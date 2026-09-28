import {
  generatePlan,
  parseWorkspace,
  planToMarkdown,
  serializeWorkspace,
  slugify,
} from "./agent.js";
import { registerApmTools } from "./webmcp.js";

const STORAGE_KEY = "orbit-apm-current-v1";
const HISTORY_KEY = "orbit-apm-history-v1";
const CHECK_KEY = "orbit-apm-checks-v1";

const form = document.querySelector("#apm-form");
const output = document.querySelector("#output");
const emptyState = document.querySelector("#empty-state");
const planView = document.querySelector("#plan-view");
const planKicker = document.querySelector("#plan-kicker");
const planTitle = document.querySelector("#plan-title");
const planStatus = document.querySelector("#plan-status");
const artifactContent = document.querySelector("#artifact-content");
const artifactNav = document.querySelector("#artifact-nav");
const formError = document.querySelector("#form-error");
const historyList = document.querySelector("#history-list");
const toast = document.querySelector("#toast");
const exportButton = document.querySelector("#export-menu-button");
const exportMenu = document.querySelector("#export-menu");
const importInput = document.querySelector("#import-file");

let currentPlan = null;
let currentView = "brief";
let toastTimer;

const SAMPLES = {
  activation: {
    product: "Workspace onboarding",
    stage: "validation",
    audience: "New workspace admins at 20–100 person companies",
    problem: "New admins invite teammates but do not configure the two permissions required for colleagues to finish setup. They leave onboarding thinking the workspace is ready, then return to support tickets and an inactive team.",
    outcome: "Increase seven-day team activation from 32% to 45%",
    evidence: "Funnel analysis shows a 41% drop between inviting a teammate and permission setup. Six of eight recent admin interviews described permissions as unclear.",
    constraints: "Two engineers for one cycle; the permissions model cannot change this quarter.",
    deadline: "Pilot decision by October 30",
  },
  retention: {
    product: "Weekly planning",
    stage: "discovery",
    audience: "Team leads who created at least one project",
    problem: "Team leads finish their first weekly plan but do not return because updating status requires too much manual collection from teammates. The plan becomes stale and loses trust after the first week.",
    outcome: "Improve week-four retained planning teams by 20%",
    evidence: "Cohort retention falls from 58% in week one to 21% in week four. Support notes repeatedly mention stale status and chasing updates.",
    constraints: "No new notification channels in the first release.",
    deadline: "Recommend a direction before annual planning",
  },
  reliability: {
    product: "Mobile checkout",
    stage: "build",
    audience: "Returning mobile shoppers on slower connections",
    problem: "Checkout occasionally loses the selected delivery option after a network interruption. Customers see a generic error, repeat earlier steps, and abandon a high-intent purchase.",
    outcome: "Reduce checkout abandonment after recoverable network errors by 30%",
    evidence: "Session replay and logs link 14% of mobile checkout failures to delivery-option state loss. Conversion is 8 points lower for affected sessions.",
    constraints: "The payment provider and delivery API cannot change; release must support the two latest mobile browser versions.",
    deadline: "Ship before the holiday code freeze",
  },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(label, text, options = {}) {
  const node = element("section", `card${options.accent ? " card-accent" : ""}${options.decision ? " decision-card" : ""}`);
  node.append(element("span", "card-label", label));
  if (options.title) node.append(element("h3", "", options.title));
  if (text) node.append(element("p", "", text));
  return node;
}

function list(items, className = "plain-list") {
  const node = element("ul", className);
  for (const item of items) node.append(element("li", "", item));
  return node;
}

function sectionWithList(label, items, options = {}) {
  const node = card(label, "", options);
  node.append(list(items, options.decision ? "decision-list" : "plain-list"));
  return node;
}

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function formContext() {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)]));
}

function fillForm(context) {
  for (const [key, value] of Object.entries(context || {})) {
    const control = form.elements.namedItem(key);
    if (control) control.value = value;
  }
  if (context?.audience || context?.evidence || context?.constraints || context?.deadline) {
    document.querySelector(".context-details").open = true;
  }
}

