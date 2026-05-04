"use strict";

const dataStore = require("./data-store");
const { executeTool, TOOL_DEFINITIONS } = require("./tools");
const { buildAgentSystemPrompt, buildUserMessage, buildToolResultMessage } = require("./prompts");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_STEPS = 5;
const AGENT_TIMEOUT_MS = 90000;
const STEP_TIMEOUT_MS = 45000;
const FORMAT_REPAIR_PROMPT =
  "���������� ����� �� ������������� ���������� �������. " +
  "����� ������ �������� JSON ��� markdown. " +
  "��������� ������ ��� �������: " +
  "{\"thinking\":\"...\",\"tool_calls\":[{\"tool\":\"name\",\"params\":{}}]} " +
  "��� {\"answer\":{\"fact\":\"...\",\"conclusion\":\"...\",\"action\":\"...\"},\"artifacts\":[]}. " +
  "���� ������ ��� �������, ����� ��������� answer.";

function getModelChain() {
  const primary = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL || "qwen/qwen3-next-80b-a3b-instruct:free";
  return [primary, fallback];
}

function extractJsonFromResponse(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/im);
  if (fence) s = fence[1].trim();

  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) s = s.slice(i, j + 1);

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function callLLM(messages, model, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:5173",
        "X-Title": process.env.OPENROUTER_APP_TITLE || "TOIR Dashboard Agent",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, status: res.status, error: errText.slice(0, 500) };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonFromResponse(content);
    return { ok: true, parsed, raw: content, model: json?.model || model };
  } catch (e) {
    return { ok: false, status: e?.name === "AbortError" ? 408 : 0, error: String(e?.message || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function restoreToolParams(params, dlpSession) {
  if (!dlpSession || typeof dlpSession.restorePayload !== "function") {
    return params;
  }
  const restored = dlpSession.restorePayload(params || {});
  return restored?.payload || params;
}

function processToolCalls(toolCalls, dlpSession) {
  if (!Array.isArray(toolCalls)) return [];
  const cap = Math.min(toolCalls.length, 3);
  const results = [];
  for (let i = 0; i < cap; i++) {
    const tc = toolCalls[i];
    const name = tc?.tool || tc?.name;
    const rawParams = tc?.params || tc?.parameters || tc?.arguments || {};
    const params = restoreToolParams(rawParams, dlpSession);
    if (!name) continue;
    const result = executeTool(name, params);
    results.push({ tool: name, params, result });
  }
  return results;
}

function sanitizeScalarForModel(value) {
  if (value == null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length <= 80) return trimmed;
    return `${trimmed.slice(0, 77)}...`;
  }
  return "[redacted]";
}

function summarizeRowsForModel(rows, maxRows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const cap = Math.max(0, Math.min(maxRows, rows.length));
  const out = [];
  for (let i = 0; i < cap; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k] = sanitizeScalarForModel(v);
    }
    out.push(clean);
  }
  return out;
}

function censorToolResultForModel(tr) {
  if (!tr || typeof tr !== "object") return tr;
  if (tr.tool !== "query_data") return tr;

  const params = tr.params || {};
  const result = tr.result || {};
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const hasWhere = Boolean(params.where && typeof params.where === "object" && Object.keys(params.where).length > 0);
  const totalBeforeLimit = Number.isFinite(result.totalBeforeLimit) ? result.totalBeforeLimit : rows.length;
  const hasLargeDataset = totalBeforeLimit > 50 || rows.length > 50;
  const shouldRedactRows = !hasWhere || hasLargeDataset;

  const summary = {
    rowsCount: rows.length,
    totalBeforeLimit,
    columns: rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]).slice(0, 30) : [],
    redaction: shouldRedactRows
      ? (!hasWhere ? "rows_redacted_unfiltered_query" : "rows_redacted_large_result")
      : "none",
  };
  return {
    ...tr,
    result: shouldRedactRows
      ? {
          ...result,
          rows: [],
          summary,
        }
      : {
          ...result,
          rows: summarizeRowsForModel(rows, 20),
          summary,
        },
  };
}

function censorToolResultsForModel(toolResults) {
  if (!Array.isArray(toolResults)) return [];
  return toolResults.map((tr) => censorToolResultForModel(tr));
}

