"use strict";

const express = require("express");
const service = require("./service");
const config = require("./config");
const pdfExport = require("./pdf-export");
const docxExport = require("./docx-export");
const { asciiAttachmentDispositionForReport } = require("./content-disposition");

const router = express.Router();

function sendError(res, error) {
  if (error && error.code === "REPORT_NOT_FOUND") {
    return res.status(404).json({ ok: false, errorCode: "report_not_found", message: String(error.message) });
  }
  const message = String((error && error.message) || error || "Unknown error").slice(0, 500);
  return res.status(400).json({ ok: false, errorCode: "report_error", message });
}

router.get("/", (req, res) => {
  try {
    const reports = service.listReports();
    res.json({
      ok: true,
      reports,
      catalog: config.REPORT_SECTION_CATALOG,
      mandatory: config.REPORT_MANDATORY_SECTION_IDS,
    });
  } catch (e) {
    sendError(res, e);
  }
});

router.post("/", (req, res) => {
  try {
    const body = req.body || {};
    const document = service.createReport({
      title: body.title,
      filters: body.filters || {},
    });
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.get("/:id", (req, res) => {
  try {
    const document = service.loadReport(req.params.id);
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.put("/:id", (req, res) => {
  try {
    const body = req.body || {};
    const document = service.saveManualEdit(req.params.id, {
      title: body.title,
      sections: body.sections,
    });
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.post("/:id/drafts", async (req, res) => {
  try {
    const instruction = (req.body && req.body.instruction) || "";
    const draft = await service.planEdit(req.params.id, instruction);
    res.json({ ok: true, draft });
  } catch (e) {
    sendError(res, e);
  }
});

router.post("/:id/drafts/:draftId/apply", (req, res) => {
  try {
    const document = service.applyEditDraft(req.params.id, req.params.draftId);
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.post("/:id/undo", (req, res) => {
  try {
    const document = service.undoLastRevision(req.params.id);
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.post("/:id/refresh_snapshot", (req, res) => {
  try {
    const document = service.refreshSnapshot(req.params.id, req.body || {});
    res.json({ ok: true, report: document });
  } catch (e) {
    sendError(res, e);
  }
});

router.get("/:id/export/docx", async (req, res) => {
  try {
    const document = service.loadReport(req.params.id);
    const buf = await docxExport.buildReportDocxBuffer(document);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", asciiAttachmentDispositionForReport(document, ".docx"));
    res.send(Buffer.from(buf));
  } catch (e) {
    sendError(res, e);
  }
});

router.get("/:id/export/pdf", async (req, res) => {
  try {
    const document = service.loadReport(req.params.id);
    const buf = await pdfExport.buildReportPdfBuffer(document);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", asciiAttachmentDispositionForReport(document, ".pdf"));
    res.send(Buffer.from(buf));
  } catch (e) {
    sendError(res, e);
  }
});

router.delete("/:id", (req, res) => {
  try {
    const deleted = service.deleteReport(req.params.id);
    res.json({ ok: true, deleted });
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;
