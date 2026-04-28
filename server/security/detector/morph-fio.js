"use strict";

// One capitalized Cyrillic token (optionally with a single hyphenated capitalized continuation).
const WORD_RE =
  /(?<!\p{L})([\u0410-\u042F\u0401][\u0430-\u044F\u0451]+(?:-[\u0410-\u042F\u0401][\u0430-\u044F\u0451]+)?)(?!\p{L})/gu;

const SCORE_PATRONYMIC = 0.6;
const SCORE_SURNAME = 0.3;
const SCORE_FIRST_NAME = 0.2;
const SCORE_DICTIONARY_HIT = 0.5;
const SCORE_THRESHOLD = 0.6;

const PATRONYMIC_ENDINGS = [
  "ович",
  "евич",
  "ьевич",
  "иевич",
  "ич",
  "ыч",
  "овна",
  "евна",
  "ьевна",
  "иевна",
  "ична",
  "инична",
  "оглы",
  "оглу",
  "улы",
  "кызы",
  "кизи",
];

const SURNAME_ENDINGS = [
  "ов",
  "ев",
  "ёв",
  "ова",
  "ева",
  "ёва",
  "ин",
  "ын",
  "ина",
  "ына",
  "ский",
  "ской",
  "цкий",
  "цкой",
  "ская",
  "цкая",
  "енко",
  "енков",
  "енкова",
  "ук",
  "юк",
  "ян",
  "ьян",
  "швили",
  "адзе",
  "ия",
];

const EQUIPMENT_BLOCKLIST = new Set([
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

const _knownFirstNames = new Set();
const _knownPatronymics = new Set();
const _knownSurnames = new Set();

function normalize(word) {
  return String(word || "").toLowerCase().trim();
}

function endsWithAny(word, endings) {
  const w = normalize(word);
  if (!w) return false;
  return endings.some((suffix) => w.endsWith(suffix));
}

function looksLikePatronymic(word) {
  const w = normalize(word);
  if (!w) return false;
  if (_knownPatronymics.has(w)) return true;
  return endsWithAny(w, PATRONYMIC_ENDINGS);
}

function looksLikeSurname(word) {
  const w = normalize(word);
  if (!w) return false;
  if (_knownSurnames.has(w)) return true;
  return endsWithAny(w, SURNAME_ENDINGS);
}

function looksLikeFirstName(word) {
  const w = normalize(word);
  if (!w) return false;
  if (_knownFirstNames.has(w)) return true;
  // first names usually end with vowel or "й"; this is a weak signal
  return /[аеёиоуыэюяй]$/.test(w);
}

function isBlocklisted(word) {
  const chunks = String(word || "").split("-");
  for (const chunk of chunks) {
    const norm = normalize(chunk);
    if (!norm) return true;
    if (EQUIPMENT_BLOCKLIST.has(norm)) return true;
  }
  return false;
}

function learnFromDictionary(employees) {
  if (!Array.isArray(employees)) return;
  for (const fio of employees) {
    const parts = String(fio || "").trim().split(/\s+/);
    if (parts.length === 3) {
      _knownSurnames.add(normalize(parts[0]));
      _knownFirstNames.add(normalize(parts[1]));
      _knownPatronymics.add(normalize(parts[2]));
    }
  }
}

function reset() {
  _knownFirstNames.clear();
  _knownPatronymics.clear();
  _knownSurnames.clear();
}

function tokenizeWords(text) {
  const tokens = [];
  WORD_RE.lastIndex = 0;
  let m = WORD_RE.exec(text);
  while (m) {
    tokens.push({
      word: m[1],
      start: m.index,
      end: m.index + m[1].length,
    });
    m = WORD_RE.exec(text);
  }
  return tokens;
}

function isWhitespaceOnly(text) {
  return typeof text === "string" && text.length > 0 && /^\s+$/.test(text);
}

function scoreTriple(a, b, c, isAllowed, span) {
  if (isBlocklisted(a) || isBlocklisted(b) || isBlocklisted(c)) return 0;
  const hasPatronymic = looksLikePatronymic(c);
  const hasSurname = looksLikeSurname(a) || looksLikeSurname(c);
  const hasFirstName = looksLikeFirstName(b) || looksLikeFirstName(a);
  const knownDictionary = typeof isAllowed === "function" && isAllowed(span);
  let score = 0;
  if (hasPatronymic) score += SCORE_PATRONYMIC;
  if (hasSurname) score += SCORE_SURNAME;
  if (hasFirstName) score += SCORE_FIRST_NAME;
  if (knownDictionary) score += SCORE_DICTIONARY_HIT;
  return score;
}

function findMatches(text, isAllowed) {
  const out = [];
  if (!text || typeof text !== "string") return out;

  const tokens = tokenizeWords(text);
  if (tokens.length < 3) return out;

  for (let i = 0; i + 2 < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const c = tokens[i + 2];

    const sep1 = text.slice(a.end, b.start);
    const sep2 = text.slice(b.end, c.start);
    if (!isWhitespaceOnly(sep1)) continue;
    if (!isWhitespaceOnly(sep2)) continue;

    const span = text.slice(a.start, c.end);
    const score = scoreTriple(a.word, b.word, c.word, isAllowed, span);
    if (score >= SCORE_THRESHOLD) {
      out.push({
        start: a.start,
        end: c.end,
        value: span,
        ruleId: "morph_fio",
        score: Number(score.toFixed(2)),
      });
    }
  }
  return out;
}

function getStats() {
  return {
    knownSurnames: _knownSurnames.size,
    knownFirstNames: _knownFirstNames.size,
    knownPatronymics: _knownPatronymics.size,
  };
}

module.exports = {
  learnFromDictionary,
  findMatches,
  reset,
  getStats,
};
