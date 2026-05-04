"use strict";

const crypto = require("crypto");

const DEFAULT_MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";
const CACHE_MAX = 500;

const DEFAULT_THRESHOLDS = Object.freeze({
  ml_person: 0.6,
  ml_org: 0.7,
  ml_location: 0.7,
});

const LABEL_TO_RULE = Object.freeze({
  PER: "ml_person",
  PERSON: "ml_person",
  PEOPLE: "ml_person",
  ORG: "ml_org",
  ORGANIZATION: "ml_org",
  LOC: "ml_location",
  LOCATION: "ml_location",
  GPE: "ml_location",
});

let _pipeline = null;
let _pipelineLoading = null;
let _pipelineFailed = false;
let _failureReason = null;
let _loadStartedAt = null;
let _loadFinishedAt = null;
let _lastInferenceMs = null;

const _cache = new Map();

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

function parseFloatSafe(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore — invalid JSON treated as missing
  }
  return null;
}

function isEnabled() {
  return parseBool(process.env.DLP_ML_ENABLED, parseBool(process.env.DLP_NER_ENABLED, true));
}

function getBackend() {
  return String(process.env.DLP_ML_BACKEND || "transformers").trim().toLowerCase();
}

function getModelId() {
  const next = String(process.env.DLP_ML_MODEL || process.env.DLP_NER_MODEL || DEFAULT_MODEL).trim();
  return next || DEFAULT_MODEL;
}

function getFallbackThreshold() {
  return parseFloatSafe(process.env.DLP_ML_THRESHOLD || process.env.DLP_NER_THRESHOLD, 0.7);
}

function getThresholdMap() {
  const fromEnv = parseJsonObject(process.env.DLP_ML_THRESHOLDS) || {};
  const fallback = getFallbackThreshold();
  const merged = { ...DEFAULT_THRESHOLDS };
  for (const [k, v] of Object.entries(fromEnv)) {
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    const key = String(k).toLowerCase();
    if (key.startsWith("ml_")) merged[key] = num;
    else if (key in DEFAULT_THRESHOLDS) merged[key] = num;
    else if (key === "person" || key === "per") merged.ml_person = num;
    else if (key === "organization" || key === "org") merged.ml_org = num;
    else if (key === "location" || key === "loc") merged.ml_location = num;
  }
  for (const k of Object.keys(merged)) {
    if (!Number.isFinite(merged[k])) merged[k] = fallback;
  }
  return merged;
}

function getTimeoutMs() {
  return parsePositiveInt(process.env.DLP_ML_TIMEOUT_MS || process.env.DLP_NER_TIMEOUT_MS, 1500);
}

function getWarmupTimeoutMs() {
  return parsePositiveInt(process.env.DLP_ML_WARMUP_TIMEOUT_MS, 25000);
}

function getMaxChars() {
  return parsePositiveInt(process.env.DLP_ML_MAX_CHARS || process.env.DLP_NER_MAX_CHARS, 4000);
}

function getFailMode() {
  const mode = String(process.env.DLP_ML_FAIL_MODE || "monitor").trim().toLowerCase();
  if (mode === "closed" || mode === "monitor" || mode === "open") return mode;
  return "monitor";
}

async function ensurePipeline() {
  if (_pipelineFailed) return null;
  if (_pipeline) return _pipeline;
  if (_pipelineLoading) return _pipelineLoading;

  if (getBackend() === "gliner") {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_ml_backend_unavailable",
        backend: "gliner",
        reason: "GLiNER backend is not yet implemented in Node.js runtime; falling back to transformers token-classification.",
      })
    );
  }

  _loadStartedAt = Date.now();
  _pipelineLoading = (async () => {
    try {
      // eslint-disable-next-line global-require
      const tx = require("@xenova/transformers");
      const model = getModelId();
      const pipe = await tx.pipeline("token-classification", model);
      _pipeline = pipe;
      _loadFinishedAt = Date.now();
      return pipe;
    } catch (e) {
      _pipelineFailed = true;
      _failureReason = String(e?.message || e).slice(0, 240);
      _loadFinishedAt = Date.now();
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "dlp_ml_pipeline_failed",
          reason: _failureReason,
        })
      );
      return null;
    } finally {
      _pipelineLoading = null;
    }
  })();
  return _pipelineLoading;
}

function digestText(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex").slice(0, 32);
}

