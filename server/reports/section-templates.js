"use strict";

const config = require("./config");

function sourceFilesPhrase(sourceName) {
  const s = String(sourceName || "").trim();
  if (!s) return "агрегированного источника";
  const m = s.match(/^(\d+)\s+/);
  if (m) return `${m[1]} отчётных файлов`;
  return `источника **${s}**`;
}

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
  const k = factPack.kpis || {};
  const org = snap.organization || "организации";
  /* В тексте паспорта показываем срез дашборда (period_label), а не meta.period выгрузки —
     иначе при фильтре «1-е полугодие» в абзаце остаётся полный год из исходных файлов. */
  const periodNarrative = snap.period_label || "—";
  const sourceCoverage = (snap.period_full && String(snap.period_full).trim()) || "";
  const filesPhrase = sourceFilesPhrase(snap.source_name);
  const months = snap.months_count != null ? snap.months_count : 12;
  const classFilter = snap.class_filter;
  const classBrief =
    classFilter && String(classFilter).trim() && classFilter !== "__all__"
      ? String(classFilter).trim()
      : "все классы";
  const sourceSpanNote =
    sourceCoverage && sourceCoverage !== periodNarrative
      ? ` Объединённый набор исходных отчётов по календарю охватывает **${sourceCoverage}**; показатели в документе посчитаны для выбранного среза.`
      : "";
  const body =
    `Отчёт охватывает деятельность по техническому обслуживанию и ремонту в **${org}** ` +
    `за период **${periodNarrative}**. Анализ базируется на данных из ${filesPhrase}, ` +
    `охватывающих **${fmtNum(k.equipment_count)} единиц** оборудования в выбранном срезе.` +
    sourceSpanNote;
  return {
    section_id: "passport",
    title: "Паспорт отчёта и контекст среза",
    body_markdown: body,
    fact_bullets: [
      `Период: ${snap.period_label || "—"} (${months} мес.).`,
      `Класс оборудования (срез): ${classBrief}.`,
      `Количество оборудования: ${fmtNum(k.equipment_count)} ед.`,
      `Общие затраты: ${fmtMoney(k.total_cost)} руб.`,
      `Суммарный простой: ${fmtHours(k.total_downtime_h)} ч.`,
    ],
    evidence_refs: ["snapshot_summary"],
    confidence: "high",
    warnings: [],
    mandatory: true,
  };
}

