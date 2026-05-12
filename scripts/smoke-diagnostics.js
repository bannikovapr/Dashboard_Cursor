"use strict";

const fs = require("fs");
const path = require("path");

const SMOKE_PREFIX = "[SMOKE][diagnostics]";

function fail(message, extra) {
  console.error(`${SMOKE_PREFIX} FAIL: ${message}`);
  if (extra != null) {
    if (typeof extra === "string") console.error(extra);
    else console.error(JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function pass(message) {
  console.log(`${SMOKE_PREFIX} OK: ${message}`);
}

function readJson(relPath) {
  const abs = path.resolve(__dirname, "..", relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf-8"));
  } catch (e) {
    fail(`cannot read JSON ${relPath}`, String(e && e.message ? e.message : e));
    return null;
  }
}

function assert(condition, message, extra) {
  if (!condition) fail(message, extra);
}

const Diagnostics = require("../js/toir-diagnostics");
assert(Diagnostics, "module js/toir-diagnostics is not exported");
assert(typeof Diagnostics.analyzeAll === "function", "analyzeAll is not a function");
assert(typeof Diagnostics.summarize === "function", "summarize is not a function");
assert(Diagnostics.STATUS && Diagnostics.STATUS.TRIGGERED === "triggered", "STATUS.TRIGGERED is invalid");
pass("module exports analyzeAll/summarize/STATUS");

const raw = readJson("data/toir.json");
assert(raw && typeof raw === "object", "data/toir.json is empty or invalid");
assert(raw.charts && raw.tables, "data/toir.json has no charts/tables");
assert(Array.isArray(raw.tables.repairEvents) && raw.tables.repairEvents.length >= 10,
  `repairEvents must be populated (need event rows from Excel), got ${(raw.tables.repairEvents || []).length}`);
pass("loaded data/toir.json");

const results = Diagnostics.analyzeAll(raw, { period: "all", class: "__all__" });
assert(Array.isArray(results), "analyzeAll did not return an array");
assert(results.length >= 13, `expected at least 13 diagnostics, got ${results.length}`);
pass(`analyzeAll returned ${results.length} diagnostics`);

const expectedIds = [
  "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10",
  "R11", "R12", "R13", "R14", "R15", "R16", "R17", "R18",
  "K1", "K2", "K3", "K4",
];
const ids = new Set(results.map((r) => r.id));
for (const id of expectedIds) {
  assert(ids.has(id), `missing diagnostic id: ${id}`);
}
pass("all expected diagnostic ids present (R1..R18, K1..K4)");

for (const r of results) {
  assert(r.id, "diagnostic without id");
  assert(["high", "medium", "low"].includes(r.confidence),
    `diagnostic ${r.id} must have confidence high|medium|low, got ${r.confidence}`);
  assert(r.title, `diagnostic ${r.id} without title`);
  assert(["triggered", "not_triggered", "insufficient_data"].includes(r.status),
    `diagnostic ${r.id} has invalid status: ${r.status}`);
  assert(typeof r.summary === "string" && r.summary.length > 0,
    `diagnostic ${r.id} has empty summary`);
  assert(typeof r.recommendation === "string" && r.recommendation.length > 0,
    `diagnostic ${r.id} has empty recommendation`);
  assert(Array.isArray(r.evidence_notes),
    `diagnostic ${r.id} has invalid evidence_notes`);
  assert(Array.isArray(r.confidence_metrics) && r.confidence_metrics.length >= 1,
    `diagnostic ${r.id} must have confidence_metrics`);
  assert(Array.isArray(r.explanation) && r.explanation.length >= 1,
    `diagnostic ${r.id} must have explanation`);
}
pass("every diagnostic has valid shape (incl. confidence, id/title/status/summary/recommendation/evidence_notes)");

const summary = Diagnostics.summarize(results);
assert(summary.total === results.length, "summarize.total mismatch");
assert(summary.triggered + summary.not_triggered + summary.insufficient_data === summary.total,
  "summarize counts do not add up");
assert(summary.insufficient_data >= 5,
  `expected at least 5 insufficient_data (R6,R9,R14,R15,R16 unsupported), got ${summary.insufficient_data}`);
pass(`summary: triggered=${summary.triggered}, not_triggered=${summary.not_triggered}, insufficient=${summary.insufficient_data}`);

const expectUnsupported = ["R6", "R9", "R14", "R15", "R16"];
const byId = new Map(results.map((r) => [r.id, r]));
for (const id of expectUnsupported) {
  const r = byId.get(id);
  assert(r && r.status === "insufficient_data",
    `${id} expected to be insufficient_data, got ${r ? r.status : "missing"}`);
}
pass("R6/R9/R14/R15/R16 are correctly insufficient_data (aggregated dataset limits)");

for (const id of ["R7", "R8", "R11", "R17"]) {
  const r = byId.get(id);
  assert(r && ["triggered", "not_triggered"].includes(r.status),
    `${id} must compute on repairEvents when present, got ${r ? r.status : "missing"}`);
}
pass("R7/R8/R11/R17 участвуют в расчёте на данных с ремонтами по датам");

const r1 = byId.get("R1");
assert(["triggered", "not_triggered"].includes(r1.status),
  `R1 must compute on real data, got ${r1.status}`);
assert(r1.evidence && r1.evidence.type === "table",
  "R1 must have a table evidence on real data");
assert(Array.isArray(r1.evidence.rows) && r1.evidence.rows.length >= 1,
  "R1 evidence must have at least 1 row on real data");
pass(`R1 computed: status=${r1.status}, evidence rows=${r1.evidence.rows.length}`);

const r12 = byId.get("R12");
assert(["triggered", "not_triggered"].includes(r12.status),
  `R12 must compute on real data, got ${r12.status}`);
assert(r12.evidence && r12.evidence.type === "table" && Array.isArray(r12.evidence.rows),
  "R12 evidence must be a table");
pass(`R12 computed: status=${r12.status}, evidence rows=${r12.evidence.rows.length}`);

const r18 = byId.get("R18");
assert(["triggered", "not_triggered"].includes(r18.status),
  `R18 must compute on real data, got ${r18.status}`);
assert(r18.evidence && r18.evidence.type === "table",
  "R18 must have a table evidence");
pass(`R18 computed: status=${r18.status}`);

const ctxH1 = Diagnostics.applyFilters(raw, { period: "h1", class: "__all__" });
assert(ctxH1.monthsCount === 6, `period h1 must give 6 months, got ${ctxH1.monthsCount}`);
const ctxH2 = Diagnostics.applyFilters(raw, { period: "h2", class: "__all__" });
assert(ctxH2.monthsCount === 6, `period h2 must give 6 months, got ${ctxH2.monthsCount}`);
const ctxAll = Diagnostics.applyFilters(raw, { period: "all", class: "__all__" });
assert(ctxAll.monthsCount === 12, `period all must give 12 months, got ${ctxAll.monthsCount}`);
pass("period filter h1/h2/all returns 6/6/12 months correctly");

const resultsH1 = Diagnostics.analyzeAll(raw, { period: "h1", class: "__all__" });
assert(resultsH1.length === results.length,
  "analyzeAll length must be the same regardless of filter");
pass("filter does not change diagnostics count");

const tools = require("../server/agent/tools");
const toolDef = tools.TOOL_DEFINITIONS.find((t) => t.name === "get_diagnostics_summary");
assert(toolDef, "tool get_diagnostics_summary is not registered in TOOL_DEFINITIONS");
const toolResult = tools.executeTool("get_diagnostics_summary", { filters: { period: "all", class: "__all__" } });
assert(!toolResult.error, `executeTool returned error: ${toolResult.error || ""}`);
assert(toolResult.summary && Array.isArray(toolResult.diagnostics) && Array.isArray(toolResult.triggered),
  "executeTool result must contain summary/diagnostics/triggered");
assert(toolResult.summary.total === results.length,
  "executeTool summary.total mismatch with direct call");
pass(`agent tool 'get_diagnostics_summary' works: total=${toolResult.summary.total}, triggered=${toolResult.summary.triggered}`);

const onlyTriggered = tools.executeTool("get_diagnostics_summary",
  { filters: { period: "all", class: "__all__" }, only_triggered: true });
assert(onlyTriggered && Array.isArray(onlyTriggered.triggered),
  "only_triggered=true must return triggered array");
assert(!Array.isArray(onlyTriggered.not_triggered),
  "only_triggered=true must NOT return not_triggered");
pass("only_triggered=true filters output correctly");

console.log(`${SMOKE_PREFIX} ALL OK (${results.length} diagnostics, ${summary.triggered} triggered, ${summary.insufficient_data} insufficient)`);
process.exit(0);