function persistPlan(plan) {
  storeJSON(STORAGE_KEY, plan);
  const history = loadJSON(HISTORY_KEY, []).filter((item) => item?.id && item.id !== plan.id);
  history.unshift(plan);
  storeJSON(HISTORY_KEY, history.slice(0, 8));
  renderHistory();
}

function renderHistory() {
  const history = loadJSON(HISTORY_KEY, []).filter((item) => item?.id && item?.context);
  historyList.replaceChildren();
  if (!history.length) {
    historyList.append(element("p", "history-empty", "Your plans will appear here."));
    return;
  }
  for (const plan of history) {
    const button = element("button", "history-item");
    button.type = "button";
    button.dataset.planId = plan.id;
    button.append(element("b", "", plan.context.product || "Product plan"));
    const date = new Date(plan.createdAt);
    button.append(element("small", "", `${plan.update?.status || "Plan"} · ${Number.isNaN(date.valueOf()) ? "Saved" : date.toLocaleDateString()}`));
    historyList.append(button);
  }
}

function setCurrentPlan(plan, { persist = true, view = "brief" } = {}) {
  currentPlan = plan;
  currentView = view;
  if (persist) persistPlan(plan);
  fillForm(plan.context);
  emptyState.hidden = true;
  planView.hidden = false;
  for (const button of artifactNav.querySelectorAll("button")) button.disabled = false;
  renderCurrentView();
}

function renderCurrentView() {
  if (!currentPlan) return;
  const labels = {
    brief: "Product brief",
    prd: "Requirements",
    backlog: "Prioritized work",
    experiment: "Evidence plan",
    risks: "Risk register",
    launch: "Readiness",
    update: "Stakeholder communication",
  };
  artifactContent.replaceChildren();
  planKicker.textContent = labels[currentView];
  planTitle.textContent = currentView === "brief" ? currentPlan.prd.title : titleForView(currentView);
  planStatus.textContent = currentPlan.update.status;
  planStatus.dataset.status = currentPlan.update.status;

  for (const button of artifactNav.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.view === currentView);
  }

  const renderer = {
    brief: renderBrief,
    prd: renderPrd,
    backlog: renderBacklog,
    experiment: renderExperiment,
    risks: renderRisks,
    launch: renderLaunch,
    update: renderUpdate,
  }[currentView];
  renderer(currentPlan);
}

function titleForView(view) {
  return {
    prd: "What the team will build—and what it will not",
    backlog: "Work ordered by expected value",
    experiment: "How the team will earn confidence",
    risks: "What could change the decision",
    launch: "The path to a responsible release",
    update: "A concise readout for stakeholders",
  }[view];
}

function renderBrief(plan) {
  artifactContent.append(card("Strategy", plan.brief.strategy, { accent: true }));
  const grid = element("div", "card-grid");
  grid.append(
    card("Problem", plan.brief.problem),
    card("Audience", plan.brief.audience),
    card("Desired outcome", plan.brief.desiredOutcome),
    card("Evidence", plan.brief.evidence),
    card("Scope", plan.brief.scope),
    card("Decision timing", plan.brief.deadline),
  );
  artifactContent.append(grid);
  artifactContent.append(sectionWithList("Open decisions", plan.questions, { decision: true }));
}

function renderPrd(plan) {
  artifactContent.append(card("Objective", plan.prd.objective, { accent: true }));
  const grid = element("div", "card-grid");
  grid.append(sectionWithList("User stories", plan.prd.userStories), sectionWithList("Non-goals", plan.prd.nonGoals));
  artifactContent.append(grid, sectionWithList("Requirements", plan.prd.requirements));

  const metrics = card("Success measures", "");
  const metricGrid = element("div", "metric-grid");
  for (const [label, value] of Object.entries({
    Primary: plan.prd.success.primary,
    Leading: plan.prd.success.leading,
    Guardrails: plan.prd.success.guardrails,
    Window: plan.prd.success.window,
  })) {
    const metric = element("div", "metric");
    metric.append(element("span", "", label), element("p", "", value));
    metricGrid.append(metric);
  }
  metrics.append(metricGrid);
  artifactContent.append(metrics);
}

