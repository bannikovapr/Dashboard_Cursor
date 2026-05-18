"use strict";

const express = require("express");
const crypto = require("crypto");
const service = require("./service");
const config = require("./config");
const pdfExport = require("./pdf-export");
const docxExport = require("./docx-export");
const { asciiAttachmentDispositionForReport } = require("./content-disposition");
const { createSession: createDlpSession } = require("../security/dlp-service");
const { writeAuditEvent, digestText } = require("../security/audit-log");
const { checkRateLimit } = require("../security/rate-limit");

const router = express.Router();

function applyHardeningHeaders(res, hardening) {
  if (!res || !hardening) return;
  if (hardening.rate && hardening.rate.applied) {
    if (Number.isFinite(hardening.rate.limit)) {
      res.setHeader("X-RateLimit-Limit", String(hardening.rate.limit));
    }
    if (Number.isFinite(hardening.rate.remaining)) {
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, hardening.rate.remaining)));
    }
    if (Number.isFinite(hardening.rate.resetAt)) {
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(hardening.rate.resetAt / 1000)));
    }
    if (!hardening.rate.allowed && Number.isFinite(hardening.rate.retryAfterSec)) {
      res.setHeader("Retry-After", String(Math.max(1, hardening.rate.retryAfterSec)));
    }
  }
}

function validateReportInstruction(text) {
  if (typeof text !== "string") return "Поле instruction должно быть строкой.";
  const value = text.trim();
  if (!value) return "Инструкция не может быть пустой.";
  if (value.length > 4000) return "Инструкция слишком длинная (макс. 4000 символов).";
  return null;
}

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
  const requestId = crypto.randomUUID();
  const hardening = { rate: checkRateLimit({ req, routeId: "report_edit" }) };
  applyHardeningHeaders(res, hardening);

  const instructionRaw = (req.body && req.body.instruction) || "";
  const instruction = typeof instructionRaw === "string" ? instructionRaw : String(instructionRaw || "");

  writeAuditEvent({
    event: "report_edit_request_received",
    service: "toir-api",
    requestId,
    route: "/api/reports/:id/drafts",
    reportId: req.params.id,
    instructionDigest: digestText(instruction),
    hardening: {
      rateLimitApplied: hardening.rate?.applied,
      rateLimitBypassed: hardening.rate?.bypassed,
    },
  });

  if (hardening.rate?.applied && !hardening.rate?.allowed) {
    writeAuditEvent({
      event: "report_edit_rate_limited",
      service: "toir-api",
      requestId,
      route: "/api/reports/:id/drafts",
      reportId: req.params.id,
      limit: hardening.rate?.limit,
      remaining: hardening.rate?.remaining,
      retryAfterSec: hardening.rate?.retryAfterSec,
    });
    return res.status(429).json({
      ok: false,
      errorCode: "rate_limited",
      requestId,
      message: "Слишком много запросов на правку отчёта. Повторите позже.",
    });
  }

  const validationError = validateReportInstruction(instruction);
  if (validationError) {
    writeAuditEvent({
      event: "report_edit_request_invalid",
      service: "toir-api",
      requestId,
      route: "/api/reports/:id/drafts",
      reportId: req.params.id,
      reason: validationError,
    });
    return res.status(400).json({
      ok: false,
      errorCode: "invalid_request",
      requestId,
      message: validationError,
    });
  }

  const dlp = createDlpSession({ requestId });
  try {
    const protectedInput = await dlp.protectPayload({ question: instruction.trim() });
    if (!protectedInput.ok) {
      const isMlUnavailable = protectedInput.blockedBy === "ml_unavailable";
      const status = isMlUnavailable ? 503 : 400;
      const errorCode = isMlUnavailable ? "ml_unavailable" : "dlp_blocked";
      const message = isMlUnavailable
        ? "ML-детектор временно недоступен. Запрос отклонён политикой fail-closed."
        : "Инструкция содержит чувствительные данные и заблокирована политикой DLP.";
      writeAuditEvent({
        event: "report_edit_dlp_blocked",
        service: "toir-api",
        requestId,
        route: "/api/reports/:id/drafts",
        reportId: req.params.id,
        blockedBy: protectedInput.blockedBy,
        blockedClassification: protectedInput.blockedClassification || null,
      });
      return res.status(status).json({
        ok: false,
        errorCode,
        requestId,
        message,
      });
    }

    if (protectedInput.summary?.enabled && protectedInput.summary.totalDetections > 0) {
      writeAuditEvent({
        event: "report_edit_dlp_protected",
        service: "toir-api",
        requestId,
        route: "/api/reports/:id/drafts",
        reportId: req.params.id,
        detections: protectedInput.summary.byType || {},
        tokensCreated: protectedInput.summary.tokensCreated || 0,
      });
    }

    const safeInstruction = protectedInput.payload?.question || instruction.trim();

    try {
      const draft = await service.planEdit(req.params.id, safeInstruction, { requestId });
      res.json({ ok: true, draft });
    } catch (e) {
      sendError(res, e);
    }
  } finally {
    dlp.dispose();
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
