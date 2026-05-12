"use strict";

const config = require("./config");

function fmtPct(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function fmtMoney(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("ru-RU");
}

function fmtHours(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

function fmtNum(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("ru-RU");
}

function baseConfidence(rowCount) {
  if (rowCount >= 30) return "high";
  if (rowCount >= 10) return "medium";
  return "low";
}

function safeFirst(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : {};
}

function findTriggered(diagnosticsSummary, ids) {
  const triggered = (diagnosticsSummary && diagnosticsSummary.triggered) || [];
  return triggered.filter((d) => ids.indexOf(d.id) !== -1);
}

function buildPassportSection(factPack) {
  const snap = factPack.snapshot_summary || {};
  const filtersText =
    `период: ${snap.period_label || "12 мес."}` +
    `, класс: ${snap.class_filter && snap.class_filter !== "__all__" ? snap.class_filter : "все классы"}`;
  const body =
    `Отчёт зафиксирован как снимок текущего среза по источнику **${snap.source_name || "—"}**. ` +
    `Повторное открытие отчёта не пересчитывает данные автоматически.\n\n` +
    `Период анализа: **${snap.period_full || snap.period_label || "—"}**.\n\n` +
    `Активные фильтры: ${filtersText}.\n\n` +
    `Организация: ${snap.organization || "—"}.`;
  return {
    section_id: "passport",
    title: "Паспорт отчёта и контекст среза",
    body_markdown: body,
    fact_bullets: [
      `Источник: ${snap.source_name || "—"}.`,
      `Период: ${snap.period_label || "—"} (доля от года ${fmtPct(snap.period_fraction)}).`,
      `Фильтр по классу: ${
        snap.class_filter && snap.class_filter !== "__all__" ? snap.class_filter : "все классы"
      }.`,
    ],
    evidence_refs: ["snapshot_summary"],
    confidence: "high",
    warnings: [],
    mandatory: true,
  };
}

function buildExecutiveSummarySection(factPack) {
  const k = factPack.kpis || {};
  const ds = factPack.diagnostics_summary || {};
  const triggered = (ds.triggered || []).slice();
  const topCost = safeFirst(factPack.top_cost_objects);
  const diagSentence = triggered.length
    ? "Сработали ключевые автодиагностики: " +
      triggered
        .slice(0, 2)
        .map((d) => `**${d.id}** — ${d.summary}`)
        .join("; ")
    : "Сильных автодиагностик по текущим порогам не сработало.";
  const body =
    `В текущем срезе зафиксировано **${fmtNum(k.total_defects)} отказов** ` +
    `на **${fmtNum(k.equipment_count)} единиц оборудования** с общим бюджетом ТОиР ` +
    `**${fmtMoney(k.total_cost)} руб.**. ` +
    `Лидер по затратам сейчас — **${topCost.name || "н/д"}** (${fmtMoney(topCost.total)} руб.).\n\n` +
    `${diagSentence}\n\n` +
    `Средний КТГ по парку — **${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}**, ` +
    `средний СННО — **${fmtHours(k.avg_mtbf_h)} ч**, ` +
    `средний СВВ — **${fmtHours(k.avg_mttr_h)} ч**. ` +
    `Руководителю нужен фокус не только на снижении затрат, но и на повышении надёжности у проблемных объектов.`;
  return {
    section_id: "executive_summary",
    title: "Короткий вывод для руководителя",
    body_markdown: body,
    fact_bullets: [
      `Затраты ТОиР: ${fmtMoney(k.total_cost)} руб.`,
      `Отказов: ${fmtNum(k.total_defects)}.`,
      `Сработавших гипотез: ${triggered.length}.`,
      `Средний КТГ: ${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}.`,
    ],
    evidence_refs: ["kpis", "diagnostics_summary", "top_cost_objects"],
    confidence: baseConfidence(k.equipment_count || 0),
    warnings: [],
    mandatory: false,
  };
}

function buildCostsAndTrendSection(factPack) {
  const k = factPack.kpis || {};
  const trend = factPack.monthly_trend || [];
  const total = trend.reduce((s, r) => s + (r.total || 0), 0);
  const sorted = [...trend].sort((a, b) => b.total - a.total);
  const peak = safeFirst(sorted);
  const peakShare = total > 0 ? peak.total / total : 0;
  const r5 = findTriggered(factPack.diagnostics_summary, ["R5"])[0];
  const body =
    `Срез показывает общий объём затрат ТОиР в **${fmtMoney(k.total_cost)} руб.** ` +
    `за **${trend.length} месяцев**. ` +
    `Пиковый месяц — **${peak.month || "н/д"}** ` +
    `с долей **${fmtPct(peakShare)}** от общего бюджета.\n\n` +
    `Для решений важна не только суммарная цифра, но и неравномерность по месяцам — ` +
    `она указывает либо на сезонность, либо на разовые крупные ремонты, ` +
    `которые не были запланированы.`;
  const warnings = r5
    ? [`R5 сработала: пик в ${fmtPct(peakShare)} от годового бюджета — стоит разобрать причины этого месяца.`]
    : [];
  return {
    section_id: "costs_and_trend",
    title: "Затраты ТОиР: масштаб и динамика",
    body_markdown: body,
    fact_bullets: [
      `Затраты за период: ${fmtMoney(k.total_cost)} руб.`,
      `Месяцев в тренде: ${trend.length}.`,
      `Пиковый месяц: ${peak.month || "н/д"} (${fmtMoney(peak.total)} руб., ${fmtPct(peakShare)}).`,
    ],
    evidence_refs: ["kpis", "monthly_trend", "diagnostics:R5"],
    confidence: baseConfidence(trend.length * 3),
    warnings,
    mandatory: false,
  };
}

function buildCostHotspotsSection(factPack) {
  const topCost = (factPack.top_cost_objects || []).slice(0, 5);
  const pareto = factPack.pareto_cost_objects || {};
  const r2 = findTriggered(factPack.diagnostics_summary, ["R2"])[0];
  const r3 = findTriggered(factPack.diagnostics_summary, ["R3"])[0];
  const r18 = findTriggered(factPack.diagnostics_summary, ["R18"])[0];
  const top1 = safeFirst(topCost);
  const top5Text = topCost.map((r) => `*${r.name}* (${fmtMoney(r.total)} руб.)`).join(", ") || "н/д";
  let body =
    `Затраты концентрируются на ограниченном наборе объектов. ` +
    `Лидер — **${top1.name || "н/д"}** с вкладом **${fmtMoney(top1.total)} руб.**. ` +
    `Топ-5 объектов: ${top5Text}.\n\n` +
    `80% затрат формируют примерно **${fmtPct(pareto.share_80)}** объектов, ` +
    `поэтому приоритизация должна идти не по числу позиций в реестре, ` +
    `а по концентрации затрат.`;
  if (r3) body += `\n\nДиагностика R3: ${r3.summary}`;
  if (r18) body += `\n\nДиагностика R18: ${r18.summary}`;
  const warnings = [];
  if (r2) warnings.push(`R2 сработала: ${r2.summary}`);
  return {
    section_id: "cost_hotspots",
    title: "Ключевые зоны затрат и проблемных объектов",
    body_markdown: body,
    fact_bullets: [
      `Топ-объект: ${top1.name || "н/д"} (${fmtMoney(top1.total)} руб.).`,
      `Доля объектов, формирующих 80% затрат: ${fmtPct(pareto.share_80)}.`,
      `Объектов с положительными затратами: ${(factPack.top_cost_objects || []).length}.`,
    ],
    evidence_refs: ["top_cost_objects", "pareto_cost_objects", "diagnostics:R2", "diagnostics:R3", "diagnostics:R18"],
    confidence: baseConfidence((factPack.top_cost_objects || []).length * 3),
    warnings,
    mandatory: false,
  };
}

function buildReliabilitySection(factPack) {
  const k = factPack.kpis || {};
  const causes = (factPack.failure_causes_top || []).slice(0, 5);
  const mtbfTop = (factPack.mtbf_top || []).slice(0, 3);
  const mttrTop = (factPack.mttr_top || []).slice(0, 3);
  const k1 = findTriggered(factPack.diagnostics_summary, ["K1"])[0];
  const k2 = findTriggered(factPack.diagnostics_summary, ["K2"])[0];
  const k3 = findTriggered(factPack.diagnostics_summary, ["K3"])[0];
  const r12 = findTriggered(factPack.diagnostics_summary, ["R12"])[0];
  const r13 = findTriggered(factPack.diagnostics_summary, ["R13"])[0];
  const causesText = causes.length
    ? causes.map((c) => `**${c.cause}** (${c.count})`).join(", ")
    : "распределение причин не выражено";
  const mtbfText = mtbfTop.length
    ? mtbfTop.map((r) => `*${r.equipment}* (${fmtHours(r.mtbf_h)} ч)`).join(", ")
    : "н/д";
  const mttrText = mttrTop.length
    ? mttrTop.map((r) => `*${r.equipment}* (${fmtHours(r.mttr_h)} ч)`).join(", ")
    : "н/д";
  const body =
    `Средний КТГ по парку — **${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}**, ` +
    `средний СННО — **${fmtHours(k.avg_mtbf_h)} ч**, ` +
    `средний СВВ — **${fmtHours(k.avg_mttr_h)} ч**.\n\n` +
    `По причинам отказов лидируют: ${causesText}.\n\n` +
    `Самые ненадёжные объекты по СННО (наработка на отказ): ${mtbfText}.\n\n` +
    `Самые медленные ремонты (СВВ): ${mttrText}.`;
  const warnings = [];
  if (k1) warnings.push(`K1: ${k1.summary}`);
  if (k2) warnings.push(`K2: ${k2.summary}`);
  if (k3) warnings.push(`K3: ${k3.summary}`);
  if (r12) warnings.push(`R12: ${r12.summary}`);
  if (r13) warnings.push(`R13: ${r13.summary}`);
  return {
    section_id: "reliability",
    title: "Надёжность: КТГ, СННО, СВВ и причины отказов",
    body_markdown: body,
    fact_bullets: [
      `Средний КТГ: ${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}.`,
      `Средний СННО: ${fmtHours(k.avg_mtbf_h)} ч.`,
      `Средний СВВ: ${fmtHours(k.avg_mttr_h)} ч.`,
      `Топ-причина отказов: ${causes[0] ? causes[0].cause : "н/д"}.`,
    ],
    evidence_refs: [
      "kpis",
      "failure_causes_top",
      "mtbf_top",
      "mttr_top",
      "diagnostics:K1",
      "diagnostics:K2",
      "diagnostics:K3",
      "diagnostics:R12",
      "diagnostics:R13",
    ],
    confidence: baseConfidence(causes.length + mtbfTop.length + mttrTop.length),
    warnings,
    mandatory: false,
  };
}

function buildPersonnelSection(factPack) {
  const ps = factPack.personnel_summary || {};
  const orgs = ps.organizations || [];
  if (!orgs.length) {
    return {
      section_id: "personnel",
      title: "Использование персонала",
      body_markdown:
        `В текущем источнике toir.json нет данных по использованию персонала — ` +
        `они подгружаются в дашборд из отдельных файлов (personnel_org_usage.json и др.) ` +
        `и в фактовый пакет отчёта на этом этапе не попадают.\n\n` +
        `Раздел оставлен в каталоге сознательно: его можно наполнить вручную, ` +
        `либо позже расширить facts.js, чтобы подтягивать сводку по подразделениям.`,
      fact_bullets: [
        "Данные по персоналу в фактовом пакете отсутствуют.",
        "Раздел можно наполнить вручную или удалить через AI-правку.",
      ],
      evidence_refs: ["personnel_summary"],
      confidence: "low",
      warnings: [
        "Без данных о трудозатратах нельзя оценить достаточность ресурсов на ремонты.",
      ],
      mandatory: false,
    };
  }
  const top = orgs[0];
  const utilization = (top.utilization_pct || 0) / 100;
  const body =
    `По данным об использовании персонала, в срезе участвует **${orgs.length} организаций**. ` +
    `Лидирует **${top.organization || "н/д"}** с фактом **${fmtHours(top.fact_h)} ч** ` +
    `при плане **${fmtHours(top.plan_h)} ч** ` +
    `(выполнение **${fmtPct(utilization)}**).`;
  return {
    section_id: "personnel",
    title: "Использование персонала",
    body_markdown: body,
    fact_bullets: orgs.slice(0, 3).map(
      (o) => `${o.organization}: факт ${fmtHours(o.fact_h)} ч / план ${fmtHours(o.plan_h)} ч.`
    ),
    evidence_refs: ["personnel_summary"],
    confidence: baseConfidence(orgs.length),
    warnings: [],
    mandatory: false,
  };
}

function buildDataLimitationsSection(factPack) {
  const q = factPack.quality_summary || {};
  const ds = factPack.diagnostics_summary || {};
  const insufficient = ds.insufficient || [];
  const body =
    `Надёжность выводов в этом отчёте зависит от того, насколько полно заполнены ключевые поля. ` +
    `Из ${q.objects_total || "—"} объектов в срезе у **${q.objects_no_ktg || 0}** нет данных КТГ, ` +
    `у **${q.objects_no_costs || 0}** нет затрат, ` +
    `у **${q.objects_no_defects || 0}** нет отказов.\n\n` +
    `Также **${q.diagnostics_unsupported_count || 9} автодиагностик** из 18 правил библиотеки expert-main ` +
    `помечены как «нет данных» — для них нужна event-level история инцидентов с датами, ` +
    `причинами и привязкой простоя к конкретному отказу. Сейчас в источнике хранятся только агрегаты, ` +
    `поэтому такие правила (повторные отказы 30–60 дней, сравнение по подразделениям, RCA-зрелость) ` +
    `не работают и их выводы недоступны.\n\n` +
    `Сильные управленческие решения лучше принимать там, где сигнал подтверждается одновременно ` +
    `и KPI, и автодиагностиками, и качественными полями.`;
  return {
    section_id: "data_limitations",
    title: "Ограничения данных и надёжность выводов",
    body_markdown: body,
    fact_bullets: [
      `Объектов без КТГ: ${q.objects_no_ktg || 0} из ${q.objects_total || "—"}.`,
      `Объектов без затрат: ${q.objects_no_costs || 0} из ${q.objects_total || "—"}.`,
      `Объектов без данных по отказам: ${q.objects_no_defects || 0} из ${q.objects_total || "—"}.`,
      `Диагностик без данных: ${insufficient.length}.`,
    ],
    evidence_refs: ["quality_summary", "diagnostics_summary"],
    confidence: "high",
    warnings: [],
    mandatory: true,
  };
}

function buildPriorityActionsSection(factPack) {
  const triggered = (factPack.diagnostics_summary && factPack.diagnostics_summary.triggered) || [];
  let actions;
  if (triggered.length) {
    actions = triggered.map((d) => `**${d.id}.** ${d.recommendation}`);
  } else {
    actions = [
      "Сделать точечный разбор верхних объектов по затратам и подтвердить, какие из них реально формируют производственный риск.",
      "Проверить объекты с низким КТГ и оценить, устранены ли коренные причины частых простоев.",
      "Не принимать дорогих решений до улучшения заполненности экономических и причинных полей.",
    ];
  }
  const numbered = actions.slice(0, 5).map((a, i) => `${i + 1}. ${a}`).join("\n");
  return {
    section_id: "priority_actions",
    title: "Приоритетные управленческие действия",
    body_markdown: numbered,
    fact_bullets: actions.slice(0, 5),
    evidence_refs: ["diagnostics_summary", "top_cost_objects", "top_problem_objects"],
    confidence: triggered.length ? "medium" : "low",
    warnings: triggered.length
      ? []
      : ["Сработавших гипотез нет — рекомендации сформулированы по общим эвристикам и требуют ручной валидации."],
    mandatory: false,
  };
}

function buildFallbackSections(factPack) {
  const builders = {
    passport: buildPassportSection,
    executive_summary: buildExecutiveSummarySection,
    costs_and_trend: buildCostsAndTrendSection,
    cost_hotspots: buildCostHotspotsSection,
    reliability: buildReliabilitySection,
    personnel: buildPersonnelSection,
    data_limitations: buildDataLimitationsSection,
    priority_actions: buildPriorityActionsSection,
  };
  return config.REPORT_SECTION_CATALOG.map((entry) => builders[entry.id](factPack));
}

module.exports = {
  buildFallbackSections,
  buildPassportSection,
  buildExecutiveSummarySection,
  buildCostsAndTrendSection,
  buildCostHotspotsSection,
  buildReliabilitySection,
  buildPersonnelSection,
  buildDataLimitationsSection,
  buildPriorityActionsSection,
};
