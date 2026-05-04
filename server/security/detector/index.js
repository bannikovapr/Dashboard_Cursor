"use strict";

const mlEngine = require("./ner-engine");
const regexBackstop = require("./regex-backstop");

// Single source of truth for ML/regex span priorities. Higher = stronger.
const RULE_PRIORITIES = Object.freeze({
  // Secrets (block).
  regex_secret_openrouter_api_key: 300,
  regex_secret_generic_api_key: 290,
  regex_secret_bearer_token: 280,
  regex_secret_pem: 275,
  regex_secret_aws_access_key: 274,
  regex_secret_jwt: 273,
  ml_secret: 270,

  // Structural PII (regex backstop).
  regex_email: 165,
  regex_phone: 130,
  regex_equipment_code: 145,

  // ML PII (semantic).
  ml_email: 160,
  ml_phone: 125,
  ml_equipment_code: 140,
  ml_person: 170,
  ml_org: 168,
  ml_location: 166,
});

const RULE_ACTIONS = Object.freeze({
  regex_secret_openrouter_api_key: "block",
  regex_secret_generic_api_key: "block",
  regex_secret_bearer_token: "block",
  regex_secret_pem: "block",
  regex_secret_aws_access_key: "block",
  regex_secret_jwt: "block",
  ml_secret: "block",

  regex_email: "tokenize",
  regex_phone: "tokenize",
  regex_equipment_code: "tokenize",

  ml_email: "tokenize",
  ml_phone: "tokenize",
  ml_equipment_code: "tokenize",
  ml_person: "tokenize",
  ml_org: "tokenize",
  ml_location: "tokenize",
});

let _initialized = false;
let _initializing = null;
let _bootStats = null;

function annotate(match) {
  return {
    start: match.start,
    end: match.end,
    value: match.value,
    ruleId: match.ruleId,
    source: match.source || "unknown",
    action: RULE_ACTIONS[match.ruleId] || match.action || "tokenize",
    priority: Number.isFinite(match.priority) ? match.priority : RULE_PRIORITIES[match.ruleId] || 100,
    score: typeof match.score === "number" ? match.score : null,
  };
}

function effectivePriority(match) {
  if (Number.isFinite(match.priority)) return match.priority;
  return match.action === "block" ? 250 : 100;
}

function dedupSpans(matches) {
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const byPriority = effectivePriority(b) - effectivePriority(a);
    if (byPriority !== 0) return byPriority;
    const byLength = b.end - b.start - (a.end - a.start);
    if (byLength !== 0) return byLength;
    return String(a.ruleId).localeCompare(String(b.ruleId));
  });

  const selected = [];
  for (const item of sorted) {
    let overlaps = false;
    for (const other of selected) {
      if (item.start < other.end && other.start < item.end) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) selected.push(item);
  }
  return selected;
}

async function init({ force } = {}) {
  if (_initialized && !force) return _bootStats;
  if (_initializing) return _initializing;

  if (force) {
    _initialized = false;
    _bootStats = null;
    if (typeof mlEngine.reset === "function") mlEngine.reset();
  }

  _initializing = (async () => {
    const ml = await mlEngine.warmup();
    _bootStats = {
      initializedAt: new Date().toISOString(),
      ml: { ...ml, status: mlEngine.getStatus() },
      regexBackstop: regexBackstop.getStatus(),
    };
    _initialized = true;
    return _bootStats;
  })();

  try {
    return await _initializing;
  } finally {
    _initializing = null;
  }
}

function getBootStats() {
  return _bootStats;
}

function getRuntimeStatus() {
  return {
    initialized: _initialized,
    ml: mlEngine.getStatus(),
    regexBackstop: regexBackstop.getStatus(),
    failMode: mlEngine.getFailMode(),
    ready: isReady(),
  };
}

function isReady() {
  if (!mlEngine.isEnabled()) return regexBackstop.isEnabled();
  return mlEngine.isReady();
}

function shouldBlockOnUnready() {
  if (mlEngine.isReady()) return false;
  if (!mlEngine.isEnabled()) return false;
  return mlEngine.getFailMode() === "closed";
}

async function detect(text, ctx = {}) {
  if (!_initialized && !_initializing) {
    // Fire-and-forget warmup if someone called detect before init.
    init({ force: false }).catch(() => {});
  }
  if (!text || typeof text !== "string") return [];

  const out = [];

  if (regexBackstop.isEnabled()) {
    for (const m of regexBackstop.findMatches(text, ctx)) out.push(annotate(m));
  }

  if (mlEngine.isEnabled()) {
    try {
      const mlOut = await mlEngine.findMatches(text);
      for (const m of mlOut) out.push(annotate(m));
    } catch {
      // ML must never break the pipeline. Regex-backstop already provided coverage.
    }
  }

  return dedupSpans(out);
}

module.exports = {
  init,
  detect,
  getBootStats,
  getRuntimeStatus,
  isReady,
  shouldBlockOnUnready,
  RULE_PRIORITIES,
  RULE_ACTIONS,
};
