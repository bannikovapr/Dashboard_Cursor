"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../../data/toir.json");

let _raw = null;
let _datasets = null;
let _personnelRaw = undefined;
let _personnelOrgRaw = undefined;
const MONTH_ORDER = {
  "январь": 1,
  "февраль": 2,
  "март": 3,
  "апрель": 4,
  "май": 5,
  "июнь": 6,
  "июль": 7,
  "август": 8,
  "сентябрь": 9,
  "октябрь": 10,
  "ноябрь": 11,
  "декабрь": 12,
};

function classifyClass(name) {
  if (/СЃС‚Р°РЅРѕРє|С‚РѕРєР°СЂРЅ|С„СЂРµР·РµСЂ|СЃРІРµСЂР»РёР»|С€Р»РёС„|РїСЂРµСЃСЃ|РґРѕР»Р±|Р·Р°С‚РѕС‡|СЂР°СЃС‚РѕС‡|РїСЂРѕС‚СЏР¶|СЌР»РµРєС‚СЂРѕСЌСЂРѕР·РёРѕРЅ|Р»РµРЅС‚РѕС‡РЅРѕРїРёР»СЊ|С„РѕСЂРјР°С‚РЅРѕ|РєСЂРѕРјРєРѕРѕР±Р»РёС†РѕРІ|СЂРµР№СЃРјСѓСЃ|С„СѓРіРѕРІР°Р»СЊРЅ|Р·СѓР±РѕС„СЂРµР·РµСЂРЅ|С‚РѕРєР°СЂРЅРѕ-РєР°СЂСѓСЃРµР»СЊРЅ|РїСЂРѕРґРѕР»СЊРЅРѕ-С„СЂРµР·РµСЂРЅ|Р»РёСЃС‚РѕРіРёР±РѕС‡РЅ|РіРёР»СЊРѕС‚РёРЅ/i.test(name))
    return "РЎС‚Р°РЅРєРё Рё РјРµС‚Р°Р»Р»РѕРѕР±СЂР°Р±РѕС‚РєР°";
  if (/РЅР°СЃРѕСЃ/i.test(name)) return "РќР°СЃРѕСЃС‹";
  if (/РєРѕРјРїСЂРµСЃСЃРѕСЂ/i.test(name)) return "РљРѕРјРїСЂРµСЃСЃРѕСЂС‹";
  if (/РєСЂР°РЅ|С‚РµР»СЊС„РµСЂ|\bС‚Р°Р»СЊ\b/i.test(name)) return "РљСЂР°РЅРѕРІРѕРµ РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ";
  if (/РїРѕРіСЂСѓР·С‡РёРє|СЌРєСЃРєР°РІР°С‚РѕСЂ|СЃР°РјРѕСЃРІР°Р»|Р±СѓР»СЊРґРѕР·РµСЂ|С‚СЏРіР°С‡/i.test(name)) return "РЎР°РјРѕС…РѕРґРЅР°СЏ С‚РµС…РЅРёРєР°";
  if (/С‚СЂР°РЅСЃС„РѕСЂРјР°С‚РѕСЂ|СЌР»РµРєС‚СЂРѕРґРІРёРіР°С‚РµР»СЊ|РіРµРЅРµСЂР°С‚РѕСЂ|РІРµРЅС‚РёР»СЏС‚РѕСЂ/i.test(name)) return "Р­Р»РµРєС‚СЂРѕРѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ";
  if (/СЂРѕР±РѕС‚|СЃРІР°СЂРѕС‡РЅ/i.test(name)) return "РЎРІР°СЂРєР° Рё СЂРѕР±РѕС‚С‹";
  if (/РєРѕРЅРІРµР№РµСЂ|РіСЂРѕС…РѕС‚|РґСЂРѕР±РёР»Рє|РјРµР»СЊРЅРёС†|С†РµРЅС‚СЂРёС„СѓРі|РєРѕС‚С‘Р»|С…РѕР»РѕРґРёР»СЊРЅ|РіРёРґСЂРѕРїСЂРµСЃСЃ/i.test(name)) return "РџСЂРѕС‡РµРµ РїСЂРѕРјС‹С€Р»РµРЅРЅРѕРµ";
  return "РџСЂРѕС‡РµРµ";
}

