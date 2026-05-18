"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");
const schemas = require("./schemas");
const facts = require("./facts");
const templates = require("./section-templates");
const storage = require("./storage");
const { sendOpenRouterJsonMessages } = require("../openrouter-client");
const prompts = require("./prompts");
const { writeAuditEvent, digestText } = require("../security/audit-log");

const TOIR_PATH = path.resolve(__dirname, "../../data/toir.json");

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function loadRawData() {
  if (!fs.existsSync(TOIR_PATH)) {
    throw new Error("data/toir.json не найден. Запустите npm run build:dashboard:json.");
  }
  return JSON.parse(fs.readFileSync(TOIR_PATH, "utf-8"));
}

function catalogEntry(sectionId) {
  return config.REPORT_SECTION_CATALOG.find((entry) => entry.id === sectionId) || null;
}

/** Сопоставить подсказку модели с section_id: точный id, затем точное совпадение с текущим title секции. */
function resolveSectionReference(sections, rawHint) {
  if (rawHint == null) return null;
  const hint = String(rawHint).trim();
  if (!hint) return null;
  const list = Array.isArray(sections) ? sections : [];
  if (list.some((s) => s.section_id === hint)) return hint;
  const low = hint.toLowerCase();
  for (const s of list) {
    if (String(s.title || "").trim().toLowerCase() === low) return s.section_id;
  }
  return null;
}

function pickSectionIdField(item) {
  if (!item || typeof item !== "object") return "";
  const v =
    item.section_id ??
    item.sectionId ??
    item.target_section_id ??
    item.targetSectionId;
  return v != null ? String(v).trim() : "";
}