function renderBacklog(plan) {
  const checks = loadJSON(CHECK_KEY, {});
  const wrapper = element("div", "backlog-wrap");
  const table = element("table", "backlog-table");
  const head = element("thead");
  const row = element("tr");
  for (const heading of ["Work item", "RICE", "Reach", "Impact", "Confidence", "Effort"]) row.append(element("th", "", heading));
  head.append(row);
  const body = element("tbody");

  for (const item of plan.backlog) {
    const tr = element("tr", checks[`${plan.id}:${item.id}`] ? "done" : "");
    const work = element("td");
    const workCell = element("div", "work-cell");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(checks[`${plan.id}:${item.id}`]);
    checkbox.setAttribute("aria-label", `Mark ${item.title} complete`);
    checkbox.dataset.checkId = `${plan.id}:${item.id}`;
    const copy = element("div");
    copy.append(element("span", "work-title", item.title), element("span", "work-desc", item.description));
    workCell.append(checkbox, copy);
    work.append(workCell);
    tr.append(work, scoreCell(item.score), numberCell(item.reach), numberCell(item.impact), numberCell(`${Math.round(item.confidence * 100)}%`), numberCell(item.effort));
    body.append(tr);
  }
  table.append(head, body);
  wrapper.append(table);
  artifactContent.append(wrapper, element("p", "legend", "RICE = reach × impact × confidence ÷ effort. Scores are directional and should be updated with real evidence."));
}

function scoreCell(value) {
  const td = element("td");
  td.append(element("span", "score", String(value)));
  return td;
}

function numberCell(value) { return element("td", "number", String(value)); }

function renderExperiment(plan) {
  artifactContent.append(card("Hypothesis", plan.experiment.hypothesis, { accent: true }));
  const flow = element("div", "experiment-flow");
  const steps = [
    ["01 · Learn", plan.experiment.method],
    ["02 · Measure", plan.experiment.primaryMetric],
    ["03 · Decide", "Scale, iterate, or stop against pre-agreed thresholds."],
  ];
  steps.forEach(([title, text], index) => {
    const step = element("div", "flow-card");
    step.append(element("b", "", title), element("p", "", text));
    flow.append(step);
    if (index < steps.length - 1) flow.append(element("div", "flow-arrow", "→"));
  });
  artifactContent.append(flow);
  const grid = element("div", "card-grid");
  grid.append(sectionWithList("Guardrails", plan.experiment.guardrails), sectionWithList("Decision rules", plan.experiment.decisionRules));
  artifactContent.append(grid);
}

function renderRisks(plan) {
  for (const risk of plan.risks) {
    const node = element("article", "card risk-card");
    node.append(element("h3", "", risk.risk));
    const level = element("div");
    level.append(element("span", "card-label", "Likelihood"), element("span", "risk-level", risk.likelihood));
    const meta = element("div", "risk-meta");
    const mitigation = element("div");
    mitigation.append(element("span", "card-label", "Mitigation"), element("p", "", risk.mitigation));
    const trigger = element("div");
    trigger.append(element("span", "card-label", "Watch for"), element("p", "", risk.trigger));
    meta.append(mitigation, trigger);
    node.append(level, meta);
    artifactContent.append(node);
  }
}

function renderLaunch(plan) {
  const checks = loadJSON(CHECK_KEY, {});
  const wrapper = element("div", "checklist");
  for (const section of plan.launch) {
    const group = element("section", "check-group");
    group.append(element("h3", "", section.group));
    for (const item of section.items) {
      const key = `${plan.id}:launch:${section.group}:${item}`;
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(checks[key]);
      checkbox.dataset.checkId = key;
      label.append(checkbox, element("span", "", item));
      group.append(label);
    }
    wrapper.append(group);
  }
  artifactContent.append(wrapper);
}

