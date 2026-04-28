"use strict";

const fs = require("fs");
const path = require("path");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
const FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL || "qwen/qwen3-next-80b-a3b-instruct:free";
const ROUTER_FALLBACK_MODEL = process.env.OPENROUTER_ROUTER_FALLBACK_MODEL || "openrouter/free";
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 45000);

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function cloneContextRedactPaths(ctx) {
  try {
    const o =
      typeof structuredClone === "function" ? structuredClone(ctx) : JSON.parse(JSON.stringify(ctx || {}));
    if (o.charts && typeof o.charts.wearImage === "string") {
      o.charts.hasWearChart = true;
      delete o.charts.wearImage;
    }
    return o;
  } catch {
    return ctx || {};
  }
}

function resolveProjectWearImage(absProjectRoot, rel) {
  if (typeof rel !== "string" || rel.length > 400 || rel.includes("..")) return null;
  const abs = path.resolve(absProjectRoot, rel.replace(/^[/\\]+/, ""));
  const relToRoot = path.relative(absProjectRoot, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

/** Снимок износа прикрепляем только к узким вопросам про износ — иначе модель «цепляется» за одну картинку при обзорных запросах. */
function shouldAttachWearChartImage(question) {
  const ql = String(question || "").toLowerCase();
  const dashboardOverview =
    /новичок|ничего не понимаю|что тут|что это за|какие график|все график|кажд(ый|ом) график|обзор|дашборд в целом|целом по дашборду|весь дашборд|что мне нужно знать|с чего начать|что такое дашборд/i.test(ql);
  if (dashboardOverview) return false;
  if (/что (они|эти графики) показывают|что показывают графики/i.test(ql)) return false;
  return /износ|wear|процент износа|график.*износ|износ.*график|кругов(ая|ой).*износ|износ.*круг|диаграмм.*износ|пирог.*износ/i.test(ql);
}

function buildUserMessageParts(question, rawContext) {
  const projectRoot = path.resolve(__dirname, "..");
  const wearRel = rawContext?.charts?.wearImage;
  const resolved = resolveProjectWearImage(projectRoot, typeof wearRel === "string" ? wearRel : "");
  const attachImage = resolved && shouldAttachWearChartImage(question);
  const imageAbs = attachImage ? resolved : null;
  const contextForText = cloneContextRedactPaths(rawContext);
  const preamble =
    "Ниже вопрос и контекст дашборда (без служебных путей к файлам). " +
    (imageAbs
      ? "К сообщению приложён снимок графика процента износа — используй его только для фактов и выводов по этому графику."
      : "");

  const textBody = `${preamble}\n\n${JSON.stringify({ question, context: contextForText })}`;
  if (!imageAbs) {
    return textBody;
  }
  const buf = fs.readFileSync(imageAbs);
  const mime = imageAbs.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const b64 = buf.toString("base64");
  return [
    { type: "text", text: textBody },
    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
  ];
}

function extractJsonCandidate(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/im);
  if (fence) s = fence[1].trim();
  if (s.startsWith("{") && s.endsWith("}")) return s;
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) return s.slice(i, j + 1);
  return s;
}

function normalizeAnswer(rawContent) {
  const fallback = {
    fact: "Сожалею, но пока не могу ответить на ваш вопрос.",
    conclusion: "Облачная модель вернула неподдерживаемый формат ответа.",
    action: "Повторите запрос или уточните формулировку вопроса.",
  };
  function pickTextFromUnknown(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const parts = value.map((x) => pickTextFromUnknown(x)).filter(Boolean);
      return parts.join("; ").trim();
    }
    if (value && typeof value === "object") {
      const textKeys = ["text", "value", "summary", "message", "content", "conclusion", "fact", "action"];
      for (const key of textKeys) {
        const v = pickTextFromUnknown(value[key]);
        if (v) return v;
      }
      const joined = Object.values(value)
        .map((v) => pickTextFromUnknown(v))
        .filter(Boolean)
        .join("; ")
        .trim();
      if (joined) return joined;
      try {
        return JSON.stringify(value);
      } catch (_) {
        return "";
      }
    }
    return "";
  }

  function normalizeField(value, fallbackValue) {
    const out = pickTextFromUnknown(value);
    if (out) return out;
    return fallbackValue;
  }

  if (!rawContent || typeof rawContent !== "string") {
    return { ...fallback, parseOk: false };
  }
  const candidate = extractJsonCandidate(rawContent);
  if (!candidate) {
    return { ...fallback, parseOk: false };
  }
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") {
      return { ...fallback, parseOk: false };
    }
    const hasAny = ["fact", "conclusion", "action"].some((k) => {
      const v = parsed[k];
      return v != null && String(v).trim() !== "";
    });
    if (!hasAny) {
      return { ...fallback, parseOk: false };
    }
    return {
      fact: normalizeField(parsed.fact, fallback.fact),
      conclusion: normalizeField(parsed.conclusion, fallback.conclusion),
      action: normalizeField(parsed.action, fallback.action),
      parseOk: true,
    };
  } catch (_) {
    return { ...fallback, parseOk: false };
  }
}

