"use strict";

// Regex-backstop layer: deterministic detection for secrets, email, phone,
// equipment_code. Lives in the detector pipeline alongside the ML engine and
// guarantees coverage when the ML model misses or is disabled.
//
// Each rule emits spans with `ruleId` prefixed by `regex_secret_*` (block) or
// `regex_*` for tokenizable PII. The merging/dedup logic in detector/index.js
// resolves overlaps with ML spans by priority.

const PHONE_CONTEXT_POSITIVE_HINTS = [
  "телефон",
  "тел.",
  "контакт",
  "моб",
  "связь",
  "whatsapp",
  "звон",
  "phone",
  "call",
];

const PHONE_CONTEXT_NEGATIVE_HINTS = [
  "номер детали",
  "детали",
  "серий",
  "артикул",
  "инвентар",
  "идентификатор",
  "заводской",
  "part",
  "serial",
  "asset",
  "tag",
];

const EQUIPMENT_CODE_PATH_HINTS = ["equipment_code", "asset_code", "tag", "code", "код", "идентификатор", "номер"];
const EQUIPMENT_NAME_PATH_HINTS = [
  "equipment",
  "machine",
  "model",
  "class",
  "type",
  "compressor",
  "pump",
  "оборуд",
  "станок",
  "насос",
  "компрессор",
  "агрегат",
];

const TOKEN_ID_RE = /^DLP_[A-Z0-9_]+_\d{4,}$/;

const RULES = [
  {
    id: "regex_secret_openrouter_api_key",
    action: "block",
    priority: 300,
    regex: /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: "regex_secret_generic_api_key",
    action: "block",
    priority: 290,
    regex: /\b(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi,
  },
  {
    id: "regex_secret_bearer_token",
    action: "block",
    priority: 280,
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  },
  {
    id: "regex_secret_pem",
    action: "block",
    priority: 270,
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/gi,
  },
  {
    id: "regex_secret_aws_access_key",
    action: "block",
    priority: 270,
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "regex_secret_jwt",
    action: "block",
    priority: 270,
    regex: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g,
  },
  {
    id: "regex_email",
    action: "tokenize",
    priority: 160,
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    id: "regex_equipment_code",
    action: "tokenize",
    priority: 145,
    regex: /(?<![A-ZА-ЯЁ0-9_])(?:[A-ZА-ЯЁ0-9]{2,}(?:_[A-ZА-ЯЁ0-9]{2,}){2,})(?![A-ZА-ЯЁ0-9_])/gu,
    guard: (text, ctx) => isLikelyCompositeEquipmentCode(text, ctx),
  },
  {
    id: "regex_phone",
    action: "tokenize",
    priority: 120,
    regex: /(?<![\p{L}\d])(?:\+?\d[\d\s()\-]{8,}\d)(?![\p{L}\d])/gu,
    guard: (text, ctx) => isLikelyPhone(text, ctx),
  },
];

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function normalizeTokenId(value) {
  return String(value || "").trim().replace(/\\_/g, "_").toUpperCase();
}

function isCanonicalTokenId(value) {
  return TOKEN_ID_RE.test(String(value || "").trim());
}

function stripDigits(text) {
  return String(text || "").replace(/\D+/g, "");
}

function normalizePath(pathValue) {
  return String(pathValue || "").toLowerCase();
}

function hasPathHint(pathValue, hints) {
  const path = normalizePath(pathValue);
  if (!path) return false;
  return hints.some((hint) => path.includes(hint));
}

function isLikelyPhone(text, ctx) {
  const raw = String(text || "").trim();
  const digits = stripDigits(raw);
  if (digits.length < 10 || digits.length > 15) return false;

  const fullText = String(ctx?.fullText || "");
  if (fullText) {
    const knownStart = Number(ctx?.matchStart);
    const knownEnd = Number(ctx?.matchEnd);
    const start = Number.isFinite(knownStart) ? knownStart : Math.max(fullText.indexOf(raw), 0);
    const end = Number.isFinite(knownEnd) ? knownEnd : Math.min(start + raw.length, fullText.length);
    const from = Math.max(0, start - 36);
    const to = Math.min(fullText.length, end + 36);
    const around = fullText.slice(from, to).toLowerCase();
    const hasPositiveContext = PHONE_CONTEXT_POSITIVE_HINTS.some((hint) => around.includes(hint));
    const hasNegativeContext = PHONE_CONTEXT_NEGATIVE_HINTS.some((hint) => around.includes(hint));
    if (hasNegativeContext && !hasPositiveContext) return false;
  }

  const startsWithPlus = raw.startsWith("+");
  if (startsWithPlus) {
    return digits.length >= 11 && digits.length <= 15;
  }

  if (digits.length === 11) {
    return /^[78]/.test(digits);
  }

  if (digits.length === 10) {
    return /^[9]/.test(digits);
  }

  return false;
}

function isLikelyCompositeEquipmentCode(text, ctx) {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 8 || raw.length > 120) return false;
  if (isCanonicalTokenId(normalizeTokenId(raw))) return false;
  if (/\s/.test(raw)) return false;
  if (!/^[A-ZА-ЯЁ0-9]+(?:_[A-ZА-ЯЁ0-9]+){2,}$/.test(raw)) return false;
  const segments = raw.split("_");
  if (segments.length < 3) return false;
  if (segments.some((s) => s.length < 2)) return false;
  const digitParts = segments.filter((s) => /^\d{2,}$/.test(s)).length;
  const alphaParts = segments.filter((s) => /[A-ZА-ЯЁ]/.test(s)).length;
  if (digitParts < 1 || alphaParts < 2) return false;
  if (segments.every((s) => /^\d+$/.test(s))) return false;

  const explicitCodePath = hasPathHint(ctx?.path, EQUIPMENT_CODE_PATH_HINTS);
  const equipmentNamePath = hasPathHint(ctx?.path, EQUIPMENT_NAME_PATH_HINTS);
  if (equipmentNamePath && !explicitCodePath && digitParts < 2) return false;
  return true;
}

function isEnabled() {
  return parseBool(process.env.DLP_REGEX_BACKSTOP_ENABLED, true);
}

function findMatches(text, ctx = {}) {
  if (!isEnabled()) return [];
  if (!text || typeof text !== "string") return [];

  const path = ctx?.path || "";
  const out = [];
  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m = rule.regex.exec(text);
    while (m) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      const guardOk =
        typeof rule.guard === "function"
          ? rule.guard(raw, { path, fullText: text, matchStart: start, matchEnd: end, ruleId: rule.id })
          : true;
      if (guardOk) {
        out.push({
          start,
          end,
          value: raw,
          ruleId: rule.id,
          source: "regex",
          action: rule.action,
          priority: Number(rule.priority),
        });
      }
      if (!rule.regex.global) break;
      m = rule.regex.exec(text);
    }
  }
  return out;
}

function getStatus() {
  return {
    enabled: isEnabled(),
    rules: RULES.map((r) => ({ id: r.id, action: r.action, priority: r.priority })),
  };
}

module.exports = {
  findMatches,
  getStatus,
  isEnabled,
};