function shouldForceGroundedFallback(modelToolResults) {
  if (!Array.isArray(modelToolResults) || modelToolResults.length === 0) return false;
  const queryResults = modelToolResults.filter((x) => x?.tool === "query_data");
  if (queryResults.length === 0) return false;
  const hasAnyRowsForModel = queryResults.some((x) => Array.isArray(x?.result?.rows) && x.result.rows.length > 0);
  if (hasAnyRowsForModel) return false;
  return queryResults.every((x) => {
    const redaction = x?.result?.summary?.redaction;
    return redaction === "rows_redacted_unfiltered_query" || redaction === "rows_redacted_large_result";
  });
}

function buildUserTableArtifactFromToolResults(toolResults) {
  const queryDataResults = Array.isArray(toolResults) ? toolResults.filter((x) => x?.tool === "query_data") : [];
  if (queryDataResults.length !== 1) return null;
  const result = queryDataResults[0]?.result || {};
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (!rows.length) return null;

  const hasEmployee = rows.some((r) => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, "employee"));
  const hasFact = rows.some((r) => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, "fact_h"));
  const hasPlan = rows.some((r) => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, "plan_h"));
  if (!hasEmployee || !hasFact || !hasPlan) return null;

  const viewRows = rows.slice(0, 50).map((r) => {
    const plan = Number(r?.plan_h);
    const fact = Number(r?.fact_h);
    const utilization =
      Number.isFinite(plan) && plan > 0 && Number.isFinite(fact) ? Number(((fact / plan) * 100).toFixed(2)) : null;
    return {
      employee: r?.employee ?? null,
      fact_h: Number.isFinite(fact) ? Number(fact.toFixed(2)) : null,
      plan_h: Number.isFinite(plan) ? Number(plan.toFixed(2)) : null,
      utilization_pct: utilization,
    };
  });

  return {
    type: "table",
    title: "������������ ����������� (����/����)",
    columns: [
      { key: "employee", label: "���������" },
      { key: "fact_h", label: "���� (�)" },
      { key: "plan_h", label: "���� (�)" },
      { key: "utilization_pct", label: "���������� (%)" },
    ],
    rows: viewRows,
  };
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSafeAggregateAnswerFromToolResults(toolResults) {
  const queryDataResults = Array.isArray(toolResults) ? toolResults.filter((x) => x?.tool === "query_data") : [];
  const rows = [];
  for (const tr of queryDataResults) {
    const trRows = Array.isArray(tr?.result?.rows) ? tr.result.rows : [];
    for (const row of trRows) rows.push(row);
  }

  const plans = [];
  const facts = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const p = toFiniteNumber(row.plan_h);
    const f = toFiniteNumber(row.fact_h);
    if (p != null) plans.push(p);
    if (f != null) facts.push(f);
  }

  if (rows.length === 0) {
    return {
      fact: "������������ ������ ��� ����������� ������: ��������� ������ ���� ������ ��������� DLP.",
      conclusion: "���������� ��������� ����������� ������ ��� ������� ��� ��������� �������������� ������.",
      action: "�������� ������ � ���������� �������� (��������, �� ������������� ��� �����������) ���� ����������� �������������� ����������.",
    };
  }

  const totalPlan = plans.reduce((acc, x) => acc + x, 0);
  const totalFact = facts.reduce((acc, x) => acc + x, 0);
  const utilizationPct = totalPlan > 0 ? (totalFact / totalPlan) * 100 : null;

  return {
    fact:
      `��������� ������ �� ����������� ������ ��������� DLP. ` +
      `�������� ���������� ������: ������� ${rows.length}, ��������� ���� ${totalFact.toFixed(2)} �, ` +
      `��������� ���� ${totalPlan.toFixed(2)} �.`,
    conclusion:
      utilizationPct == null
        ? "���������� ��������� ������� ����������, ��� ��� �������� ���� �����������."
        : `������������ ���������� ����� ���������� ${utilizationPct.toFixed(2)}%.`,
    action: "����� �������� ������������ ������, ������� ������ �� ����������� ����������/�������������/�����������.",
  };
}

