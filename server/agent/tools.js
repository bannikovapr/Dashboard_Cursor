"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const dataStore = require("./data-store");
const Diagnostics = require("../../js/toir-diagnostics");

const TOOL_DEFINITIONS = [
  {
    name: "get_kpis",
    description: "Р’РѕР·РІСЂР°С‰Р°РµС‚ РєР»СЋС‡РµРІС‹Рµ РїРѕРєР°Р·Р°С‚РµР»Рё (KPI) РґР°С€Р±РѕСЂРґР° РўРћРР : РѕР±С‰РёРµ Р·Р°С‚СЂР°С‚С‹, РєРѕР»РёС‡РµСЃС‚РІРѕ РѕС‚РєР°Р·РѕРІ, РєРѕР»РёС‡РµСЃС‚РІРѕ РµРґРёРЅРёС† РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ, Р° С‚Р°РєР¶Рµ РјРµС‚Р°-РёРЅС„РѕСЂРјР°С†РёСЋ (РїРµСЂРёРѕРґ, РёСЃС‚РѕС‡РЅРёРє).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "forecast_metric",
    description: "РЎС‚СЂРѕРёС‚ РїСЂРѕРіРЅРѕР· РІСЂРµРјРµРЅРЅРѕРіРѕ СЂСЏРґР° (on-demand) РїРѕ РјРµС‚СЂРёРєРµ СЃ РіРѕСЂРёР·РѕРЅС‚РѕРј РґРѕ 12 РїРµСЂРёРѕРґРѕРІ. Р’РѕР·РІСЂР°С‰Р°РµС‚ РїСЂРѕРіРЅРѕР·, РґРѕРІРµСЂРёС‚РµР»СЊРЅС‹Рµ РёРЅС‚РµСЂРІР°Р»С‹, РјРµС‚СЂРёРєРё РєР°С‡РµСЃС‚РІР° Рё Р°СЂС‚РµС„Р°РєС‚С‹ РґР»СЏ UI.",
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["costs_monthly", "material_rub", "material_h", "labor_h", "class_costs"],
          description: "РњРµС‚СЂРёРєР° РІСЂРµРјРµРЅРЅРѕРіРѕ СЂСЏРґР° РґР»СЏ РїСЂРѕРіРЅРѕР·Р°.",
        },
        horizon: {
          type: "number",
          description: "Р“РѕСЂРёР·РѕРЅС‚ РїСЂРѕРіРЅРѕР·Р° РІ РјРµСЃСЏС†Р°С… (1..12).",
        },
        method: {
          type: "string",
          enum: ["auto", "ets", "arima"],
          description: "РњРµС‚РѕРґ РїСЂРѕРіРЅРѕР·Р°.",
        },
        filters: {
          type: "object",
          description: "Р¤РёР»СЊС‚СЂС‹ СЃСЂРµР·Р°: period/class, РЅР°РїСЂРёРјРµСЂ {period:'all',class:'__all__'}.",
        },
        with_confidence: {
          type: "boolean",
          description: "Р’РѕР·РІСЂР°С‰Р°С‚СЊ РґРѕРІРµСЂРёС‚РµР»СЊРЅС‹Р№ РёРЅС‚РµСЂРІР°Р» РїСЂРѕРіРЅРѕР·Р°.",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "query_data",
    description: "Р’С‹РїРѕР»РЅСЏРµС‚ Р·Р°РїСЂРѕСЃ Рє РЅР°Р±РѕСЂСѓ РґР°РЅРЅС‹С… РўРћРР . Р”РѕСЃС‚СѓРїРЅС‹Рµ РЅР°Р±РѕСЂС‹: costs_monthly, failure_causes, material_labor, mtbf, mttr, equipment_costs, ktg, defects, analysis_leaders, analysis_causes, personnel_utilization, personnel_org_usage, personnel_org_departments, personnel_org_organizations.",
    parameters: {
      type: "object",
      properties: {
        dataset: {
          type: "string",
          description: "РРјСЏ РЅР°Р±РѕСЂР° РґР°РЅРЅС‹С…",
          enum: [
            "costs_monthly", "failure_causes", "material_labor",
            "mtbf", "mttr", "equipment_costs", "ktg", "defects",
            "analysis_leaders", "analysis_causes", "personnel_utilization",
            "personnel_org_usage", "personnel_org_departments", "personnel_org_organizations",
          ],
        },
        where: {
          type: "object",
          description: "Р¤РёР»СЊС‚СЂ СЃС‚СЂРѕРє. РљР»СЋС‡ вЂ” РёРјСЏ РїРѕР»СЏ, Р·РЅР°С‡РµРЅРёРµ вЂ” С‚РѕС‡РЅРѕРµ СЃРѕРІРїР°РґРµРЅРёРµ (СЃС‚СЂРѕРєР°/С‡РёСЃР»Рѕ) РёР»Рё РѕР±СЉРµРєС‚ СЃ РѕРїРµСЂР°С‚РѕСЂР°РјРё: eq, ne, gt, gte, lt, lte, contains.",
        },
        select: {
          type: "array",
          items: { type: "string" },
          description: "РЎРїРёСЃРѕРє РїРѕР»РµР№ РґР»СЏ РІРѕР·РІСЂР°С‚Р° (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ вЂ” РІСЃРµ).",
        },
        orderBy: {
          description: "РЎРѕСЂС‚РёСЂРѕРІРєР°: СЃС‚СЂРѕРєР° (РёРјСЏ РїРѕР»СЏ, desc) РёР»Рё РѕР±СЉРµРєС‚ {field, dir:'asc'|'desc'}.",
        },
        limit: {
          type: "number",
          description: "РњР°РєСЃРёРјСѓРј СЃС‚СЂРѕРє РІ РѕС‚РІРµС‚Рµ (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ 1000, РјР°РєСЃ. 1000).",
        },
      },
      required: ["dataset"],
    },
  },
  {
    name: "compute",
    description: "Р’С‹РїРѕР»РЅСЏРµС‚ РІС‹С‡РёСЃР»РµРЅРёРµ РЅР°Рґ СЂРµР·СѓР»СЊС‚Р°С‚РѕРј РїСЂРµРґС‹РґСѓС‰РµРіРѕ Р·Р°РїСЂРѕСЃР° РёР»Рё РЅР°Рґ СѓРєР°Р·Р°РЅРЅС‹Рј РЅР°Р±РѕСЂРѕРј РґР°РЅРЅС‹С…. РћРїРµСЂР°С†РёРё: sum, avg, min, max, delta, percent, rank, count, group_by.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["sum", "avg", "min", "max", "delta", "percent", "rank", "count", "group_by"],
          description: "РўРёРї РІС‹С‡РёСЃР»РµРЅРёСЏ.",
        },
        dataset: {
          type: "string",
          description: "РРјСЏ РЅР°Р±РѕСЂР° РґР°РЅРЅС‹С… (РµСЃР»Рё РЅСѓР¶РЅРѕ Р·Р°РїСЂРѕСЃРёС‚СЊ РґР°РЅРЅС‹Рµ РґР»СЏ РІС‹С‡РёСЃР»РµРЅРёСЏ).",
        },
        field: {
          type: "string",
          description: "РџРѕР»Рµ РґР»СЏ Р°РіСЂРµРіР°С†РёРё (РґР»СЏ sum, avg, min, max, rank).",
        },
        where: {
          type: "object",
          description: "Р¤РёР»СЊС‚СЂ СЃС‚СЂРѕРє (Р°РЅР°Р»РѕРіРёС‡РЅРѕ query_data).",
        },
        group_field: {
          type: "string",
          description: "РџРѕР»Рµ РіСЂСѓРїРїРёСЂРѕРІРєРё (РґР»СЏ group_by).",
        },
        agg_field: {
          type: "string",
          description: "РџРѕР»Рµ Р°РіСЂРµРіР°С†РёРё РІ РіСЂСѓРїРїРµ (РґР»СЏ group_by).",
        },
        values: {
          type: "array",
          items: { type: "number" },
          description: "Р”РІР° С‡РёСЃР»Р° РґР»СЏ delta (СЂР°Р·РЅРѕСЃС‚СЊ) РёР»Рё percent (РґРѕР»СЏ).",
        },
        limit: {
          type: "number",
          description: "РљРѕР»-РІРѕ СЃС‚СЂРѕРє РґР»СЏ rank.",
        },
      },
      required: ["operation"],
    },
  },
  {
    name: "build_table",
    description: "Р¤РѕСЂРјРёСЂСѓРµС‚ С‚Р°Р±Р»РёС‡РЅС‹Р№ Р°СЂС‚РµС„Р°РєС‚ РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ. Р’С‹Р·С‹РІР°Р№ РїРѕСЃР»Рµ РїРѕР»СѓС‡РµРЅРёСЏ РґР°РЅРЅС‹С… С‡РµСЂРµР· query_data/compute.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Р—Р°РіРѕР»РѕРІРѕРє С‚Р°Р±Р»РёС†С‹." },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              label: { type: "string" },
            },
            required: ["key", "label"],
          },
          description: "РћРїСЂРµРґРµР»РµРЅРёСЏ СЃС‚РѕР»Р±С†РѕРІ.",
        },
        rows: {
          type: "array",
          items: { type: "object" },
          description: "РњР°СЃСЃРёРІ СЃС‚СЂРѕРє-РѕР±СЉРµРєС‚РѕРІ.",
        },
      },
      required: ["title", "columns", "rows"],
    },
  },
  {
    name: "build_chart",
    description: "Р¤РѕСЂРјРёСЂСѓРµС‚ СЃРїРµС†РёС„РёРєР°С†РёСЋ РіСЂР°С„РёРєР° РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ. РўРёРїС‹: bar, line, pie, donut, area. Р’С‹Р·С‹РІР°Р№ РїРѕСЃР»Рµ РїРѕР»СѓС‡РµРЅРёСЏ РґР°РЅРЅС‹С….",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Р—Р°РіРѕР»РѕРІРѕРє РіСЂР°С„РёРєР°." },
        chartType: {
          type: "string",
          enum: ["bar", "line", "pie", "donut", "area"],
          description: "РўРёРї РіСЂР°С„РёРєР°.",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "РџРѕРґРїРёСЃРё РїРѕ РѕСЃРё X (РёР»Рё СЃРµРіРјРµРЅС‚РѕРІ РґР»СЏ pie/donut).",
        },
        series: {
          type: "array",
          description: "РњР°СЃСЃРёРІ СЃРµСЂРёР№. РљР°Р¶РґР°СЏ СЃРµСЂРёСЏ: {name: string, data: number[]}.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              data: { type: "array", items: { type: "number" } },
            },
            required: ["name", "data"],
          },
        },
      },
      required: ["title", "chartType", "categories", "series"],
    },
  },
  {
    name: "search_equipment",
    description: "РџРѕР»РЅРѕС‚РµРєСЃС‚РѕРІС‹Р№ РїРѕРёСЃРє РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ РїРѕ РЅР°Р·РІР°РЅРёСЋ. Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРѕРІРїР°РґРµРЅРёСЏ СЃ СѓРєР°Р·Р°РЅРёРµРј РєР»Р°СЃСЃР°.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "РџРѕРёСЃРєРѕРІС‹Р№ Р·Р°РїСЂРѕСЃ (С‡Р°СЃС‚СЊ РЅР°Р·РІР°РЅРёСЏ)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_diagnostics_summary",
    description:
      "Сводка статистических гипотез (диагностик) ТОиР: сколько сработало, сколько с недостаточными данными, полный список результатов. Учитывает filters.period и filters.class как на дашборде.",
    parameters: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: "Срез: period (all|h1|h2), class (класс оборудования или __all__).",
        },
        only_triggered: {
          type: "boolean",
          description: "Если true — в ответе только массив triggered и summary (без полного списка и not_triggered).",
        },
      },
      required: [],
    },
  },
];

