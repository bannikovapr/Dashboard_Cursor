"use strict";

const path = require("path");

const REPORTS_STORAGE_DIR = path.resolve(__dirname, "../../.reports");

const REPORT_SECTION_CATALOG = [
  { id: "passport",          title: "Паспорт отчёта и контекст среза",            mandatory: true  },
  { id: "executive_summary", title: "Короткий вывод для руководителя",            mandatory: false },
  { id: "costs_and_trend",   title: "Затраты ТОиР: масштаб и динамика",           mandatory: false },
  { id: "cost_hotspots",     title: "Ключевые зоны затрат и проблемных объектов", mandatory: false },
  { id: "reliability",       title: "Надёжность: КТГ, СННО, СВР и причины",       mandatory: false },
  { id: "personnel",         title: "Использование персонала",                    mandatory: false },
  { id: "personnel_by_department", title: "Использование персонала по подразделениям", mandatory: false },
  { id: "data_limitations",  title: "Ограничения данных и надёжность выводов",    mandatory: true  },
  { id: "priority_actions",  title: "Приоритетные управленческие действия",       mandatory: false },
];

const REPORT_MANDATORY_SECTION_IDS = REPORT_SECTION_CATALOG
  .filter((entry) => entry.mandatory)
  .map((entry) => entry.id);

const REPORT_MAX_REVISIONS = 20;
const REPORT_MAX_PENDING_DRAFTS = 10;

const REPORT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const VALID_OPERATION_TYPES = [
  "update_title",
  "replace_section",
  "insert_section_after",
  "delete_section",
  "move_section",
];

const VALID_CONFIDENCE_LEVELS = ["high", "medium", "low"];

const CONFIDENCE_LABELS = {
  high: "Высокая",
  medium: "Средняя",
  low: "Низкая",
};

const VALID_AUTHOR_TYPES = ["system", "manual", "ai"];

module.exports = {
  REPORTS_STORAGE_DIR,
  REPORT_SECTION_CATALOG,
  REPORT_MANDATORY_SECTION_IDS,
  REPORT_MAX_REVISIONS,
  REPORT_MAX_PENDING_DRAFTS,
  REPORT_ID_PATTERN,
  VALID_OPERATION_TYPES,
  VALID_CONFIDENCE_LEVELS,
  VALID_AUTHOR_TYPES,
  CONFIDENCE_LABELS,
};