async function protectToolResultsForModel(toolResults, dlpSession) {
  if (!dlpSession || typeof dlpSession.protectPayload !== "function") {
    return {
      ok: true,
      toolResults,
      summary: { enabled: false, totalDetections: 0, tokensCreated: 0, byType: {} },
    };
  }

  const protectedPayload = await dlpSession.protectPayload({ toolResults });
  if (!protectedPayload.ok) {
    return {
      ok: false,
      blockedBy: protectedPayload.blockedBy || "unknown",
      summary: protectedPayload.summary || { enabled: true, totalDetections: 0, tokensCreated: 0, byType: {} },
    };
  }

  return {
    ok: true,
    toolResults: protectedPayload.payload?.toolResults || toolResults,
    summary: protectedPayload.summary || { enabled: true, totalDetections: 0, tokensCreated: 0, byType: {} },
  };
}

function collectArtifacts(allToolResults) {
  const artifacts = [];
  for (const step of allToolResults) {
    for (const tr of step) {
      if (tr.result?.artifact) {
        artifacts.push(tr.result.artifact);
      }
      if (Array.isArray(tr.result?.artifacts)) {
        for (const a of tr.result.artifacts) {
          if (a && a.type) artifacts.push(a);
        }
      }
    }
  }
  return artifacts;
}

function collectForecastTrace(allToolResults) {
  for (const step of allToolResults) {
    for (const tr of step) {
      if (tr.tool === "forecast_metric" && tr.result?.forecast) {
        return {
          forecastModel: tr.result.forecast?.model_info?.name || null,
          horizon: tr.result.forecast?.horizon || null,
          forecastMetric: tr.result.forecast?.metric || null,
          forecastLatencyMs: tr.result.forecast?.forecastLatencyMs || null,
        };
      }
    }
  }
  return null;
}

function fallbackAnswer() {
  return {
    answer: {
      fact: "�������, �� ���� �� ���� �������� �� ��� ������.",
      conclusion: "����� �� ���� �������� ���������� ����� �� ������ �� ���������� ����� �����.",
      action: "���������� ����������������� ������ ��� ������������� � ����� �������� ������.",
    },
    artifacts: [],
  };
}

function isValidFinalAnswer(parsed) {
  return (
    parsed &&
    parsed.answer &&
    typeof parsed.answer.fact === "string" &&
    parsed.answer.fact.trim().length > 0
  );
}

function safeInvokeModelTrace(modelTraceHook, stage, payload) {
  if (typeof modelTraceHook !== "function") return;
  try {
    modelTraceHook(stage, payload || {});
  } catch {
    // Best-effort logging hook: never break agent flow.
  }
}

function createTrace() {
  return {
    steps: 0,
    toolsUsed: [],
    model: null,
    forecastModel: null,
    horizon: null,
    forecastMetric: null,
    forecastLatencyMs: null,
    failureReason: null,
  };
}