function renderUpdate(plan) {
  const sheet = element("article", "update-sheet");
  const banner = element("div", "update-banner");
  banner.append(element("h3", "", plan.update.headline), element("span", "", plan.update.status));
  const body = element("div", "update-body");
  const summary = element("section");
  summary.append(element("h4", "", "Summary"), element("p", "", plan.update.summary));
  body.append(summary);
  for (const [label, values] of [["Progress", plan.update.progress], ["Next", plan.update.next], ["Asks", plan.update.asks]]) {
    const section = element("section");
    section.append(element("h4", "", label), list(values));
    body.append(section);
  }
  sheet.append(banner, body);
  artifactContent.append(sheet);
}

async function runWorkflow(context) {
  output.setAttribute("aria-busy", "true");
  formError.hidden = true;
  try {
    const plan = generatePlan(context);
    setCurrentPlan(plan);
    showToast("Plan ready. Start with the open decisions.");
    return plan;
  } finally {
    output.setAttribute("aria-busy", "false");
  }
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await runWorkflow(formContext());
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
    formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
  if (event.key === "Escape") {
    exportMenu.hidden = true;
    exportButton.setAttribute("aria-expanded", "false");
  }
});

artifactNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button || button.disabled) return;
  currentView = button.dataset.view;
  renderCurrentView();
  if (matchMedia("(max-width: 880px)").matches) planView.scrollIntoView({ behavior: "smooth", block: "start" });
});

artifactContent.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-check-id]");
  if (!checkbox) return;
  const checks = loadJSON(CHECK_KEY, {});
  checks[checkbox.dataset.checkId] = checkbox.checked;
  storeJSON(CHECK_KEY, checks);
  checkbox.closest("tr")?.classList.toggle("done", checkbox.checked);
});

document.querySelector(".samples").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sample]");
  if (!button) return;
  fillForm(SAMPLES[button.dataset.sample]);
  document.querySelector("#problem").focus();
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-plan-id]");
  if (!button) return;
  const plan = loadJSON(HISTORY_KEY, []).find((item) => item.id === button.dataset.planId);
  if (plan) {
    setCurrentPlan(plan, { persist: false });
    showToast("Saved plan restored.");
  }
});

document.querySelector("#clear-history").addEventListener("click", () => {
  storeJSON(HISTORY_KEY, []);
  renderHistory();
  showToast("Run history cleared. The current plan is unchanged.");
});

exportButton.addEventListener("click", () => {
  const willOpen = exportMenu.hidden;
  exportMenu.hidden = !willOpen;
  exportButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) exportMenu.querySelector("button")?.focus();
});

exportMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-export]");
  if (!button) return;
  if (!currentPlan) {
    showToast("Run a workflow before exporting.");
    return;
  }
  const basename = slugify(currentPlan.context.product);
  if (button.dataset.export === "markdown") download(`${basename}-plan.md`, planToMarkdown(currentPlan), "text/markdown");
  if (button.dataset.export === "json") download(`${basename}-workspace.json`, serializeWorkspace(currentPlan), "application/json");
  exportMenu.hidden = true;
  exportButton.setAttribute("aria-expanded", "false");
  showToast("Export downloaded.");
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#export-menu") && !event.target.closest("#export-menu-button")) {
    exportMenu.hidden = true;
    exportButton.setAttribute("aria-expanded", "false");
  }
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error("Workspace file must be smaller than 1 MB.");
    const plan = parseWorkspace(await file.text());
    setCurrentPlan(plan);
    showToast("Workspace imported.");
  } catch (error) {
    showToast(error.message);
  } finally {
    importInput.value = "";
  }
});

document.querySelector("#copy-view").addEventListener("click", async () => {
  if (!currentPlan) return;
  const text = `${planTitle.textContent}\n\n${artifactContent.innerText}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Current artifact copied.");
  } catch {
    showToast("Copy is unavailable in this browser.");
  }
});

const storedPlan = loadJSON(STORAGE_KEY, null);
renderHistory();
if (storedPlan?.id && storedPlan?.schemaVersion === 1) setCurrentPlan(storedPlan, { persist: false });

const lifecycle = new AbortController();
registerApmTools({
  modelContext: document.modelContext,
  runWorkflow: async (context) => {
    fillForm(context);
    return runWorkflow(context);
  },
  readPlan: () => currentPlan,
  toMarkdown: planToMarkdown,
  signal: lifecycle.signal,
});
window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
