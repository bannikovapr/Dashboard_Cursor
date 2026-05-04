"use strict";

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { askOpenRouter } = require("./openrouter-client");
const { runAgent } = require("./agent/agent-controller");
const { createSession: createDlpSession } = require("./security/dlp-service");
const { writeAuditEvent, digestText } = require("./security/audit-log");
const { summarizePolicy } = require("./security/secret-policy");
const { checkRateLimit, summarizeRateLimit } = require("./security/rate-limit");
const { getKeyStatus } = require("./security/crypto");
const { writeTraceEvent } = require("./security/filter-trace-log");
const { writeAgentFlowEvent } = require("./security/agent-chat-flow-log");
const { buildSummary, parseBool, parsePositiveInt } = require("./security/log-utils");
const detector = require("./security/detector");

const app = express();
const API_PORT = Number(process.env.API_PORT || 8787);
const AGENT_FLOW_VERBOSE_MODEL_IO = parseBool(process.env.DLP_AGENT_FLOW_MODEL_IO_VERBOSE, false);
const AGENT_FLOW_MODEL_PREVIEW_MAX = parsePositiveInt(process.env.DLP_AGENT_FLOW_MODEL_PREVIEW_MAX, 260);

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:5174";
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

function isDevLoopbackOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || "");
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) {
        return cb(null, true);
      }
      if (allowedOrigins.includes(origin) || isDevLoopbackOrigin(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Origin not allowed"));
    },
  })
);
app.use(express.json({ limit: "50mb" }));

function validateQuestion(question) {
  if (typeof question !== "string") return "Поле question должно быть строкой.";
  const value = question.trim();
  if (!value) return "Поле question обязательно.";
  if (value.length > 4000) return "Поле question слишком длинное (макс. 4000 символов).";
  return null;
}

function stripAnswerMeta(answer) {
  if (!answer || typeof answer !== "object") return answer;
  const rest = { ...answer };
  delete rest.parseOk;
  return rest;
}

function audit(event, payload) {
  writeAuditEvent({
    event,
    service: "toir-api",
    ...payload,
  });
}

function traceFilterStage(stage, payload) {
  writeTraceEvent(stage, {
    service: "toir-api",
    ...payload,
  });
}

function traceAgentFlowStage(stage, payload) {
  writeAgentFlowEvent(stage, {
    service: "toir-api",
    ...payload,
  });
}

function summarizeFlowText(value) {
  const src = typeof value === "string" ? value : JSON.stringify(value || "");
  return buildSummary(src, AGENT_FLOW_MODEL_PREVIEW_MAX);
}

function summarizeModelParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  if (Array.isArray(parsed.tool_calls)) {
    return {
      kind: "tool_calls",
      count: parsed.tool_calls.length,
      tools: parsed.tool_calls.slice(0, 6).map((tc) => tc?.tool || tc?.name || "unknown"),
    };
  }

  if (parsed.answer && typeof parsed.answer === "object") {
    return {
      kind: "final_answer",
      answerDigest: {
        fact: digestText(parsed.answer.fact),
        conclusion: digestText(parsed.answer.conclusion),
        action: digestText(parsed.answer.action),
      },
      artifactsCount: Array.isArray(parsed.artifacts) ? parsed.artifacts.length : 0,
    };
  }

  return {
    kind: "other",
    keys: Object.keys(parsed).slice(0, 20),
  };
}

function compactAgentModelTracePayload(stage, payload) {
  if (AGENT_FLOW_VERBOSE_MODEL_IO) return payload || {};

  if (stage === "back_to_model") {
    const req = payload?.request || {};
    const messages = Array.isArray(req.messages) ? req.messages : [];
    const lastMessage = messages[messages.length - 1] || null;
    return {
      step: payload?.step || null,
      attempt: payload?.attempt || null,
      request: {
        model: req.model || null,
        temperature: req.temperature,
        response_format: req.response_format || null,
        messageCount: messages.length,
        messageRoles: messages.slice(-10).map((m) => m?.role || "unknown"),
        messagesDigest: digestText(JSON.stringify(messages)),
        lastMessage: lastMessage
          ? {
              role: lastMessage.role || null,
              content: summarizeFlowText(lastMessage.content),
            }
          : null,
      },
    };
  }

  if (stage === "model_to_back") {
    const resp = payload?.response || {};
    return {
      step: payload?.step || null,
      attempt: payload?.attempt || null,
      response: {
        ok: resp.ok,
        status: resp.status || null,
        providerModel: resp.providerModel || null,
        error: typeof resp.error === "string" ? resp.error.slice(0, 280) : resp.error || null,
        parsed: summarizeModelParsed(resp.parsed),
        rawSummary: summarizeFlowText(resp.rawContent),
      },
    };
  }

  return payload || {};
}