function executeGetKpis() {
  return {
    kpis: dataStore.getKpis(),
    meta: dataStore.getMeta(),
    datasets_available: dataStore.getDatasetNames(),
  };
}

function executeGetDiagnosticsSummary(params) {
  const p = params || {};
  const filters = p.filters || {};
  const period = filters.period || "all";
  const cls = filters.class != null ? filters.class : "__all__";
  const filePath = path.resolve(__dirname, "../../data/toir.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const diagnostics = Diagnostics.analyzeAll(raw, { period, class: cls });
  const summary = Diagnostics.summarize(diagnostics);
  if (p.only_triggered) {
    return {
      summary,
      triggered: diagnostics.filter((d) => d.status === Diagnostics.STATUS.TRIGGERED),
    };
  }
  return {
    summary,
    diagnostics,
    triggered: diagnostics.filter((d) => d.status === Diagnostics.STATUS.TRIGGERED),
    not_triggered: diagnostics.filter((d) => d.status === Diagnostics.STATUS.NOT_TRIGGERED),
  };
}

function executeQueryData(params) {
  const { dataset, where, select, orderBy, limit } = params || {};
  if (!dataset) return { error: "РџР°СЂР°РјРµС‚СЂ dataset РѕР±СЏР·Р°С‚РµР»РµРЅ." };
  return dataStore.queryDataset(dataset, { where, select, orderBy, limit });
}

function executeCompute(params) {
  const { operation, dataset, field, where, group_field, agg_field, values, limit } = params || {};

  let rows = null;
  if (dataset) {
    const result = dataStore.queryDataset(dataset, { where });
    if (result.error) return result;
    rows = result.rows;
  }

  switch (operation) {
    case "sum": {
      if (!rows || !field) return { error: "Р”Р»СЏ sum РЅСѓР¶РЅС‹ dataset Рё field." };
      const val = rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
      return { result: val, operation: "sum", field, count: rows.length };
    }
    case "avg": {
      if (!rows || !field) return { error: "Р”Р»СЏ avg РЅСѓР¶РЅС‹ dataset Рё field." };
      const nums = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v));
      if (!nums.length) return { result: null, operation: "avg", field, count: 0 };
      return { result: nums.reduce((a, b) => a + b, 0) / nums.length, operation: "avg", field, count: nums.length };
    }
    case "min": {
      if (!rows || !field) return { error: "Р”Р»СЏ min РЅСѓР¶РЅС‹ dataset Рё field." };
      const nums = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v));
      if (!nums.length) return { result: null };
      const minVal = Math.min(...nums);
      const minRow = rows.find((r) => Number(r[field]) === minVal);
      return { result: minVal, row: minRow, operation: "min", field };
    }
    case "max": {
      if (!rows || !field) return { error: "Р”Р»СЏ max РЅСѓР¶РЅС‹ dataset Рё field." };
      const nums = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v));
      if (!nums.length) return { result: null };
      const maxVal = Math.max(...nums);
      const maxRow = rows.find((r) => Number(r[field]) === maxVal);
      return { result: maxVal, row: maxRow, operation: "max", field };
    }
    case "delta": {
      if (!values || values.length < 2) return { error: "Р”Р»СЏ delta РЅСѓР¶РµРЅ РјР°СЃСЃРёРІ values РёР· 2 С‡РёСЃРµР»." };
      const [a, b] = values;
      return { result: b - a, a, b, percent_change: a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null };
    }
    case "percent": {
      if (!values || values.length < 2) return { error: "Р”Р»СЏ percent РЅСѓР¶РµРЅ РјР°СЃСЃРёРІ values: [С‡Р°СЃС‚СЊ, С†РµР»РѕРµ]." };
      const [part, whole] = values;
      return { result: whole !== 0 ? (part / whole) * 100 : null, part, whole };
    }
    case "rank": {
      if (!rows || !field) return { error: "Р”Р»СЏ rank РЅСѓР¶РЅС‹ dataset Рё field." };
      const sorted = [...rows].sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0));
      const lim = Number(limit);
      const top = Number.isFinite(lim) && lim > 0 ? sorted.slice(0, lim) : sorted;
      return { rows: top, operation: "rank", field, limit: top.length };
    }
    case "count": {
      if (!rows) return { error: "Р”Р»СЏ count РЅСѓР¶РµРЅ dataset." };
      return { result: rows.length, operation: "count" };
    }
    case "group_by": {
      if (!rows || !group_field || !agg_field) return { error: "Р”Р»СЏ group_by РЅСѓР¶РЅС‹ dataset, group_field Рё agg_field." };
      const groups = new Map();
      for (const r of rows) {
        const key = r[group_field] ?? "__null__";
        if (!groups.has(key)) groups.set(key, { sum: 0, count: 0 });
        const g = groups.get(key);
        g.sum += Number(r[agg_field]) || 0;
        g.count += 1;
      }
      const result = [...groups.entries()]
        .map(([key, g]) => ({ [group_field]: key, sum: g.sum, count: g.count, avg: g.count ? g.sum / g.count : 0 }))
        .sort((a, b) => b.sum - a.sum);
      return { rows: result, operation: "group_by", group_field, agg_field };
    }
    default:
      return { error: `РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕРїРµСЂР°С†РёСЏ: ${operation}` };
  }
}

