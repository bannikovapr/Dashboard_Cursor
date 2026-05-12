"use strict";

const crypto = require("crypto");
const config = require("./config");

function utcNowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function asString(value, def) {
  if (value === null || value === undefined) return def === undefined ? "" : def;
  return String(value);
}

function asArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.assign({}, value);
}

function asConfidence(value) {
  return config.VALID_CONFIDENCE_LEVELS.includes(value) ? value : "medium";
}

function asAuthorType(value) {
  return config.VALID_AUTHOR_TYPES.includes(value) ? value : "system";
}

function makeSnapshot(payload) {
  const p = payload || {};
  return {
    source_name: asString(p.source_name),
    period_label: asString(p.period_label),
    period: asString(p.period, "all"),
    class_filter: asString(p.class_filter, "__all__"),
    date_start: p.date_start || null,
    date_end: p.date_end || null,
    selected_filters: asObject(p.selected_filters),
    raw_data_signature: asString(p.raw_data_signature),
    organization: asString(p.organization),
  };
}

function makeFactPack(payload) {
  const p = payload || {};
  return {
    snapshot_summary: asObject(p.snapshot_summary),
    kpis: asObject(p.kpis),
    monthly_trend: asArray(p.monthly_trend),
    top_cost_objects: asArray(p.top_cost_objects),
    top_downtime_objects: asArray(p.top_downtime_objects),
    pareto_cost_objects: asObject(p.pareto_cost_objects),
    pareto_downtime_objects: asObject(p.pareto_downtime_objects),
    failure_causes_top: asArray(p.failure_causes_top),
    mtbf_top: asArray(p.mtbf_top),
    mttr_top: asArray(p.mttr_top),
    class_summary: asArray(p.class_summary),
    personnel_summary: asObject(p.personnel_summary),
    quality_summary: asObject(p.quality_summary),
    diagnostics_summary: asObject(p.diagnostics_summary),
    top_problem_objects: asArray(p.top_problem_objects),
  };
}

function makeSection(payload) {
  const p = payload || {};
  return {
    section_id: asString(p.section_id),
    title: asString(p.title),
    body_markdown: asString(p.body_markdown),
    fact_bullets: asArray(p.fact_bullets).map((v) => asString(v)),
    evidence_refs: asArray(p.evidence_refs).map((v) => asString(v)),
    confidence: asConfidence(p.confidence),
    warnings: asArray(p.warnings).map((v) => asString(v)),
    mandatory: !!p.mandatory,
  };
}

function cloneSection(section) {
  return makeSection(section);
}

function cloneSections(sections) {
  return (sections || []).map(cloneSection);
}

function renderSectionMarkdown(section) {
  const parts = [`## ${section.title}`];
  const body = (section.body_markdown || "").trim();
  if (body) parts.push(body);
  if (section.fact_bullets && section.fact_bullets.length) {
    parts.push("**Подтверждающие факты**");
    section.fact_bullets.forEach((b) => parts.push(`- ${b}`));
  }
  parts.push(`**Уровень уверенности:** ${config.CONFIDENCE_LABELS[section.confidence] || section.confidence}`);
  if (section.evidence_refs && section.evidence_refs.length) {
    parts.push(`**Опора на данные:** ${section.evidence_refs.join(", ")}`);
  }
  if (section.warnings && section.warnings.length) {
    parts.push("**Ограничения секции**");
    section.warnings.forEach((w) => parts.push(`- ${w}`));
  }
  return parts.filter(Boolean).join("\n\n");
}

function makeRevision(payload) {
  const p = payload || {};
  return {
    revision_id: asString(p.revision_id),
    created_at: asString(p.created_at),
    author_type: asAuthorType(p.author_type),
    summary: asString(p.summary),
    title: asString(p.title),
    sections: cloneSections(p.sections),
  };
}

function makeEditOperation(payload) {
  const p = payload || {};
  const opType = asString(p.operation_type);
  return {
    operation_type: opType,
    section_id: p.section_id ? asString(p.section_id) : null,
    after_section_id: p.after_section_id ? asString(p.after_section_id) : null,
    new_section_id: p.new_section_id ? asString(p.new_section_id) : null,
    title: p.title === undefined || p.title === null ? null : asString(p.title),
    body_markdown: p.body_markdown === undefined || p.body_markdown === null ? null : asString(p.body_markdown),
    fact_bullets: asArray(p.fact_bullets).map((v) => asString(v)),
    evidence_refs: asArray(p.evidence_refs).map((v) => asString(v)),
    confidence: p.confidence && config.VALID_CONFIDENCE_LEVELS.includes(p.confidence) ? p.confidence : null,
    warnings: asArray(p.warnings).map((v) => asString(v)),
    reasoning: p.reasoning ? asString(p.reasoning) : null,
  };
}

function makeEditDraft(payload) {
  const p = payload || {};
  return {
    draft_id: asString(p.draft_id),
    report_id: asString(p.report_id),
    instruction: asString(p.instruction),
    created_at: asString(p.created_at),
    base_revision_id: asString(p.base_revision_id),
    operations: asArray(p.operations).map(makeEditOperation),
    preview_title: asString(p.preview_title),
    preview_sections: cloneSections(p.preview_sections),
    warnings: asArray(p.warnings).map((v) => asString(v)),
    used_fallback: !!p.used_fallback,
  };
}

function makeDocument(payload) {
  const p = payload || {};
  return {
    report_id: asString(p.report_id),
    title: asString(p.title),
    created_at: asString(p.created_at),
    updated_at: asString(p.updated_at),
    snapshot: makeSnapshot(p.snapshot),
    fact_pack: makeFactPack(p.fact_pack),
    sections: cloneSections(p.sections),
    revisions: asArray(p.revisions).map(makeRevision),
    pending_drafts: asArray(p.pending_drafts).map(makeEditDraft),
  };
}

function latestRevisionId(document) {
  if (!document || !document.revisions || !document.revisions.length) return "";
  return document.revisions[document.revisions.length - 1].revision_id;
}

function renderDocumentMarkdown(document) {
  const snap = document.snapshot || {};
  const parts = [`# ${document.title}`];
  parts.push(
    `Сформирован по снимку: источник ${snap.source_name || "—"}, ` +
    `период ${snap.period_label || snap.period || "—"}, ` +
    `класс ${snap.class_filter && snap.class_filter !== "__all__" ? snap.class_filter : "все"}.`
  );
  (document.sections || []).forEach((section) => parts.push(renderSectionMarkdown(section)));
  return parts.filter(Boolean).join("\n\n");
}

module.exports = {
  utcNowIso,
  newId,
  makeSnapshot,
  makeFactPack,
  makeSection,
  cloneSection,
  cloneSections,
  renderSectionMarkdown,
  makeRevision,
  makeEditOperation,
  makeEditDraft,
  makeDocument,
  latestRevisionId,
  renderDocumentMarkdown,
};
