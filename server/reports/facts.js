"use strict";

const Diagnostics = require("../../js/toir-diagnostics");

function safeShare(num, denom) {
  if (!denom) return 0;
  return Number(num) / Number(denom);
}

function median(values) {
  const sorted = (values || [])
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function buildPersonnelFactSummary(rawData) {
  const po = rawData && rawData.personnelOrgUsage;
  if (!po || typeof po !== "object") return {};
  const metaIn = po.meta || {};
  const stripOrg = (o) => ({
    organization: o.organization != null ? String(o.organization) : "",
    employees: round2(o.employees),
    fact_h: round2(o.fact_h),
    plan_h: round2(o.plan_h),
    utilization_pct: round2(o.utilization_pct),
  });
  const stripDept = (d) => ({
    organization: d.organization != null ? String(d.organization) : "",
    department: d.department != null ? String(d.department) : "",
    employees: round2(d.employees),
    fact_h: round2(d.fact_h),
    plan_h: round2(d.plan_h),
    utilization_pct: round2(d.utilization_pct),
  });
  const organizations = (po.organizations || [])
    .map(stripOrg)
    .filter((r) => r.organization || r.plan_h || r.fact_h);
  const departments = (po.departments || [])
    .map(stripDept)
    .filter((r) => r.department || r.plan_h || r.fact_h)
    .sort((a, b) => (b.plan_h || 0) - (a.plan_h || 0));
  return {
    meta: {
      organizations_count: Number(metaIn.organizations_count) || organizations.length,
      departments_count: Number(metaIn.departments_count) || departments.length,
      employees_count: Number(metaIn.employees_count) || 0,
    },
    organizations,
    departments_top: departments.slice(0, 12),
  };
}

function paretoBy(items, valueKey) {
  const arr = (items || [])
    .map((r) => Object.assign({}, r))
    .filter((r) => Number(r[valueKey]) > 0)
    .sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const total = arr.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  if (!arr.length || total <= 0) {
    return { grouped: [], top80: [], share80: 0, total: 0 };
  }
  let cum = 0;
  const grouped = arr.map((r) => {
    cum += Number(r[valueKey]) || 0;
    return Object.assign({}, r, {
      cum_perc: cum / total,
      share: Number(r[valueKey]) / total,
    });
  });
  let cutoff = grouped.findIndex((r) => r.cum_perc >= 0.8);
  if (cutoff < 0) cutoff = grouped.length - 1;
  return {
    grouped,
    top80: grouped.slice(0, cutoff + 1),
    share80: (cutoff + 1) / grouped.length,
    total,
  };
}

function periodLabel(period) {
  if (period === "h1") return "1-е полугодие 2025";
  if (period === "h2") return "2-е полугодие 2025";
  return "12 мес.";
}

function buildSnapshot(rawData, filters) {
  const f = filters || {};
  const period = f.period || "all";
  const classFilter = f.class || "__all__";
  const meta = (rawData && rawData.meta) || {};
  return {
    source_name: meta.source || "",
    period_label: periodLabel(period),
    period: period,
    class_filter: classFilter,
    date_start: null,
    date_end: null,
    selected_filters: { period, class: classFilter },
    raw_data_signature: meta.period || "",
    organization: meta.organization || "",
  };
}

function serializeDiagnostic(diag, options) {
  const includeEvidence = !!(options && options.includeEvidence);
  const evidenceRowLimit = (options && options.evidenceRowLimit) || 5;
  const out = {
    id: diag.id,
    title: diag.title,
    status: diag.status,
    confidence: diag.confidence || "medium",
    summary: diag.summary,
    recommendation: diag.recommendation,
    evidence_notes: Array.isArray(diag.evidence_notes) ? diag.evidence_notes : [],
  };
  if (Array.isArray(diag.confidence_metrics) && diag.confidence_metrics.length) {
    out.confidence_metrics = diag.confidence_metrics.slice(0, 4);
  } else {
    out.confidence_metrics = [];
  }
  if (Array.isArray(diag.explanation) && diag.explanation.length) {
    out.explanation = diag.explanation.slice(0, 8);
  } else {
    out.explanation = [];
  }
  if (diag.warning) out.warning = diag.warning;
  if (includeEvidence && diag.evidence) {
    const ev = diag.evidence;
    if (ev.type === "table") {
      out.evidence = {
        type: "table",
        title: ev.title,
        columns: ev.columns,
        rows: Array.isArray(ev.rows) ? ev.rows.slice(0, evidenceRowLimit) : [],
      };
    } else if (ev.type === "chart") {
      out.evidence = {
        type: "chart",
        chartType: ev.chartType,
        title: ev.title,
        categories: ev.categories,
        series: ev.series,
      };
    }
  }
  return out;
}

function buildFactPack(rawData, filters) {
  const f = filters || {};
  const period = f.period || "all";
  const classFilter = f.class || "__all__";
  const meta = (rawData && rawData.meta) || {};

  const ctx = Diagnostics.applyFilters(rawData || {}, { period, class: classFilter });

  const totalCost = ctx.equipmentCosts.reduce((s, r) => s + (r.total || 0), 0);
  const totalDowntime = ctx.ktg.reduce((s, r) => s + (r.total_downtime_h || 0), 0);
  const totalDefects = Math.round(ctx.defects.reduce((s, r) => s + (r.count || 0), 0));
  const equipmentCount = ctx.equipmentCosts.length;

  const ktgValues = ctx.ktg.map((r) => r.avg_ktg).filter((v) => Number.isFinite(v) && v > 0);
  const avgKtg = ktgValues.length ? ktgValues.reduce((a, b) => a + b, 0) / ktgValues.length : null;
  const mtbfValues = ctx.mtbf.map((r) => r.mtbf_h).filter((v) => v > 0);
  const avgMtbf = mtbfValues.length ? mtbfValues.reduce((a, b) => a + b, 0) / mtbfValues.length : null;
  const mttrValues = ctx.mttr.map((r) => r.mttr_h).filter((v) => v > 0);
  const avgMttr = mttrValues.length ? mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length : null;

  const kpis = {
    total_cost: Math.round(totalCost),
    total_downtime_h: Math.round(totalDowntime * 10) / 10,
    total_defects: totalDefects,
    equipment_count: equipmentCount,
    avg_ktg: avgKtg !== null ? Math.round(avgKtg * 10) / 10 : null,
    avg_mtbf_h: avgMtbf !== null ? Math.round(avgMtbf * 10) / 10 : null,
    avg_mttr_h: avgMttr !== null ? Math.round(avgMttr * 10) / 10 : null,
    period_fraction: ctx.periodFraction,
  };

  const monthlyTrend = ctx.costsMonthly.map((r) => ({
    month: r.month,
    total: Math.round(r.total),
  }));

  const topCostObjects = ctx.equipmentCosts
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((r) => ({ name: r.name, class: r.class, total: Math.round(r.total) }));

  const topDowntimeObjects = ctx.ktg
    .filter((r) => r.total_downtime_h > 0)
    .sort((a, b) => b.total_downtime_h - a.total_downtime_h)
    .slice(0, 10)
    .map((r) => ({
      name: r.name,
      class: r.class,
      total_downtime_h: Math.round(r.total_downtime_h * 10) / 10,
      avg_ktg: Number.isFinite(r.avg_ktg) ? Math.round(r.avg_ktg * 10) / 10 : null,
    }));

  const paretoCost = paretoBy(ctx.equipmentCosts, "total");
  const paretoDowntime = paretoBy(ctx.ktg, "total_downtime_h");

  const failureCausesTop = ctx.failureCauses
    .filter((r) => r.cause && r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((r) => ({ cause: r.cause, count: r.count }));

  const mtbfTop = ctx.mtbf
    .filter((r) => r.mtbf_h > 0)
    .sort((a, b) => a.mtbf_h - b.mtbf_h)
    .slice(0, 10)
    .map((r) => ({ equipment: r.equipment, class: r.class, mtbf_h: Math.round(r.mtbf_h * 10) / 10 }));

  const mttrTop = ctx.mttr
    .filter((r) => r.mttr_h > 0)
    .sort((a, b) => b.mttr_h - a.mttr_h)
    .slice(0, 10)
    .map((r) => ({ equipment: r.equipment, class: r.class, mttr_h: Math.round(r.mttr_h * 10) / 10 }));

  const classMap = new Map();
  function ensureClass(cls) {
    if (!classMap.has(cls)) {
      classMap.set(cls, {
        class: cls,
        equipment_count: 0,
        total_cost: 0,
        total_downtime_h: 0,
        total_defects: 0,
        ktg_sum: 0,
        ktg_n: 0,
      });
    }
    return classMap.get(cls);
  }
  ctx.equipmentCosts.forEach((r) => {
    const a = ensureClass(r.class);
    a.equipment_count += 1;
    a.total_cost += r.total;
  });
  ctx.defects.forEach((r) => {
    ensureClass(r.class).total_defects += r.count;
  });
  ctx.ktg.forEach((r) => {
    const a = ensureClass(r.class);
    a.total_downtime_h += r.total_downtime_h;
    if (Number.isFinite(r.avg_ktg) && r.avg_ktg > 0) {
      a.ktg_sum += r.avg_ktg;
      a.ktg_n += 1;
    }
  });
  const classSummary = [...classMap.values()]
    .map((a) => ({
      class: a.class,
      equipment_count: a.equipment_count,
      total_cost: Math.round(a.total_cost),
      total_downtime_h: Math.round(a.total_downtime_h * 10) / 10,
      total_defects: Math.round(a.total_defects),
      avg_ktg: a.ktg_n ? Math.round((a.ktg_sum / a.ktg_n) * 10) / 10 : null,
      cost_share: safeShare(a.total_cost, totalCost),
      defect_share: safeShare(a.total_defects, totalDefects || 1),
    }))
    .sort((a, b) => b.total_cost - a.total_cost);

  const equipNames = new Set(ctx.equipmentCosts.map((r) => r.name));
  const ktgNames = new Set(ctx.ktg.map((r) => r.name));
  const defectsNames = new Set(ctx.defects.map((r) => r.name));
  const allNames = new Set([...equipNames, ...ktgNames, ...defectsNames]);
  const objectsTotal = allNames.size;
  const noKtg = [...allNames].filter((n) => !ktgNames.has(n)).length;
  const noCosts = [...allNames].filter((n) => !equipNames.has(n)).length;
  const noDefects = [...allNames].filter((n) => !defectsNames.has(n)).length;
  const diagnostics = Diagnostics.analyzeAll(rawData, { period, class: classFilter });

  const dataLimitedIds = ["R6", "R9", "R14", "R15", "R16"];
  const unsupportedCount = diagnostics.filter(
    (d) => d.status === Diagnostics.STATUS.INSUFFICIENT && dataLimitedIds.includes(d.id)
  ).length;
  const qualitySummary = {
    objects_total: objectsTotal,
    objects_no_ktg: noKtg,
    objects_no_costs: noCosts,
    objects_no_defects: noDefects,
    diagnostics_unsupported_count: unsupportedCount,
    diagnostics_unsupported_reason:
      unsupportedCount > 0
        ? `${unsupportedCount} правил опираются на атрибуты, которых нет в агрегированном наборе ` +
          "(подразделение, дисциплина ремонта, раздельная экономика «ремонт vs потери», поля RCA на уровне инцидента). " +
          "Гипотезы R7, R8, R11 и R17 считаются по таблице repairEvents (ремонты с датами из листа «Наработка на отказ»)."
        : "Ограничений по недостающим атрибутам не зафиксировано.",
  };
  const diagSummary = Diagnostics.summarize(diagnostics);
  const triggered = diagnostics.filter((d) => d.status === Diagnostics.STATUS.TRIGGERED);
  const insufficient = diagnostics.filter((d) => d.status === Diagnostics.STATUS.INSUFFICIENT);

  const diagnosticsSummary = {
    summary: diagSummary,
    triggered: triggered.map((d) => serializeDiagnostic(d, { includeEvidence: true })),
    insufficient: insufficient.map((d) => serializeDiagnostic(d, { includeEvidence: false })),
    all: diagnostics.map((d) => serializeDiagnostic(d, { includeEvidence: false })),
  };

  const objectsMap = new Map();
  function ensureObject(name, cls) {
    if (!objectsMap.has(name)) {
      objectsMap.set(name, {
        name,
        class: cls,
        cost: 0,
        downtime_h: 0,
        defects: 0,
        avg_ktg: null,
      });
    }
    return objectsMap.get(name);
  }
  ctx.equipmentCosts.forEach((r) => {
    const o = ensureObject(r.name, r.class);
    o.cost = r.total;
  });
  ctx.ktg.forEach((r) => {
    const o = ensureObject(r.name, r.class);
    o.downtime_h = r.total_downtime_h;
    o.avg_ktg = Number.isFinite(r.avg_ktg) ? r.avg_ktg : null;
  });
  ctx.defects.forEach((r) => {
    const o = ensureObject(r.name, r.class);
    o.defects = r.count;
  });
  const objs = [...objectsMap.values()];
  const maxCost = Math.max(1, ...objs.map((o) => o.cost));
  const maxDowntime = Math.max(1, ...objs.map((o) => o.downtime_h));
  const maxDefects = Math.max(1, ...objs.map((o) => o.defects));
  const topProblemObjects = objs
    .map((o) => ({
      name: o.name,
      class: o.class,
      cost: Math.round(o.cost),
      downtime_h: Math.round(o.downtime_h * 10) / 10,
      defects: Math.round(o.defects),
      avg_ktg: o.avg_ktg !== null ? Math.round(o.avg_ktg * 10) / 10 : null,
      score: Math.round(((o.cost / maxCost) + (o.downtime_h / maxDowntime) + (o.defects / maxDefects)) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const personnelSummary = buildPersonnelFactSummary(rawData);

  const snapshotSummary = {
    source_name: meta.source || "",
    period: period,
    period_label: periodLabel(period),
    class_filter: classFilter,
    months_count: ctx.monthsCount,
    period_fraction: ctx.periodFraction,
    selected_filters: { period, class: classFilter },
    organization: meta.organization || "",
    period_full: meta.period || "",
  };

  return {
    snapshot_summary: snapshotSummary,
    kpis,
    monthly_trend: monthlyTrend,
    top_cost_objects: topCostObjects,
    top_downtime_objects: topDowntimeObjects,
    pareto_cost_objects: {
      share_80: paretoCost.share80,
      total: Math.round(paretoCost.total),
      top_80: paretoCost.top80.slice(0, 10).map((r) => ({
        name: r.name,
        class: r.class,
        total: Math.round(r.total),
        share: r.share,
      })),
    },
    pareto_downtime_objects: {
      share_80: paretoDowntime.share80,
      total: Math.round(paretoDowntime.total * 10) / 10,
      top_80: paretoDowntime.top80.slice(0, 10).map((r) => ({
        name: r.name,
        class: r.class,
        total_downtime_h: Math.round(r.total_downtime_h * 10) / 10,
        share: r.share,
      })),
    },
    failure_causes_top: failureCausesTop,
    mtbf_top: mtbfTop,
    mttr_top: mttrTop,
    class_summary: classSummary,
    personnel_summary: personnelSummary,
    quality_summary: qualitySummary,
    diagnostics_summary: diagnosticsSummary,
    top_problem_objects: topProblemObjects,
  };
}

module.exports = {
  buildFactPack,
  buildSnapshot,
  serializeDiagnostic,
};
