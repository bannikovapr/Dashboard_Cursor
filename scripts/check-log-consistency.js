"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const TARGETS = new Set(["agent-flow", "filter-trace", "audit", "all"]);

function parseArgs(argv) {
  const args = {
    target: "all",
    path: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token.startsWith("--target=")) {
      args.target = token.slice("--target=".length).trim() || "all";
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      args.target = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--path=")) {
      args.path = token.slice("--path=".length).trim() || null;
      continue;
    }
    if (token === "--path" && argv[i + 1]) {
      args.path = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
  }
  return args;
}

function resolveTargets(targetArg) {
  const normalized = String(targetArg || "all").trim().toLowerCase();
  if (!TARGETS.has(normalized)) {
    throw new Error(`Unsupported --target value: ${targetArg}`);
  }
  if (normalized === "all") return ["agent-flow", "filter-trace", "audit"];
  return [normalized];
}

function getDefaultPath(target) {
  if (target === "agent-flow") {
    return path.resolve(process.env.DLP_AGENT_FLOW_LOG_PATH || "logs/dlp-agent-flow.log");
  }
  if (target === "filter-trace") {
    return path.resolve(process.env.FILTER_TRACE_LOG_PATH || "logs/filter-trace.log");
  }
  if (target === "audit") {
    return path.resolve(process.env.AUDIT_LOG_PATH || "logs/security-audit.log");
  }
  return null;
}

function readJsonLines(filePath, stripBom) {
  if (!fs.existsSync(filePath)) {
    return { records: [], parseErrors: [], missingFile: true };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const records = [];
  const parseErrors = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    let raw = lines[i];
    if (!raw || !raw.trim()) continue;
    if (stripBom && lineNo === 1) {
      raw = raw.replace(/^\uFEFF/, "");
    }
    try {
      const parsed = JSON.parse(raw);
      records.push({ line: lineNo, record: parsed });
    } catch (e) {
      parseErrors.push({
        line: lineNo,
        reason: "invalid_json",
        detail: String(e && e.message ? e.message : e).slice(0, 200),
      });
    }
  }
  return { records, parseErrors, missingFile: false };
}

function addIssue(collector, level, target, line, message) {
  collector.push({
    level,
    target,
    line,
    message,
  });
}

function validateCommon(entry, target, issues) {
  const rec = entry.record || {};
  if (typeof rec.ts !== "string" || !rec.ts.trim()) {
    addIssue(issues, "error", target, entry.line, "missing ts");
  } else if (Number.isNaN(Date.parse(rec.ts))) {
    addIssue(issues, "error", target, entry.line, "invalid ts");
  }

  if (rec.schemaVersion == null) {
    addIssue(issues, "warning", target, entry.line, "missing schemaVersion (legacy record)");
  } else if (!Number.isFinite(Number(rec.schemaVersion)) || Number(rec.schemaVersion) <= 0) {
    addIssue(issues, "error", target, entry.line, "invalid schemaVersion");
  }

  if (typeof rec.logType !== "string" || !rec.logType.trim()) {
    addIssue(issues, "warning", target, entry.line, "missing logType");
  }
}

function validateAgentFlow(records, issues) {
  const perRequest = new Map();
  for (const entry of records) {
    const rec = entry.record || {};
    validateCommon(entry, "agent-flow", issues);

    if (typeof rec.stage !== "string" || !rec.stage.trim()) {
      addIssue(issues, "error", "agent-flow", entry.line, "missing stage");
      continue;
    }
    if (typeof rec.requestId !== "string" || !rec.requestId.trim()) {
      addIssue(issues, "error", "agent-flow", entry.line, "missing requestId");
      continue;
    }

    if (!perRequest.has(rec.requestId)) {
      perRequest.set(rec.requestId, {
        stages: new Set(),
        backToModelCount: 0,
        modelToBackCount: 0,
      });
    }
    const bucket = perRequest.get(rec.requestId);
    bucket.stages.add(rec.stage);

    if (rec.stage === "back_to_model") {
      bucket.backToModelCount += 1;
      if (!rec.request || typeof rec.request !== "object") {
        addIssue(issues, "error", "agent-flow", entry.line, "back_to_model missing request object");
      }
    }
    if (rec.stage === "model_to_back") {
      bucket.modelToBackCount += 1;
      if (!rec.response || typeof rec.response !== "object") {
        addIssue(issues, "error", "agent-flow", entry.line, "model_to_back missing response object");
      }
    }
    if (rec.stage === "back_to_front") {
      if (!Number.isFinite(Number(rec.status))) {
        addIssue(issues, "error", "agent-flow", entry.line, "back_to_front missing numeric status");
      }
      if (!("payloadToFrontend" in rec)) {
        addIssue(issues, "error", "agent-flow", entry.line, "back_to_front missing payloadToFrontend");
      }
    }
  }

  for (const [requestId, state] of perRequest.entries()) {
    if (!state.stages.has("front_to_back")) {
      addIssue(issues, "error", "agent-flow", 0, `requestId=${requestId} missing front_to_back`);
    }
    if (!state.stages.has("back_to_front")) {
      addIssue(issues, "error", "agent-flow", 0, `requestId=${requestId} missing back_to_front`);
    }
    if (state.backToModelCount !== state.modelToBackCount) {
      addIssue(
        issues,
        "error",
        "agent-flow",
        0,
        `requestId=${requestId} mismatch back_to_model(${state.backToModelCount}) vs model_to_back(${state.modelToBackCount})`
      );
    }
  }
}

