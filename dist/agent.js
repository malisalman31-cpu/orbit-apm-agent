const STAGES = new Set(["discovery", "validation", "build", "launch", "growth"]);

const THEME_LEXICON = {
  activation: ["activate", "activation", "onboard", "onboarding", "first value", "setup"],
  retention: ["retain", "retention", "churn", "repeat", "return", "habit"],
  conversion: ["convert", "conversion", "checkout", "purchase", "upgrade", "signup", "sign up"],
  reliability: ["reliable", "reliability", "crash", "error", "latency", "slow", "failure"],
  discovery: ["research", "unknown", "unclear", "discover", "interview", "feedback"],
  collaboration: ["team", "share", "collaborate", "handoff", "stakeholder", "approval"],
  adoption: ["adoption", "usage", "engagement", "daily active", "weekly active", "underused"],
};

export function cleanText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function slugify(value) {
  const slug = cleanText(value, 120)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "product-plan";
}

export function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeContext(input = {}) {
  const context = {
    product: cleanText(input.product, 120) || "Product",
    stage: STAGES.has(input.stage) ? input.stage : "discovery",
    audience: cleanText(input.audience, 300),
    problem: cleanText(input.problem, 3000),
    outcome: cleanText(input.outcome, 1000),
    evidence: cleanText(input.evidence, 2000),
    constraints: cleanText(input.constraints, 1500),
    deadline: cleanText(input.deadline, 120),
  };

  if (context.problem.length < 12) {
    throw new Error("Describe the product problem in at least 12 characters.");
  }
  if (context.outcome.length < 5) {
    throw new Error("Add the outcome you want to improve.");
  }
  return context;
}

export function extractSignals(input) {
  const context = typeof input === "string" ? { problem: input } : input || {};
  const text = [context.problem, context.outcome, context.evidence, context.constraints]
    .map((value) => cleanText(value).toLowerCase())
    .join(" ");

  const themes = Object.entries(THEME_LEXICON)
    .map(([theme, words]) => ({
      theme,
      matches: words.filter((word) => text.includes(word)).length,
    }))
    .filter((entry) => entry.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.theme.localeCompare(b.theme))
    .map((entry) => entry.theme);

  const metrics = [...new Set(text.match(/(?:\$\s?)?\d+(?:\.\d+)?\s?(?:%|percent|users?|customers?|days?|weeks?|months?|minutes?|hours?|k|m)?/gi) || [])]
    .map((metric) => metric.trim())
    .filter(Boolean)
    .slice(0, 8);

  const hasEvidence = cleanText(context.evidence).length >= 15;
  const uncertainty = [
    !cleanText(context.audience),
    !hasEvidence,
    !cleanText(context.constraints),
    !cleanText(context.deadline),
  ].filter(Boolean).length;

  return {
    themes: themes.length ? themes.slice(0, 4) : ["discovery"],
    metrics,
    hasEvidence,
    uncertainty,
  };
}

export function calculateRice({ reach, impact, confidence, effort }) {
  const values = [reach, impact, confidence, effort].map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] < 0 || values[2] > 1 || values[3] <= 0) {
    throw new Error("RICE inputs must be valid: reach and impact ≥ 0, confidence 0–1, effort > 0.");
  }
  return Math.round(((values[0] * values[1] * values[2]) / values[3]) * 10) / 10;
}

function sentence(value) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstClause(value, fallback) {
  const text = cleanText(value).split(/[.!?\n]/)[0].trim();
  return text || fallback;
}

function goalAction(value) {
  const outcome = firstClause(value, "improve the target outcome").toLowerCase();
  return /^(increase|reduce|decrease|improve|grow|raise|lower|cut|reach)\b/.test(outcome)
    ? outcome
    : `improve ${outcome}`;
}

