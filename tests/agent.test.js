import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRice,
  cleanText,
  extractSignals,
  generatePlan,
  normalizeContext,
  parseWorkspace,
  planToMarkdown,
  serializeWorkspace,
  slugify,
  stableHash,
} from "../dist/agent.js";

const validContext = {
  product: "Team onboarding",
  stage: "validation",
  audience: "New workspace admins",
  problem: "New workspace admins invite teammates but do not finish permissions setup.",
  outcome: "Increase seven-day activation from 32% to 45%",
  evidence: "Six of eight interviews describe permissions as unclear, with a 41% funnel drop.",
  constraints: "Two engineers and no permissions-model changes this quarter.",
  deadline: "Pilot decision by October 30",
};

const fixedNow = "2026-09-27T12:00:00.000Z";

test("cleanText trims, normalizes line endings, and removes control characters", () => {
  assert.equal(cleanText("  hello\r\nworld\u0000  "), "hello\nworld");
});

test("cleanText enforces the maximum length", () => {
  assert.equal(cleanText("abcdef", 3), "abc");
});

test("slugify creates a portable filename", () => {
  assert.equal(slugify("  Café Team / Launch!  "), "cafe-team-launch");
});

test("slugify falls back when no ASCII characters remain", () => {
  assert.equal(slugify("产品"), "product-plan");
});

test("stableHash is deterministic and sensitive to input", () => {
  assert.equal(stableHash("alpha"), stableHash("alpha"));
  assert.notEqual(stableHash("alpha"), stableHash("beta"));
});

test("normalizeContext supplies safe defaults", () => {
  const context = normalizeContext({ problem: "A sufficiently clear problem", outcome: "Grow retention", stage: "invalid" });
  assert.equal(context.product, "Product");
  assert.equal(context.stage, "discovery");
});

test("normalizeContext rejects short problems", () => {
  assert.throws(() => normalizeContext({ problem: "Too short", outcome: "Grow" }), /at least 12/);
});

test("normalizeContext rejects missing outcomes", () => {
  assert.throws(() => normalizeContext({ problem: "This problem is long enough", outcome: "" }), /outcome/);
});

test("extractSignals identifies activation and collaboration themes", () => {
  const signals = extractSignals({ problem: "Onboarding setup breaks when teams share work", outcome: "Improve activation" });
  assert.ok(signals.themes.includes("activation"));
  assert.ok(signals.themes.includes("collaboration"));
});

test("extractSignals returns discovery as the default theme", () => {
  assert.deepEqual(extractSignals("An unusual product concern without known keywords").themes, ["discovery"]);
});

test("extractSignals captures numeric metrics without duplicates", () => {
  const signals = extractSignals({ problem: "32% leave after 7 days", outcome: "Move 32% to 45%" });
  assert.ok(signals.metrics.includes("32%"));
  assert.ok(signals.metrics.includes("45%"));
  assert.equal(signals.metrics.filter((item) => item === "32%").length, 1);
});

test("extractSignals reports uncertainty from missing context", () => {
  assert.equal(extractSignals({ problem: "A long enough problem" }).uncertainty, 4);
});

test("calculateRice applies the standard formula", () => {
  assert.equal(calculateRice({ reach: 10, impact: 3, confidence: 0.8, effort: 2 }), 12);
});

test("calculateRice rounds to one decimal", () => {
  assert.equal(calculateRice({ reach: 7, impact: 2, confidence: 0.75, effort: 4 }), 2.6);
});

test("calculateRice rejects invalid confidence", () => {
  assert.throws(() => calculateRice({ reach: 1, impact: 1, confidence: 2, effort: 1 }), /RICE inputs/);
});

test("calculateRice rejects zero effort", () => {
  assert.throws(() => calculateRice({ reach: 1, impact: 1, confidence: 0.8, effort: 0 }), /RICE inputs/);
});

test("generatePlan creates the complete artifact topology", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.equal(plan.createdAt, fixedNow);
  assert.ok(plan.brief.problem);
  assert.ok(plan.prd.requirements.length >= 5);
  assert.ok(plan.backlog.length >= 7);
  assert.ok(plan.experiment.decisionRules.length >= 3);
  assert.ok(plan.risks.length >= 3);
  assert.ok(plan.launch.length >= 5);
  assert.ok(plan.update.summary);
});

