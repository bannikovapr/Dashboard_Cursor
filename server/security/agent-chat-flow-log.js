"use strict";

const fs = require("fs");
const path = require("path");
const { appendJsonLine, ensureDir, parseBool, parsePositiveInt, sanitizeForLog } = require("./log-utils");

function flowLogEnabled() {
  return parseBool(process.env.DLP_AGENT_FLOW_LOG_ENABLED, false);
}

function getFlowLogPath() {
  const configured = String(process.env.DLP_AGENT_FLOW_LOG_PATH || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "../../logs/dlp-agent-flow.log");
}

function writeAgentFlowEvent(stage, payload) {
  if (!flowLogEnabled()) return;
  const schemaVersion = parsePositiveInt(process.env.DLP_AGENT_FLOW_LOG_SCHEMA_VERSION, 1);
  const maxStringLen = parsePositiveInt(process.env.DLP_AGENT_FLOW_MAX_STRING, 30000);
  const redactSensitive = parseBool(process.env.DLP_AGENT_FLOW_LOG_REDACT, true);
  const rotateMaxBytes = parsePositiveInt(process.env.DLP_AGENT_FLOW_LOG_ROTATE_MAX_BYTES, 5 * 1024 * 1024);
  const rotateMaxFiles = parsePositiveInt(process.env.DLP_AGENT_FLOW_LOG_ROTATE_MAX_FILES, 14);
  const rotateDaily = parseBool(process.env.DLP_AGENT_FLOW_LOG_ROTATE_DAILY, true);
  const safePayload = sanitizeForLog(payload || {}, {
    maxDepth: 8,
    maxArray: 80,
    maxObjectKeys: 100,
    maxStringLen,
    redactSensitive,
  });
  const payloadObject = safePayload && typeof safePayload === "object" && !Array.isArray(safePayload)
    ? safePayload
    : { payload: safePayload };
  const record = {
    ts: new Date().toISOString(),
    schemaVersion,
    logType: "agent_flow",
    stage: String(stage || "unknown"),
    ...payloadObject,
  };
  try {
    const logPath = getFlowLogPath();
    appendJsonLine(logPath, record, {
      rotateDaily,
      rotateMaxBytes,
      rotateMaxFiles,
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 200);
    console.warn(JSON.stringify({ level: "warn", event: "agent_flow_write_failed", message: msg }));
  }
}

function resetAgentFlowFile() {
  const logPath = getFlowLogPath();
  ensureDir(logPath);
  fs.writeFileSync(logPath, "", "utf8");
  return logPath;
}

module.exports = {
  writeAgentFlowEvent,
  resetAgentFlowFile,
  getFlowLogPath,
};
