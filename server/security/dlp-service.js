"use strict";

const { encryptText, decryptText } = require("./crypto");
const tokenVault = require("./token-vault");
const { resolveAction, getRulePolicy, summarizePolicy } = require("./secret-policy");
const detector = require("./detector");

const TOKEN_REF_RE = /(?:\[\[\s*(DLP(?:\\?_[A-Z0-9]+)+)\s*\]\])|(?<![A-Z0-9_])(DLP(?:\\?_[A-Z0-9]+)+)(?![A-Z0-9_])/gi;
const TOKEN_ID_RE = /^DLP_[A-Z0-9_]+_\d{4,}$/;

// Guard sets are deliberately preserved: they no longer act as match sources,
// but suppress false positives that may come from any detector layer.
const FIO_NON_PERSON_WORDS = new Set([
  "станок",
  "токарный",
  "винторезный",
  "фрезерный",
  "сверлильный",
  "шлифовальный",
  "пресс",
  "насос",
  "компрессор",
  "конвейер",
  "редуктор",
  "двигатель",
  "генератор",
  "вентилятор",
  "трансформатор",
  "гидропресс",
  "котел",
  "котёл",
  "кран",
  "тельфер",
  "тягач",
  "погрузчик",
  "экскаватор",
  "самосвал",
  "бульдозер",
  "робот",
  "сварочный",
  "агрегат",
  "установка",
  "участок",
  "цех",
]);

const GENERIC_INSTALLATION_TAIL_WORDS = new Set([
  "основная",
  "основной",
  "резервная",
  "резервный",
  "производственная",
  "производственный",
  "ремонтная",
  "ремонтный",
  "компрессорная",
  "компрессорный",
  "насосная",
  "насосный",
  "сервисная",
  "сервисный",
  "центральная",
  "центральный",
  "участок",
  "цех",
  "линия",
  "блок",
  "станция",
  "площадка",
  "пост",
]);

const INSTALLATION_INTENT_WORDS = new Set([
  "требует",
  "требуются",
  "требуется",
  "нуждается",
  "нуждаются",
  "диагностики",
  "диагностика",
  "ремонта",
  "ремонт",
  "обслуживания",
  "проверки",
  "замены",
  "остановлена",
  "остановлен",
  "запущена",
  "запущен",
  "переведена",
  "переведен",
  "переведено",
  "резерв",
]);

const GENERIC_EQUIPMENT_WORDS = new Set([
  ...FIO_NON_PERSON_WORDS,
  "компрессорная",
  "насосная",
  "siemens",
  "atlas",
  "copco",
  "kuka",
  "toyota",
  "камаз",
  "маз",
  "jcb",
  "howo",
]);

const EQUIPMENT_CODE_PATH_HINTS = ["equipment_code", "asset_code", "tag", "code", "код", "идентификатор", "номер"];
const EQUIPMENT_NAME_PATH_HINTS = [
  "equipment",
  "machine",
  "model",
  "class",
  "type",
  "compressor",
  "pump",
  "оборуд",
  "станок",
  "насос",
  "компрессор",
  "агрегат",
];

const PHONE_CONTEXT_POSITIVE_HINTS = [
  "телефон",
  "тел.",
  "контакт",
  "моб",
  "связь",
  "whatsapp",
  "звон",
  "phone",
  "call",
];
const PHONE_CONTEXT_NEGATIVE_HINTS = [
  "номер детали",
  "детали",
  "серий",
  "артикул",
  "инвентар",
  "идентификатор",
  "заводской",
  "part",
  "serial",
  "asset",
  "tag",
];