function pickAfterSectionIdField(item) {
  if (!item || typeof item !== "object") return "";
  const v = item.after_section_id ?? item.afterSectionId ?? item.anchor_section_id ?? item.anchorSectionId;
  return v != null ? String(v).trim() : "";
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
      const sidRaw = op.section_id != null ? String(op.section_id).trim() : "";
      const sid = resolveSectionReference(list, sidRaw);
      if (!sid) throw new Error("delete_section: не удалось сопоставить section_id.");
      if (config.REPORT_MANDATORY_SECTION_IDS.includes(sid)) {
        throw new Error(`Нельзя удалить обязательную секцию: ${sid}`);
      }
      const idx = list.findIndex((s) => s.section_id === sid);
      if (idx >= 0) list.splice(idx, 1);
      continue;
    }
    if (type === "replace_section") {
      const sidRaw = op.section_id != null ? String(op.section_id).trim() : "";
      const resolvedSid = resolveSectionReference(list, sidRaw);
      if (!resolvedSid) continue;
      const idx = list.findIndex((s) => s.section_id === resolvedSid);
      if (idx < 0) continue;
      const s = list[idx];
      const rawOp = raw && typeof raw === "object" ? raw : {};
      if (op.title != null) s.title = String(op.title);
      if (op.body_markdown != null) s.body_markdown = String(op.body_markdown);
      if (Array.isArray(op.fact_bullets) && op.fact_bullets.length) {
        s.fact_bullets = op.fact_bullets.map((v) => String(v)).filter(Boolean);
      }
      if (op.confidence) s.confidence = op.confidence;
      if (Array.isArray(op.evidence_refs) && op.evidence_refs.length) {
        s.evidence_refs = op.evidence_refs.map((v) => String(v)).filter(Boolean);
      }
      if (Object.prototype.hasOwnProperty.call(rawOp, "warnings") && Array.isArray(rawOp.warnings)) {
        s.warnings = rawOp.warnings.map((v) => String(v)).filter(Boolean);
      }
      continue;
    }
    if (type === "insert_section_after") {
      const rawAfter = op.after_section_id != null ? String(op.after_section_id).trim() : "";
      const resolvedAfter = rawAfter ? resolveSectionReference(list, rawAfter) : "";
      if (rawAfter && resolvedAfter) op.after_section_id = resolvedAfter;
      const sid = op.new_section_id || op.section_id;
      if (!sid) throw new Error("insert_section_after: не указан идентификатор секции.");
      const entry = catalogEntry(sid);
      const rawOp = raw && typeof raw === "object" ? raw : {};
      const newSec = schemas.makeSection({
        section_id: sid,
        title: op.title != null ? String(op.title) : entry ? entry.title : sid,
        body_markdown: op.body_markdown != null ? String(op.body_markdown) : "Заполните содержание секции.",
        fact_bullets: op.fact_bullets || [],
        evidence_refs: op.evidence_refs && op.evidence_refs.length ? op.evidence_refs : [],
        confidence: op.confidence || "medium",
        warnings: Object.prototype.hasOwnProperty.call(rawOp, "warnings") && Array.isArray(rawOp.warnings)
          ? rawOp.warnings.map((v) => String(v)).filter(Boolean)
          : [],
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
      const sidRaw = op.section_id != null ? String(op.section_id).trim() : "";
      const resolvedSid = resolveSectionReference(list, sidRaw);
      if (!resolvedSid) continue;
      const idx = list.findIndex((s) => s.section_id === resolvedSid);
      if (idx < 0) continue;
      const [row] = list.splice(idx, 1);
      let insertAt = list.length;
      if (op.after_section_id) {
        const afterRaw = String(op.after_section_id).trim();
        const afterResolved = resolveSectionReference(list, afterRaw);
        const anchor = afterResolved || afterRaw;
        const j = list.findIndex((x) => x.section_id === anchor);
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
  }
  return { operations, warnings };
}

function normalizeLlmOperations(document, rawList) {
  const sections = document.sections || [];
  const existingIds = new Set(sections.map((s) => s.section_id));
  const out = [];
  const notes = [];
  let resolvedByTitle = 0;
  if (!Array.isArray(rawList)) return { operations: out, notes };

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const type = String(item.operation_type || "").trim();
    if (!config.VALID_OPERATION_TYPES.includes(type)) continue;
    const op = Object.assign({}, item, { operation_type: type });

    if (type === "replace_section" || type === "delete_section") {
      const picked = pickSectionIdField(op);
      const resolved = resolveSectionReference(sections, picked);
      if (!resolved) {
        if (picked) {
          notes.push(`Операция ${type} пропущена: не найдена секция «${picked}» (нужен section_id из документа или точный заголовок секции).`);
        }
        continue;
      }
      if (picked !== resolved) resolvedByTitle += 1;
      op.section_id = resolved;
    } else if (type === "move_section") {
      const picked = pickSectionIdField(op);
      const resolved = resolveSectionReference(sections, picked);
      if (!resolved) {
        if (picked) notes.push(`Операция move_section пропущена: не найдена секция «${picked}».`);
        continue;
      }
      if (picked !== resolved) resolvedByTitle += 1;
      op.section_id = resolved;
      const anchorPick = pickAfterSectionIdField(op);
      if (anchorPick) {
        const ra = resolveSectionReference(sections, anchorPick);
        if (ra) {
          op.after_section_id = ra;
          if (anchorPick !== ra) resolvedByTitle += 1;
        }
      }
    } else if (type === "insert_section_after") {
      if (!op.new_section_id && op.section_id && !existingIds.has(String(op.section_id))) {
        op.new_section_id = String(op.section_id);
        op.section_id = null;
      }
      const anchorPick = pickAfterSectionIdField(op);
      if (anchorPick) {
        const ra = resolveSectionReference(sections, anchorPick);
        if (ra) {
          op.after_section_id = ra;
          if (anchorPick !== ra) resolvedByTitle += 1;
        }
      }
    }

    out.push(op);
  }

  if (resolvedByTitle > 0) {
    notes.unshift(
      `Модель указала подписи секций вместо внутренних id — сопоставлено операций: ${resolvedByTitle}. Для стабильности используйте section_id из document.sections (например costs_and_trend).`
    );
  }
  return { operations: out, notes };
}

function tryPreview(document, operations) {
  const previewSections = schemas.cloneSections(document.sections);
  const previewTitle = applyOperations(document.title, previewSections, operations);
  validateSections(previewSections);
  if (!previewTitle || !String(previewTitle).trim()) {
    throw new Error("Пустой заголовок после превью операций.");
  }
  return { previewSections, previewTitle };
}

async function planEdit(reportId, instruction, options) {
  const requestId = (options && options.requestId) || "";
  const document = loadReport(reportId);
  const ins = String(instruction || "").trim();
  if (!ins) throw new Error("Инструкция не может быть пустой.");

  const warnings = [];
  let operations = [];
  let used_fallback = true;

  const llmOn =
    parseBool(process.env.REPORT_AI_EDIT_ENABLED, true) &&
    !!(process.env.OPENROUTER_API_KEY || "").trim() &&
    !parseBool(process.env.OPENROUTER_MOCK_ENABLED, false);

  let llmMeta = null;

  if (llmOn) {
    try {
      const messages = prompts.buildReportEditMessages(document, ins);
      const llm = await sendOpenRouterJsonMessages({ messages, requestId });
      if (llm.ok && llm.parsed && Array.isArray(llm.parsed.operations)) {
        const normalized = normalizeLlmOperations(document, llm.parsed.operations);
        for (const n of normalized.notes || []) {
          if (warnings.indexOf(n) === -1) warnings.push(n);
        }
        if (normalized.operations.length) {
          operations = normalized.operations;
          used_fallback = false;
          llmMeta = { providerModel: llm.providerModel || null, latencyMs: llm.latencyMs || null };
        }
      }
      if (operations.length === 0) {
        warnings.push(
          `LLM не вернул применимый план правок${llm && llm.error ? `: ${String(llm.error).slice(0, 200)}` : ""}.`
        );
        writeAuditEvent({
          event: "report_edit_llm_plan_failed",
          service: "toir-api",
          requestId,
          reportId: document.report_id,
          instructionDigest: digestText(ins),
          error: (llm && llm.error) || "no_operations",
          providerModel: llm && llm.providerModel,
        });
      }
    } catch (e) {
      warnings.push(`Ошибка вызова LLM для плана правок: ${String(e.message || e).slice(0, 220)}.`);
      writeAuditEvent({
        event: "report_edit_llm_exception",
        service: "toir-api",
        requestId,
        reportId: document.report_id,
        instructionDigest: digestText(ins),
        error: String(e.message || e).slice(0, 400),
      });
    }
  } else if (!parseBool(process.env.REPORT_AI_EDIT_ENABLED, true)) {
    warnings.push("AI-план правок отключён (REPORT_AI_EDIT_ENABLED=false), используется эвристический план.");
  } else if (!(process.env.OPENROUTER_API_KEY || "").trim()) {
    warnings.push("Ключ OpenRouter не настроен — используется эвристический план правок.");
  } else if (parseBool(process.env.OPENROUTER_MOCK_ENABLED, false)) {
    warnings.push("Включён OPENROUTER_MOCK — JSON-план правок через модель недоступен, используется fallback.");
  }

  if (!operations.length) {
    const fb = buildFallbackEditPlan(document, ins);
    for (const w of fb.warnings || []) warnings.push(w);
    operations = fb.operations || [];
    if (!operations.length) {
      throw new Error("Не удалось сформировать операции по инструкции.");
    }
    used_fallback = true;
  }

  let previewSections;
  let previewTitle;
  try {
    const pv = tryPreview(document, operations);
    previewSections = pv.previewSections;
    previewTitle = pv.previewTitle;
  } catch (e) {
    if (!used_fallback) {
      warnings.push(`План LLM не прошёл проверку: ${String(e.message || e).slice(0, 280)}.`);
      writeAuditEvent({
        event: "report_edit_llm_validate_failed",
        service: "toir-api",
        requestId,
        reportId: document.report_id,
        instructionDigest: digestText(ins),
        error: String(e.message || e).slice(0, 400),
      });
      const fb = buildFallbackEditPlan(document, ins);
      for (const w of fb.warnings || []) {
        if (warnings.indexOf(w) === -1) warnings.push(w);
      }
      operations = fb.operations || [];
      if (!operations.length) {
        throw new Error("Не удалось сформировать операции по инструкции.");
      }
      used_fallback = true;
      const pv2 = tryPreview(document, operations);
      previewSections = pv2.previewSections;
      previewTitle = pv2.previewTitle;
    } else {
      throw e;
    }
  }

  if (!used_fallback && llmMeta) {
    writeAuditEvent({
      event: "report_edit_llm_plan_ok",
      service: "toir-api",
      requestId,
      reportId: document.report_id,
      instructionDigest: digestText(ins),
      operationsCount: operations.length,
      providerModel: llmMeta.providerModel,
      latencyMs: llmMeta.latencyMs,
    });
  }

  if (used_fallback && warnings.indexOf("Использован эвристический план правок (fallback).") === -1) {
    warnings.unshift("Использован эвристический план правок (fallback).");
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
    used_fallback,
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

function refreshSnapshot(reportId, payload) {
  const document = loadReport(reportId);
  const rawData = loadRawData();
  const snap = document.snapshot || {};
  const bodyFilters = payload && payload.filters && typeof payload.filters === "object" ? payload.filters : null;
  const hasOverride =
    bodyFilters &&
    (Object.prototype.hasOwnProperty.call(bodyFilters, "period") ||
      Object.prototype.hasOwnProperty.call(bodyFilters, "class"));
  const filters = hasOverride
    ? {
        period:
          bodyFilters.period != null && String(bodyFilters.period).trim() !== ""
            ? String(bodyFilters.period)
            : snap.period || "all",
        class:
          bodyFilters.class != null && String(bodyFilters.class).trim() !== ""
            ? String(bodyFilters.class)
            : snap.class_filter || "__all__",
      }
    : {
        period: snap.period || "all",
        class: snap.class_filter || "__all__",
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
