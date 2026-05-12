"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");
const schemas = require("./schemas");
const facts = require("./facts");
const templates = require("./section-templates");
const storage = require("./storage");

const TOIR_PATH = path.resolve(__dirname, "../../data/toir.json");

function loadRawData() {
  if (!fs.existsSync(TOIR_PATH)) {
    throw new Error("data/toir.json не найден. Запустите npm run build:dashboard:json.");
  }
  return JSON.parse(fs.readFileSync(TOIR_PATH, "utf-8"));
}

function catalogEntry(sectionId) {
  return config.REPORT_SECTION_CATALOG.find((entry) => entry.id === sectionId) || null;
}

function ensureSection(rawSection) {
  const entry = catalogEntry(rawSection && rawSection.section_id);
  return schemas.makeSection({
    section_id: rawSection && rawSection.section_id,
    title: (rawSection && rawSection.title) || (entry ? entry.title : ""),
    body_markdown: ((rawSection && rawSection.body_markdown) || "").trim(),
    fact_bullets: rawSection && rawSection.fact_bullets,
    evidence_refs: rawSection && rawSection.evidence_refs,
    confidence: (rawSection && rawSection.confidence) || "medium",
    warnings: rawSection && rawSection.warnings,
    mandatory: !!(entry && entry.mandatory) || !!(rawSection && rawSection.mandatory),
  });
}

function validateSections(sections) {
  if (!Array.isArray(sections) || !sections.length) {
    throw new Error("В отчёте должна остаться хотя бы одна секция.");
  }
  const prepared = sections.map(ensureSection);
  const seen = new Set();
  for (const section of prepared) {
    if (!section.section_id) {
      throw new Error("У секции должен быть section_id.");
    }
    if (seen.has(section.section_id)) {
      throw new Error(`Дублируется section_id: ${section.section_id}`);
    }
    seen.add(section.section_id);
    if (!section.title || !section.title.trim()) {
      throw new Error(`У секции ${section.section_id} нет заголовка.`);
    }
    if (!section.body_markdown || !section.body_markdown.trim()) {
      throw new Error(`У секции ${section.section_id} пустое body_markdown.`);
    }
  }
  for (const mandId of config.REPORT_MANDATORY_SECTION_IDS) {
    if (!seen.has(mandId)) {
      throw new Error(`В отчёте отсутствует обязательная секция: ${mandId}.`);
    }
  }
  return prepared;
}

function appendRevision(document, authorType, summary) {
  const rev = schemas.makeRevision({
    revision_id: schemas.newId("rev"),
    created_at: document.updated_at,
    author_type: authorType,
    summary,
    title: document.title,
    sections: schemas.cloneSections(document.sections),
  });
  document.revisions = [...(document.revisions || []), rev];
  if (document.revisions.length > config.REPORT_MAX_REVISIONS) {
    document.revisions = document.revisions.slice(-config.REPORT_MAX_REVISIONS);
  }
}

function defaultTitle(snapshot) {
  const periodLabel = snapshot.period_label || "12 мес.";
  const classNote =
    snapshot.class_filter && snapshot.class_filter !== "__all__" ? ` · ${snapshot.class_filter}` : "";
  return `Отчёт ТОиР: ${periodLabel}${classNote}`;
}

function buildSnapshotAndFactPack(rawData, filters) {
  const snapshot = schemas.makeSnapshot(facts.buildSnapshot(rawData, filters));
  const factPack = schemas.makeFactPack(facts.buildFactPack(rawData, filters));
  return { snapshot, factPack };
}

function createReport(input) {
  const params = input || {};
  const filters = params.filters || {};
  const rawData = loadRawData();
  const { snapshot, factPack } = buildSnapshotAndFactPack(rawData, filters);
  const reportTitle = (params.title && String(params.title).trim()) || defaultTitle(snapshot);

  // Этап 1: только fallback-шаблоны. LLM-ветка добавляется на этапе 3.
  const generatedSections = templates.buildFallbackSections(factPack);
  const validated = validateSections(generatedSections);

  const now = schemas.utcNowIso();
  const document = schemas.makeDocument({
    report_id: schemas.newId("rpt"),
    title: reportTitle,
    created_at: now,
    updated_at: now,
    snapshot,
    fact_pack: factPack,
    sections: validated,
    revisions: [],
    pending_drafts: [],
  });

  appendRevision(
    document,
    "system",
    "Первичное создание отчёта (шаблонная генерация по фактам, без LLM)."
  );
  storage.saveDocument(document);
  return document;
}