function withFailureReason(status, payload) {
  if (status === 200) return payload;
  const src = payload && typeof payload === "object" ? payload : { message: String(payload || "") };
  if (src.failureReason) return src;
  if (src.trace?.failureReason) return { ...src, failureReason: src.trace.failureReason };

  let failureReason = src.errorCode || "unknown_error";
  if (!src.errorCode) {
    if (status === 429) failureReason = "rate_limited";
    else if (status === 400) failureReason = "bad_request";
    else if (status === 500) failureReason = "server_error";
    else if (status >= 500) failureReason = "provider_error";
  }
  return { ...src, failureReason };
}

function evaluateHardening(req, routeId) {
  const rate = checkRateLimit({ req, routeId });
  return { rate };
}

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

app.get("/health", (_req, res) => {
  const policy = summarizePolicy();
  const dlpKey = getKeyStatus();
  const detectorStatus = detector.getRuntimeStatus();
  const mlReady = Boolean(detectorStatus?.ml?.ready);
  const status = mlReady || detectorStatus?.failMode !== "closed" ? 200 : 503;
  res.status(status).json({
    ok: status === 200,
    service: "toir-api",
    allowedOrigins,
    secretPolicyMode: policy.mode,
    mlReady,
    hardening: {
      dlpKey,
      rateLimit: summarizeRateLimit(),
      detector: detectorStatus,
    },
  });
});