// Pattern-based rules that remain as match sources (not strict-list-based).
const RULES = [
  {
    id: "openrouter_api_key",
    action: "block",
    priority: 300,
    regex: /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: "generic_api_key",
    action: "block",
    priority: 290,
    regex: /\b(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi,
  },
  {
    id: "bearer_token",
    action: "block",
    priority: 280,
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  },
  {
    id: "private_key",
    action: "block",
    priority: 270,
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/gi,
  },
  {
    id: "email",
    action: "tokenize",
    priority: 160,
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    id: "equipment_code_composite",
    action: "tokenize",
    priority: 145,
    regex: /(?<![A-ZА-ЯЁ0-9_])(?:[A-ZА-ЯЁ0-9]{2,}(?:_[A-ZА-ЯЁ0-9]{2,}){2,})(?![A-ZА-ЯЁ0-9_])/gu,
    guard: (text, ctx) => isLikelyCompositeEquipmentCode(text, ctx),
  },
  {
    id: "phone",
    action: "tokenize",
    priority: 120,
    regex: /(?<![\p{L}\d])(?:\+?\d[\d\s()\-]{8,}\d)(?![\p{L}\d])/gu,
    guard: (text, ctx) => isLikelyPhone(text, ctx),
  },
];

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeType(id) {
  return String(id || "unknown").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function normalizeTokenId(value) {
  return String(value || "")
    .trim()
    .replace(/\\_/g, "_")
    .toUpperCase();
}

function isCanonicalTokenId(value) {
  return TOKEN_ID_RE.test(String(value || "").trim());
}

function stripDigits(text) {
  return String(text || "").replace(/\D+/g, "");
}

function splitDomainWords(text) {
  const parts = String(text || "").match(/[A-Za-zА-Яа-яЁё0-9-]+/g);
  return Array.isArray(parts) ? parts : [];
}

function normalizeDomainWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/^[^A-Za-zА-Яа-яЁё0-9]+|[^A-Za-zА-Яа-яЁё0-9]+$/g, "");
}

function normalizeWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^\u0430-\u044f\u0451-]/g, "");
}

function normalizePath(pathValue) {
  return String(pathValue || "").toLowerCase();
}

function hasPathHint(pathValue, hints) {
  const path = normalizePath(pathValue);
  if (!path) return false;
  return hints.some((hint) => path.includes(hint));
}

function isLikelyPhone(text, ctx) {
  const raw = String(text || "").trim();
  const digits = stripDigits(raw);
  if (digits.length < 10 || digits.length > 15) return false;

  const fullText = String(ctx?.fullText || "");
  if (fullText) {
    const knownStart = Number(ctx?.matchStart);
    const knownEnd = Number(ctx?.matchEnd);
    const start = Number.isFinite(knownStart) ? knownStart : Math.max(fullText.indexOf(raw), 0);
    const end = Number.isFinite(knownEnd) ? knownEnd : Math.min(start + raw.length, fullText.length);
    const from = Math.max(0, start - 36);
    const to = Math.min(fullText.length, end + 36);
    const around = fullText.slice(from, to).toLowerCase();
    const hasPositiveContext = PHONE_CONTEXT_POSITIVE_HINTS.some((hint) => around.includes(hint));
    const hasNegativeContext = PHONE_CONTEXT_NEGATIVE_HINTS.some((hint) => around.includes(hint));
    if (hasNegativeContext && !hasPositiveContext) return false;
  }

  const startsWithPlus = raw.startsWith("+");
  if (startsWithPlus) {
    return digits.length >= 11 && digits.length <= 15;
  }

  if (digits.length === 11) {
    return /^[78]/.test(digits);
  }

  if (digits.length === 10) {
    return /^[9]/.test(digits);
  }

  return false;
}

function hasGenericEquipmentSemantics(text, options = {}) {
  const words = splitDomainWords(text).map(normalizeDomainWord).filter(Boolean);
  if (!words.length) return false;
  const ignoreFirstIfIn = options.ignoreFirstIfIn;
  const first = words[0];
  const ignoreFirst = Boolean(first && ignoreFirstIfIn && ignoreFirstIfIn.has(first));
  if (!ignoreFirst && GENERIC_EQUIPMENT_WORDS.has(first)) return true;

  let genericHits = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (ignoreFirst && i === 0) continue;
    if (GENERIC_EQUIPMENT_WORDS.has(words[i])) genericHits += 1;
  }
  return genericHits >= 2;
}