function listReports() {
  return storage.listSummaries();
}

function loadReport(reportId) {
  return storage.loadDocument(reportId);
}

function deleteReport(reportId) {
  return storage.deleteDocument(reportId);
}

function saveManualEdit(reportId, payload) {
  const document = loadReport(reportId);
  if (Array.isArray(payload && payload.sections)) {
    document.sections = validateSections(payload.sections);
  }
  if (payload && payload.title !== undefined && payload.title !== null) {
    const t = String(payload.title).trim();
    if (!t) throw new Error("Заголовок отчёта не может быть пустым.");
    document.title = t;
  }
  document.updated_at = schemas.utcNowIso();
  document.pending_drafts = [];
  appendRevision(document, "manual", "Ручная правка отчёта.");
  storage.saveDocument(document);
  return document;
}

function applyOperations(title, sections, operations) {
  if (!Array.isArray(sections)) {
    throw new Error("Секции отчёта недоступны.");
  }
  let currentTitle = title;
  const list = sections;
  for (const raw of operations || []) {
    const op = raw && raw.operation_type ? raw : schemas.makeEditOperation(raw);
    const type = op.operation_type;
    if (!config.VALID_OPERATION_TYPES.includes(type)) {
      throw new Error(`Неизвестная операция: ${type}`);
    }
    if (type === "update_title") {
      const nt = op.title != null ? String(op.title).trim() : "";
      if (!nt) throw new Error("Пустой заголовок в операции update_title.");
      currentTitle = nt;
      continue;
    }
    if (type === "delete_section") {
      const sid = op.section_id;
      if (!sid) throw new Error("delete_section: нет section_id.");
      if (config.REPORT_MANDATORY_SECTION_IDS.includes(sid)) {
        throw new Error(`Нельзя удалить обязательную секцию: ${sid}`);
      }
      const idx = list.findIndex((s) => s.section_id === sid);
      if (idx >= 0) list.splice(idx, 1);
      continue;
    }
    if (type === "replace_section") {
      const idx = list.findIndex((s) => s.section_id === op.section_id);
      if (idx < 0) continue;
      const s = list[idx];
      if (op.title != null) s.title = String(op.title);
      if (op.body_markdown != null) s.body_markdown = String(op.body_markdown);
      if (Array.isArray(op.fact_bullets) && op.fact_bullets.length) {
        s.fact_bullets = op.fact_bullets.map((v) => String(v)).filter(Boolean);
      }
      if (op.confidence) s.confidence = op.confidence;
      if (Array.isArray(op.evidence_refs) && op.evidence_refs.length) {
        s.evidence_refs = op.evidence_refs.map((v) => String(v)).filter(Boolean);
      }
      continue;
    }
    if (type === "insert_section_after") {
      const sid = op.new_section_id || op.section_id;
      if (!sid) throw new Error("insert_section_after: не указан идентификатор секции.");
      const entry = catalogEntry(sid);
      const newSec = schemas.makeSection({
        section_id: sid,
        title: op.title != null ? String(op.title) : entry ? entry.title : sid,
        body_markdown: op.body_markdown != null ? String(op.body_markdown) : "Заполните содержание секции.",
        fact_bullets: op.fact_bullets || [],
        mandatory: entry ? entry.mandatory : false,
      });
      let insertAt = list.length;
      if (op.after_section_id) {
        const j = list.findIndex((x) => x.section_id === op.after_section_id);
        insertAt = j >= 0 ? j + 1 : list.length;
      }
      list.splice(insertAt, 0, newSec);
      continue;
    }
    if (type === "move_section") {
      const idx = list.findIndex((s) => s.section_id === op.section_id);
      if (idx < 0) continue;
      const [row] = list.splice(idx, 1);
      let insertAt = list.length;
      if (op.after_section_id) {
        const j = list.findIndex((x) => x.section_id === op.after_section_id);
        insertAt = j >= 0 ? j + 1 : list.length;
      }
      list.splice(insertAt, 0, row);
    }
  }
  return currentTitle;
}