function resolveEquipmentClass(raw, name) {
  if (name == null || name === "") return classifyClass(name);
  const nm = String(name);
  const map = raw && raw.tables && raw.tables.equipmentClassByName;
  if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, nm)) {
    const v = map[nm];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return classifyClass(nm);
}

function loadRaw() {
  if (_raw) return _raw;
  const text = fs.readFileSync(DATA_PATH, "utf-8");
  _raw = JSON.parse(text);
  return _raw;
}

function loadPersonnelRaw() {
  if (_personnelRaw !== undefined) return _personnelRaw;
  try {
    const raw = loadRaw();
    const p = raw.personnelUsage;
    _personnelRaw = p && typeof p === "object" ? p : null;
  } catch (e) {
    _personnelRaw = null;
    console.warn(`[agent:data-store] personnelUsage from toir.json: ${String(e?.message || e).slice(0, 300)}`);
  }
  return _personnelRaw;
}

function loadPersonnelOrgRaw() {
  if (_personnelOrgRaw !== undefined) return _personnelOrgRaw;
  try {
    const raw = loadRaw();
    const p = raw.personnelOrgUsage;
    _personnelOrgRaw = p && typeof p === "object" ? p : null;
  } catch (e) {
    _personnelOrgRaw = null;
    console.warn(`[agent:data-store] personnelOrgUsage from toir.json: ${String(e?.message || e).slice(0, 300)}`);
  }
  return _personnelOrgRaw;
}

function buildDatasets(raw) {
  if (_datasets) return _datasets;

  const ds = {};

  ds.costs_monthly = (raw.charts?.costsByMonth || []).map((r) => ({
    month: r.month,
    total: Number(r.total) || 0,
  }));

  ds.failure_causes = (raw.charts?.failureCauses || raw.charts?.failure_causes || []).map((r) => ({
    cause: r.cause,
    count: Number(r.count) || 0,
  }));

  ds.material_labor = (raw.charts?.materialLaborByMonth || []).map((r) => ({
    month: r.month,
    material_rub: Number(r.material_rub || r.material || r.material_h || 0),
    labor_h: Number(r.labor_h || r.labor || 0),
  }));

  ds.mtbf = (raw.charts?.mtbfByEquipment || []).map((r) => ({
    equipment: r.equipment,
    mtbf_h: Number(r.mtbf_h) || 0,
  }));

  ds.mttr = (raw.charts?.mttrByEquipment || []).map((r) => ({
    equipment: r.equipment,
    mttr_h: Number(r.mttr_h) || 0,
  }));

  const eqCosts = raw.tables?.equipmentCosts || {};
  ds.equipment_costs = Object.entries(eqCosts).map(([name, info]) => ({
    name,
    class: resolveEquipmentClass(raw, name),
    total: Number(info?.total || 0),
    months: info?.months || {},
  }));

  const ktgMap = raw.tables?.ktg || {};
  ds.ktg = Object.entries(ktgMap).map(([name, info]) => ({
    name,
    class: resolveEquipmentClass(raw, name),
    avg_ktg: Number(info?.avg_ktg || 0),
    total_downtime_h: Number(info?.total_downtime_h || 0),
    monthly_ktg: info?.monthly_ktg || {},
  }));

  const defectsMap = raw.tables?.equipmentDefects || {};
  ds.defects = Object.entries(defectsMap)
    .filter(([name]) => name !== "РС‚РѕРіРѕ")
    .map(([name, count]) => ({
      name,
      class: resolveEquipmentClass(raw, name),
      count: Number(count) || 0,
    }));

  ds.analysis_leaders = (raw.analysis?.top3_cost_leaders || []).map((r) => ({
    equipment: r.equipment,
    total_rub: Number(r.total_rub) || 0,
  }));

  ds.analysis_causes = (raw.analysis?.top3_failure_causes || []).map((r) => ({
    cause: r.cause,
    count: Number(r.count) || 0,
  }));

  const personnelRaw = loadPersonnelRaw();
  ds.personnel_utilization = (personnelRaw?.table?.rows || []).map((r) => ({
    employee: r.employee,
    fact_h: Number(r.fact_h) || 0,
    plan_h: Number(r.plan_h) || 0,
    utilization_pct: Number(r.utilization_pct) || 0,
  }));

  const personnelOrgRaw = loadPersonnelOrgRaw();
  ds.personnel_org_usage = (personnelOrgRaw?.table?.rows || []).map((r) => ({
    organization: r.organization || null,
    department: r.department || null,
    employee: r.employee || null,
    fact_h: Number(r.fact_h) || 0,
    plan_h: Number(r.plan_h) || 0,
    utilization_pct: Number(r.utilization_pct) || 0,
  }));

  ds.personnel_org_departments = (personnelOrgRaw?.departments || []).map((r) => ({
    organization: r.organization || null,
    department: r.department || null,
    employees: Number(r.employees) || 0,
    fact_h: Number(r.fact_h) || 0,
    plan_h: Number(r.plan_h) || 0,
    utilization_pct: Number(r.utilization_pct) || 0,
  }));

  ds.personnel_org_organizations = (personnelOrgRaw?.organizations || []).map((r) => ({
    organization: r.organization || null,
    employees: Number(r.employees) || 0,
    fact_h: Number(r.fact_h) || 0,
    plan_h: Number(r.plan_h) || 0,
    utilization_pct: Number(r.utilization_pct) || 0,
  }));

  _datasets = ds;
  return ds;
}