function validateFilterTrace(records, issues) {
  const perRequest = new Map();
  for (const entry of records) {
    const rec = entry.record || {};
    validateCommon(entry, "filter-trace", issues);

    if (typeof rec.event !== "string" || !rec.event.trim()) {
      addIssue(issues, "error", "filter-trace", entry.line, "missing event");
      continue;
    }

    if (typeof rec.requestId === "string" && rec.requestId.trim()) {
      if (!perRequest.has(rec.requestId)) perRequest.set(rec.requestId, []);
      perRequest.get(rec.requestId).push(rec.event);
    }

    if (rec.event.endsWith("_model_request") && !("sentToModel" in rec)) {
      addIssue(issues, "error", "filter-trace", entry.line, "model_request missing sentToModel");
    }
    if (rec.event.endsWith("_model_response") && !("ok" in rec)) {
      addIssue(issues, "error", "filter-trace", entry.line, "model_response missing ok");
    }
    if (rec.event.endsWith("_response_to_dashboard") && !("responseForDashboard" in rec)) {
      addIssue(issues, "error", "filter-trace", entry.line, "response_to_dashboard missing responseForDashboard");
    }
  }

  for (const [requestId, events] of perRequest.entries()) {
    const hasRequest = events.some((e) => e.endsWith("_request_received"));
    const hasTerminal = events.some(
      (e) =>
        e.endsWith("_response_to_dashboard") ||
        e.endsWith("_dlp_blocked") ||
        e.endsWith("_request_invalid") ||
        e.endsWith("_rate_limited") ||
        e.endsWith("_exception")
    );
    if (!hasRequest) {
      addIssue(issues, "warning", "filter-trace", 0, `requestId=${requestId} missing *_request_received`);
    }
    if (!hasTerminal) {
      addIssue(issues, "warning", "filter-trace", 0, `requestId=${requestId} missing terminal event`);
    }
  }
}

function validateAudit(records, issues) {
  for (const entry of records) {
    const rec = entry.record || {};
    validateCommon(entry, "audit", issues);
    if (typeof rec.event !== "string" || !rec.event.trim()) {
      addIssue(issues, "error", "audit", entry.line, "missing event");
    }
    if (typeof rec.service !== "string" || !rec.service.trim()) {
      addIssue(issues, "warning", "audit", entry.line, "missing service");
    }
  }
}

function runSingle(target, filePath) {
  const stripBom = target === "audit";
  const { records, parseErrors, missingFile } = readJsonLines(filePath, stripBom);
  const issues = [];

  if (missingFile) {
    addIssue(issues, "warning", target, 0, "log file not found");
    return {
      target,
      filePath,
      totalRecords: 0,
      errors: [],
      warnings: issues,
    };
  }

  for (const pe of parseErrors) {
    addIssue(issues, "error", target, pe.line, `${pe.reason}${pe.detail ? `: ${pe.detail}` : ""}`);
  }

  if (target === "agent-flow") validateAgentFlow(records, issues);
  else if (target === "filter-trace") validateFilterTrace(records, issues);
  else validateAudit(records, issues);

  const errors = issues.filter((x) => x.level === "error");
  const warnings = issues.filter((x) => x.level === "warning");
  return {
    target,
    filePath,
    totalRecords: records.length,
    errors,
    warnings,
  };
}

function printSummary(results) {
  const compact = results.map((r) => ({
    target: r.target,
    filePath: r.filePath,
    totalRecords: r.totalRecords,
    errors: r.errors.length,
    warnings: r.warnings.length,
  }));
  console.log(JSON.stringify({ ok: compact.every((x) => x.errors === 0), results: compact }, null, 2));

  for (const res of results) {
    for (const issue of [...res.errors, ...res.warnings].slice(0, 50)) {
      const location = issue.line > 0 ? `line ${issue.line}` : "line n/a";
      console.log(`[${issue.level.toUpperCase()}][${issue.target}] ${location}: ${issue.message}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const targets = resolveTargets(args.target);
  const results = [];

  for (const target of targets) {
    const filePath = path.resolve(args.path || getDefaultPath(target));
    results.push(runSingle(target, filePath));
  }

  printSummary(results);
  const hasErrors = results.some((r) => r.errors.length > 0);
  if (hasErrors) process.exit(1);
}

main();
