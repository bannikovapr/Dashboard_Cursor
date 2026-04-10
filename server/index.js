"use strict";

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { askOpenRouter } = require("./openrouter-client");

function contextsJsonEqual(a, b) {
  try {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  } catch {
    return false;
  }
}

const app = express();
const API_PORT = Number(process.env.API_PORT || 8787);

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

function isInsufficientAnswer(answer) {
  const a = stripAnswerMeta(answer);
  const fact = String(a?.fact || "").toLowerCase();
  const conclusion = String(a?.conclusion || "").toLowerCase();
  const joined = `${fact} ${conclusion}`;
  return (
    joined.includes("не могу ответить") ||
    joined.includes("недостаточно данных") ||
    joined.includes("нет данных")
  );
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "toir-api", allowedOrigins });
});

app.post("/api/chat", async (req, res) => {
  const requestId = crypto.randomUUID();
  const question = req.body?.question;
  const context = req.body?.context || {};
  const contextExpanded = req.body?.contextExpanded || null;
  const validationError = validateQuestion(question);

  if (validationError) {
    return res.status(400).json({
      ok: false,
      errorCode: "invalid_request",
      requestId,
      message: validationError,
    });
  }

  try {
    let result = await askOpenRouter({
      question: question.trim(),
      context,
      requestId,
    });
    let usedEscalation = false;
    const sameExpandedAsPrimary =
      !contextExpanded || contextsJsonEqual(context, contextExpanded);
    if (!sameExpandedAsPrimary && result.ok && contextExpanded && isInsufficientAnswer(result.answer)) {
      usedEscalation = true;
      const retry = await askOpenRouter({
        question: question.trim(),
        context: contextExpanded,
        requestId,
      });
      if (retry.ok && retry.answer?.parseOk !== false) result = retry;
    }

    if (!result.ok) {
      const errorCode =
        result.status === 429 ? "rate_limited" : result.status >= 500 ? "provider_unavailable" : "provider_error";
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
      return res.status(502).json({
        ok: false,
        errorCode,
        requestId,
        message: "Не удалось получить ответ от облачной модели.",
      });
    }

    if (result.answer?.parseOk === false) {
      console.warn(
        JSON.stringify({
          requestId,
          level: "warn",
          event: "openrouter_invalid_model_json",
          providerModel: result.providerModel,
        })
      );
      return res.status(502).json({
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

    const out = stripAnswerMeta(result.answer);
    return res.json({
      ok: true,
      requestId,
      needsMoreContext: Boolean(usedEscalation && isInsufficientAnswer(result.answer)),
      providerModel: result.providerModel,
      fact: out.fact,
      conclusion: out.conclusion,
      action: out.action,
    });
  } catch (err) {
    const missingKey = err?.code === "missing_api_key";
    return res.status(missingKey ? 500 : 502).json({
      ok: false,
      errorCode: missingKey ? "provider_not_configured" : "provider_unavailable",
      requestId,
      message: missingKey ? "OpenRouter API key is not configured on server." : "Cloud provider is unavailable.",
    });
  }
});

app.listen(API_PORT, () => {
  console.log(`TOIR API listening on http://localhost:${API_PORT}`);
});