const DATASET_SCHEMA = {
  costs_monthly: { fields: ["month", "total"], description: "Затраты ТОиР по месяцам" },
  failure_causes: { fields: ["cause", "count"], description: "Причины отказов и их количество" },
  material_labor: {
    fields: ["month", "material_rub", "labor_h"],
    description: "Структура по месяцам: материальные затраты (руб.) и трудозатраты (часы)",
  },
  mtbf: { fields: ["equipment", "mtbf_h"], description: "СННО (наработка на отказ) по оборудованию, часы" },
  mttr: { fields: ["equipment", "mttr_h"], description: "СВР (среднее время восстановления) по оборудованию, часы" },
  equipment_costs: { fields: ["name", "class", "total", "months"], description: "Затраты по единицам оборудования с помесячной разбивкой" },
  ktg: { fields: ["name", "class", "avg_ktg", "total_downtime_h", "monthly_ktg"], description: "КТГ (коэффициент технической готовности) по оборудованию" },
  defects: { fields: ["name", "class", "count"], description: "Количество дефектов/отказов по оборудованию" },
  analysis_leaders: { fields: ["equipment", "total_rub"], description: "Топ-3 лидера по затратам" },
  analysis_causes: { fields: ["cause", "count"], description: "Топ-3 причин отказов" },
  personnel_utilization: {
    fields: ["employee", "fact_h", "plan_h", "utilization_pct"],
    description: "Объем выполненных ремонтных работ по сотрудникам за год (факт/план часов, выполнение)",
  },
  personnel_org_usage: {
    fields: ["organization", "department", "employee", "fact_h", "plan_h", "utilization_pct"],
    description: "Использование персонала по организациям, подразделениям и сотрудникам (факт/план часов, выполнение)",
  },
  personnel_org_departments: {
    fields: ["organization", "department", "employees", "fact_h", "plan_h", "utilization_pct"],
    description: "Использование персонала на уровне подразделений",
  },
  personnel_org_organizations: {
    fields: ["organization", "employees", "fact_h", "plan_h", "utilization_pct"],
    description: "Использование персонала на уровне организаций",
  },
};
function init() {
  const raw = loadRaw();
  buildDatasets(raw);
}

function getKpis() {
  const raw = loadRaw();
  return {
    total_cost: Number(raw.kpis?.total_cost) || 0,
    total_defects: Number(raw.kpis?.total_defects) || 0,
    equipment_count: Number(raw.kpis?.equipment_count) || 0,
  };
}

function getMeta() {
  const raw = loadRaw();
  return raw.meta || {};
}

function getDatasetSchema() {
  return DATASET_SCHEMA;
}

function getDatasetNames() {
  return Object.keys(DATASET_SCHEMA);
}

