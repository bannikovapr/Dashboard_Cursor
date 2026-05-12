/* eslint-disable no-unused-vars */
/* Shared layout for HTML / Markdown / Word export. Node: CommonJS. Browser: window.__ReportExportLayout */
(function initExportLayout(factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== "undefined") {
    globalThis.__ReportExportLayout = factory();
  }
})(function reportExportLayoutFactory() {
  "use strict";

  function fmtDateRu(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return String(iso);
    }
  }

  const CONFIDENCE_LABELS = {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
  };

  function classLine(snap) {
    if (!snap || !snap.class_filter || snap.class_filter === "__all__") return "все классы";
    return String(snap.class_filter);
  }

  function buildExportLayout(doc_) {
    const snap = doc_.snapshot || {};
    const cls = classLine(snap);
    const sections = Array.isArray(doc_.sections) ? doc_.sections : [];
    const numbered = sections.map((s, i) =>
      Object.assign({}, s, {
        _num: i + 1,
        _anchor: `sec-${i + 1}`,
        _confidenceLabel: CONFIDENCE_LABELS[s.confidence] || s.confidence || "Средняя",
      })
    );

    const allRefs = [];
    numbered.forEach((s) => {
      (s.evidence_refs || []).forEach((r) => {
        if (r) allRefs.push(String(r));
      });
    });
    const uniqueRefs = Array.from(new Set(allRefs)).sort((a, b) => a.localeCompare(b, "ru"));

    const methodologyBullets = [
      `Источник данных: ${snap.source_name || "—"}.`,
      `Период среза: ${snap.period_label || snap.period || "—"}.`,
      `Фильтр по классу оборудования: ${cls}.`,
      `Идентификатор снимка данных: ${(snap.raw_data_signature || "").trim() || "не зафиксирован"}.`,
    ];
    if (snap.organization && String(snap.organization).trim()) {
      methodologyBullets.splice(3, 0, `Организация (из набора): ${snap.organization}.`);
    }

    const introductionParagraphs = [
      "Настоящий документ оформлен как самостоятельный аналитический отчёт по показателям технического обслуживания и ремонта (ТОиР). " +
        "Он предназначен для управленческих решений и фиксирует выводы на основе согласованного среза данных.",
      "Структура отчёта следует распространённой практике деловой аналитики: краткое резюме для руководителя, " +
        "описание охвата и методики, последовательное изложение результатов по темам, отдельный блок ограничений и достоверности, " +
        "завершающий список приоритетных действий и приложение с опорой на наборы данных.",
    ];

    return {
      title: doc_.title || "Отчёт ТОиР",
      documentKind: "Аналитический отчёт по показателям ТОиР",
      audienceNote:
        "Аудитория: руководители производства, главные инженеры, службы надёжности и ТОиР. " +
        "Формат позволяет передать смысл без привязки к экранным блокам дашборда.",
      preparedAtFormatted: fmtDateRu(doc_.updated_at),
      createdAtFormatted: fmtDateRu(doc_.created_at),
      reportId: doc_.report_id || "—",
      revisionCount: (doc_.revisions || []).length,
      methodologyBullets,
      introductionParagraphs,
      snapshot: {
        periodLabel: snap.period_label || snap.period || "—",
        classLabel: cls,
        sourceName: snap.source_name || "—",
        organization: (snap.organization && String(snap.organization).trim()) || "",
        signature: (snap.raw_data_signature && String(snap.raw_data_signature).trim()) || "",
      },
      numberedSections: numbered,
      toc: numbered.map((s) => ({ num: s._num, title: s.title || "Секция", anchor: s._anchor })),
      appendix: {
        title: "Приложение А. Метаданные и опора на данные",
        evidenceRefs: uniqueRefs,
        footerNote:
          "Ссылки вида «kpis», «monthly_trend» и т. п. указывают на фрагменты снимка toir.json, использованные при формировании секций.",
      },
    };
  }

  function fmtMoneyRu(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Math.round(Number(n)).toLocaleString("ru-RU");
  }

  /** @param {object|undefined|null} factPack */
  function buildFactPackPresentation(factPack) {
    const fp = factPack || {};
    const kpis = fp.kpis || {};
    const pf = kpis.period_fraction != null ? Number(kpis.period_fraction) : 1;
    const pfNote = pf > 0 && pf < 1 ? ` (срез ~${(pf * 100).toFixed(0)}% года)` : "";
    const kpisRows = [
      { k: "Суммарные затраты ТОиР, руб." + pfNote, v: fmtMoneyRu(kpis.total_cost) },
      {
        k: "Суммарный простой, ч",
        v: kpis.total_downtime_h != null ? String(kpis.total_downtime_h) : "—",
      },
      {
        k: "Отказы (агрегат), шт.",
        v: kpis.total_defects != null ? String(Math.round(kpis.total_defects)) : "—",
      },
      {
        k: "Единиц оборудования в срезе",
        v: kpis.equipment_count != null ? String(kpis.equipment_count) : "—",
      },
      { k: "Средний КТГ, %", v: kpis.avg_ktg !== null && kpis.avg_ktg !== undefined ? String(kpis.avg_ktg) : "—" },
      { k: "Среднее СННО, ч", v: kpis.avg_mtbf_h != null && kpis.avg_mtbf_h !== undefined ? String(kpis.avg_mtbf_h) : "—" },
      { k: "Среднее СВВ, ч", v: kpis.avg_mttr_h != null && kpis.avg_mttr_h !== undefined ? String(kpis.avg_mttr_h) : "—" },
    ];

    const monthly = (fp.monthly_trend || []).map((r) => ({
      month: r.month || "—",
      total: Number(r.total) || 0,
      vFmt: fmtMoneyRu(r.total),
    }));
    const maxMonthly = Math.max(1, ...monthly.map((r) => r.total));

    const topCosts = (fp.top_cost_objects || []).map((r) => ({
      name: r.name || "—",
      cls: r.class || "—",
      vFmt: fmtMoneyRu(r.total),
    }));

    const topDowntime = (fp.top_downtime_objects || []).map((r) => ({
      name: r.name || "—",
      downtimeFmt: r.total_downtime_h != null ? String(r.total_downtime_h) : "—",
      ktgFmt: r.avg_ktg != null && r.avg_ktg !== undefined ? String(r.avg_ktg) : "—",
    }));

    const causes = (fp.failure_causes_top || []).map((r) => ({
      cause: r.cause || "—",
      countFmt: r.count != null ? String(r.count) : "—",
    }));

    const classSummary = (fp.class_summary || []).map((r) => ({
      cls: r.class || "—",
      eq: String(r.equipment_count || 0),
      cost: fmtMoneyRu(r.total_cost),
      dow: r.total_downtime_h != null ? String(r.total_downtime_h) : "—",
      def: r.total_defects != null ? String(Math.round(r.total_defects)) : "—",
      ktg: r.avg_ktg !== null && r.avg_ktg !== undefined ? String(r.avg_ktg) : "—",
      cShare: r.cost_share != null ? `${(Number(r.cost_share) * 100).toFixed(1)}%` : "—",
    }));

    const problems = (fp.top_problem_objects || []).map((r) => ({
      name: r.name || "—",
      scoreFmt: r.score != null ? String(r.score) : "—",
      cost: fmtMoneyRu(r.cost),
      dow: r.downtime_h != null ? String(r.downtime_h) : "—",
      def: r.defects != null ? String(Math.round(r.defects)) : "—",
    }));

    const trig = (fp.diagnostics_summary && fp.diagnostics_summary.triggered) || [];
    const triggeredDiagnostics = (Array.isArray(trig) ? trig : []).map((d) => ({
      id: d.id || "—",
      summary: ((d.summary && String(d.summary)) || d.title || "—").slice(0, 280),
    }));

    const pareto = fp.pareto_cost_objects || {};
    let paretoLine = "";
    if (
      pareto.top_80 &&
      pareto.top_80.length &&
      pareto.share_80 != null &&
      pareto.total != null
    ) {
      paretoLine =
        `По затратам: ~80% суммы приходится на ${pareto.top_80.length} объект(ов); ` +
        `узкая доля парка (по количеству объектов с затратами) — около ${(Number(pareto.share_80) * 100).toFixed(0)}%; ` +
        `всего затрат в расчёте: ${fmtMoneyRu(pareto.total)} руб.`;
    }

    return {
      kpisRows,
      monthly,
      maxMonthly,
      topCosts,
      topDowntime,
      causes,
      classSummary,
      problems,
      triggeredDiagnostics,
      paretoLine,
    };
  }

  return { buildExportLayout, buildFactPackPresentation, fmtDateRu, CONFIDENCE_LABELS };
});
