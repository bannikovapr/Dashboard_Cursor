"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dailyRotationState = new Map();

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function truncateString(text, maxLen) {
  const src = String(text || "");
  if (src.length <= maxLen) return src;
  return `${src.slice(0, maxLen)}...[truncated]`;
}

function digestString16(text) {
  const src = String(text || "");
  if (!src) return null;
  return crypto.createHash("sha256").update(src, "utf8").digest("hex").slice(0, 16);
}

function luhnCheck(digits) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function redactCardLike(text) {
  return text.replace(/\b(?:\d[ -]?){13,19}\d\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnCheck(digits)) return match;
    return "[redacted_card]";
  });
}

function redactSensitiveText(text) {
  let out = String(text || "");
  if (!out) return out;

  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted_email]");
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted_api_key]");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted_access_key]");
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, "Bearer [redacted_token]");
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted_jwt]");
  out = out.replace(/(?<![A-Za-z0-9_-])(?:\+?\d[\d()\-\s]{8,}\d)(?![A-Za-z0-9_-])/g, "[redacted_phone]");
  out = redactCardLike(out);
  return out;
}

const SENSITIVE_KEY_RE =
  /(password|passwd|pwd|api[-_]?key|authorization|cookie|set-cookie|private[-_]?key|client[-_]?secret|token(?!sCreated)|secret)/i;

function sanitizeForLog(value, options, depth) {
  const cfg = {
    maxDepth: 8,
    maxArray: 80,
    maxObjectKeys: 100,
    maxStringLen: 12000,
    redactSensitive: true,
    ...options,
  };
  const level = Number.isFinite(depth) ? depth : 0;

  if (level > cfg.maxDepth) return "[depth_limit]";
  if (typeof value === "string") {
    const processed = cfg.redactSensitive ? redactSensitiveText(value) : value;
    return truncateString(processed, cfg.maxStringLen);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    const limited = value.slice(0, cfg.maxArray);
    return limited.map((x) => sanitizeForLog(x, cfg, level + 1));
  }
  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, cfg.maxObjectKeys);
    for (const [k, v] of entries) {
      if (SENSITIVE_KEY_RE.test(k)) {
        const digest = typeof v === "string" ? digestString16(v) : null;
        out[k] = digest ? `[redacted:${digest}]` : "[redacted]";
        continue;
      }
      out[k] = sanitizeForLog(v, cfg, level + 1);
    }
    return out;
  }
  return truncateString(String(value), cfg.maxStringLen);
}

function buildSummary(text, previewLen) {
  const src = String(text || "");
  if (!src) return { length: 0, sha256_16: null, preview: "" };
  const maxPreview = parsePositiveInt(previewLen, 220);
  const redacted = redactSensitiveText(src);
  return {
    length: redacted.length,
    sha256_16: digestString16(redacted),
    preview: truncateString(redacted, maxPreview),
  };
}

function buildRotateSuffix(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}.${String(reason || "rotate").toLowerCase()}`;
}

function rotateLogFile(logPath, reason) {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (!stat || stat.size <= 0) return;
  const rotated = `${logPath}.${buildRotateSuffix(reason)}`;
  fs.renameSync(logPath, rotated);
}

function pruneOldRotations(logPath, maxFiles) {
  const keep = parsePositiveInt(maxFiles, 14);
  const dir = path.dirname(logPath);
  const base = path.basename(logPath);
  const items = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith(`${base}.`))
    .map((d) => {
      const full = path.join(dir, d.name);
      const stat = fs.statSync(full);
      return { full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (items.length <= keep) return;
  for (const stale of items.slice(keep)) {
    fs.rmSync(stale.full, { force: true });
  }
}

function maybeRotateDaily(logPath, enabled) {
  if (!enabled) return;
  const today = new Date().toISOString().slice(0, 10);
  if (dailyRotationState.get(logPath) === today) return;
  dailyRotationState.set(logPath, today);

  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (!stat || stat.size <= 0) return;
  const fileDay = new Date(stat.mtimeMs).toISOString().slice(0, 10);
  if (fileDay !== today) {
    rotateLogFile(logPath, "daily");
  }
}

function maybeRotateBySize(logPath, lineBytes, maxBytes) {
  const limit = parsePositiveInt(maxBytes, 0);
  if (!limit) return;
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (!stat) return;
  if (stat.size + lineBytes > limit) {
    rotateLogFile(logPath, "size");
  }
}

function appendJsonLine(logPath, record, options) {
  const cfg = {
    rotateDaily: true,
    rotateMaxBytes: 5 * 1024 * 1024,
    rotateMaxFiles: 14,
    ...options,
  };

  ensureDir(logPath);
  const line = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  maybeRotateDaily(logPath, parseBool(cfg.rotateDaily, true));
  maybeRotateBySize(logPath, bytes, cfg.rotateMaxBytes);
  fs.appendFileSync(logPath, line, "utf8");
  pruneOldRotations(logPath, cfg.rotateMaxFiles);
}

module.exports = {
  appendJsonLine,
  buildSummary,
  ensureDir,
  parseBool,
  parsePositiveInt,
  sanitizeForLog,
};
