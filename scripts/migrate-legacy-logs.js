"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const TARGETS = new Set(["agent-flow", "filter-trace", "audit", "all"]);

function parseArgs(argv) {
  const args = {
    target: "all",
    path: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
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

function getTargetConfig(target) {
  if (target === "agent-flow") {
    return {
      expectedLogType: "agent_flow",
      filePath: path.resolve(process.env.DLP_AGENT_FLOW_LOG_PATH || "logs/dlp-agent-flow.log"),
      useBom: false,
    };
  }
  if (target === "filter-trace") {
    return {
      expectedLogType: "filter_trace",
      filePath: path.resolve(process.env.FILTER_TRACE_LOG_PATH || "logs/filter-trace.log"),
      useBom: false,
    };
  }
  if (target === "audit") {
    const bomEnabled = String(process.env.AUDIT_LOG_UTF8_BOM || "true").trim().toLowerCase();
    return {
      expectedLogType: "audit",
      filePath: path.resolve(process.env.AUDIT_LOG_PATH || "logs/security-audit.log"),
      useBom: !["0", "false", "off", "no"].includes(bomEnabled),
    };
  }
  throw new Error(`Unsupported target: ${target}`);
}

function isModernRecord(parsed, expectedLogType) {
  if (!parsed || typeof parsed !== "object") return false;
  const schemaVersion = Number(parsed.schemaVersion);
  if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) return false;
  if (String(parsed.logType || "") !== expectedLogType) return false;
  if (typeof parsed.ts !== "string" || !parsed.ts.trim()) return false;
  return true;
}

function buildArchivePath(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.legacy.${stamp}.jsonl`;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function migrateSingle(target, cfg, options) {
  const filePath = cfg.filePath;
  const exists = fs.existsSync(filePath);
  if (!exists) {
    return {
      target,
      filePath,
      exists: false,
      migrated: false,
      modernKept: 0,
      archived: 0,
      invalidJsonArchived: 0,
      archivePath: null,
      dryRun: options.dryRun,
    };
  }

  const rawText = fs.readFileSync(filePath, "utf8");
  const hasBom = rawText.startsWith("\uFEFF");
  const body = hasBom ? rawText.slice(1) : rawText;
  const lines = body.split(/\r?\n/);
  const modernLines = [];
  const legacyLines = [];
  let invalidJsonArchived = 0;

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidJsonArchived += 1;
      legacyLines.push(line);
      continue;
    }

    if (isModernRecord(parsed, cfg.expectedLogType)) {
      modernLines.push(line);
    } else {
      legacyLines.push(line);
    }
  }

  const archivePath = legacyLines.length > 0 ? buildArchivePath(filePath) : null;
  if (!options.dryRun) {
    ensureDirForFile(filePath);
    if (archivePath) {
      ensureDirForFile(archivePath);
      fs.writeFileSync(archivePath, `${legacyLines.join("\n")}\n`, "utf8");
    }

    const nextBody = modernLines.length > 0 ? `${modernLines.join("\n")}\n` : "";
    const withBom = cfg.useBom && (nextBody || hasBom) ? `\uFEFF${nextBody}` : nextBody;
    fs.writeFileSync(filePath, withBom, "utf8");
  }

  return {
    target,
    filePath,
    exists: true,
    migrated: legacyLines.length > 0,
    modernKept: modernLines.length,
    archived: legacyLines.length,
    invalidJsonArchived,
    archivePath,
    dryRun: options.dryRun,
  };
}

function printResult(results) {
  const payload = {
    ok: true,
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
}

function main() {
  const args = parseArgs(process.argv);
  const targets = resolveTargets(args.target);
  if (args.path && targets.length !== 1) {
    throw new Error("--path can be used only with one concrete --target value");
  }

  const results = [];
  for (const target of targets) {
    const cfg = getTargetConfig(target);
    if (args.path) cfg.filePath = path.resolve(args.path);
    results.push(migrateSingle(target, cfg, { dryRun: args.dryRun }));
  }
  printResult(results);
}

main();
