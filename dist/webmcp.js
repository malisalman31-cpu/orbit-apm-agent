function requiredString(input, key, minimum = 1) {
  const value = typeof input?.[key] === "string" ? input[key].trim() : "";
  if (value.length < minimum) throw new Error(`${key} is required.`);
  return value;
}

export function registerApmTools({ modelContext, runWorkflow, readPlan, toMarkdown, signal }) {
  if (!modelContext?.registerTool) return { supported: false, count: 0 };
  if (![runWorkflow, readPlan, toMarkdown].every((value) => typeof value === "function")) {
    throw new Error("WebMCP registration requires workflow callbacks.");
  }

  const registrations = [
    {
      name: "run_apm_workflow",
      title: "Run APM workflow",
      description: "Create and display a complete product brief, PRD, backlog, experiment, risks, launch checklist, and stakeholder update from product context.",
      inputSchema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product or initiative name" },
          stage: { type: "string", enum: ["discovery", "validation", "build", "launch", "growth"] },
          audience: { type: "string" },
          problem: { type: "string", minLength: 12 },
          outcome: { type: "string", minLength: 5 },
          evidence: { type: "string" },
          constraints: { type: "string" },
          deadline: { type: "string" },
        },
        required: ["product", "problem", "outcome"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const context = {
          product: requiredString(input, "product"),
          problem: requiredString(input, "problem", 12),
          outcome: requiredString(input, "outcome", 5),
          stage: input?.stage || "discovery",
          audience: input?.audience || "",
          evidence: input?.evidence || "",
          constraints: input?.constraints || "",
          deadline: input?.deadline || "",
        };
        const plan = await runWorkflow(context);
        return {
          planId: plan.id,
          title: plan.prd.title,
          status: plan.update.status,
          backlogItems: plan.backlog.length,
          openDecisions: plan.questions.length,
        };
      },
    },
    {
      name: "read_current_apm_plan",
      title: "Read current APM plan",
      description: "Read a concise summary of the product plan currently shown in Orbit APM.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        const plan = await readPlan();
        if (!plan) return { available: false };
        return {
          available: true,
          planId: plan.id,
          title: plan.prd.title,
          objective: plan.prd.objective,
          status: plan.update.status,
          topPriorities: plan.backlog.slice(0, 3).map((item) => ({ title: item.title, score: item.score })),
          openDecisions: plan.questions,
        };
      },
    },
    {
      name: "export_current_apm_plan",
      title: "Export current APM plan",
      description: "Return the complete current Orbit APM plan as Markdown without changing it.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        const plan = await readPlan();
        if (!plan) throw new Error("No product plan is available yet.");
        return { planId: plan.id, markdown: await toMarkdown(plan) };
      },
    },
  ];

  for (const tool of registrations) {
    void Promise.resolve(modelContext.registerTool(tool, signal ? { signal } : undefined)).catch(() => {});
  }
  return { supported: true, count: registrations.length, names: registrations.map((tool) => tool.name) };
}