function isLikelyCompositeEquipmentCode(text, ctx) {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 8 || raw.length > 120) return false;
  if (isCanonicalTokenId(normalizeTokenId(raw))) return false;
  if (/\s/.test(raw)) return false;
  if (!/^[A-ZА-ЯЁ0-9]+(?:_[A-ZА-ЯЁ0-9]+){2,}$/.test(raw)) return false;
  const segments = raw.split("_");
  if (segments.length < 3) return false;
  if (segments.some((s) => s.length < 2)) return false;
  const digitParts = segments.filter((s) => /^\d{2,}$/.test(s)).length;
  const alphaParts = segments.filter((s) => /[A-ZА-ЯЁ]/.test(s)).length;
  if (digitParts < 1 || alphaParts < 2) return false;
  if (segments.every((s) => /^\d+$/.test(s))) return false;

  const explicitCodePath = hasPathHint(ctx?.path, EQUIPMENT_CODE_PATH_HINTS);
  const equipmentNamePath = hasPathHint(ctx?.path, EQUIPMENT_NAME_PATH_HINTS);
  if (equipmentNamePath && !explicitCodePath && digitParts < 2) return false;
  return true;
}

function detectorGuardKeeps(match, fullText) {
  if (!match || typeof match !== "object") return false;
  const value = String(match.value || "");
  if (!value) return false;
  if (isCanonicalTokenId(normalizeTokenId(value))) return false;
  const ruleId = String(match.ruleId || "");

  // FIO-like spans: drop blocklisted words.
  if (ruleId === "morph_fio" || ruleId === "ner_person" || ruleId === "dictionary_employee") {
    const parts = value.trim().split(/\s+/);
    for (const part of parts) {
      if (/\d/.test(part)) return false;
      const chunks = part.split("-");
      for (const chunk of chunks) {
        const normalized = normalizeWord(chunk);
        if (normalized && FIO_NON_PERSON_WORDS.has(normalized)) return false;
      }
    }
  }

  // ORG-like spans must not collapse to generic equipment vocabulary.
  if (ruleId === "ner_org" || ruleId === "structural_org" || ruleId === "dictionary_org") {
    if (hasGenericEquipmentSemantics(value)) return false;
  }

  // Location/installation guards: drop spans built only from generic tail words.
  if (ruleId === "ner_location" || ruleId === "structural_location" || ruleId === "dictionary_installation") {
    const words = splitDomainWords(value).map(normalizeDomainWord).filter(Boolean);
    if (!words.length) return false;
    const tail = words.slice(1);
    if (
      tail.length &&
      tail.every(
        (w) => GENERIC_INSTALLATION_TAIL_WORDS.has(w) || INSTALLATION_INTENT_WORDS.has(w) || GENERIC_EQUIPMENT_WORDS.has(w)
      )
    ) {
      return false;
    }
    if (hasGenericEquipmentSemantics(value, { ignoreFirstIfIn: GENERIC_INSTALLATION_TAIL_WORDS })) return false;
  }

  return true;
}

function hasOverlap(range, selected) {
  for (const x of selected) {
    if (range.start < x.end && x.start < range.end) return true;
  }
  return false;
}

function effectivePriority(match) {
  if (Number.isFinite(match.priority)) return match.priority;
  return match.action === "block" ? 200 : 100;
}

function collectRegexMatches(text, path) {
  const all = [];
  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m = rule.regex.exec(text);
    while (m) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      const guardOk =
        typeof rule.guard === "function"
          ? rule.guard(raw, { path, fullText: text, matchStart: start, matchEnd: end, ruleId: rule.id })
          : true;
      if (guardOk) {
        all.push({
          start,
          end,
          value: raw,
          ruleId: rule.id,
          action: rule.action,
          priority: Number(rule.priority),
        });
      }
      if (!rule.regex.global) break;
      m = rule.regex.exec(text);
    }
  }
  return all;
}