function buildFallbackEditPlan(document, instruction) {
  const low = String(instruction || "").toLowerCase();
  const operations = [];
  const warnings = [];
  if (/персонал|убер(и|ите)\s+раздел/.test(low)) {
    operations.push({
      operation_type: "delete_section",
      section_id: "personnel",
      reasoning: "Эвристика: удаление раздела о персонале по формулировке запроса.",
    });
    return { operations, warnings };
  }
  const ex = (document.sections || []).find((s) => s.section_id === "executive_summary");
  if (ex) {
    operations.push({
      operation_type: "replace_section",
      section_id: "executive_summary",
      body_markdown: `${ex.body_markdown}\n\n_Правка по запросу (fallback, без LLM)._`,
      reasoning: "Эвристика: дополнение executive_summary.",
    });
    warnings.push("Использован упрощённый план правок (fallback), LLM не вызывался.");
  }
  return { operations, warnings };
}

async function planEdit(reportId, instruction) {
  const document = loadReport(reportId);
  const ins = String(instruction || "").trim();
  if (!ins) throw new Error("Инструкция не может быть пустой.");
  const { operations, warnings } = buildFallbackEditPlan(document, ins);
  if (!operations.length) {
    throw new Error("Не удалось сформировать операции по инструкции (fallback).");
  }
  const previewSections = schemas.cloneSections(document.sections);
  const previewTitle = applyOperations(document.title, previewSections, operations);
  validateSections(previewSections);
  if (!previewTitle || !String(previewTitle).trim()) {
    throw new Error("Пустой заголовок после превью операций.");
  }
  const draft = schemas.makeEditDraft({
    draft_id: schemas.newId("drf"),
    report_id: document.report_id,
    instruction: ins,
    created_at: schemas.utcNowIso(),
    base_revision_id: schemas.latestRevisionId(document),
    operations: operations.map((op) => schemas.makeEditOperation(op)),
    preview_title: previewTitle,
    preview_sections: previewSections,
    warnings,
    used_fallback: true,
  });
  document.pending_drafts = [...(document.pending_drafts || []), draft].slice(-config.REPORT_MAX_PENDING_DRAFTS);
  storage.saveDocument(document);
  return draft;
}

function applyEditDraft(reportId, draftId) {
  const document = loadReport(reportId);
  const draft = (document.pending_drafts || []).find((d) => d.draft_id === draftId);
  if (!draft) {
    const err = new Error(`Черновик ${draftId} не найден.`);
    err.code = "DRAFT_NOT_FOUND";
    throw err;
  }
  const sections = schemas.cloneSections(document.sections);
  const newTitle = applyOperations(document.title, sections, draft.operations);
  document.title = newTitle;
  document.sections = validateSections(sections);
  document.pending_drafts = (document.pending_drafts || []).filter((d) => d.draft_id !== draftId);
  document.updated_at = schemas.utcNowIso();
  appendRevision(
    document,
    "ai",
    `План правки применён (${draft.operations.length} операций).`
  );
  storage.saveDocument(document);
  return document;
}

function undoLastRevision(reportId) {
  const document = loadReport(reportId);
  if (!document.revisions || document.revisions.length < 2) {
    throw new Error("Нет ревизии для отмены.");
  }
  document.revisions.pop();
  const last = document.revisions[document.revisions.length - 1];
  document.title = last.title;
  document.sections = schemas.cloneSections(last.sections);
  document.updated_at = schemas.utcNowIso();
  document.pending_drafts = [];
  storage.saveDocument(document);
  return document;
}

function refreshSnapshot(reportId) {
  const document = loadReport(reportId);
  const rawData = loadRawData();
  const filters = {
    period: (document.snapshot && document.snapshot.period) || "all",
    class: (document.snapshot && document.snapshot.class_filter) || "__all__",
  };
  const { snapshot, factPack } = buildSnapshotAndFactPack(rawData, filters);
  document.snapshot = snapshot;
  document.fact_pack = factPack;
  document.updated_at = schemas.utcNowIso();
  const warnText = `Снимок обновлён (${document.updated_at}). Перепроверьте формулировки секций.`;
  document.sections = (document.sections || []).map((s) => {
    if (s.section_id === "passport" || s.section_id === "data_limitations") return s;
    const w = [...(s.warnings || []), warnText];
    return Object.assign({}, s, { warnings: w });
  });
  appendRevision(document, "system", "Обновлены snapshot и fact pack по текущему toir.json.");
  storage.saveDocument(document);
  return document;
}

module.exports = {
  loadRawData,
  buildSnapshotAndFactPack,
  validateSections,
  appendRevision,
  ensureSection,
  catalogEntry,
  defaultTitle,
  applyOperations,
  planEdit,
  applyEditDraft,
  undoLastRevision,
  refreshSnapshot,
  createReport,
  listReports,
  loadReport,
  deleteReport,
  saveManualEdit,
};
