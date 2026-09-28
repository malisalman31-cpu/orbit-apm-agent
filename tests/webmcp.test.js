import test from "node:test";
import assert from "node:assert/strict";
import { generatePlan, planToMarkdown } from "../dist/agent.js";
import { registerApmTools } from "../dist/webmcp.js";

const context = {
  product: "Search",
  stage: "discovery",
  audience: "Active customers",
  problem: "Customers cannot find saved work after their workspace grows.",
  outcome: "Reduce time to find saved work by 40%",
};

function harness(current = null) {
  const tools = new Map();
  return {
    tools,
    modelContext: {
      registerTool(tool, options) {
        tools.set(tool.name, { ...tool, options });
      },
    },
    callbacks: {
      runWorkflow(input) {
        current = generatePlan(input, { now: "2026-09-27T12:00:00.000Z" });
        return current;
      },
      readPlan() { return current; },
      toMarkdown: planToMarkdown,
    },
  };
}

test("returns unsupported when modelContext is absent", () => {
  assert.deepEqual(registerApmTools({}), { supported: false, count: 0 });
});

test("requires workflow callbacks", () => {
  assert.throws(() => registerApmTools({ modelContext: { registerTool() {} } }), /requires workflow callbacks/);
});

test("registers three stable tools", () => {
  const kit = harness();
  const result = registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  assert.equal(result.count, 3);
  assert.deepEqual(result.names, ["run_apm_workflow", "read_current_apm_plan", "export_current_apm_plan"]);
  assert.equal(kit.tools.size, 3);
});

test("marks mutating and read-only tools correctly", () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  assert.equal(kit.tools.get("run_apm_workflow").annotations.readOnlyHint, false);
  assert.equal(kit.tools.get("read_current_apm_plan").annotations.readOnlyHint, true);
  assert.equal(kit.tools.get("export_current_apm_plan").annotations.readOnlyHint, true);
});

test("passes an AbortSignal into registrations", () => {
  const kit = harness();
  const controller = new AbortController();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks, signal: controller.signal });
  assert.equal(kit.tools.get("run_apm_workflow").options.signal, controller.signal);
});

test("run tool executes the visible workflow and returns a concise result", async () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  const result = await kit.tools.get("run_apm_workflow").execute(context);
  assert.match(result.planId, /^plan-/);
  assert.equal(result.backlogItems, 7);
  assert.ok(result.openDecisions >= 2);
});

test("run tool rejects a too-short problem before mutation", async () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  await assert.rejects(() => kit.tools.get("run_apm_workflow").execute({ ...context, problem: "Too short" }), /problem is required/);
  assert.equal(await kit.callbacks.readPlan(), null);
});

test("read tool reports empty state", async () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  assert.deepEqual(await kit.tools.get("read_current_apm_plan").execute({}), { available: false });
});

test("read tool returns current priorities after a run", async () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  await kit.tools.get("run_apm_workflow").execute(context);
  const result = await kit.tools.get("read_current_apm_plan").execute({});
  assert.equal(result.available, true);
  assert.equal(result.topPriorities.length, 3);
  assert.match(result.objective, /Active customers/);
});

test("export tool intentionally fails when no plan exists", async () => {
  const kit = harness();
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  await assert.rejects(() => kit.tools.get("export_current_apm_plan").execute({}), /No product plan/);
});

test("export tool returns Markdown for the current plan", async () => {
  const plan = generatePlan(context, { now: "2026-09-27T12:00:00.000Z" });
  const kit = harness(plan);
  registerApmTools({ modelContext: kit.modelContext, ...kit.callbacks });
  const result = await kit.tools.get("export_current_apm_plan").execute({});
  assert.equal(result.planId, plan.id);
  assert.match(result.markdown, /^# Search:/);
});
