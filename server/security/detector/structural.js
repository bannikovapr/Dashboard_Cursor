"use strict";

// Capitalized phrase: 2..5 consecutive capitalized words (Cyrillic or Latin),
// allowing inner hyphens, digits and quote characters as connective tokens.
const PROPER_PHRASE_RE =
  /(?<!\p{L})(?:["«]?[\u0410-\u042F\u0401A-Z][\u0410-\u042F\u0401\u0430-\u044F\u0451A-Za-z\-]+["»]?)(?:\s+(?:["«]?[\u0410-\u042F\u0401A-Z][\u0410-\u042F\u0401\u0430-\u044F\u0451A-Za-z0-9\-]+["»]?)){1,4}(?!\p{L})/gu;

// Soft (root) hints used as weak contextual signals. We avoid strict prefix lists
// for the entity span itself; only the surrounding window is checked.
const ORG_HINTS = [
  "ооо",
  "ао ",
  "пао",
  "зао",
  "оао",
  "ип ",
  "llc",
  "ltd",
  "gmbh",
  "jsc",
  "компани",
  "организац",
  "предприят",
  "холдинг",
  "корпорац",
  "филиал",
  "дочерн",
];

const LOC_HINTS = [
  "площадк",
  "установк",
  "линия",
  "блок",
  "станция",
  "узел",
  "полигон",
  "терминал",
  "скважин",
  "цех",
  "участок",
  "объект",
  "корпус",
  "комплекс",
];

const GENERIC_TAIL_WORDS = new Set([
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
]);

function lower(value) {
  return String(value || "").toLowerCase();
}

function aroundContext(text, start, end, radius) {
  const r = Number.isFinite(radius) ? radius : 36;
  const from = Math.max(0, start - r);
  const to = Math.min(text.length, end + r);
  return lower(text.slice(from, to));
}

function hasAnyHint(haystack, hints) {
  return hints.some((hint) => haystack.includes(hint));
}

function isLikelyTooGeneric(span) {
  const tokens = lower(span)
    .split(/\s+/)
    .map((x) => x.replace(/^["«]+|["»]+$/g, ""))
    .filter(Boolean);
  if (!tokens.length) return true;
  const generic = tokens.filter((t) => GENERIC_TAIL_WORDS.has(t)).length;
  return generic === tokens.length;
}

function findMatches(text) {
  const out = [];
  if (!text || typeof text !== "string") return out;

  PROPER_PHRASE_RE.lastIndex = 0;
  let m = PROPER_PHRASE_RE.exec(text);
  while (m) {
    const span = m[0];
    const start = m.index;
    const end = start + span.length;
    const lowered = aroundContext(text, start, end, 36);
    let ruleId = null;
    if (!isLikelyTooGeneric(span)) {
      if (hasAnyHint(lowered, ORG_HINTS)) ruleId = "structural_org";
      else if (hasAnyHint(lowered, LOC_HINTS)) ruleId = "structural_location";
    }
    if (ruleId) {
      out.push({ start, end, value: span, ruleId });
    }
    m = PROPER_PHRASE_RE.exec(text);
  }
  return out;
}

module.exports = {
  findMatches,
};