app.post("/api/chat", async (req, res) => {
  const requestId = crypto.randomUUID();
  const question = req.body?.question;
  const context = req.body?.context || {};
  const startedAt = Date.now();
  const validationError = validateQuestion(question);
  const hardening = evaluateHardening(req, "chat");
  applyHardeningHeaders(res, hardening);
  const auditWithContext = (event, payload) => audit(event, payload);
  const sendChatResponse = (status, payload) => {
    const normalizedPayload = withFailureReason(status, payload);
    if (status === 200) return res.json(normalizedPayload);
    return res.status(status).json(normalizedPayload);
  };

  auditWithContext("chat_request_received", {
    requestId,
    route: "/api/chat",
    questionDigest: digestText(question),
    hasContext: Boolean(context && typeof context === "object" && Object.keys(context).length > 0),
    hardening: {
      rateLimitApplied: hardening.rate?.applied,
      rateLimitBypassed: hardening.rate?.bypassed,
    },
  });
  traceFilterStage("chat_request_received", {
    requestId,
    route: "/api/chat",
    inputFromDashboard: {
      question,
      context,
    },
  });

  if (hardening.rate?.applied && !hardening.rate?.allowed) {
    auditWithContext("chat_rate_limited", {
      requestId,
      route: "/api/chat",
      limit: hardening.rate?.limit,
      remaining: hardening.rate?.remaining,
      retryAfterSec: hardening.rate?.retryAfterSec,
      windowMs: hardening.rate?.windowMs,
      keyDigest: hardening.rate?.keyDigest || null,
    });
    traceFilterStage("chat_rate_limited", {
      requestId,
      route: "/api/chat",
      rateLimit: {
        limit: hardening.rate?.limit,
        remaining: hardening.rate?.remaining,
        retryAfterSec: hardening.rate?.retryAfterSec,
        windowMs: hardening.rate?.windowMs,
        keyDigest: hardening.rate?.keyDigest || null,
      },
    });
    return sendChatResponse(429, {
      ok: false,
      errorCode: "rate_limited",
      requestId,
      message: "Слишком много запросов. Повторите попытку чуть позже.",
    });
  }

  if (validationError) {
    auditWithContext("chat_request_invalid", {
      requestId,
      route: "/api/chat",
      reason: validationError,
    });
    traceFilterStage("chat_request_invalid", {
      requestId,
      route: "/api/chat",
      reason: validationError,
    });
    return sendChatResponse(400, {
      ok: false,
      errorCode: "invalid_request",
      requestId,
      message: validationError,
    });
  }

  const dlp = createDlpSession({ requestId });

  try {
    const protectedInput = await dlp.protectPayload({
      question: question.trim(),
      context,
    });
    traceFilterStage("chat_dlp_protect_result", {
      requestId,
      route: "/api/chat",
      ok: protectedInput.ok,
      blockedBy: protectedInput.blockedBy || null,
      blockedClassification: protectedInput.blockedClassification || null,
      summary: protectedInput.summary || null,
      payloadToModel: protectedInput.payload || null,
    });

    if (!protectedInput.ok) {
      const isMlUnavailable = protectedInput.blockedBy === "ml_unavailable";
      const status = isMlUnavailable ? 503 : 400;
      const errorCode = isMlUnavailable ? "ml_unavailable" : "dlp_blocked";
      const message = isMlUnavailable
        ? "ML-детектор временно недоступен. Запрос отклонён политикой fail-closed."
        : "Запрос содержит секреты и заблокирован политикой DLP.";
      auditWithContext("chat_dlp_blocked", {
        requestId,
        route: "/api/chat",
        blockedBy: protectedInput.blockedBy,
        blockedClassification: protectedInput.blockedClassification || null,
        detections: protectedInput.summary?.byType || {},
        byClassification: protectedInput.summary?.byClassification || {},
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "dlp_blocked_request",
          blockedBy: protectedInput.blockedBy,
          detections: protectedInput.summary?.byType || {},
        })
      );
      traceFilterStage("chat_dlp_blocked", {
        requestId,
        route: "/api/chat",
        blockedBy: protectedInput.blockedBy,
        blockedClassification: protectedInput.blockedClassification || null,
        detections: protectedInput.summary?.byType || {},
        byClassification: protectedInput.summary?.byClassification || {},
      });
      return sendChatResponse(status, {
        ok: false,
        errorCode,
        requestId,
        message,
      });
    }

    if (protectedInput.summary?.enabled && protectedInput.summary.totalDetections > 0) {
      auditWithContext("chat_dlp_protected", {
        requestId,
        route: "/api/chat",
        detections: protectedInput.summary.byType || {},
        byClassification: protectedInput.summary.byClassification || {},
        tokensCreated: protectedInput.summary.tokensCreated || 0,
        policy: protectedInput.summary?.policy || null,
      });
      console.info(
        JSON.stringify({
          requestId,
          level: "info",
          event: "dlp_protected",
          detections: protectedInput.summary.byType || {},
          tokensCreated: protectedInput.summary.tokensCreated || 0,
        })
      );
    }

    const safeQuestion = protectedInput.payload?.question || question.trim();
    const safeContext = protectedInput.payload?.context || context;
    traceFilterStage("chat_model_request", {
      requestId,
      route: "/api/chat",
      sentToModel: {
        question: safeQuestion,
        context: safeContext,
      },
    });

    let result = await askOpenRouter({
      question: safeQuestion,
      context: safeContext,
      requestId,
    });
    traceFilterStage("chat_model_response", {
      requestId,
      route: "/api/chat",
      ok: result.ok,
      status: result.status,
      providerModel: result.providerModel || null,
      rawContent: result.rawContent || null,
      normalizedAnswer: result.answer || null,
      providerError: result.error || null,
    });

    if (!result.ok) {
      const errorCode =
        result.status === 429 ? "rate_limited" : result.status >= 500 ? "provider_unavailable" : "provider_error";
      auditWithContext("chat_provider_error", {
        requestId,
        route: "/api/chat",
        errorCode,
        providerStatus: result.status,
        providerModel: result.providerModel || null,
        latencyMs: result.latencyMs || null,
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "openrouter_error",
          providerModel: result.providerModel,
          status: result.status,
          latencyMs: result.latencyMs,
        })
      );
      return sendChatResponse(502, {
        ok: false,
        errorCode,
        requestId,
        message: "Не удалось получить ответ от облачной модели.",
      });
    }

    if (result.answer?.parseOk === false) {
      auditWithContext("chat_invalid_model_answer", {
        requestId,
        route: "/api/chat",
        providerModel: result.providerModel || null,
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "openrouter_invalid_model_json",
          providerModel: result.providerModel,
        })
      );
      return sendChatResponse(502, {
        ok: false,
        errorCode: "invalid_model_answer",
        requestId,
        message: "Модель вернула ответ в неподдерживаемом формате.",
      });
    }

    console.info(
      JSON.stringify({
        requestId,
        level: "info",
        event: "openrouter_ok",
        providerModel: result.providerModel,
        status: result.status,
        latencyMs: result.latencyMs,
      })
    );

    let out = stripAnswerMeta(result.answer);
    const restoredOutput = dlp.restorePayload(out);
    out = restoredOutput.payload;
    traceFilterStage("chat_dlp_restore_result", {
      requestId,
      route: "/api/chat",
      restoreSummary: restoredOutput.summary || null,
      restoredOutput: out,
    });

    if (restoredOutput.summary?.enabled && restoredOutput.summary.restoredCount > 0) {
      auditWithContext("chat_dlp_restored", {
        requestId,
        route: "/api/chat",
        restoredCount: restoredOutput.summary.restoredCount,
        missingTokens: restoredOutput.summary.missingTokens || 0,
        decryptErrors: restoredOutput.summary.decryptErrors || 0,
      });
      console.info(
        JSON.stringify({
          requestId,
          level: "info",
          event: "dlp_restored",
          restoredCount: restoredOutput.summary.restoredCount,
          missingTokens: restoredOutput.summary.missingTokens || 0,
          decryptErrors: restoredOutput.summary.decryptErrors || 0,
        })
      );
    }

    if (restoredOutput.summary?.enabled && restoredOutput.summary.missingTokens > 0) {
      auditWithContext("chat_dlp_restore_partial", {
        requestId,
        route: "/api/chat",
        missingTokens: restoredOutput.summary.missingTokens || 0,
        decryptErrors: restoredOutput.summary.decryptErrors || 0,
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "dlp_restore_partial",
          missingTokens: restoredOutput.summary.missingTokens,
          decryptErrors: restoredOutput.summary.decryptErrors || 0,
        })
      );
    }

    auditWithContext("chat_response_success", {
      requestId,
      route: "/api/chat",
      providerModel: result.providerModel || null,
      latencyMs: Date.now() - startedAt,
      answerDigest: {
        fact: digestText(out.fact),
        conclusion: digestText(out.conclusion),
        action: digestText(out.action),
      },
    });
    traceFilterStage("chat_response_to_dashboard", {
      requestId,
      route: "/api/chat",
      responseForDashboard: {
        ok: true,
        requestId,
        providerModel: result.providerModel,
        fact: out.fact,
        conclusion: out.conclusion,
        action: out.action,
      },
    });

    return sendChatResponse(200, {
      ok: true,
      requestId,
      providerModel: result.providerModel,
      fact: out.fact,
      conclusion: out.conclusion,
      action: out.action,
    });
  } catch (err) {
    const missingKey = err?.code === "missing_api_key";
    auditWithContext("chat_exception", {
      requestId,
      route: "/api/chat",
      missingKey,
      message: String(err?.message || err).slice(0, 300),
      latencyMs: Date.now() - startedAt,
    });
    traceFilterStage("chat_exception", {
      requestId,
      route: "/api/chat",
      missingKey,
      error: String(err?.message || err).slice(0, 300),
    });
    return sendChatResponse(missingKey ? 500 : 502, {
      ok: false,
      errorCode: missingKey ? "provider_not_configured" : "provider_unavailable",
      requestId,
      message: missingKey ? "OpenRouter API key is not configured on server." : "Cloud provider is unavailable.",
    });
  } finally {
    dlp.dispose();
  }
});