function buildSystemPrompt() {
  return [
    "Ты аналитик ТОИР. Пользователю приходит только твой JSON-ответ (fact, conclusion, action) — без доступа к внутреннему контексту.",
    "Весь текст ответа только на русском языке.",
    "Строго запрещено упоминать в fact, conclusion и action: пути к файлам и каталогам, имена файлов, расширения, сервер, API, OpenRouter, JSON, ключи и имена полей данных, структуры БД, служебные идентификаторы. Формулируй нейтрально: «по данным дашборда», «на графике», «по показателям парка».",
    "Словарь для сопоставления (используй молча, не цитируй имена полей пользователю): СННО — наработка на отказ, часы по объектам в разделе показателей MTBF; СВВ — время восстановления (MTTR); КТГ — готовность по объектам в таблице КТГ.",
    "Дополнительный словарь: запросы про ремонты сотрудников, выполненные работы сотрудников, загрузку персонала и трудозатраты сотрудников трактуй как один и тот же срез по персоналу за год (факт/план часов). Этот срез нужно сопоставлять со структурой работ по месяцам, где трудозатраты отражают суммарный объем работ.",
    "Если вопрос про организации или подразделения в части персонала, используй срез по сотрудникам с группировкой по организациям/подразделениям и отвечай по факту, плану и выполнению.",
    "Не утверждай, что СННО или КТГ отсутствуют, если в контексте есть соответствующие показатели.",
    "Если вопрос касается графика износа - проанализируй изображение и включи в ответ данные из изображения. В fact опиши, что видно на картинке; в conclusion — выводы по этому визуалу, не копируя дословно абзац о назначении графика. В action — шаги без имён файлов и интеграций. Если вопрос касается не только графика - сократи информацию по этому графику и выдай ее как часть ответа, не забыв про другую часть ответа на вопрос пользователя",
    "График процента износа на дашборде: график процента износа визуализирует текущее состояние оборудования, позволяя оценить степень выработки ресурса и прогнозировать необходимость проведения планово-предупредительных работ (ППР) или замены узлов.",
    "Опирайся на показатели из контекста; не выдумывай цифры, которых нет в данных или на приложенном изображении.",
    "Формат ответа: JSON с ключами fact, conclusion, action.",
    "fact — факты и цифры по сути вопроса;",
    "conclusion — выводы на основе fact (и визуала, если он есть);",
    "action — предлагаемые действия.",
    "Если ответить нельзя, fact: 'Сожалею, но пока не могу ответить на ваш вопрос.'",
  ].join(" ");
}

function buildMockOpenRouterResult({ question, context, requestId }) {
  const ctx = context && typeof context === "object" ? context : {};
  const summary = {
    contextKeys: Object.keys(ctx).length,
    hasCharts: Boolean(ctx.charts),
    hasKpis: Boolean(ctx.kpis),
  };
  const answer = {
    fact: `[MOCK] Вопрос к модели: ${String(question || "").trim()}`,
    conclusion: `[MOCK] Контекст получен. keys=${summary.contextKeys}, charts=${summary.hasCharts}, kpis=${summary.hasKpis}.`,
    action: "[MOCK] Проверить, что финальный ответ на дашборде совпадает с детокенизированной версией.",
    parseOk: true,
  };
  return {
    ok: true,
    status: 200,
    latencyMs: 1,
    providerModel: "mock/openrouter",
    requestId,
    answer,
    rawContent: JSON.stringify(answer),
  };
}

async function sendOpenRouterRequest({ apiKey, model, question, context, requestId }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    try {
      const safeContext = context || {};
      const userContent = buildUserMessageParts(question, safeContext);
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:5173",
          "X-Title": process.env.OPENROUTER_APP_TITLE || "TOIR Dashboard Assistant",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: userContent },
          ],
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
          error: errorText.slice(0, 500),
          requestId,
        };
      }
      const json = await res.json();
      const rawContent = json?.choices?.[0]?.message?.content || "";
      return {
        ok: true,
        status: res.status,
        latencyMs,
        providerModel: json?.model || model,
        answer: normalizeAnswer(rawContent),
        rawContent,
        requestId,
      };
    } catch (e) {
      const latencyMs = Date.now() - startedAt;
      return {
        ok: false,
        status: e?.name === "AbortError" ? 408 : 0,
        latencyMs,
        providerModel: model,
        error: String(e?.message || e).slice(0, 500),
        requestId,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function askOpenRouter({ question, context, requestId }) {
  if (parseBool(process.env.OPENROUTER_MOCK_ENABLED, false)) {
    return buildMockOpenRouterResult({ question, context, requestId });
  }

  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("OPENROUTER_API_KEY is not configured");
    err.code = "missing_api_key";
    throw err;
  }

  const modelChain = [DEFAULT_MODEL, FALLBACK_MODEL, ROUTER_FALLBACK_MODEL];
  let lastResult = null;
  for (const model of modelChain) {
    const result = await sendOpenRouterRequest({
      apiKey,
      model,
      question,
      context,
      requestId,
    });
    lastResult = result;
    if (result.ok && result.answer && result.answer.parseOk !== false) {
      return result;
    }
  }
  return lastResult;
}

module.exports = {
  askOpenRouter,
};
