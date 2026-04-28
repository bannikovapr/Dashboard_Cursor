"use strict";

const fs = require("fs");
const path = require("path");
const { appendJsonLine, ensureDir, parseBool, parsePositiveInt, sanitizeForLog } = require("./log-utils");

function traceEnabled() {
  return parseBool(process.env.FILTER_TRACE_LOG_ENABLED, false);
}

function getTracePath() {
  const configured = String(process.env.FILTER_TRACE_LOG_PATH || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "../../logs/filter-trace.log");
}

function writeTraceEvent(event, payload) {
  if (!traceEnabled()) return;
  const schemaVersion = parsePositiveInt(process.env.FILTER_TRACE_LOG_SCHEMA_VERSION, 1);
  const maxStringLen = parsePositiveInt(process.env.FILTER_TRACE_MAX_STRING, 10000);
  const redactSensitive = parseBool(process.env.FILTER_TRACE_LOG_REDACT, true);
  const rotateMaxBytes = parsePositiveInt(process.env.FILTER_TRACE_LOG_ROTATE_MAX_BYTES, 5 * 1024 * 1024);
  const rotateMaxFiles = parsePositiveInt(process.env.FILTER_TRACE_LOG_ROTATE_MAX_FILES, 14);
  const rotateDaily = parseBool(process.env.FILTER_TRACE_LOG_ROTATE_DAILY, true);
  const safePayload = sanitizeForLog(payload || {}, {
    maxDepth: 8,
    maxArray: 50,
    maxObjectKeys: 80,
    maxStringLen,
    redactSensitive,
  });
  const payloadObject = safePayload && typeof safePayload === "object" && !Array.isArray(safePayload)
    ? safePayload
    : { payload: safePayload };
  const record = {
    ts: new Date().toISOString(),
    schemaVersion,
    logType: "filter_trace",
    event: String(event || "unknown"),
    ...payloadObject,
  };
  try {
    const logPath = getTracePath();
    appendJsonLine(logPath, record, {
      rotateDaily,
      rotateMaxBytes,
      rotateMaxFiles,
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 200);
    console.warn(JSON.stringify({ level: "warn", event: "filter_trace_write_failed", message: msg }));
  }
}

function resetTraceFile() {
  const logPath = getTracePath();
  ensureDir(logPath);
  fs.writeFileSync(logPath, "", "utf8");
  return logPath;
}

module.exports = {
  writeTraceEvent,
  resetTraceFile,
  getTracePath,
};