function executeBuildTable(params) {
  const { title, columns, rows } = params || {};
  if (!title || !columns || !rows) return { error: "РќСѓР¶РЅС‹ title, columns Рё rows." };
  return {
    artifact: {
      type: "table",
      title,
      columns: Array.isArray(columns) ? columns : [],
      rows: Array.isArray(rows) ? rows : [],
    },
  };
}

function executeBuildChart(params) {
  const { title, chartType, categories, series } = params || {};
  if (!title || !chartType || !categories || !series) {
    return { error: "РќСѓР¶РЅС‹ title, chartType, categories Рё series." };
  }
  return {
    artifact: {
      type: "chart",
      title,
      chartType,
      categories: Array.isArray(categories) ? categories : [],
      series: Array.isArray(series)
        ? series.map((s) => ({
            name: s.name || "РЎРµСЂРёСЏ",
            data: Array.isArray(s.data) ? s.data : [],
          }))
        : [],
    },
  };
}

function executeSearchEquipment(params) {
  const query = params?.query;
  return dataStore.searchEquipment(query);
}

function callPythonForecast(payload) {
  const scriptPath = path.resolve(__dirname, "../../scripts/forecast_series.py");
  const runners = [
    { cmd: "py", args: ["-3", scriptPath] },
    { cmd: "python", args: [scriptPath] },
  ];
  let lastErr = null;
  for (const r of runners) {
    try {
      const run = spawnSync(r.cmd, r.args, {
        input: JSON.stringify(payload),
        encoding: "utf-8",
        timeout: 35000,
        windowsHide: true,
      });
      if (run.error) {
        lastErr = run.error;
        continue;
      }
      if (run.status !== 0 && !run.stdout) {
        lastErr = new Error((run.stderr || "").slice(0, 300));
        continue;
      }
      const parsed = JSON.parse(run.stdout || "{}");
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, error: `Python forecast failed: ${String(lastErr?.message || lastErr || "unknown").slice(0, 300)}` };
}

function buildForecastArtifacts(metricLabel, unit, withConfidence, history, forecast) {
  const categories = [...history.map((x) => x.ts), ...forecast.map((x) => x.ts)];
  const historySeries = [...history.map((x) => Number(x.value) || 0), ...forecast.map(() => null)];
  const forecastSeries = [...history.map(() => null), ...forecast.map((x) => Number(x.value) || 0)];
  const baseSeries = [
    { name: "Р¤Р°РєС‚", data: historySeries },
    { name: "РџСЂРѕРіРЅРѕР·", data: forecastSeries },
  ];
  if (withConfidence && forecast.length) {
    const lowerSeries = [...history.map(() => null), ...forecast.map((x) => Number(x.lower) || 0)];
    const upperSeries = [...history.map(() => null), ...forecast.map((x) => Number(x.upper) || 0)];
    baseSeries.push({ name: "РќРёР¶РЅРёР№ РёРЅС‚РµСЂРІР°Р»", data: lowerSeries });
    baseSeries.push({ name: "Р’РµСЂС…РЅРёР№ РёРЅС‚РµСЂРІР°Р»", data: upperSeries });
  }

  const chart = {
    type: "chart",
    title: `РџСЂРѕРіРЅРѕР·: ${metricLabel}`,
    chartType: "line",
    categories,
    series: baseSeries,
    meta: {
      forecast: true,
      unit,
    },
  };

  const rows = forecast.map((p) => ({
    ts: p.ts,
    forecast: Number(p.value) || 0,
    lower: p.lower != null ? Number(p.lower) || 0 : null,
    upper: p.upper != null ? Number(p.upper) || 0 : null,
  }));
  const table = {
    type: "table",
    title: `РџСЂРѕРіРЅРѕР·РЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ: ${metricLabel}`,
    columns: [
      { key: "ts", label: "РџРµСЂРёРѕРґ" },
      { key: "forecast", label: `РџСЂРѕРіРЅРѕР· (${unit})` },
      { key: "lower", label: "РќРёР¶РЅСЏСЏ РіСЂР°РЅРёС†Р°" },
      { key: "upper", label: "Р’РµСЂС…РЅСЏСЏ РіСЂР°РЅРёС†Р°" },
    ],
    rows,
    meta: {
      forecast: true,
      unit,
    },
  };

  return { chart, table };
}

function executeForecastMetric(params) {
  const startedAt = Date.now();
  const metric = params?.metric;
  const horizon = Math.min(Math.max(Number(params?.horizon || 3), 1), 12);
  const method = String(params?.method || "auto");
  const filters = params?.filters || {};
  const withConfidence = params?.with_confidence !== false;
  if (!metric) return { error: "РџР°СЂР°РјРµС‚СЂ metric РѕР±СЏР·Р°С‚РµР»РµРЅ." };

  const source = dataStore.getForecastSeries(metric, filters);
  if (source?.error) return source;
  const history = source.series || [];
  if (history.length < 3) {
    return { error: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РёСЃС‚РѕСЂРёС‡РµСЃРєРёС… С‚РѕС‡РµРє РґР»СЏ РїСЂРѕРіРЅРѕР·Р°: ${history.length}. РўСЂРµР±СѓРµС‚СЃСЏ РјРёРЅРёРјСѓРј 3.` };
  }

  const pyOut = callPythonForecast({
    series: history,
    horizon,
    method,
    with_confidence: withConfidence,
  });
  if (!pyOut?.ok) {
    return { error: pyOut?.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕСЃС‚СЂРѕРёС‚СЊ РїСЂРѕРіРЅРѕР·." };
  }

  const artifacts = buildForecastArtifacts(
    source.meta?.metricLabel || metric,
    source.meta?.unit || "",
    withConfidence,
    pyOut.series_history || history,
    pyOut.series_forecast || []
  );

  return {
    ok: true,
    forecast: {
      metric,
      horizon,
      methodRequested: method,
      model_info: pyOut.model_info || {},
      quality: pyOut.quality || {},
      forecastLatencyMs: Date.now() - startedAt,
      series_history: pyOut.series_history || history,
      series_forecast: pyOut.series_forecast || [],
      meta: source.meta || {},
    },
    artifacts: [artifacts.chart, artifacts.table],
  };
}

const EXECUTORS = {
  get_kpis: executeGetKpis,
  get_diagnostics_summary: executeGetDiagnosticsSummary,
  forecast_metric: executeForecastMetric,
  query_data: executeQueryData,
  compute: executeCompute,
  build_table: executeBuildTable,
  build_chart: executeBuildChart,
  search_equipment: executeSearchEquipment,
};

function executeTool(name, params) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `РРЅСЃС‚СЂСѓРјРµРЅС‚ "${name}" РЅРµ РЅР°Р№РґРµРЅ.` };
  try {
    return fn(params || {});
  } catch (e) {
    return { error: `РћС€РёР±РєР° РёРЅСЃС‚СЂСѓРјРµРЅС‚Р° ${name}: ${String(e.message || e).slice(0, 300)}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
};



