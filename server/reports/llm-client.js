"use strict";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
const FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL || "qwen/qwen3-next-80b-a3b-instruct:free";
const ROUTER_FALLBACK_MODEL =
  process.env.OPENROUTER_ROUTER_FALLBACK_MODEL || "openrouter/free";
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 45000);

function parseBool(value) {
  if (value == null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function llmConfigured() {
  if (parseBool(process.env.OPENROUTER_MOCK_ENABLED)) return true;
  return !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
}

function extractJsonCandidate(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

function tryParseJson(content) {
  if (!content) return null;
  const candidate = extractJsonCandidate(content);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    return null;
  }
}

async function sendRequest({ apiKey, model, messages, temperature, maxTokens, requestId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:5173",
        "X-Title": process.env.OPENROUTER_APP_TITLE || "TOIR Dashboard Reports",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: temperature == null ? 0.2 : temperature,
        response_format: { type: "json_object" },
        max_tokens: maxTokens || 3500,
        messages,
      }),
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      const errorText = await res.text();
      return {
        ok: false,
        status: res.status,
        latencyMs,
        providerModel: model,
        errorCode: "provider_error",
        message: errorText.slice(0, 500),
        requestId,
      };
    }
    const json = await res.json();
    const content = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
    const parsed = tryParseJson(content);
    return {
      ok: true,
      status: res.status,
      latencyMs,
      providerModel: (json && json.model) || model,
      content,
      parsed,
      parseOk: parsed != null,
      requestId,
    };
  } catch (e) {
    return {
      ok: false,
      status: e && e.name === "AbortError" ? 408 : 0,
      latencyMs: Date.now() - startedAt,
      providerModel: model,
      errorCode: e && e.name === "AbortError" ? "timeout" : "network_error",
      message: String((e && e.message) || e).slice(0, 500),
      requestId,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function chatJsonObject({ messages, temperature, maxTokens, requestId }) {
  if (parseBool(process.env.OPENROUTER_MOCK_ENABLED)) {
    return {
      ok: false,
      errorCode: "mock_enabled",
      message: "OpenRouter mock mode is enabled — reports must use fallback templates.",
      providerModel: "mock/openrouter",
    };
  }
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      errorCode: "missing_api_key",
      message: "OPENROUTER_API_KEY is not configured on server.",
    };
  }

  const modelChain = [DEFAULT_MODEL, FALLBACK_MODEL, ROUTER_FALLBACK_MODEL];
  let lastResult = null;
  for (const model of modelChain) {
    const result = await sendRequest({
      apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      requestId,
    });
    lastResult = result;
    if (result.ok && result.parseOk) {
      return result;
    }
  }
  return lastResult || { ok: false, errorCode: "provider_error", message: "All providers failed." };
}

module.exports = {
  chatJsonObject,
  llmConfigured,
  tryParseJson,
};