function backlogTemplates(context, signals) {
  const audience = context.audience || "target users";
  const theme = signals.themes[0];
  const themeLabel = theme === "discovery" ? "core workflow" : theme;
  const confidence = signals.hasEvidence ? 0.85 : 0.62;

  return [
    {
      title: "Define baseline and instrumentation",
      description: `Document the current baseline for “${firstClause(context.outcome, "the target outcome")},” plus event definitions and the reporting owner.`,
      reach: 10, impact: 3, confidence: signals.hasEvidence ? 0.9 : 0.7, effort: 1,
      acceptance: ["Baseline is timestamped and segmented", "Metric owner and review cadence are named"],
    },
    {
      title: `Interview ${audience}`,
      description: `Run focused discovery on the moments that create the ${themeLabel} problem and test the riskiest assumptions.`,
      reach: 9, impact: 3, confidence: 0.9, effort: 1.5,
      acceptance: ["At least five relevant sessions are synthesized", "Patterns are separated from one-off requests"],
    },
    {
      title: "Prototype the smallest viable flow",
      description: `Create a low-cost prototype that demonstrates how ${context.product} could help ${goalAction(context.outcome)}.`,
      reach: 9, impact: 3, confidence, effort: 2,
      acceptance: ["Prototype covers the critical happy path", "Usability sessions include success criteria"],
    },
    {
      title: `Build the ${themeLabel} intervention`,
      description: `Implement the smallest reversible product change that addresses: ${firstClause(context.problem, "the stated problem")}.`,
      reach: 8, impact: 3, confidence: Math.max(0.5, confidence - 0.08), effort: 2,
      acceptance: ["Core flow works end to end", "Failure and empty states are covered", "Analytics events pass QA"],
    },
    {
      title: "Run a guarded pilot",
      description: "Release to a representative cohort, monitor leading indicators, and collect qualitative feedback before scaling.",
      reach: 8, impact: 3, confidence: 0.75, effort: 3,
      acceptance: ["Pilot cohort and rollback rule are documented", "Results are reviewed against the decision threshold"],
    },
    {
      title: "Prepare launch and enablement",
      description: "Align support, sales, operations, release notes, and ownership for launch-day monitoring.",
      reach: 7, impact: 1, confidence: 0.9, effort: 2,
      acceptance: ["Support material is ready", "Launch owner and escalation path are confirmed"],
    },
    {
      title: "Review impact and decide next move",
      description: "Compare results with the baseline, document learnings, and choose whether to scale, iterate, or stop.",
      reach: 6, impact: 1, confidence: 0.9, effort: 3,
      acceptance: ["Decision memo links evidence to the recommendation", "Follow-up work has an owner"],
    },
  ];
}

