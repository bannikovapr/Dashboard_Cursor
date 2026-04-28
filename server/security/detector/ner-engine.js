"use strict";

const crypto = require("crypto");

const DEFAULT_MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";
const CACHE_MAX = 500;

let _pipeline = null;
let _pipelineLoading = null;
let _pipelineFailed = false;
let _failureReason = null;
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

function isEnabled() {
  return parseBool(process.env.DLP_NER_ENABLED, false);
}

function getModelId() {
  return String(process.env.DLP_NER_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function getThreshold() {
  return parseFloatSafe(process.env.DLP_NER_THRESHOLD, 0.85);
}

function getTimeoutMs() {
  return parsePositiveInt(process.env.DLP_NER_TIMEOUT_MS, 1500);
}

function getMaxChars() {
  return parsePositiveInt(process.env.DLP_NER_MAX_CHARS, 2000);
}

async function ensurePipeline() {
  if (_pipelineFailed) return null;
  if (_pipeline) return _pipeline;
  if (_pipelineLoading) return _pipelineLoading;

  _pipelineLoading = (async () => {
    try {
      // Optional dependency: only loaded when DLP_NER_ENABLED=true.
      // eslint-disable-next-line global-require
      const tx = require("@xenova/transformers");
      const model = getModelId();
      const pipe = await tx.pipeline("token-classification", model);
      _pipeline = pipe;
      return pipe;
    } catch (e) {
      _pipelineFailed = true;
      _failureReason = String(e?.message || e).slice(0, 240);
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "dlp_ner_pipeline_failed",
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
  const label = String(rawLabel || "").toUpperCase();
  if (label.includes("PER")) return "ner_person";
  if (label.includes("ORG")) return "ner_org";
  if (label.includes("LOC") || label.includes("GPE")) return "ner_location";
  return null;
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("ner_timeout")), ms);
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

async function findMatches(text) {
  if (!isEnabled()) return [];
  if (!text || typeof text !== "string") return [];
  const maxChars = getMaxChars();
  if (text.length > maxChars) return [];

  const dig = digestText(text);
  if (_cache.has(dig)) return _cache.get(dig);

  const pipe = await ensurePipeline();
  if (!pipe) {
    _cache.set(dig, []);
    return [];
  }

  let result = [];
  try {
    const raw = await withTimeout(
      pipe(text, { aggregation_strategy: "simple", ignore_labels: ["O"] }),
      getTimeoutMs()
    );
    const normalized = normalizePipelineOutput(raw);
    const merged = mergeAdjacent(normalized);
    const threshold = getThreshold();
    for (const entity of merged) {
      if (!Number.isFinite(entity.score) || entity.score < threshold) continue;
      const ruleId = mapEntityLabel(entity.label);
      if (!ruleId) continue;
      result.push({
        start: entity.start,
        end: entity.end,
        value: text.slice(entity.start, entity.end),
        ruleId,
        score: Number(entity.score.toFixed(3)),
      });
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_ner_inference_failed",
        reason: String(e?.message || e).slice(0, 200),
      })
    );
    result = [];
  }

  if (_cache.size >= CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(dig, result);

  return result;
}

function getStatus() {
  return {
    enabled: isEnabled(),
    model: getModelId(),
    threshold: getThreshold(),
    timeoutMs: getTimeoutMs(),
    maxChars: getMaxChars(),
    loaded: Boolean(_pipeline),
    failed: _pipelineFailed,
    failureReason: _failureReason,
    cacheSize: _cache.size,
  };
}

function reset() {
  _pipeline = null;
  _pipelineLoading = null;
  _pipelineFailed = false;
  _failureReason = null;
  _cache.clear();
}

module.exports = {
  findMatches,
  getStatus,
  reset,
};
