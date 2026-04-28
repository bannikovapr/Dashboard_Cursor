"use strict";

const dictionary = require("./dictionary-index");
const morphFio = require("./morph-fio");
const structural = require("./structural");
const nerEngine = require("./ner-engine");

const RULE_PRIORITIES = Object.freeze({
  dictionary_employee: 200,
  dictionary_org: 195,
  dictionary_department: 190,
  dictionary_installation: 185,
  morph_fio: 170,
  structural_org: 160,
  structural_location: 155,
  ner_person: 150,
  ner_org: 145,
  ner_location: 140,
});

const RULE_ACTIONS = Object.freeze({
  dictionary_employee: "tokenize",
  dictionary_org: "tokenize",
  dictionary_department: "tokenize",
  dictionary_installation: "tokenize",
  morph_fio: "tokenize",
  structural_org: "tokenize",
  structural_location: "tokenize",
  ner_person: "tokenize",
  ner_org: "tokenize",
  ner_location: "tokenize",
});

let _initialized = false;
let _bootStats = null;

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function isLayerEnabled(envVar, fallback) {
  return parseBool(process.env[envVar], fallback);
}

function annotate(match) {
  return {
    start: match.start,
    end: match.end,
    value: match.value,
    ruleId: match.ruleId,
    action: RULE_ACTIONS[match.ruleId] || "tokenize",
    priority: RULE_PRIORITIES[match.ruleId] || 100,
    score: typeof match.score === "number" ? match.score : null,
  };
}

function init({ force } = {}) {
  if (_initialized && !force) return _bootStats;
  morphFio.reset();
  const dictStats = dictionary.init({ force: true });
  morphFio.learnFromDictionary(dictionary.getEmployees());
  _bootStats = {
    initializedAt: new Date().toISOString(),
    dictionary: dictStats,
    morphFio: morphFio.getStats(),
    ner: nerEngine.getStatus(),
  };
  _initialized = true;
  return _bootStats;
}

function getBootStats() {
  if (!_initialized) init();
  return _bootStats;
}

function getRuntimeStatus() {
  return {
    dictionary: dictionary.getStats(),
    morphFio: morphFio.getStats(),
    ner: nerEngine.getStatus(),
    layers: {
      dictionary: isLayerEnabled("DLP_DICT_ENABLED", true),
      morphFio: isLayerEnabled("DLP_MORPH_FIO_ENABLED", true),
      structural: isLayerEnabled("DLP_STRUCTURAL_ENABLED", true),
      ner: isLayerEnabled("DLP_NER_ENABLED", false),
    },
  };
}

async function detect(text, _ctx = {}) {
  if (!_initialized) init();
  if (!text || typeof text !== "string") return [];
  const out = [];

  if (isLayerEnabled("DLP_DICT_ENABLED", true)) {
    for (const m of dictionary.findMatches(text)) out.push(annotate(m));
  }

  if (isLayerEnabled("DLP_MORPH_FIO_ENABLED", true)) {
    const allowed = (full) => dictionary.hasEmployee(full);
    for (const m of morphFio.findMatches(text, allowed)) out.push(annotate(m));
  }

  if (isLayerEnabled("DLP_STRUCTURAL_ENABLED", true)) {
    for (const m of structural.findMatches(text)) out.push(annotate(m));
  }

  if (isLayerEnabled("DLP_NER_ENABLED", false)) {
    try {
      const nerOut = await nerEngine.findMatches(text);
      for (const m of nerOut) out.push(annotate(m));
    } catch {
      // Best-effort: NER must never break detection pipeline.
    }
  }

  return out;
}

module.exports = {
  init,
  detect,
  getBootStats,
  getRuntimeStatus,
  RULE_PRIORITIES,
  RULE_ACTIONS,
};