function mapEntityLabel(rawLabel) {
  const label = String(rawLabel || "")
    .toUpperCase()
    .replace(/^[BIESL]-/, "");
  if (LABEL_TO_RULE[label]) return LABEL_TO_RULE[label];
  if (label.includes("PER")) return "ml_person";
  if (label.includes("ORG")) return "ml_org";
  if (label.includes("LOC") || label.includes("GPE")) return "ml_location";
  return null;
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("ml_inference_timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function mergeAdjacent(entities) {
  const out = [];
  for (const e of entities) {
    const last = out[out.length - 1];
    const sameGroup = last && last.label === e.label && e.start <= last.end + 1;
    if (sameGroup) {
      last.end = e.end;
      last.score = Math.min(last.score, e.score);
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

function normalizePipelineOutput(rawOutput) {
  if (!Array.isArray(rawOutput)) return [];
  return rawOutput
    .map((entry) => ({
      label: entry?.entity_group || entry?.entity || null,
      start: Number(entry?.start),
      end: Number(entry?.end),
      score: Number(entry?.score),
    }))
    .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start);
}

function cacheGet(key) {
  if (!_cache.has(key)) return undefined;
  // True LRU: re-insert to move to the most-recent end.
  const value = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

async function warmup() {
  if (!isEnabled()) {
    return { loaded: false, skipped: true, reason: "ml_disabled" };
  }
  const timeout = getWarmupTimeoutMs();
  try {
    const pipe = await withTimeout(ensurePipeline(), timeout);
    return {
      loaded: Boolean(pipe),
      skipped: false,
      loadMs: _loadStartedAt && _loadFinishedAt ? _loadFinishedAt - _loadStartedAt : null,
      failed: _pipelineFailed,
      failureReason: _failureReason,
    };
  } catch (e) {
    _pipelineFailed = true;
    _failureReason = String(e?.message || e).slice(0, 240);
    return {
      loaded: false,
      skipped: false,
      failed: true,
      failureReason: _failureReason,
    };
  }
}

async function findMatches(text) {
  if (!isEnabled()) return [];
  if (!text || typeof text !== "string") return [];
  const maxChars = getMaxChars();
  if (text.length > maxChars) return [];

  const dig = digestText(text);
  const cached = cacheGet(dig);
  if (cached) return cached;

  const pipe = await ensurePipeline();
  if (!pipe) {
    cacheSet(dig, []);
    return [];
  }

  const thresholds = getThresholdMap();
  const fallback = getFallbackThreshold();
  const startedAt = Date.now();

  let result = [];
  try {
    const raw = await withTimeout(
      pipe(text, { aggregation_strategy: "simple", ignore_labels: ["O"] }),
      getTimeoutMs()
    );
    const normalized = normalizePipelineOutput(raw);
    const merged = mergeAdjacent(normalized);
    for (const entity of merged) {
      if (!Number.isFinite(entity.score)) continue;
      const ruleId = mapEntityLabel(entity.label);
      if (!ruleId) continue;
      const threshold = Number.isFinite(thresholds[ruleId]) ? thresholds[ruleId] : fallback;
      if (entity.score < threshold) continue;
      result.push({
        start: entity.start,
        end: entity.end,
        value: text.slice(entity.start, entity.end),
        ruleId,
        source: "ml",
        score: Number(entity.score.toFixed(3)),
      });
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_ml_inference_failed",
        reason: String(e?.message || e).slice(0, 200),
      })
    );
    result = [];
  } finally {
    _lastInferenceMs = Date.now() - startedAt;
  }

  cacheSet(dig, result);
  return result;
}

function isReady() {
  if (!isEnabled()) return false;
  return Boolean(_pipeline) && !_pipelineFailed;
}

function getStatus() {
  return {
    enabled: isEnabled(),
    backend: getBackend(),
    model: getModelId(),
    failMode: getFailMode(),
    thresholds: getThresholdMap(),
    fallbackThreshold: getFallbackThreshold(),
    timeoutMs: getTimeoutMs(),
    warmupTimeoutMs: getWarmupTimeoutMs(),
    maxChars: getMaxChars(),
    loaded: Boolean(_pipeline),
    failed: _pipelineFailed,
    failureReason: _failureReason,
    cacheSize: _cache.size,
    loadMs: _loadStartedAt && _loadFinishedAt ? _loadFinishedAt - _loadStartedAt : null,
    lastInferenceMs: _lastInferenceMs,
    ready: Boolean(_pipeline) && !_pipelineFailed && isEnabled(),
  };
}

function reset() {
  _pipeline = null;
  _pipelineLoading = null;
  _pipelineFailed = false;
  _failureReason = null;
  _loadStartedAt = null;
  _loadFinishedAt = null;
  _lastInferenceMs = null;
  _cache.clear();
}

module.exports = {
  warmup,
  findMatches,
  getStatus,
  isReady,
  isEnabled,
  getFailMode,
  reset,
};