function buildExecutiveSummarySection(factPack) {
  const k = factPack.kpis || {};
  const snapSum = factPack.snapshot_summary || {};
  const k1 = findTriggered(factPack.diagnostics_summary, ["K1"])[0];
  const r18 = findTriggered(factPack.diagnostics_summary, ["R18"])[0];
  const k3 = findTriggered(factPack.diagnostics_summary, ["K3"])[0];

  const classScopeLine =
    snapSum.class_filter && snapSum.class_filter !== "__all__"
      ? `Данное резюме относится к классу оборудования **«${String(snapSum.class_filter)}»** в выбранном периоде. `
      : "";

  const ktgLine =
    k.avg_ktg !== null
      ? k.avg_ktg < 90
        ? `Текущее состояние ТОиР характеризуется низкой эффективностью использования оборудования: **средний КТГ по парку ${k.avg_ktg}%** (целевой ориентир — 90%).`
        : `Средний **КТГ по парку ${k.avg_ktg}%** на уровне или выше типового целевого ориентира (90%), однако отдельные объекты и участки парка могут оставаться в зоне риска.`
      : "Текущее состояние ТОиР оцените по доступным KPI; данных КТГ в срезе недостаточно.";
  const topCostNames = new Set((factPack.top_cost_objects || []).slice(0, 5).map((r) => r.name));
  const byDefects = [...(factPack.top_problem_objects || [])].sort((a, b) => (b.defects || 0) - (a.defects || 0));
  const topDefectNames = new Set(byDefects.slice(0, 5).map((o) => o.name));
  let overlap = 0;
  topCostNames.forEach((n) => {
    if (topDefectNames.has(n)) overlap += 1;
  });
  const mismatchLine =
    topCostNames.size && topDefectNames.size
      ? overlap <= 1
        ? "Затраты и простои распределены неравномерно; **топ-5 объектов по затратам не совпадает с топ-5 по числу отказов**."
        : `Затраты и простои распределены неравномерно; пересечение топ-5 по затратам и по отказам — **${overlap}** объект(ов).`
      : "Затраты и простои распределены неравномерно.";

  const corrLine =
    "При этом **слабая корреляция** между частотой отказов и финансовыми потерями типична для парка с редкими дорогими инцидентами.";

  const r18Line = r18
    ? `Основные потери генерируются редкими, но дорогостоящими инцидентами (${r18.summary}) — требуется **риск-ориентированный** подход вместо фокуса только на числе ремонтов.`
    : "Имеет смысл проверить, не концентрируются ли потери в редких дорогостоящих случаях вопреки частоте отказов.";

  const chunks = [];
  if (classScopeLine) chunks.push(classScopeLine.trim());
  chunks.push(ktgLine);
  if (k1) chunks.push(k1.summary);
  chunks.push(mismatchLine, corrLine, r18Line);
  if (k3) chunks.push(k3.summary);
  const body = chunks.join(" ");

  const factBullets = [`Средний КТГ по парку: ${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}.`];
  if (topCostNames.size && topDefectNames.size) {
    factBullets.push(
      overlap <= 1
        ? "Топ-5 объектов по затратам не совпадают с топ-5 по количеству отказов."
        : `Пересечение топ-5 по затратам и по отказам: ${overlap} объект(ов).`
    );
  }
  if (k3) {
    factBullets.push(`Диагностика K3 (длительные ремонты): ${k3.summary}`);
  } else {
    const slow = (factPack.mttr_top || []).filter((r) => (r.mttr_h || 0) > 50).length;
    if (slow) factBullets.push(`Объектов с СВР выше 50 ч в топе: ${slow}.`);
  }

  const evidenceRefs = ["kpis", "top_cost_objects", "top_problem_objects"];
  if (r18) evidenceRefs.push("diagnostics:R18");
  if (k1) evidenceRefs.push("diagnostics:K1");
  if (k3) evidenceRefs.push("diagnostics:K3");

  return {
    section_id: "executive_summary",
    title: "Короткий вывод для руководителя",
    body_markdown: body,
    fact_bullets: factBullets,
    evidence_refs: evidenceRefs,
    confidence: k.avg_ktg !== null && factBullets.length >= 2 ? "high" : "medium",
    warnings: [
      "Отсутствие в источнике полного среза по персоналу и детализированных связей «отказ — простой — ущерб» ограничивает глубину управленческих выводов.",
    ],
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
    confidence: trend.length >= 6 && k.total_cost > 0 ? "high" : baseConfidence(Math.max(1, trend.length) * 3),
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
    confidence:
      (factPack.top_cost_objects || []).length >= 5 && pareto.share_80 > 0 ? "high" : baseConfidence((factPack.top_cost_objects || []).length * 3),
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
    `средний СВР — **${fmtHours(k.avg_mttr_h)} ч**.\n\n` +
    `По причинам отказов лидируют: ${causesText}.\n\n` +
    `Самые ненадёжные объекты по СННО (наработка на отказ): ${mtbfText}.\n\n` +
    `Самые медленные ремонты (СВР): ${mttrText}.`;
  const warnings = [];
  if (k1) warnings.push(`K1: ${k1.summary}`);
  if (k2) warnings.push(`K2: ${k2.summary}`);
  if (k3) warnings.push(`K3: ${k3.summary}`);
  if (r12) warnings.push(`R12: ${r12.summary}`);
  if (r13) warnings.push(`R13: ${r13.summary}`);
  return {
    section_id: "reliability",
    title: "Надёжность: КТГ, СННО, СВР и причины отказов",
    body_markdown: body,
    fact_bullets: [
      `Средний КТГ: ${k.avg_ktg !== null ? k.avg_ktg + "%" : "н/д"}.`,
      `Средний СННО: ${fmtHours(k.avg_mtbf_h)} ч.`,
      `Средний СВР: ${fmtHours(k.avg_mttr_h)} ч.`,
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
    confidence: "medium",
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
        `В текущем источнике toir.json нет блоков personnelUsage / personnelOrgUsage — ` +
        `они собираются тем же скриптом analyze_toir из отчётов «Использование персонала» и «Анализ использования персонала», если файлы лежат в data/.\n\n` +
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

function buildPersonnelByDepartmentSection(factPack) {
  const ps = factPack.personnel_summary || {};
  const dept = ps.departments_top || [];
  if (!dept.length) {
    return {
      section_id: "personnel_by_department",
      title: "Использование персонала по подразделениям",
      body_markdown:
        "В фактовом пакете нет агрегированной разбивки по подразделениям (блок personnelOrgUsage.departments). " +
        "Пересоберите toir.json при наличии выгрузки «Анализ использования персонала организация».",
      fact_bullets: ["В срезе нет сводки departments_top для подразделений."],
      evidence_refs: ["personnel_summary"],
      confidence: "low",
      warnings: [
        "Нельзя сформировать содержательный раздел без агрегатов по подразделениям в источнике.",
      ],
      mandatory: false,
    };
  }
  const topN = dept.slice(0, 8);
  const lines = topN.map((d) => {
    const pct = d.utilization_pct != null ? `${fmtNum(d.utilization_pct)}%` : "—";
    return (
      `- **${d.department || "н/д"}** (${d.organization || "—"}): факт **${fmtHours(d.fact_h)}** ч, ` +
      `план **${fmtHours(d.plan_h)}** ч, выполнение **${pct}**, сотрудников: **${fmtNum(d.employees)}**.`
    );
  });
  const body =
    `Крупнейшие подразделения по объёму плановых часов в выгрузке (топ-${topN.length}).\n\n` + lines.join("\n");
  return {
    section_id: "personnel_by_department",
    title: "Использование персонала по подразделениям",
    body_markdown: body,
    fact_bullets: dept.slice(0, 3).map((d) => {
      const pct = d.utilization_pct != null ? `${fmtNum(d.utilization_pct)}%` : "—";
      return `${d.department || "н/д"}: факт ${fmtHours(d.fact_h)} ч / план ${fmtHours(d.plan_h)} ч (${pct}).`;
    }),
    evidence_refs: ["personnel_summary"],
    confidence: baseConfidence(dept.length * 3),
    warnings: [],
    mandatory: false,
  };
}

function buildDataLimitationsSection(factPack) {
  const q = factPack.quality_summary || {};
  const unsupported = q.diagnostics_unsupported_count != null ? q.diagnostics_unsupported_count : 9;
  const body =
    `Анализ ограничен отсутствием детализированной истории инцидентов ` +
    `(привязка простоев к конкретным отказам, журналы нарядов, стоимость часа простоя). ` +
    `Это снижает возможности глубокого RCA и точной оценки экономической целесообразности ремонтов.\n\n` +
    `**${unsupported}** из 18 диагностических правил не применимы на текущем агрегате из‑за нехватки событийных атрибутов в источнике. ` +
    `В факт-пакете отчёта нет свода по трудозатратам персонала; отсутствует единая **стоимость часа простоя** для расчёта экономического ущерба.`;
  return {
    section_id: "data_limitations",
    title: "Ограничения данных и надёжность выводов",
    body_markdown: body,
    fact_bullets: [
      `${unsupported} из 18 диагностических правил не применимы из-за отсутствия событийной истории в нужном виде.`,
      "Нет данных по трудозатратам персонала в факт-пакете.",
      "Отсутствует стоимость часа простоя для расчёта экономического ущерба.",
    ],
    evidence_refs: ["quality_summary", "diagnostics_summary"],
    confidence: "medium",
    warnings: [
      "Снижена уверенность в выводах, касающихся эффективности ремонтных бригад и экономической целесообразности восстановления.",
    ],
    mandatory: true,
  };
}

function buildPriorityActionsSection(factPack) {
  const triggered = (factPack.diagnostics_summary && factPack.diagnostics_summary.triggered) || [];
  const preferredOrder = ["R18", "K1", "K3"];
  const byId = new Map(triggered.map((d) => [d.id, d]));
  const actions = [];
  preferredOrder.forEach((id) => {
    const d = byId.get(id);
    if (d) actions.push(`**${d.id}.** ${d.recommendation}`);
  });
  triggered.forEach((d) => {
    if (preferredOrder.indexOf(d.id) === -1) actions.push(`**${d.id}.** ${d.recommendation}`);
  });
  let finalActions = actions;
  if (!finalActions.length) {
    finalActions = [
      "Сделать точечный разбор верхних объектов по затратам и подтвердить, какие из них реально формируют производственный риск.",
      "Проверить объекты с низким КТГ и оценить, устранены ли коренные причины частых простоев.",
      "Не принимать дорогих решений до улучшения заполненности экономических и причинных полей.",
    ];
  }
  const numbered = finalActions.slice(0, 5).map((a, i) => `${i + 1}. ${a}`).join("\n");
  return {
    section_id: "priority_actions",
    title: "Приоритетные управленческие действия",
    body_markdown: numbered,
    fact_bullets: finalActions.slice(0, 5),
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
    personnel_by_department: buildPersonnelByDepartmentSection,
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
  buildPersonnelByDepartmentSection,
  buildDataLimitationsSection,
  buildPriorityActionsSection,
};
