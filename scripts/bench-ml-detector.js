"use strict";

// ML detector benchmark.
// Loads the configured ML model, runs the synthetic dataset through the
// detector, and prints precision/recall/F1 per ruleId family + latency
// distribution. Intended for offline tuning and A/B model comparisons
// (toggle DLP_ML_MODEL to switch between candidates).
//
// Usage:
//   DLP_ML_ENABLED=true node scripts/bench-ml-detector.js
//   DLP_ML_MODEL=Xenova/bert-base-multilingual-cased-ner-hrl npm run bench:ml-detector

const path = require("path");

function loadDetector() {
  const detectorAbs = require.resolve(path.resolve(__dirname, "..", "server/security/detector/index.js"));
  delete require.cache[detectorAbs];
  return require(detectorAbs);
}

const SECRET_FAMILY = new Set([
  "regex_secret_openrouter_api_key",
  "regex_secret_generic_api_key",
  "regex_secret_bearer_token",
  "regex_secret_pem",
  "regex_secret_aws_access_key",
  "regex_secret_jwt",
  "ml_secret",
]);

const FAMILY_OF = (ruleId) => {
  if (!ruleId) return "other";
  if (SECRET_FAMILY.has(ruleId)) return "SECRET";
  if (ruleId === "ml_person") return "PER";
  if (ruleId === "ml_org") return "ORG";
  if (ruleId === "ml_location") return "LOC";
  if (ruleId === "ml_email" || ruleId === "regex_email") return "EMAIL";
  if (ruleId === "ml_phone" || ruleId === "regex_phone") return "PHONE";
  if (ruleId === "ml_equipment_code" || ruleId === "regex_equipment_code") return "EQUIPMENT_CODE";
  return "OTHER";
};

// Each sample: text + expected entity families (upper-case) seen in the text.
// Entries are intentionally diverse to exercise both ML and regex backstop.
const DATASET = [
  // Persons (RU FIO)
  { text: "Сегодня Иванов Иван Иванович подписал акт.", expect: ["PER"] },
  { text: "Связаться с Петровой Анной Сергеевной по поводу ТО.", expect: ["PER"] },
  { text: "Сидоров А.А. согласовал график.", expect: ["PER"] },

  // Organizations
  { text: "Сделка с ООО Ромашка по договору №12.", expect: ["ORG"] },
  { text: "Контракт АО Газпром нефть подписан.", expect: ["ORG"] },

  // Locations
  { text: "Площадка Усть-Каменогорская переведена в резерв.", expect: ["LOC"] },
  { text: "Завод в Новосибирске остановлен на ремонт.", expect: ["LOC"] },

  // Email
  { text: "Связь по почте ivanov@example.com", expect: ["EMAIL"] },
  { text: "Контакт petrov.service@corp.ru подтверждён.", expect: ["EMAIL"] },

  // Phone
  { text: "Тел. +7 (999) 123-45-67 для уточнений.", expect: ["PHONE"] },
  { text: "Звонить на 8-800-555-35-35.", expect: ["PHONE"] },

  // Equipment code
  { text: "Карточка оборудования INK_SIB_003_COMP_005 актуализирована.", expect: ["EQUIPMENT_CODE"] },
  { text: "Узел AS_LINE_07_PUMP_12 находится на ремонте.", expect: ["EQUIPMENT_CODE"] },

  // Secrets
  { text: `Утёкший ключ sk-or-v1-${"A".repeat(32)}`, expect: ["SECRET"] },
  {
    text: "Authorization: " + "Bear" + "er " + "abcdef.0123456789.zyxwv0987654321",
    expect: ["SECRET"],
  },
  { text: "PEM:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----", expect: ["SECRET"] },
  { text: "AWS access key: AKIAIOSFODNN7EXAMPLE", expect: ["SECRET"] },

  // Mixed / edge cases (should not produce false positives in equipment names)
  { text: "Компрессор центробежный Siemens работает штатно.", expect: [] },
  { text: "Установка компрессорная основная требует диагностики.", expect: [] },
  { text: "Номер детали 1234567890, серийный 70000000000.", expect: [] },
  { text: "Графики и план/факт за апрель готовы.", expect: [] },
];

function uniqueFamilies(matches) {
  const out = new Set();
  for (const m of matches || []) out.add(FAMILY_OF(m.ruleId));
  out.delete("other");
  return out;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

async function run() {
  const det = loadDetector();
  const boot = await det.init({ force: true });
  const status = det.getRuntimeStatus();

  console.log("[BENCH] detector status:");
  console.log(
    JSON.stringify(
      {
        ml: {
          enabled: status?.ml?.enabled,
          model: status?.ml?.model,
          backend: status?.ml?.backend,
          ready: status?.ml?.ready,
          loadMs: status?.ml?.loadMs,
        },
        failMode: status?.failMode,
        regexBackstop: { enabled: status?.regexBackstop?.enabled },
        bootInitializedAt: boot?.initializedAt,
      },
      null,
      2
    )
  );

  const families = ["PER", "ORG", "LOC", "EMAIL", "PHONE", "EQUIPMENT_CODE", "SECRET"];
  const counts = {};
  for (const f of families) counts[f] = { tp: 0, fp: 0, fn: 0 };

  const latencies = [];
  for (const sample of DATASET) {
    const startedAt = Date.now();
    const matches = await det.detect(sample.text);
    latencies.push(Date.now() - startedAt);
    const found = uniqueFamilies(matches);
    const expected = new Set(sample.expect || []);

    for (const f of families) {
      const inExp = expected.has(f);
      const inFound = found.has(f);
      if (inExp && inFound) counts[f].tp += 1;
      else if (!inExp && inFound) counts[f].fp += 1;
      else if (inExp && !inFound) counts[f].fn += 1;
    }
  }

  function score({ tp, fp, fn }) {
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = tp + fn === 0 ? null : tp / (tp + fn);
    const f1 =
      precision != null && recall != null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    return {
      tp,
      fp,
      fn,
      precision: precision == null ? null : Number(precision.toFixed(3)),
      recall: recall == null ? null : Number(recall.toFixed(3)),
      f1: f1 == null ? null : Number(f1.toFixed(3)),
    };
  }

  const report = {};
  for (const f of families) report[f] = score(counts[f]);

  const latencyReport = {
    samples: latencies.length,
    p50_ms: quantile(latencies, 0.5),
    p95_ms: quantile(latencies, 0.95),
    p99_ms: quantile(latencies, 0.99),
    max_ms: latencies.reduce((a, b) => Math.max(a, b), 0),
    mean_ms: Number((latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(2)),
  };

  console.log("\n[BENCH] per-family scores:");
  console.log(JSON.stringify(report, null, 2));
  console.log("\n[BENCH] latency:");
  console.log(JSON.stringify(latencyReport, null, 2));
}

run().catch((err) => {
  console.error("[BENCH] UNHANDLED:", err);
  process.exit(1);
});