function selectNonOverlapping(allMatches) {
  const sorted = [...allMatches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const byPriority = effectivePriority(b) - effectivePriority(a);
    if (byPriority !== 0) return byPriority;
    const byLength = b.end - b.start - (a.end - a.start);
    if (byLength !== 0) return byLength;
    return String(a.ruleId).localeCompare(String(b.ruleId));
  });

  const selected = [];
  for (const item of sorted) {
    if (!hasOverlap(item, selected)) selected.push(item);
  }
  return selected;
}

function createSession({ requestId }) {
  const enabled = parseBool(process.env.DLP_ENABLED, true);
  const blockOnSecrets = parseBool(process.env.DLP_BLOCK_ON_SECRETS, true);
  const ttlSec = parsePositiveInt(process.env.DLP_TOKEN_TTL_SEC, 15 * 60);
  const policy = summarizePolicy();
  const typeCounters = new Map();

  function nextToken(typeId) {
    const type = normalizeType(typeId);
    const n = (typeCounters.get(type) || 0) + 1;
    typeCounters.set(type, n);
    return `[[DLP_${type}_${String(n).padStart(4, "0")}]]`;
  }

  async function collectMatches(input, path) {
    const text = String(input || "");
    if (!text) return [];

    const regexMatches = collectRegexMatches(text, path);

    let detectorMatches = [];
    try {
      const raw = await detector.detect(text, { path });
      detectorMatches = (raw || []).filter((m) => detectorGuardKeeps(m, text));
    } catch (e) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "dlp_detector_failure",
          message: String(e?.message || e).slice(0, 240),
        })
      );
      detectorMatches = [];
    }

    return selectNonOverlapping([...regexMatches, ...detectorMatches]);
  }

  async function sanitizeString(input, path, counters) {
    const text = String(input || "");
    const matches = await collectMatches(text, path);
    if (!matches.length) return { value: text, blockedBy: null };

    let blockedBy = null;
    let cursor = 0;
    const chunks = [];

    for (const m of matches) {
      chunks.push(text.slice(cursor, m.start));
      const action = resolveAction(m.ruleId, m.action === "block" ? "block" : "tokenize");
      const rulePolicy = getRulePolicy(m.ruleId);
      const classification = rulePolicy.classification || "unknown";

      counters.totalDetections += 1;
      counters.byType[m.ruleId] = (counters.byType[m.ruleId] || 0) + 1;
      counters.byClassification[classification] = (counters.byClassification[classification] || 0) + 1;

      if (action === "block") {
        if (!blockedBy && blockOnSecrets) blockedBy = m.ruleId;
        chunks.push(m.value);
      } else {
        const token = nextToken(m.ruleId);
        const aad = `${requestId}:${token}`;
        tokenVault.putToken({
          requestId,
          token,
          encrypted: encryptText(m.value, aad),
          dataType: m.ruleId,
          ttlSec,
        });
        counters.tokensCreated += 1;
        counters.tokensByPath[path] = (counters.tokensByPath[path] || 0) + 1;
        chunks.push(token);
      }
      cursor = m.end;
    }

    chunks.push(text.slice(cursor));
    return { value: chunks.join(""), blockedBy };
  }

  async function walkAndSanitize(node, path, counters) {
    if (typeof node === "string") {
      return sanitizeString(node, path, counters);
    }
    if (Array.isArray(node)) {
      const out = [];
      let blockedBy = null;
      for (let i = 0; i < node.length; i += 1) {
        const r = await walkAndSanitize(node[i], `${path}[${i}]`, counters);
        out.push(r.value);
        if (!blockedBy && r.blockedBy) blockedBy = r.blockedBy;
      }
      return { value: out, blockedBy };
    }
    if (node && typeof node === "object") {
      const out = {};
      let blockedBy = null;
      for (const [k, v] of Object.entries(node)) {
        const r = await walkAndSanitize(v, `${path}.${k}`, counters);
        out[k] = r.value;
        if (!blockedBy && r.blockedBy) blockedBy = r.blockedBy;
      }
      return { value: out, blockedBy };
    }
    return { value: node, blockedBy: null };
  }

  async function protectPayload(payload) {
    if (!enabled) {
      return {
        ok: true,
        payload,
        summary: { enabled: false, policy, totalDetections: 0, tokensCreated: 0, byType: {}, byClassification: {} },
      };
    }

    const counters = {
      totalDetections: 0,
      tokensCreated: 0,
      byType: {},
      tokensByPath: {},
      byClassification: {},
    };
    const result = await walkAndSanitize(payload, "$", counters);
    const blocked = Boolean(result.blockedBy);
    const blockedPolicy = result.blockedBy ? getRulePolicy(result.blockedBy) : null;
    return {
      ok: !blocked,
      blockedBy: result.blockedBy,
      blockedClassification: blockedPolicy?.classification || null,
      payload: result.value,
      summary: {
        enabled: true,
        policy,
        totalDetections: counters.totalDetections,
        tokensCreated: counters.tokensCreated,
        byType: counters.byType,
        byClassification: counters.byClassification,
      },
    };
  }

  function restoreStringOnce(input, counters) {
    const text = String(input || "");
    let out = "";
    let cursor = 0;
    TOKEN_REF_RE.lastIndex = 0;
    let m = TOKEN_REF_RE.exec(text);
    let restoredInPass = 0;
    while (m) {
      const full = m[0];
      const tokenId = normalizeTokenId(m[1] || m[2] || "");
      const start = m.index;
      const end = start + full.length;
      out += text.slice(cursor, start);

      if (!isCanonicalTokenId(tokenId)) {
        out += full;
        cursor = end;
        m = TOKEN_REF_RE.exec(text);
        continue;
      }

      const canonicalToken = `[[${tokenId}]]`;
      const record = tokenVault.getToken({ requestId, token: canonicalToken });
      if (!record) {
        counters.missingTokens += 1;
        out += full;
      } else {
        try {
          const aad = `${requestId}:${canonicalToken}`;
          const plain = decryptText(record.encrypted, aad);
          out += plain;
          counters.restoredCount += 1;
          restoredInPass += 1;
        } catch {
          counters.decryptErrors += 1;
          out += full;
        }
      }
      cursor = end;
      m = TOKEN_REF_RE.exec(text);
    }
    out += text.slice(cursor);
    return { value: out, restoredInPass };
  }

  function restoreString(input, counters) {
    let text = String(input || "");
    const maxPasses = parsePositiveInt(process.env.DLP_RESTORE_MAX_PASSES, 3);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const next = restoreStringOnce(text, counters);
      text = next.value;
      if (next.restoredInPass <= 0) break;
    }
    return text;
  }

  function walkAndRestore(node, counters) {
    if (typeof node === "string") {
      return restoreString(node, counters);
    }
    if (Array.isArray(node)) {
      return node.map((x) => walkAndRestore(x, counters));
    }
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = walkAndRestore(v, counters);
      }
      return out;
    }
    return node;
  }

  function restorePayload(payload) {
    if (!enabled) {
      return {
        payload,
        summary: { enabled: false, restoredCount: 0, missingTokens: 0, decryptErrors: 0 },
      };
    }
    const counters = { restoredCount: 0, missingTokens: 0, decryptErrors: 0 };
    const restored = walkAndRestore(payload, counters);
    return {
      payload: restored,
      summary: {
        enabled: true,
        restoredCount: counters.restoredCount,
        missingTokens: counters.missingTokens,
        decryptErrors: counters.decryptErrors,
      },
    };
  }

  function dispose() {
    tokenVault.clearRequest(requestId);
  }

  return {
    enabled,
    protectPayload,
    restorePayload,
    dispose,
  };
}

module.exports = {
  createSession,
};
