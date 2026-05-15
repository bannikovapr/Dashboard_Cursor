"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const TERM_SOURCES = Object.freeze({
  toir: "data/toir.json",
});

const GENERIC_SHORT_TERMS = new Set([
  "цех",
  "отдел",
  "служба",
  "управление",
  "линия",
  "блок",
  "узел",
  "станция",
  "площадка",
  "установка",
  "участок",
]);

let _state = null;

function readJsonSafely(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const text = fs.readFileSync(absPath, "utf8");
    return JSON.parse(text);
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_dict_index_read_failed",
        file: absPath,
        message: String(e?.message || e).slice(0, 240),
      })
    );
    return null;
  }
}

function isWordCharacter(ch) {
  return /[A-Za-zА-Яа-яЁё0-9]/.test(String(ch || ""));
}

function isAcceptableTerm(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.length < 4) return false;
  if (raw.length > 120) return false;
  const lower = raw.toLowerCase();
  if (GENERIC_SHORT_TERMS.has(lower)) return false;
  return true;
}

function addTerm(map, raw, type) {
  const value = String(raw || "").trim();
  if (!isAcceptableTerm(value)) return;
  const lower = value.toLowerCase();
  const existing = map.get(lower);
  if (existing && existing.type === type) return;
  map.set(lower, { raw: existing?.raw || value, type });
}

function buildState() {
  const terms = new Map();
  const employees = new Set();
  const organizations = new Set();
  const departments = new Set();

  const toir = readJsonSafely(path.resolve(PROJECT_ROOT, TERM_SOURCES.toir));

  const personnel = toir?.personnelUsage;
  if (personnel?.table?.rows) {
    for (const row of personnel.table.rows) {
      if (row?.employee) {
        addTerm(terms, row.employee, "dictionary_employee");
        employees.add(String(row.employee).trim());
      }
    }
  }

  const org = toir?.personnelOrgUsage;
  const harvestRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row?.employee) {
        addTerm(terms, row.employee, "dictionary_employee");
        employees.add(String(row.employee).trim());
      }
      if (row?.organization) {
        addTerm(terms, row.organization, "dictionary_org");
        organizations.add(String(row.organization).trim());
      }
      if (row?.department) {
        addTerm(terms, row.department, "dictionary_department");
        departments.add(String(row.department).trim());
      }
    }
  };
  if (org?.table?.rows) harvestRows(org.table.rows);
  if (Array.isArray(org?.organizations)) harvestRows(org.organizations);
  if (Array.isArray(org?.departments)) harvestRows(org.departments);

  // Оборудование / локации в toir (если есть).
  if (Array.isArray(toir?.installations)) {
    for (const inst of toir.installations) {
      if (inst?.name) addTerm(terms, inst.name, "dictionary_installation");
    }
  }
  if (Array.isArray(toir?.locations)) {
    for (const loc of toir.locations) {
      if (loc?.name) addTerm(terms, loc.name, "dictionary_installation");
    }
  }

  const list = [...terms.entries()]
    .map(([lower, value]) => ({ lower, raw: value.raw, type: value.type, length: value.raw.length }))
    .sort((a, b) => b.length - a.length);

  return {
    list,
    employeesLower: new Set([...employees].map((s) => s.toLowerCase())),
    organizationsLower: new Set([...organizations].map((s) => s.toLowerCase())),
    departmentsLower: new Set([...departments].map((s) => s.toLowerCase())),
    employeesRaw: [...employees],
    counts: {
      total: list.length,
      employees: employees.size,
      organizations: organizations.size,
      departments: departments.size,
    },
  };
}

function init({ force } = {}) {
  if (_state && !force) return getStats();
  _state = buildState();
  return getStats();
}

function getStats() {
  if (!_state) {
    return {
      enabled: false,
      counts: { total: 0, employees: 0, organizations: 0, departments: 0 },
      sources: { ...TERM_SOURCES },
    };
  }
  return {
    enabled: true,
    counts: _state.counts,
    sources: { ...TERM_SOURCES },
  };
}

function findMatches(text) {
  if (!_state) init();
  const out = [];
  if (!text || typeof text !== "string") return out;
  const lower = text.toLowerCase();

  for (const term of _state.list) {
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(term.lower, from);
      if (idx < 0) break;
      const before = idx > 0 ? text[idx - 1] : "";
      const after = idx + term.length < text.length ? text[idx + term.length] : "";
      const boundaryOk = !isWordCharacter(before) && !isWordCharacter(after);
      if (boundaryOk) {
        out.push({
          start: idx,
          end: idx + term.length,
          value: text.slice(idx, idx + term.length),
          ruleId: term.type,
        });
      }
      from = idx + Math.max(1, term.length);
    }
  }
  return out;
}

function getEmployees() {
  if (!_state) init();
  return _state ? _state.employeesRaw : [];
}

function hasEmployee(text) {
  if (!_state) init();
  return _state ? _state.employeesLower.has(String(text || "").trim().toLowerCase()) : false;
}

module.exports = {
  init,
  getStats,
  findMatches,
  getEmployees,
  hasEmployee,
};
