"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

function ensureDir() {
  if (!fs.existsSync(config.REPORTS_STORAGE_DIR)) {
    fs.mkdirSync(config.REPORTS_STORAGE_DIR, { recursive: true });
  }
}

function validateReportId(reportId) {
  if (!reportId || typeof reportId !== "string") return false;
  return config.REPORT_ID_PATTERN.test(reportId);
}

function reportPath(reportId) {
  if (!validateReportId(reportId)) {
    throw new Error(`Невалидный report_id: ${reportId}`);
  }
  const baseDir = path.resolve(config.REPORTS_STORAGE_DIR);
  const target = path.resolve(baseDir, `${reportId}.json`);
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) {
    throw new Error(`Путь к отчёту выходит за пределы хранилища: ${reportId}`);
  }
  return target;
}

function saveDocument(document) {
  if (!document || !document.report_id) {
    throw new Error("Отчёт без report_id нельзя сохранить.");
  }
  ensureDir();
  const filePath = reportPath(document.report_id);
  const payload = JSON.stringify(document, null, 2);
  fs.writeFileSync(filePath, payload, "utf-8");
}

function loadDocument(reportId) {
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Отчёт ${reportId} не найден.`);
    error.code = "REPORT_NOT_FOUND";
    throw error;
  }
  const text = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(text);
}

function deleteDocument(reportId) {
  const filePath = reportPath(reportId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function listDocuments() {
  ensureDir();
  const dir = config.REPORTS_STORAGE_DIR;
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (e) {
    return [];
  }
  const docs = [];
  for (const fileName of files) {
    try {
      const text = fs.readFileSync(path.join(dir, fileName), "utf-8");
      docs.push(JSON.parse(text));
    } catch (e) {
      // skip corrupt file
    }
  }
  docs.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return docs;
}

function listSummaries() {
  return listDocuments().map((doc) => ({
    report_id: doc.report_id,
    title: doc.title,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    snapshot: {
      period: doc.snapshot && doc.snapshot.period,
      period_label: doc.snapshot && doc.snapshot.period_label,
      class_filter: doc.snapshot && doc.snapshot.class_filter,
    },
    section_count: (doc.sections || []).length,
    revision_count: (doc.revisions || []).length,
    pending_drafts_count: (doc.pending_drafts || []).length,
  }));
}

module.exports = {
  saveDocument,
  loadDocument,
  deleteDocument,
  listDocuments,
  listSummaries,
  validateReportId,
};