async function runAgent({ question, filters, requestId, dlpSession, modelTraceHook }) {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      requestId,
      errorCode: "provider_not_configured",
      message: "API-���� OpenRouter �� �������� �� �������.",
      trace: { ...createTrace(), failureReason: "provider_not_configured" },
    };
  }

  dataStore.init();

  const systemPrompt = buildAgentSystemPrompt();
  const userMsg = buildUserMessage(question, filters);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMsg },
  ];

  const startedAt = Date.now();
  const models = getModelChain();
  const trace = createTrace();
  const allToolResults = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() - startedAt > AGENT_TIMEOUT_MS) {
      trace.failureReason = "agent_timeout";
      break;
    }

    trace.steps = step + 1;

    let llmResult = null;
    for (let attempt = 0; attempt < models.length; attempt += 1) {
      const model = models[attempt];
      safeInvokeModelTrace(modelTraceHook, "back_to_model", {
        step: step + 1,
        attempt: attempt + 1,
        request: {
          model,
          temperature: 0.15,
          response_format: { type: "json_object" },
          messages,
        },
      });
      llmResult = await callLLM(messages, model, apiKey);
      safeInvokeModelTrace(modelTraceHook, "model_to_back", {
        step: step + 1,
        attempt: attempt + 1,
        response: {
          ok: llmResult.ok,
          status: llmResult.status || null,
          providerModel: llmResult.model || model,
          rawContent: llmResult.raw || null,
          parsed: llmResult.parsed || null,
          error: llmResult.error || null,
        },
      });
      if (llmResult.ok && llmResult.parsed) {
        trace.model = llmResult.model || model;
        break;
      }
    }

    if (!llmResult?.ok) {
      trace.failureReason = `provider_error_${String(llmResult?.status || "unknown")}`;
      break;
    }
    if (!llmResult?.parsed) {
      trace.failureReason = "invalid_json_from_model";
      if (step < MAX_STEPS - 1) {
        if (llmResult.raw) {
          messages.push({ role: "assistant", content: llmResult.raw });
        }
        messages.push({ role: "user", content: FORMAT_REPAIR_PROMPT });
        continue;
      }
      break;
    }

    const parsed = llmResult.parsed;
    if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: llmResult.raw });

      const toolResults = processToolCalls(parsed.tool_calls, dlpSession);
      allToolResults.push(toolResults);

      for (const tr of toolResults) {
        if (!trace.toolsUsed.includes(tr.tool)) trace.toolsUsed.push(tr.tool);
      }

      const safeToolResults = await protectToolResultsForModel(toolResults, dlpSession);
      if (!safeToolResults.ok) {
        return {
          ok: false,
          requestId,
          errorCode: "dlp_blocked",
          message: "���������� ������������ �������� ������� � ������������� ��������� DLP.",
          trace: { ...trace, failureReason: "dlp_blocked_tool_results" },
        };
      }

      const modelToolResults = censorToolResultsForModel(safeToolResults.toolResults);
      const toolMsg = buildToolResultMessage(modelToolResults);
      messages.push({ role: "user", content: toolMsg });

      if (shouldForceGroundedFallback(modelToolResults)) {
        const tableArtifact = buildUserTableArtifactFromToolResults(toolResults);
        const fallbackAnswer = tableArtifact
          ? {
              fact: "�� ������ �������� ����������� ������ ����������� � ������ � ������ �����������.",
              conclusion:
                "��������� ������ �������� ������������; � ������ ��������� ������������ ������ �� ������������.",
              action: "��� ������� ������� ������� ������ �� ����������, ������������� ��� �����������.",
            }
          : buildSafeAggregateAnswerFromToolResults(toolResults);
        return {
          ok: true,
          requestId,
          answer: fallbackAnswer,
          artifacts: tableArtifact ? [tableArtifact] : [],
          trace: { ...trace, ...(collectForecastTrace(allToolResults) || {}) },
        };
      }
      continue;
    }

    if (isValidFinalAnswer(parsed)) {
      const autoArtifacts = collectArtifacts(allToolResults);
      const explicitArtifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts.filter((a) => a && a.type) : [];

      const mergedArtifacts = [...autoArtifacts];
      for (const ea of explicitArtifacts) {
        const isDuplicate = mergedArtifacts.some(
          (a) => a.type === ea.type && a.title === ea.title
        );
        if (!isDuplicate) mergedArtifacts.push(ea);
      }

      return {
        ok: true,
        requestId,
        answer: {
          fact: parsed.answer.fact || "",
          conclusion: parsed.answer.conclusion || "",
          action: parsed.answer.action || "",
        },
        artifacts: mergedArtifacts,
        trace: { ...trace, ...(collectForecastTrace(allToolResults) || {}) },
      };
    }

    trace.failureReason = "invalid_final_schema";
    if (step < MAX_STEPS - 1) {
      messages.push({ role: "assistant", content: llmResult.raw || JSON.stringify(parsed) });
      messages.push({ role: "user", content: FORMAT_REPAIR_PROMPT });
      continue;
    }
    break;
  }

  if (!trace.failureReason) {
    trace.failureReason = trace.steps >= MAX_STEPS ? "max_steps_exceeded" : "agent_stopped_without_answer";
  }
  const fb = fallbackAnswer();
  return {
    ok: true,
    requestId,
    ...fb,
    trace,
  };
}

module.exports = { runAgent };