app.post("/api/agent", async (req, res) => {
  const requestId = crypto.randomUUID();
  const question = req.body?.question;
  const filters = req.body?.filters || {};
  const startedAt = Date.now();
  const validationError = validateQuestion(question);
  const hardening = evaluateHardening(req, "agent");
  applyHardeningHeaders(res, hardening);
  const auditWithContext = (event, payload) => audit(event, payload);
  const sendAgentResponse = (status, payload) => {
    const normalizedPayload = withFailureReason(status, payload);
    traceAgentFlowStage("back_to_front", {
      requestId,
      route: "/api/agent",
      status,
      payloadToFrontend: normalizedPayload,
    });
    if (status === 200) return res.json(normalizedPayload);
    return res.status(status).json(normalizedPayload);
  };

  auditWithContext("agent_request_received", {
    requestId,
    route: "/api/agent",
    questionDigest: digestText(question),
    filtersDigest: digestText(JSON.stringify(filters || {})),
    hardening: {
      rateLimitApplied: hardening.rate?.applied,
      rateLimitBypassed: hardening.rate?.bypassed,
    },
  });
  traceFilterStage("agent_request_received", {
    requestId,
    route: "/api/agent",
    inputFromDashboard: {
      question,
      filters,
    },
  });
  traceAgentFlowStage("front_to_back", {
    requestId,
    route: "/api/agent",
    payloadFromFrontend: {
      question,
      filters,
    },
  });

  if (hardening.rate?.applied && !hardening.rate?.allowed) {
    auditWithContext("agent_rate_limited", {
      requestId,
      route: "/api/agent",
      limit: hardening.rate?.limit,
      remaining: hardening.rate?.remaining,
      retryAfterSec: hardening.rate?.retryAfterSec,
      windowMs: hardening.rate?.windowMs,
      keyDigest: hardening.rate?.keyDigest || null,
    });
    traceFilterStage("agent_rate_limited", {
      requestId,
      route: "/api/agent",
      rateLimit: {
        limit: hardening.rate?.limit,
        remaining: hardening.rate?.remaining,
        retryAfterSec: hardening.rate?.retryAfterSec,
        windowMs: hardening.rate?.windowMs,
        keyDigest: hardening.rate?.keyDigest || null,
      },
    });
    return sendAgentResponse(429, {
      ok: false,
      errorCode: "rate_limited",
      requestId,
      message: "Too many requests. Please retry shortly.",
    });
  }

  if (validationError) {
    auditWithContext("agent_request_invalid", {
      requestId,
      route: "/api/agent",
      reason: validationError,
    });
    traceFilterStage("agent_request_invalid", {
      requestId,
      route: "/api/agent",
      reason: validationError,
    });
    return sendAgentResponse(400, {
      ok: false,
      errorCode: "invalid_request",
      requestId,
      message: validationError,
    });
  }

  const dlp = createDlpSession({ requestId });

  try {
    const protectedInput = await dlp.protectPayload({
      question: question.trim(),
      filters,
    });
    traceFilterStage("agent_dlp_protect_result", {
      requestId,
      route: "/api/agent",
      ok: protectedInput.ok,
      blockedBy: protectedInput.blockedBy || null,
      blockedClassification: protectedInput.blockedClassification || null,
      summary: protectedInput.summary || null,
      payloadToModel: protectedInput.payload || null,
    });

    if (!protectedInput.ok) {
      const isMlUnavailable = protectedInput.blockedBy === "ml_unavailable";
      const status = isMlUnavailable ? 503 : 400;
      const errorCode = isMlUnavailable ? "ml_unavailable" : "dlp_blocked";
      const message = isMlUnavailable
        ? "ML-детектор временно недоступен. Запрос отклонён политикой fail-closed."
        : "Запрос содержит секреты и заблокирован политикой DLP.";
      auditWithContext("agent_dlp_blocked", {
        requestId,
        route: "/api/agent",
        blockedBy: protectedInput.blockedBy,
        blockedClassification: protectedInput.blockedClassification || null,
        detections: protectedInput.summary?.byType || {},
        byClassification: protectedInput.summary?.byClassification || {},
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "dlp_blocked_request",
          blockedBy: protectedInput.blockedBy,
          detections: protectedInput.summary?.byType || {},
        })
      );
      traceFilterStage("agent_dlp_blocked", {
        requestId,
        route: "/api/agent",
        blockedBy: protectedInput.blockedBy,
        blockedClassification: protectedInput.blockedClassification || null,
        detections: protectedInput.summary?.byType || {},
        byClassification: protectedInput.summary?.byClassification || {},
      });
      return sendAgentResponse(status, {
        ok: false,
        errorCode,
        requestId,
        message,
      });
    }

    if (protectedInput.summary?.enabled && protectedInput.summary.totalDetections > 0) {
      auditWithContext("agent_dlp_protected", {
        requestId,
        route: "/api/agent",
        detections: protectedInput.summary.byType || {},
        byClassification: protectedInput.summary.byClassification || {},
        tokensCreated: protectedInput.summary.tokensCreated || 0,
        policy: protectedInput.summary?.policy || null,
      });
      console.info(
        JSON.stringify({
          requestId,
          level: "info",
          event: "dlp_protected",
          detections: protectedInput.summary.byType || {},
          tokensCreated: protectedInput.summary.tokensCreated || 0,
        })
      );
    }

    const safeQuestion = protectedInput.payload?.question || question.trim();
    const safeFilters = protectedInput.payload?.filters || filters;
    traceFilterStage("agent_model_request", {
      requestId,
      route: "/api/agent",
      sentToModel: {
        question: safeQuestion,
        filters: safeFilters,
      },
    });

    const result = await runAgent({
      question: safeQuestion,
      filters: safeFilters,
      requestId,
      dlpSession: dlp,
      modelTraceHook: (stage, payload) => {
        traceAgentFlowStage(stage, {
          requestId,
          route: "/api/agent",
          ...compactAgentModelTracePayload(stage, payload),
        });
      },
    });
    traceFilterStage("agent_model_response", {
      requestId,
      route: "/api/agent",
      ok: result.ok,
      errorCode: result.errorCode || null,
      message: result.message || null,
      answer: result.answer || null,
      artifacts: result.artifacts || [],
      trace: result.trace || null,
    });

    if (!result.ok) {
      const status =
        result.errorCode === "provider_not_configured"
          ? 500
          : result.errorCode === "dlp_blocked"
            ? 400
            : 502;
      auditWithContext("agent_execution_failed", {
        requestId,
        route: "/api/agent",
        status,
        errorCode: result.errorCode || "unknown",
        message: String(result.message || "").slice(0, 240),
      });
      return sendAgentResponse(status, result);
    }

    let output = {
      answer: result.answer,
      artifacts: result.artifacts,
      trace: result.trace,
    };

    const restoredOutput = dlp.restorePayload(output);
    output = restoredOutput.payload || output;
    traceFilterStage("agent_dlp_restore_result", {
      requestId,
      route: "/api/agent",
      restoreSummary: restoredOutput.summary || null,
      restoredOutput: output,
    });

    if (restoredOutput.summary?.enabled && restoredOutput.summary.restoredCount > 0) {
      auditWithContext("agent_dlp_restored", {
        requestId,
        route: "/api/agent",
        restoredCount: restoredOutput.summary.restoredCount,
        missingTokens: restoredOutput.summary.missingTokens || 0,
        decryptErrors: restoredOutput.summary.decryptErrors || 0,
      });
      console.info(
        JSON.stringify({
          requestId,
          level: "info",
          event: "dlp_restored",
          restoredCount: restoredOutput.summary.restoredCount,
          missingTokens: restoredOutput.summary.missingTokens || 0,
          decryptErrors: restoredOutput.summary.decryptErrors || 0,
        })
      );
    }

    if (restoredOutput.summary?.enabled && restoredOutput.summary.missingTokens > 0) {
      auditWithContext("agent_dlp_restore_partial", {
        requestId,
        route: "/api/agent",
        missingTokens: restoredOutput.summary.missingTokens || 0,
        decryptErrors: restoredOutput.summary.decryptErrors || 0,
      });
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "dlp_restore_partial",
          missingTokens: restoredOutput.summary.missingTokens,
          decryptErrors: restoredOutput.summary.decryptErrors || 0,
        })
      );
    }

    console.info(
      JSON.stringify({
        requestId,
        level: "info",
        event: "agent_ok",
        steps: result.trace?.steps,
        toolsUsed: result.trace?.toolsUsed,
        model: result.trace?.model,
      })
    );

    auditWithContext("agent_response_success", {
      requestId,
      route: "/api/agent",
      latencyMs: Date.now() - startedAt,
      toolsUsed: result.trace?.toolsUsed || [],
      steps: result.trace?.steps || null,
      artifactsCount: Array.isArray(output.artifacts) ? output.artifacts.length : 0,
      answerDigest: {
        fact: digestText(output.answer?.fact),
        conclusion: digestText(output.answer?.conclusion),
        action: digestText(output.answer?.action),
      },
    });
    traceFilterStage("agent_response_to_dashboard", {
      requestId,
      route: "/api/agent",
      responseForDashboard: {
        ok: true,
        requestId,
        answer: output.answer || result.answer,
        artifacts: output.artifacts || result.artifacts,
        trace: output.trace || result.trace,
      },
    });

    return sendAgentResponse(200, {
      ...result,
      answer: output.answer || result.answer,
      artifacts: output.artifacts || result.artifacts,
      trace: output.trace || result.trace,
    });
  } catch (err) {
    auditWithContext("agent_exception", {
      requestId,
      route: "/api/agent",
      message: String(err?.message || err).slice(0, 300),
      latencyMs: Date.now() - startedAt,
    });
    traceFilterStage("agent_exception", {
      requestId,
      route: "/api/agent",
      error: String(err?.message || err).slice(0, 300),
    });
    console.error(
      JSON.stringify({
        requestId,
        level: "error",
        event: "agent_error",
        message: String(err?.message || err).slice(0, 500),
      })
    );
    return sendAgentResponse(502, {
      ok: false,
      errorCode: "agent_error",
      requestId,
      message: "Agent error. Please try again later or switch to quick answer mode.",
    });
  } finally {
    dlp.dispose();
  }
});