function matchesWhere(row, where) {
  if (!where || typeof where !== "object") return true;
  for (const [field, condition] of Object.entries(where)) {
    const val = row[field];
    if (typeof condition === "string" || typeof condition === "number") {
      if (val !== condition) return false;
    } else if (condition && typeof condition === "object") {
      if ("eq" in condition && val !== condition.eq) return false;
      if ("ne" in condition && val === condition.ne) return false;
      if ("gt" in condition && !(val > condition.gt)) return false;
      if ("gte" in condition && !(val >= condition.gte)) return false;
      if ("lt" in condition && !(val < condition.lt)) return false;
      if ("lte" in condition && !(val <= condition.lte)) return false;
      if ("contains" in condition) {
        if (typeof val !== "string" || !val.toLowerCase().includes(String(condition.contains).toLowerCase())) return false;
      }
      if ("in" in condition && Array.isArray(condition.in) && !condition.in.includes(val)) return false;
    }
  }
  return true;
}

function applySelect(row, select) {
  if (!select || !Array.isArray(select) || select.length === 0) return row;
  const out = {};
  for (const f of select) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

function queryDataset(datasetName, { where, select, orderBy, limit } = {}) {
  const raw = loadRaw();
  const ds = buildDatasets(raw);
  const rows = ds[datasetName];
  if (!rows) return { error: `РќР°Р±РѕСЂ РґР°РЅРЅС‹С… "${datasetName}" РЅРµ РЅР°Р№РґРµРЅ. Р”РѕСЃС‚СѓРїРЅС‹Рµ: ${Object.keys(ds).join(", ")}` };

  let result = rows.filter((r) => matchesWhere(r, where));

  if (orderBy) {
    const field = typeof orderBy === "string" ? orderBy : orderBy.field;
    const dir = (typeof orderBy === "object" && orderBy.dir === "asc") ? 1 : -1;
    result = [...result].sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ru") * dir;
    });
  }

  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    result = result.slice(0, Number(limit));
  }

  if (select) result = result.map((r) => applySelect(r, select));

  return { rows: result, totalBeforeLimit: rows.filter((r) => matchesWhere(r, where)).length };
}

