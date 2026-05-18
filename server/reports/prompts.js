"use strict";

const config = require("./config");

function jsonDump(value) {
  return JSON.stringify(value, null, 2);
}

const REPORT_GENERATION_SYSTEM_PROMPT = [
  "Ты создаёшь управленческий отчёт о состоянии ТОиР (техническое обслуживание и ремонт).",
  "",
  "Жёсткие правила:",
  "- Опирайся ТОЛЬКО на переданный fact_pack. Не выдумывай числа, события и рекомендации.",
  "- Каждая секция должна содержать вывод, подтверждающие факты и уровень уверенности.",
  "- Если данных недостаточно — фиксируй это в warnings и снижай confidence.",
  "- Используй каталог секций и сохраняй section_id из каталога.",
  "- Верни ТОЛЬКО валидный JSON без markdown-обёрток, без префиксов и пояснений.",
  "",
  "Формат JSON:",
  "{",
  '  "title": "Отчёт ТОиР ...",',
  '  "sections": [',
  "    {",
  '      "section_id": "executive_summary",',
  '      "title": "Короткий вывод для руководителя",',
  '      "body_markdown": "Текст в формате Markdown (заголовки 2-3 уровня, **жирный**, списки)",',
  '      "fact_bullets": ["Факт 1", "Факт 2"],',
  '      "evidence_refs": ["kpis", "diagnostics:R2"],',
  '      "confidence": "medium",',
  '      "warnings": ["Если нужны ограничения"]',
  "    }",
  "  ]",
  "}",
  "",
  "Правила контента:",
  "- Весь текст на русском языке.",
  "- В body_markdown используй конкретные числа из fact_pack (KPI, топ-объекты, доли).",
  "- В evidence_refs указывай ключи из fact_pack (kpis, monthly_trend, top_cost_objects, " +
    "pareto_cost_objects, mtbf_top, mttr_top, failure_causes_top, quality_summary, personnel_summary, " +
    "diagnostics_summary) или конкретные диагностики в формате diagnostics:R1, diagnostics:K2.",
  "- confidence: high (≥30 объектов или сильные сигналы), medium (10-30), low (мало данных).",
  "- НЕ упоминай в тексте: имена JSON-полей, пути к файлам, OpenRouter, API, серверы.",
  "- Формулируй нейтрально: «по данным дашборда», «по выгрузке», «в текущем срезе».",
].join("\n");

const REPORT_EDIT_SYSTEM_PROMPT = [
  "Ты планируешь правки существующего отчёта ТОиР.",
  "",
  "Жёсткие правила:",
  "- Не переписывай весь документ без необходимости — это план правки, а не пересоздание.",
  "- Используй ТОЛЬКО операции: update_title, replace_section, insert_section_after, " +
    "delete_section, move_section.",
  "- Обязательные секции (mandatory_section_ids) удалять НЕЛЬЗЯ.",
  "- Любая новая или заменённая секция обязана содержать body_markdown, fact_bullets, " +
    "evidence_refs, confidence и warnings.",
  "- Верни ТОЛЬКО валидный JSON без markdown-обёрток.",
  "",
  "Формат JSON:",
  "{",
  '  "operations": [',
  "    {",
  '      "operation_type": "delete_section",',
  '      "section_id": "personnel",',
  '      "reasoning": "пользователь попросил убрать раздел"',
  "    },",
  "    {",
  '      "operation_type": "replace_section",',
  '      "section_id": "executive_summary",',
  '      "title": "Короткий вывод",',
  '      "body_markdown": "...",',
  '      "fact_bullets": ["..."],',
  '      "evidence_refs": ["kpis"],',
  '      "confidence": "medium",',
  '      "warnings": []',
  "    },",
  "    {",
  '      "operation_type": "insert_section_after",',
  '      "after_section_id": "personnel",',
  '      "new_section_id": "personnel_by_department",',
  '      "title": "Использование персонала по подразделениям",',
  '      "body_markdown": "...",',
  '      "fact_bullets": ["..."],',
  '      "evidence_refs": ["personnel_summary"],',
  '      "confidence": "medium",',
  '      "warnings": []',
  "    }",
  "  ]",
  "}",
  "",
  "Правила:",
  "- Если инструкция неоднозначна — выбирай самый аккуратный план: меньше операций, " +
    "не трогай секции, на которые пользователь не сослался.",
  "- При replace_section и insert_section_after используй конкретные числа из fact_pack.",
  "- Для персонала и подразделений опирайся на fact_pack.personnel_summary (organizations, meta, departments_top) " +
    "и указывай evidence_refs, включающие \"personnel_summary\".",
  "- Для отдельного раздела по подразделениям используй section_id \"personnel_by_department\" " +
    "(insert_section_after с new_section_id или replace_section существующей секции с этим id).",
  "- Секцию data_limitations (обязательную) не удаляй; при запросе «убери ограничения» упрости текст и при необходимости обнови warnings.",
  "- Все тексты на русском языке.",
].join("\n");

function buildReportGenerationMessages(factPack, options) {
  const titleHint = (options && options.titleHint) || "Отчёт ТОиР";
  const payload = {
    title_hint: titleHint,
    section_catalog: config.REPORT_SECTION_CATALOG,
    mandatory_section_ids: config.REPORT_MANDATORY_SECTION_IDS,
    fact_pack: factPack,
  };
  return [
    { role: "system", content: REPORT_GENERATION_SYSTEM_PROMPT },
    { role: "user", content: jsonDump(payload) },
  ];
}

function buildReportEditMessages(document, instruction) {
  const payload = {
    instruction: String(instruction || "").trim(),
    mandatory_section_ids: config.REPORT_MANDATORY_SECTION_IDS,
    section_catalog: config.REPORT_SECTION_CATALOG,
    document: {
      report_id: document.report_id,
      title: document.title,
      sections: (document.sections || []).map((s) => ({
        section_id: s.section_id,
        title: s.title,
        body_markdown: s.body_markdown,
        fact_bullets: s.fact_bullets,
        evidence_refs: s.evidence_refs,
        confidence: s.confidence,
        warnings: s.warnings,
        mandatory: s.mandatory,
      })),
    },
    fact_pack: document.fact_pack,
  };
  return [
    { role: "system", content: REPORT_EDIT_SYSTEM_PROMPT },
    { role: "user", content: jsonDump(payload) },
  ];
}

module.exports = {
  REPORT_GENERATION_SYSTEM_PROMPT,
  REPORT_EDIT_SYSTEM_PROMPT,
  buildReportGenerationMessages,
  buildReportEditMessages,
};