const bootDlpKeyStatus = getKeyStatus();
let bootDetectorStats = null;
const detectorBoot = Promise.resolve()
  .then(() => detector.init({ force: true }))
  .then((stats) => {
    bootDetectorStats = stats;
    audit("security_boot_hardening", {
      route: "startup",
      hardening: {
        dlpKey: bootDlpKeyStatus,
        rateLimit: summarizeRateLimit(),
        secretPolicyMode: summarizePolicy().mode,
        detector: bootDetectorStats,
      },
    });
  })
  .catch((e) => {
    bootDetectorStats = { error: String(e?.message || e).slice(0, 240) };
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_detector_boot_failed",
        message: bootDetectorStats.error,
      })
    );
    audit("security_boot_hardening", {
      route: "startup",
      hardening: {
        dlpKey: bootDlpKeyStatus,
        rateLimit: summarizeRateLimit(),
        secretPolicyMode: summarizePolicy().mode,
        detector: bootDetectorStats,
      },
    });
  });
if (bootDlpKeyStatus?.ephemeral) {
  audit("dlp_ephemeral_key_active", {
    route: "startup",
    hardening: {
      dlpKey: bootDlpKeyStatus,
      rolloutStage: String(process.env.DLP_EPHEMERAL_ROLLOUT_STAGE || "transition"),
      deprecationTarget: String(process.env.DLP_EPHEMERAL_DISABLE_AFTER || "next-release"),
    },
  });
}

app.listen(API_PORT, () => {
  console.log(`TOIR API listening on http://localhost:${API_PORT}`);
  detectorBoot.finally(() => {
    const status = detector.getRuntimeStatus();
    console.log(
      JSON.stringify({
        level: "info",
        event: "dlp_detector_ready",
        ready: status?.ready === true,
        mlReady: status?.ml?.ready === true,
        mlLoadMs: status?.ml?.loadMs || null,
        failMode: status?.failMode || null,
      })
    );
  });
});