test("generatePlan is deterministic when time is fixed", () => {
  assert.deepEqual(generatePlan(validContext, { now: fixedNow }), generatePlan(validContext, { now: fixedNow }));
});

test("generatePlan backlog is sorted by descending RICE score", () => {
  const scores = generatePlan(validContext, { now: fixedNow }).backlog.map((item) => item.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test("generatePlan prioritizes the baseline before downstream execution", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.equal(plan.backlog[0].title, "Define baseline and instrumentation");
  assert.ok(plan.backlog.findIndex((item) => item.title.startsWith("Build the")) < plan.backlog.findIndex((item) => item.title === "Run a guarded pilot"));
});

test("generatePlan backlog IDs are unique", () => {
  const ids = generatePlan(validContext, { now: fixedNow }).backlog.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("generatePlan flags missing evidence", () => {
  const plan = generatePlan({ ...validContext, evidence: "" }, { now: fixedNow });
  assert.equal(plan.update.status, "Needs evidence");
  assert.match(plan.brief.evidence, /No customer/);
  assert.ok(plan.questions.some((question) => /evidence/i.test(question)));
});

test("generatePlan uses launch status at the launch stage", () => {
  const plan = generatePlan({ ...validContext, stage: "launch" }, { now: fixedNow });
  assert.equal(plan.update.status, "Preparing launch");
});

test("generatePlan carries target audience into objective and hypothesis", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.match(plan.prd.objective, /New workspace admins/);
  assert.match(plan.experiment.hypothesis, /New workspace admins/);
});

test("generatePlan keeps action-oriented outcomes grammatical", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.doesNotMatch(plan.brief.strategy, /improve increase/i);
  assert.match(plan.prd.objective, /in order to increase seven-day activation/i);
});

test("generatePlan turns supplied constraints into a risk", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.ok(plan.risks.some((risk) => risk.risk.includes("Two engineers")));
});

test("generatePlan leaves a clear decision-timing fallback", () => {
  const plan = generatePlan({ ...validContext, deadline: "" }, { now: fixedNow });
  assert.match(plan.brief.deadline, /No fixed deadline/);
});

test("planToMarkdown exports every major artifact", () => {
  const markdown = planToMarkdown(generatePlan(validContext, { now: fixedNow }));
  for (const heading of ["## Product brief", "## PRD", "## Prioritized backlog", "## Experiment plan", "## Risks", "## Launch checklist", "## Stakeholder update"]) {
    assert.ok(markdown.includes(heading));
  }
});

test("planToMarkdown includes checklist syntax and RICE table", () => {
  const markdown = planToMarkdown(generatePlan(validContext, { now: fixedNow }));
  assert.match(markdown, /- \[ \] Problem evidence reviewed/);
  assert.match(markdown, /\| Work item \| RICE \|/);
});

test("planToMarkdown escapes pipes in table cells", () => {
  const plan = generatePlan({ ...validContext, problem: "Admins see setup | approval break during team onboarding." }, { now: fixedNow });
  plan.risks[0].risk = "Trust | reliability regression";
  assert.match(planToMarkdown(plan), /Trust \\\| reliability/);
});

test("planToMarkdown rejects incomplete plans", () => {
  assert.throws(() => planToMarkdown({}), /valid Orbit plan/);
});

test("serializeWorkspace and parseWorkspace round trip", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.deepEqual(parseWorkspace(serializeWorkspace(plan)), plan);
});

test("parseWorkspace accepts a raw supported plan", () => {
  const plan = generatePlan(validContext, { now: fixedNow });
  assert.deepEqual(parseWorkspace(JSON.stringify(plan)), plan);
});

test("parseWorkspace rejects malformed JSON", () => {
  assert.throws(() => parseWorkspace("{nope"), /not valid JSON/);
});

test("parseWorkspace rejects unsupported objects", () => {
  assert.throws(() => parseWorkspace(JSON.stringify({ app: "elsewhere" })), /not a supported/);
});

test("parseWorkspace rejects oversized imports", () => {
  assert.throws(() => parseWorkspace("x".repeat(1_000_001)), /too large/);
});
