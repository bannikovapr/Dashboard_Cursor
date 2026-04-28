"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const preparedLogPaths = new Set();

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function parseIntPositive(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getAuditPath() {
  const configured = String(process.env.AUDIT_LOG_PATH || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "../../logs/security-audit.log");
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function hasUtf8Bom(buf) {
  return buf && buf.length >= 3 && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2];
}

function ensureUtf8Bom(filePath) {
  const enabled = parseBool(process.env.AUDIT_LOG_UTF8_BOM, true);
  if (!enabled) return;
  if (preparedLogPaths.has(filePath)) return;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "\uFEFF", "utf8");
    preparedLogPaths.add(filePath);
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    fs.writeFileSync(filePath, "\uFEFF", "utf8");
    preparedLogPaths.add(filePath);
    return;
  }

  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(3);
    fs.readSync(fd, head, 0, 3, 0);
    if (hasUtf8Bom(head)) {
      preparedLogPaths.add(filePath);
      return;
    }
  } finally {
    fs.closeSync(fd);
  }

  const data = fs.readFileSync(filePath);
  fs.writeFileSync(filePath, Buffer.concat([UTF8_BOM, data]));
  preparedLogPaths.add(filePath);
}

function digestText(input) {
  const text = String(input || "");
  if (!text) return null;
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  return {
    sha256_16: hash.slice(0, 16),
    length: text.length,
  };
}

function truncateText(text, maxLen) {
  const src = String(text || "");
  if (src.length <= maxLen) return src;
  return `${src.slice(0, maxLen)}...[truncated]`;
}

function sanitizeValue(value, depth, maxStringLen) {
  if (depth > 5) return "[depth_limit]";
  if (typeof value === "string") return truncateText(value, maxStringLen);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitizeValue(v, depth + 1, maxStringLen));
  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 50);
    for (const [k, v] of entries) {
      out[k] = sanitizeValue(v, depth + 1, maxStringLen);
    }
    return out;
  }
  return String(value);
}

function writeAuditEvent(payload) {
  const enabled = parseBool(process.env.AUDIT_LOG_ENABLED, true);
  if (!enabled) return;

  const schemaVersion = parseIntPositive(process.env.AUDIT_LOG_SCHEMA_VERSION, 1);
  const maxStringLen = parseIntPositive(process.env.AUDIT_LOG_MAX_STRING, 300);
  const record = {
    ts: new Date().toISOString(),
    schemaVersion,
    logType: "audit",
    ...sanitizeValue(payload, 0, maxStringLen),
  };

  try {
    const logPath = getAuditPath();
    ensureDir(logPath);
    ensureUtf8Bom(logPath);
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (e) {
    // Audit logging must not break API responses.
    const msg = String(e && e.message ? e.message : e).slice(0, 200);
    console.warn(JSON.stringify({ level: "warn", event: "audit_log_write_failed", message: msg }));
  }
}

module.exports = {
  writeAuditEvent,
  digestText,
};