function searchEquipment(query) {
  const raw = loadRaw();
  const ds = buildDatasets(raw);
  const qRaw = String(query || "");
  const q = qRaw.toLowerCase();
  const tokens = q
    .replace(/[В«В»"'.;,!?()]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!q) return { rows: [] };

  const seen = new Set();
  const results = [];
  for (const dsName of ["equipment_costs", "ktg", "defects", "mtbf", "mttr"]) {
    const rows = ds[dsName] || [];
    const nameField = dsName === "mtbf" || dsName === "mttr" ? "equipment" : "name";
    for (const r of rows) {
      const name = r[nameField];
      if (!name || seen.has(name)) continue;
      const nameLower = String(name).toLowerCase();
      const hasFullSubstring = nameLower.includes(q);
      const hasAllTokens = tokens.length > 0 && tokens.every((t) => nameLower.includes(t));
      if (hasFullSubstring || hasAllTokens) {
        seen.add(name);
        results.push({
          name,
          class: classifyClass(name),
          found_in: dsName,
        });
      }
    }
  }
  return { rows: results };
}

function parseRuMonthLabel(label) {
  const parts = String(label || "").trim().split(/\s+/);
  if (parts.length < 2) return null;
  const m = MONTH_ORDER[parts[0].toLowerCase()];
  const y = Number(parts[1]);
  if (!m || !Number.isFinite(y)) return null;
  return { year: y, month: m };
}

function sortRuMonthLabels(labels) {
  return [...labels].sort((a, b) => {
    const pa = parseRuMonthLabel(a);
    const pb = parseRuMonthLabel(b);
    if (!pa || !pb) return String(a).localeCompare(String(b), "ru");
    if (pa.year !== pb.year) return pa.year - pb.year;
    return pa.month - pb.month;
  });
}

function monthLabelToTs(label) {
  const p = parseRuMonthLabel(label);
  if (!p) return String(label || "");
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function applyPeriodFilter(rows, period) {
  if (!Array.isArray(rows)) return [];
  if (!period || period === "all") return rows;
  if (period === "h1") return rows.slice(0, 6);
  if (period === "h2") return rows.slice(6, 12);
  return rows;
}

function buildSeriesFromMonthMap(monthMap, metricLabel, unit) {
  const monthLabels = sortRuMonthLabels(Object.keys(monthMap || {}));
  return monthLabels.map((monthLabel) => ({
    ts: monthLabelToTs(monthLabel),
    monthLabel,
    value: Number(monthMap[monthLabel]) || 0,
    metricLabel,
    unit,
  }));
}

function buildCostsSeriesByClass(raw, classFilter) {
  const costs = raw.tables?.equipmentCosts || {};
  const monthMap = {};
  for (const [name, info] of Object.entries(costs)) {
    const cls = resolveEquipmentClass(raw, name);
    if (classFilter && classFilter !== "__all__" && cls !== classFilter) continue;
    const months = info?.months || {};
    for (const [monthLabel, value] of Object.entries(months)) {
      monthMap[monthLabel] = (Number(monthMap[monthLabel]) || 0) + (Number(value) || 0);
    }
  }
  return buildSeriesFromMonthMap(monthMap, "Р—Р°С‚СЂР°С‚С‹ РўРћРР ", "rub");
}

function getForecastSeries(metric, filters = {}) {
  const raw = loadRaw();
  const period = filters?.period || "all";
  const classFilter = filters?.class || "__all__";

  let series = [];
  let meta = {
    metric,
    period,
    class: classFilter,
    metricLabel: "",
    unit: "",
  };

  if (metric === "costs_monthly") {
    if (classFilter && classFilter !== "__all__") {
      series = buildCostsSeriesByClass(raw, classFilter);
      meta.metricLabel = `Р—Р°С‚СЂР°С‚С‹ РўРћРР  В· РєР»Р°СЃСЃ: ${classFilter}`;
      meta.unit = "rub";
    } else {
      series = (raw.charts?.costsByMonth || []).map((r) => ({
        ts: monthLabelToTs(r.month),
        monthLabel: r.month,
        value: Number(r.total) || 0,
        metricLabel: "Р—Р°С‚СЂР°С‚С‹ РўРћРР ",
        unit: "rub",
      }));
      meta.metricLabel = "Р—Р°С‚СЂР°С‚С‹ РўРћРР ";
      meta.unit = "rub";
    }
  } else if (metric === "material_rub" || metric === "material_h" || metric === "labor_h") {
    const isMaterial = metric === "material_rub" || metric === "material_h";
    series = (raw.charts?.materialLaborByMonth || []).map((r) => ({
      ts: monthLabelToTs(r.month),
      monthLabel: r.month,
      value: isMaterial
        ? Number(r.material_rub || r.material || r.material_h || 0)
        : Number(r.labor_h || r.labor || 0),
      metricLabel: isMaterial ? "Материальные затраты (руб.)" : "Трудозатраты (часы)",
      unit: isMaterial ? "rub" : "hours",
    }));
    meta.metricLabel = isMaterial ? "Материальные затраты (руб.)" : "Трудозатраты (часы)";
    meta.unit = isMaterial ? "rub" : "hours";
  } else if (metric === "class_costs") {
    series = buildCostsSeriesByClass(raw, classFilter);
    meta.metricLabel = classFilter && classFilter !== "__all__"
      ? `Р—Р°С‚СЂР°С‚С‹ РўРћРР  В· РєР»Р°СЃСЃ: ${classFilter}`
      : "Р—Р°С‚СЂР°С‚С‹ РўРћРР  (Р°РіСЂРµРіРёСЂРѕРІР°РЅРѕ РїРѕ РІСЃРµРј РєР»Р°СЃСЃР°Рј)";
    meta.unit = "rub";
  } else {
    return { error: `РњРµС‚СЂРёРєР° РїСЂРѕРіРЅРѕР·Р° "${metric}" РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ.` };
  }

  series = applyPeriodFilter(series, period);
  return { series, meta };
}

function reload() {
  _raw = null;
  _datasets = null;
  _personnelRaw = undefined;
  _personnelOrgRaw = undefined;
  loadRaw();
  buildDatasets(_raw);
}

module.exports = {
  init,
  getKpis,
  getMeta,
  getDatasetSchema,
  getDatasetNames,
  queryDataset,
  searchEquipment,
  getForecastSeries,
  sortRuMonthLabels,
  monthLabelToTs,
  classifyClass,
  resolveEquipmentClass,
  reload,
};