function buildBacklog(context, signals) {
  return backlogTemplates(context, signals)
    .map((item, index) => ({
      id: `work-${index + 1}-${stableHash(item.title)}`,
      ...item,
      score: calculateRice(item),
      status: "not-started",
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function buildQuestions(context, signals) {
  const questions = [];
  if (!context.audience) questions.push("Which user segment feels this problem most acutely, and which segment is explicitly out of scope?");
  if (!signals.hasEvidence) questions.push("What direct customer evidence or behavioral data confirms the problem and its frequency?");
  if (!context.constraints) questions.push("Which technical, legal, operational, or staffing constraints could change the solution shape?");
  if (!context.deadline) questions.push("Is there a real decision or market deadline, and what happens if it moves?");
  questions.push("What result would make the team stop or reverse the initiative?");
  questions.push("Who owns the final tradeoff when customer value, delivery speed, and risk conflict?");
  return questions.slice(0, 6);
}

function buildRisks(context, signals) {
  const risks = [
    {
      risk: "The team solves the visible symptom instead of the underlying user problem.",
      likelihood: signals.hasEvidence ? "medium" : "high",
      mitigation: "Validate the causal chain in interviews and compare it with behavioral data before committing to scope.",
      trigger: "Users can describe the pain but do not choose or complete the proposed flow.",
    },
    {
      risk: "Success is declared from activity instead of outcome movement.",
      likelihood: "medium",
      mitigation: "Freeze the baseline, primary metric, guardrails, and evaluation window before the pilot.",
      trigger: "The team reports launches or clicks without the target outcome.",
    },
    {
      risk: "The change adds friction or harms an adjacent segment.",
      likelihood: "medium",
      mitigation: "Segment metrics, add guardrails, and retain a fast rollback path.",
      trigger: "Support contacts, errors, or drop-off rise in a protected cohort.",
    },
  ];
  if (context.constraints) {
    risks.push({
      risk: `Known constraints may force a scope tradeoff: ${firstClause(context.constraints, "delivery constraints")}.`,
      likelihood: "medium",
      mitigation: "Convert each constraint into a testable boundary and escalate unresolved conflicts before build starts.",
      trigger: "A constraint blocks the critical path or invalidates the measurement plan.",
    });
  }
  return risks;
}

export function generatePlan(input, options = {}) {
  const context = normalizeContext(input);
  const signals = extractSignals(context);
  const createdAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const audience = context.audience || "the highest-need user segment";
  const backlog = buildBacklog(context, signals);
  const targetMetric = sentence(context.outcome);
  const evidence = context.evidence || "No customer or behavioral evidence has been supplied yet.";
  const deadline = context.deadline || "No fixed deadline; sequence around evidence and decision readiness.";

  const plan = {
    schemaVersion: 1,
    id: `plan-${stableHash(JSON.stringify(context) + createdAt)}`,
    createdAt,
    context,
    signals,
    brief: {
      problem: sentence(context.problem),
      audience,
      desiredOutcome: targetMetric,
      evidence: sentence(evidence),
      strategy: `Reduce uncertainty first, then ship the smallest reversible intervention that can help ${goalAction(context.outcome)}.`,
      scope: `Focus on ${audience}; protect adjacent journeys with explicit guardrails.`,
      deadline,
    },
    questions: buildQuestions(context, signals),
    prd: {
      title: `${context.product}: ${firstClause(context.outcome, "outcome initiative")}`,
      objective: `For ${audience}, address ${firstClause(context.problem, "the stated problem").toLowerCase()} in order to ${goalAction(context.outcome)}.`,
      nonGoals: [
        "Redesigning unrelated journeys or rebuilding the product platform.",
        "Optimizing secondary metrics before the primary outcome is validated.",
        "Scaling to every segment before the target cohort shows value.",
      ],
      userStories: [
        `As ${audience}, I can complete the critical flow with less uncertainty or effort.`,
        `As a product team member, I can see whether the team is on track to ${goalAction(context.outcome)}.`,
        "As a support or operations partner, I can identify failures and follow a clear escalation path.",
      ],
      requirements: [
        "Cover the primary happy path, loading, empty, permission, and recoverable failure states.",
        "Instrument exposure, first action, completion, outcome, error, and rollback events.",
        "Define eligibility and exclusion rules for the pilot cohort.",
        "Provide an owner-visible kill switch or rollback procedure.",
        "Meet the product's accessibility, privacy, security, and support-readiness standards.",
      ],
      success: {
        primary: targetMetric,
        leading: "Critical-flow completion rate and time to first value improve for the target cohort.",
        guardrails: "No material regression in reliability, support contact rate, adjacent conversion, or user trust.",
        window: context.deadline ? `Evaluate by ${context.deadline}.` : "Set an evaluation window before the pilot begins.",
      },
    },
    backlog,
    experiment: {
      hypothesis: `If ${context.product} removes the main friction behind ${firstClause(context.problem, "the problem").toLowerCase()}, then we will ${goalAction(context.outcome)} for ${audience}, because the critical journey becomes clearer and easier to complete.`,
      method: context.stage === "discovery"
        ? "Start with five structured interviews and a task-based prototype test; move to a guarded behavioral pilot only if the core assumption holds."
        : "Run a guarded cohort pilot against the current experience, with qualitative follow-up for unexpected behavior.",
      primaryMetric: targetMetric,
      guardrails: ["Error and failure rate", "Support contact rate", "Adjacent-funnel conversion", "Opt-out or rollback rate"],
      decisionRules: [
        "Scale when the primary metric moves in the intended direction and no guardrail crosses its agreed threshold.",
        "Iterate when qualitative evidence supports the mechanism but the outcome signal is weak or uneven.",
        "Stop when the mechanism is disproven, trust is harmed, or the expected value no longer justifies the cost.",
      ],
    },
    risks: buildRisks(context, signals),
    launch: [
      { group: "Evidence", items: ["Problem evidence reviewed", "Baseline and segments frozen", "Decision thresholds approved"] },
      { group: "Product", items: ["Critical states tested", "Analytics QA complete", "Accessibility review complete"] },
      { group: "Risk", items: ["Privacy and security review complete", "Rollback path rehearsed", "Guardrail alerts assigned"] },
      { group: "Readiness", items: ["Support briefed", "Release notes ready", "Launch owner and escalation channel confirmed"] },
      { group: "Learning", items: ["Pilot cohort confirmed", "Review date scheduled", "Scale / iterate / stop owner named"] },
    ],
    decisions: [
      {
        decision: `Start with the ${audience} segment rather than broad release.`,
        rationale: "A narrow cohort improves signal quality and keeps the first change reversible.",
        status: "proposed",
      },
      {
        decision: "Use outcome movement plus guardrails as the launch decision, not delivery completion.",
        rationale: "Shipping is an input; customer and business impact determine whether to scale.",
        status: "proposed",
      },
    ],
    update: {
      headline: `${context.product}: ${context.outcome}`,
      status: !signals.hasEvidence || signals.uncertainty >= 3 ? "Needs evidence" : context.stage === "launch" ? "Preparing launch" : "In progress",
      summary: `We are addressing ${firstClause(context.problem, "the product problem").toLowerCase()} for ${audience}. The plan prioritizes baseline measurement, focused discovery, a reversible prototype, and a guarded pilot.`,
      progress: [
        "Problem, intended outcome, and first-pass scope are documented.",
        `${backlog.length} work items are prioritized using a consistent RICE model.`,
        "Experiment decision rules and launch guardrails are defined.",
      ],
      next: backlog.slice(0, 3).map((item) => item.title),
      asks: buildQuestions(context, signals).slice(0, 2),
    },
  };

  return plan;
}

function lineList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function tableCell(value) {
  return cleanText(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function planToMarkdown(plan) {
  if (!plan?.context || !plan?.brief || !Array.isArray(plan.backlog)) {
    throw new Error("A valid Orbit plan is required for Markdown export.");
  }
  const checklist = plan.launch
    .map((section) => `### ${section.group}\n${section.items.map((item) => `- [ ] ${item}`).join("\n")}`)
    .join("\n\n");
  const backlog = plan.backlog
    .map((item) => `| ${tableCell(item.title)} | ${item.score} | ${item.reach} | ${item.impact} | ${Math.round(item.confidence * 100)}% | ${item.effort} |`)
    .join("\n");
  const risks = plan.risks
    .map((risk) => `| ${tableCell(risk.risk)} | ${risk.likelihood} | ${tableCell(risk.mitigation)} |`)
    .join("\n");

  return `# ${plan.prd.title}\n\n_Generated by Orbit APM on ${new Date(plan.createdAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })}_\n\n## Product brief\n\n**Problem**\n${plan.brief.problem}\n\n**Audience**\n${plan.brief.audience}\n\n**Desired outcome**\n${plan.brief.desiredOutcome}\n\n**Evidence**\n${plan.brief.evidence}\n\n**Strategy**\n${plan.brief.strategy}\n\n**Scope**\n${plan.brief.scope}\n\n## Open decisions\n\n${lineList(plan.questions)}\n\n## PRD\n\n### Objective\n${plan.prd.objective}\n\n### Non-goals\n${lineList(plan.prd.nonGoals)}\n\n### User stories\n${lineList(plan.prd.userStories)}\n\n### Requirements\n${lineList(plan.prd.requirements)}\n\n### Success\n- Primary: ${plan.prd.success.primary}\n- Leading: ${plan.prd.success.leading}\n- Guardrails: ${plan.prd.success.guardrails}\n- Window: ${plan.prd.success.window}\n\n## Prioritized backlog\n\n| Work item | RICE | Reach | Impact | Confidence | Effort |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${backlog}\n\n## Experiment plan\n\n**Hypothesis**\n${plan.experiment.hypothesis}\n\n**Method**\n${plan.experiment.method}\n\n**Decision rules**\n${lineList(plan.experiment.decisionRules)}\n\n## Risks\n\n| Risk | Likelihood | Mitigation |\n| --- | --- | --- |\n${risks}\n\n## Launch checklist\n\n${checklist}\n\n## Stakeholder update\n\n**${plan.update.status}: ${plan.update.headline}**\n\n${plan.update.summary}\n\n### Progress\n${lineList(plan.update.progress)}\n\n### Next\n${lineList(plan.update.next)}\n\n### Asks\n${lineList(plan.update.asks)}\n`;
}

export function serializeWorkspace(plan) {
  if (!plan?.id || !plan?.context) throw new Error("A valid plan is required.");
  return JSON.stringify({ app: "orbit-apm", exportedAt: new Date().toISOString(), plan }, null, 2);
}

export function parseWorkspace(raw) {
  if (typeof raw !== "string" || raw.length > 1_000_000) throw new Error("Workspace file is empty or too large.");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Workspace file is not valid JSON.");
  }
  const plan = data?.app === "orbit-apm" ? data.plan : data;
  if (!plan?.id || plan?.schemaVersion !== 1 || !plan?.context || !plan?.prd || !Array.isArray(plan?.backlog)) {
    throw new Error("This is not a supported Orbit workspace.");
  }
  return plan;
}
