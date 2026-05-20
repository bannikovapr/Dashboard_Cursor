"use strict";

/**
 * Детерминированный разбор вопроса (до/после LLM): топ-N, визуализация, датасет.
 */

function parseTopN(question) {
  const q = String(question || "");
  const m = q.match(/топ[-\s]?(\d+)|top[-\s]?(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1] || m[2], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 50);
}

function wantsVisualization(question) {
  const q = String(question || "").toLowerCase();
  return /график|диаграмм|chart|plot|визуал|таблиц|table|список|перечень|топ|top[-\s]?\d/i.test(q);
}

const RANKING_PRESETS = {
  ktg: {
    key: "ktg",
    dataset: "ktg",
    nameField: "name",
    valueField: "avg_ktg",
    seriesLabel: "КТГ, %",
    titleSuffix: "по КТГ",
    chartType: "bar",
  },
  costs: {
    key: "costs",
    dataset: "equipment_costs",
    nameField: "name",
    valueField: "total",
    seriesLabel: "Затраты, ₽",
    titleSuffix: "по затратам",
    chartType: "bar",
  },
  defects: {
    key: "defects",
    dataset: "defects",
    nameField: "name",
    valueField: "count",
    seriesLabel: "Отказы",
    titleSuffix: "по числу отказов",
    chartType: "bar",
  },
};

function parseRequestedTopRankings(question) {
  const q = String(question || "").toLowerCase();
  const keys = [];
  if (/ктг|ktg|готовност|техническ.*готов/i.test(q)) keys.push("ktg");
  if (/затрат|стоим|руб|cost|дорог/i.test(q)) keys.push("costs");
  if (
    /проблем|отказ|дефект|надёжн|надежн|failure|сбой/i.test(q) ||
    (/объект/.test(q) && /проблем|отказ|дефект/.test(q))
  ) {
    keys.push("defects");
  }
  return [...new Set(keys)].map((k) => RANKING_PRESETS[k]).filter(Boolean);
}

function wantsMultipleCharts(question) {
  const q = String(question || "").toLowerCase();
  if (/два\s+график|2\s+график|двух\s+график|несколько\s+график|два\s+диаграм/i.test(q)) {
    return true;
  }
  if (/график.*\s+и\s+.*график/i.test(q)) return true;
  return parseRequestedTopRankings(question).length >= 2;
}

function pickTopRanking(question) {
  const rankings = parseRequestedTopRankings(question);
  if (rankings.length) return rankings[0];
  return RANKING_PRESETS.defects;
}

function buildQuestionHints(question) {
  const topN = parseTopN(question);
  const rankings = parseRequestedTopRankings(question);
  const ranking = topN ? pickTopRanking(question) : null;
  return {
    top_n: topN,
    visualize_required: wantsVisualization(question),
    multiple_charts_required: wantsMultipleCharts(question),
    rankings,
    ranking,
    do_not_use_datasets_for_top:
      topN != null
        ? ["analysis_leaders", "analysis_causes"]
        : [],
  };
}

function enrichUserPayload(question, filters) {
  const hints = buildQuestionHints(question);
  return JSON.stringify({
    question,
    filters: filters || {},
    routing_hints: hints,
  });
}

module.exports = {
  RANKING_PRESETS,
  parseTopN,
  wantsVisualization,
  wantsMultipleCharts,
  parseRequestedTopRankings,
  pickTopRanking,
  buildQuestionHints,
  enrichUserPayload,
};
