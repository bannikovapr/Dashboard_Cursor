(function () {
  const U = window.ToirUtils;
  const Charts = window.ToirCharts;
  const runtimeLlm = {
    baseUrl: window.TOIR_API_URL || "http://localhost:8787/api/chat",
    timeoutMs: 45000,
  };

  function classifyClass(name) {
    if (/станок|токарн|фрезер|сверлил|шлиф|пресс|долб|заточ|расточ|протяж|электроэрозион|ленточнопиль|форматно|кромкооблицов|рейсмус|фуговальн|зубофрезерн|токарно-карусельн|продольно-фрезерн|листогибочн|гильотин/i.test(name))
      return "Станки и металлообработка";
    if (/насос/i.test(name)) return "Насосы";
    if (/компрессор/i.test(name)) return "Компрессоры";
    if (/кран|тельфер|\bталь\b/i.test(name)) return "Крановое оборудование";
    if (/погрузчик|экскаватор|самосвал|бульдозер|тягач/i.test(name)) return "Самоходная техника";
    if (/трансформатор|электродвигатель|генератор|вентилятор/i.test(name)) return "Электрооборудование";
    if (/робот|сварочн/i.test(name)) return "Сварка и роботы";
    if (/конвейер|грохот|дробилк|мельниц|центрифуг|котёл|холодильн|гидропресс/i.test(name)) return "Прочее промышленное";
    return "Прочее";
  }

  function shortMonthLabel(full) {
    const [mon] = full.split(" ");
    if (!mon) return full;
    return `${mon.slice(0, 3)}.`;
  }

  function monthSetFromPeriod(periodValue, allMonthKeys) {
    if (periodValue === "all" || !periodValue) return new Set(allMonthKeys);
    if (periodValue === "h1") return new Set(allMonthKeys.slice(0, 6));
    if (periodValue === "h2") return new Set(allMonthKeys.slice(6, 12));
    return new Set(allMonthKeys);
  }

  function buildEquipmentRows(data, monthSet, classNameFilter) {
    const costs = data.tables.equipmentCosts || {};
    const ktgMap = data.tables.ktg || {};
    const defects = data.tables.equipmentDefects || {};
    const rows = [];
    for (const [name, info] of Object.entries(costs)) {
      const cls = classifyClass(name);
      if (classNameFilter && classNameFilter !== "__all__" && cls !== classNameFilter) continue;
      let costInPeriod = 0;
      const months = info.months || {};
      for (const [mk, v] of Object.entries(months)) {
        if (monthSet.has(mk)) costInPeriod += v;
      }
      if (classNameFilter !== "__all__" && costInPeriod === 0) continue;
      const k = ktgMap[name];
      rows.push({
        name,
        class: cls,
        cost: costInPeriod,
        downtime: k ? k.total_downtime_h : 0,
        ktgPct: k ? k.avg_ktg : null,
        failures: Object.prototype.hasOwnProperty.call(defects, name) && name !== "Итого" ? defects[name] || 0 : 0,
      });
    }
    return rows;
  }

  function aggregateClasses(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.class)) {
        map.set(r.class, {
          class: r.class,
          qty: 0,
          costs: 0,
          downtime: 0,
          failures: 0,
          ktgSum: 0,
          ktgN: 0,
        });
      }
      const a = map.get(r.class);
      a.qty += 1;
      a.costs += r.cost;
      a.downtime += r.downtime;
      a.failures += r.failures;
      if (r.ktgPct != null) {
        a.ktgSum += r.ktgPct;
        a.ktgN += 1;
      }
    }
    return [...map.values()].map((a) => ({
      class: a.class,
      qty: a.qty,
      costs: a.costs,
      downtime: a.downtime,
      failures: a.failures,
      ktg: a.ktgN ? a.ktgSum / a.ktgN / 100 : null,
    }));
  }

  function topSharePct(rows) {
    const total = rows.reduce((s, r) => s + r.cost, 0);
    if (!total) return 0;
    const top = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 3);
    const t = top.reduce((s, r) => s + r.cost, 0);
    return (t / total) * 100;
  }

  function monthlyCostsSeriesMln(data, cm, classFilter) {
    const classActive = classFilter && classFilter !== "__all__";
    if (!classActive) return cm.map((m) => m.total / 1e6);
    const costs = data.tables?.equipmentCosts || {};
    return cm.map((row) => {
      const mk = row.month;
      let sum = 0;
      for (const [name, info] of Object.entries(costs)) {
        if (classifyClass(name) !== classFilter) continue;
        const v = info.months && info.months[mk];
        if (v) sum += v;
      }
      return sum / 1e6;
    });
  }

  function getKpiStatus(value, rules) {
    if (!rules || value == null || Number.isNaN(value)) return "na";
    if (rules.direction === "higher") {
      if (value >= rules.target) return "target";
      if (value >= rules.standard) return "standard";
      return "below";
    }
    if (value <= rules.target) return "target";
    if (value <= rules.standard) return "standard";
    return "below";
  }

  function setKpiStatusClass(id, status) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("kpi-status-target", "kpi-status-standard", "kpi-status-below");
    if (status === "target") el.classList.add("kpi-status-target");
    else if (status === "standard") el.classList.add("kpi-status-standard");
    else if (status === "below") el.classList.add("kpi-status-below");
  }

  function calcKpiBaselines(data) {
    const allMonths = (data.charts.costsByMonth || []).map((m) => m.month);
    const allRows = buildEquipmentRows(data, monthSetFromPeriod("all", allMonths), "__all__");
    const baseTotal = Number(data.kpis?.total_cost) || allRows.reduce((s, r) => s + r.cost, 0);
    const baseEq = Number(data.kpis?.equipment_count) || allRows.length || 1;
    const baseAvgPerUnit = baseEq ? baseTotal / baseEq : null;
    const baseFails = Number(data.kpis?.total_defects) || allRows.reduce((s, r) => s + r.failures, 0);
    const basePerEq = baseEq ? baseFails / baseEq : null;
    const baseTop3 = topSharePct(allRows);
    const baseDowntime = Object.values(data.tables?.ktg || {}).reduce((s, k) => s + (Number(k?.total_downtime_h) || 0), 0);
    return { baseTotal, baseEq, baseAvgPerUnit, baseFails, basePerEq, baseTop3, baseDowntime };
  }

  function renderKpis(rows, data, monthLabelsFiltered) {
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const eqCount = rows.length || data.kpis?.equipment_count;
    const avgPerUnit = eqCount ? totalCost / eqCount : 0;
    const downtimeSum = rows.reduce((s, r) => s + r.downtime, 0);
    const top3 = topSharePct(rows);
    const fails = rows.reduce((s, r) => s + r.failures, 0);
    const ktgVals = rows.filter((r) => r.ktgPct != null).map((r) => r.ktgPct);
    const ktgAvg = ktgVals.length ? ktgVals.reduce((a, b) => a + b, 0) / ktgVals.length : null;
    const perUnitDef = eqCount ? fails / eqCount : null;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set("kpiTotal", U.formatMoneyMln(totalCost));
    set("kpiTotalHint", `Период: ${monthLabelsFiltered.length} мес.`);

    set("kpiTop3", `${top3.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
    set("kpiTop3Hint", "Доля топ-3 объектов в сумме затрат");

    set("kpiAvgUnit", U.formatMoneyK(avgPerUnit));
    set("kpiAvgHint", "Средняя сумма затрат на единицу в срезе");

    set("kpiDown", U.formatHours(downtimeSum));
    set("kpiDownHint", "Сумма часов простоя по объектам с данными КТГ");

    set("kpiFails", U.formatCount(fails || data.kpis?.total_defects));
    set("kpiFailsHint", "Сумма отказов по объектам в текущем срезе");

    set("kpiKtg", ktgAvg != null ? U.formatRatioFromPercent(ktgAvg) : "—");
    set("kpiKtgHint", "Средний КТГ (доля доступного времени)");

    set("kpiPerEq", perUnitDef != null ? perUnitDef.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "—");
    set("kpiPerEqHint", "Отказов на единицу парка в текущем срезе");

    const mtbfRows = data.charts?.mtbfByEquipment || [];
    const mtbfFiltered = mtbfRows
      .filter((x) => rows.some((r) => r.name === x.equipment))
      .map((x) => Number(x.mtbf_h) || 0)
      .filter((v) => v > 0);
    const mtbfAvg = mtbfFiltered.length ? mtbfFiltered.reduce((a, b) => a + b, 0) / mtbfFiltered.length : null;
    set("kpiMtbf", mtbfAvg != null ? `${Math.round(mtbfAvg).toLocaleString("ru-RU")} ч` : "—");
    set("kpiMtbfHint", "СННО: средняя наработка на отказ по объектам в текущем срезе");

    const b = calcKpiBaselines(data);
    const rules = {
      kpiTotal: b.baseTotal ? { direction: "lower", target: b.baseTotal * 0.9, standard: b.baseTotal * 1.1 } : null,
      kpiTop3: b.baseTop3 ? { direction: "lower", target: Math.max(35, b.baseTop3 * 0.95), standard: Math.max(50, b.baseTop3 * 1.1) } : null,
      kpiAvgUnit: b.baseAvgPerUnit
        ? { direction: "lower", target: b.baseAvgPerUnit * 0.9, standard: b.baseAvgPerUnit * 1.1 }
        : null,
      kpiDown: b.baseDowntime
        ? { direction: "lower", target: b.baseDowntime * 0.9, standard: b.baseDowntime * 1.1 }
        : null,
      kpiFails: b.baseFails ? { direction: "lower", target: b.baseFails * 0.9, standard: b.baseFails * 1.1 } : null,
      // Бенчмарк reliability: standard ~= 90% availability, target ~= 95%+.
      kpiKtg: { direction: "higher", target: 95, standard: 90 },
      kpiPerEq: b.basePerEq ? { direction: "lower", target: b.basePerEq * 0.9, standard: b.basePerEq * 1.1 } : null,
      // Бенчмарк MTBF: standard ~= 2,000h, target ~= 5,000h+.
      kpiMtbf: { direction: "higher", target: 5000, standard: 2000 },
    };
    const current = {
      kpiTotal: totalCost,
      kpiTop3: top3,
      kpiAvgUnit: avgPerUnit,
      kpiDown: downtimeSum,
      kpiFails: fails,
      kpiKtg: ktgAvg,
      kpiPerEq: perUnitDef,
      kpiMtbf: mtbfAvg,
    };
    Object.entries(current).forEach(([id, val]) => {
      const status = getKpiStatus(val, rules[id]);
      setKpiStatusClass(id, status);
    });
  }

  function renderTables(classRows, topRows) {
    const tbodyCls = document.querySelector("#tblClasses tbody");
    const tbodyTop = document.querySelector("#tblTop tbody");
    if (tbodyCls) {
      tbodyCls.innerHTML = classRows
        .sort((a, b) => b.costs - a.costs)
        .map(
          (r) => `<tr>
          <td>${escapeHtml(r.class)}</td>
          <td>${r.qty}</td>
          <td>${U.formatMoneyMln(r.costs)}</td>
          <td>${U.formatHours(r.downtime)}</td>
          <td>${r.failures}</td>
          <td>${r.ktg != null ? r.ktg.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}</td>
        </tr>`
        )
        .join("");
    }
    if (tbodyTop) {
      tbodyTop.innerHTML = topRows
        .map(
          (r) => `<tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${U.formatMoneyMln(r.cost)}</td>
          <td>${U.formatHours(r.downtime)}</td>
          <td>${r.failures}</td>
          <td>${r.ktg != null ? (r.ktg / 100).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}</td>
        </tr>`
        )
        .join("");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, " ");
  }


  function renderWearImage(data) {
    const box = document.getElementById("chartWearImage");
    if (!box) return;
    const src = data?.charts?.wearImage;
    if (!src) {
      box.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">В отчете «Процент износа» изображение не найдено.</p>';
      return;
    }
    const safe = escapeAttr(src);
    box.innerHTML = `<img class="chart-image" src="${safe}" alt="Процент износа" loading="lazy" />`;
  }

  function fillClassSelect(selectEl, classes, preferredValue) {
    if (!selectEl) return;
    selectEl.replaceChildren();
    const allOpt = document.createElement("option");
    allOpt.value = "__all__";
    allOpt.textContent = "Все классы";
    selectEl.appendChild(allOpt);
    for (const c of classes) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      selectEl.appendChild(o);
    }
    const pick =
      preferredValue && [...selectEl.options].some((o) => o.value === preferredValue)
        ? preferredValue
        : "__all__";
    selectEl.value = pick;
  }

  function updateHeaderChips(data, periodValue, classValue, rows) {
    const periodChip = document.getElementById("chipPeriod");
    const classChip = document.getElementById("chipClass");
    const countChip = document.getElementById("chipEquipCount");
    const updatedChip = document.getElementById("chipUpdated");

    const periodMap = {
      all: "Последние 12 мес.",
      h1: "1-е полугодие 2025",
      h2: "2-е полугодие 2025",
    };
    if (periodChip) periodChip.textContent = periodMap[periodValue] || "Последние 12 мес.";
    if (classChip) classChip.textContent = classValue === "__all__" ? "Все классы" : classValue;
    if (countChip) countChip.textContent = String(rows.length || 0);
    if (updatedChip) updatedChip.textContent = data?.meta?.generated || "auto";
  }

  function topProblemRows(data, monthSet, classFilter, limit = 12) {
    const rows = buildEquipmentRows(data, monthSet, classFilter);
    const ktgMap = data.tables.ktg || {};
    const defects = data.tables.equipmentDefects || {};
    const scored = rows.map((r) => {
      const k = ktgMap[r.name];
      const ktg = k ? k.avg_ktg : null;
      const downtime = k ? k.total_downtime_h : r.downtime;
      const f = defects[r.name] || r.failures;
      const reliabilityPenalty = (downtime / 1000 + f * 2) * (ktg != null ? 1 / (ktg / 100) : 1);
      return { name: r.name, cost: r.cost, downtime, failures: f, ktg, score: r.cost * 0.001 + reliabilityPenalty };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function applyTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    document.querySelectorAll(".panel-charts").forEach((p) => {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
  }

  function wireUi(data) {
    const periodSel = document.getElementById("panelPeriod");
    const classSel = document.getElementById("panelClass");

    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTab(btn.dataset.tab);
        Charts.resizeAll();
      });
    });

    const allRowsForClasses = buildEquipmentRows(
      data,
      monthSetFromPeriod("all", (data.charts.costsByMonth || []).map((m) => m.month)),
      "__all__"
    );
    const classCatalog = [...new Set(allRowsForClasses.map((r) => r.class))].sort();
    fillClassSelect(classSel, classCatalog, "__all__");

    const allMonths = (data.charts.costsByMonth || []).map((m) => m.month);
    const drain = () => {
      const monthSet = monthSetFromPeriod(periodSel?.value || "all", allMonths);
      const cls = classSel?.value || "__all__";
      const rows = buildEquipmentRows(data, monthSet, cls);
      updateHeaderChips(data, periodSel?.value || "all", cls, rows);
      const agg = aggregateClasses(rows);
      const totalEq = agg.reduce((s, a) => s + a.qty, 0) || 1;
      const cats = agg.map((a) => a.class);
      const vals = agg.map((a) => (100 * a.qty) / totalEq);
      const structPct = vals.map((v) => Math.round(v * 10) / 10);
      Charts.renderStructureByClass(cats, structPct, "#chartStructure", 260);
      Charts.renderStructureByClass(cats, structPct, "#chartStructureEq", 260);

      const cm = (data.charts.costsByMonth || []).filter((m) => monthSet.has(m.month));
      const costsMln = monthlyCostsSeriesMln(data, cm, cls);
      const monthLbl = cm.map((m) => shortMonthLabel(m.month));
      Charts.renderCostsByMonth(monthLbl, costsMln, "#chartCosts", 320);
      Charts.renderCostsByMonth(monthLbl, costsMln, "#chartCostsTab", 260);

      const fc = [...(data.charts.failure_causes || data.charts.failureCauses || [])].sort((a, b) => b.count - a.count);
      const fcLabels = fc.map((x) => x.cause);
      const fcCounts = fc.map((x) => x.count);
      Charts.renderFailureCauses(fcLabels, fcCounts, "#chartCauses", 260);
      Charts.renderFailureCauses(fcLabels, fcCounts, "#chartCausesRel", 260);

      const topCostRows = [...rows]
        .filter((r) => r.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);
      Charts.renderTopEquipmentCost(
        topCostRows.map((r) => r.name),
        topCostRows.map((r) => r.cost / 1e6),
        "#chartTopCostEquip",
        280
      );

      const aggByCost = [...agg].sort((a, b) => b.costs - a.costs);
      Charts.renderClassCostDonut(
        aggByCost.map((a) => a.class),
        aggByCost.map((a) => a.costs),
        "#chartClassCostDonut",
        280
      );


      const ktgMonthlyMap = new Map();
      rows.forEach((r) => {
        const k = (data.tables.ktg || {})[r.name];
        const monthly = k?.monthly_ktg || {};
        Object.entries(monthly).forEach(([month, val]) => {
          if (!monthSet.has(month)) return;
          if (!ktgMonthlyMap.has(month)) ktgMonthlyMap.set(month, []);
          if (Number(val) > 0) ktgMonthlyMap.get(month).push(Number(val) / 100);
        });
      });
      const ktgMonths = cm.map((m) => m.month).filter((m) => ktgMonthlyMap.has(m));
      const ktgAvgSeries = ktgMonths.map((m) => {
        const arr = ktgMonthlyMap.get(m) || [];
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      });
      Charts.renderKtgLine(
        ktgMonths.map((m) => shortMonthLabel(m)),
        ktgAvgSeries,
        "#chartKtgTrend",
        260
      );

      const mtbfTop = (data.charts.mtbfByEquipment || [])
        .filter((x) => cls === "__all__" || classifyClass(x.equipment) === cls)
        .slice(0, 10);
      Charts.renderMtbfTop(
        mtbfTop.map((x) => x.equipment),
        mtbfTop.map((x) => Number(x.mtbf_h) || 0),
        "#chartMtbfTop",
        260
      );
      const mttrTop = (data.charts.mttrByEquipment || [])
        .filter((x) => cls === "__all__" || classifyClass(x.equipment) === cls)
        .slice(0, 10);
      Charts.renderMttrTop(
        mttrTop.map((x) => x.equipment),
        mttrTop.map((x) => Number(x.mttr_h) || 0),
        "#chartMttrTop",
        260
      );
      const mlRows = (data.charts.materialLaborByMonth || []).filter((m) => monthSet.has(m.month));
      Charts.renderMaterialLaborStacked(
        mlRows.map((m) => shortMonthLabel(m.month)),
        mlRows.map((m) => Number(m.material_h || m.material || 0)),
        mlRows.map((m) => Number(m.labor_h || m.labor || 0)),
        "#chartMaterialLabor",
        260
      );

      Charts.renderClassCostsBar(
        aggByCost.map((a) => a.class),
        aggByCost.map((a) => a.costs / 1e6),
        "#chartClassCostsBar",
        260
      );

      const monthShort = cm.map((m) => m.month);
      renderKpis(rows, data, monthShort);

      const structSub = document.getElementById("chartStructureSub");
      if (structSub) {
        structSub.textContent =
          cls !== "__all__"
            ? "Срез по выбранному классу оборудования"
            : "Доля единиц в выбранном срезе (агрегация по наименованию)";
      }
      const costSub = document.getElementById("chartCostsSub");
      if (costSub) {
        costSub.textContent =
          cls !== "__all__"
            ? "Сумма затрат объектов выбранного класса, млн ₽"
            : "Итого по выгрузке (млн ₽)";
      }
      const causeSub = document.getElementById("chartCausesSub");
      if (causeSub) causeSub.textContent = "По количеству записей в периоде";
      const causeRelSub = document.getElementById("chartCausesRelSub");
      if (causeRelSub) {
        causeRelSub.textContent =
          cls !== "__all__"
            ? `Топ причин по отказам · класс: ${cls}`
            : "Топ причин отказов по количеству случаев";
      }
      const ktgTrendSub = document.getElementById("chartKtgTrendSub");
      if (ktgTrendSub) {
        ktgTrendSub.textContent =
          cls !== "__all__"
            ? `Средний КТГ по месяцам · класс: ${cls}`
            : "Средний КТГ по месяцам по объектам с данными";
      }
      const mtbfTopSub = document.getElementById("chartMtbfTopSub");
      if (mtbfTopSub) {
        mtbfTopSub.textContent =
          cls !== "__all__"
            ? `Топ-10 по СННО · класс: ${cls}`
            : "Топ-10 по СННО · все классы";
      }
      const mttrTopSub = document.getElementById("chartMttrTopSub");
      if (mttrTopSub) {
        mttrTopSub.textContent =
          cls !== "__all__"
            ? `Топ-10 по СВВ · класс: ${cls}`
            : "Топ-10 по СВВ · все классы";
      }
      const matLabSub = document.getElementById("chartMaterialLaborSub");
      if (matLabSub) {
        matLabSub.textContent =
          cls !== "__all__"
            ? `Труд/материалы по месяцам · класс: ${cls}`
            : "Часы трудозатрат и материальных работ по месяцам";
      }
      const eqStructSub = document.getElementById("chartStructureEqSub");
      if (eqStructSub) {
        eqStructSub.textContent =
          cls !== "__all__" ? "Срез по выбранному классу" : "Доля единиц парка по классам";
      }
      const wearSub = document.getElementById("chartWearSub");
      if (wearSub) wearSub.textContent = "";
      renderWearImage(data);

      renderTables(agg, topProblemRows(data, monthSet, cls));

      document.getElementById("footerSource").textContent =
        `Источник: ${data.meta?.source || "—"} → data/toir.json · ${data.meta?.period || ""}`;

      setTimeout(() => Charts.resizeAll(), 120);
    };

    periodSel?.addEventListener("change", drain);
    classSel?.addEventListener("change", drain);
    window.applyClassFilter = (className) => {
      if (!classSel) return;
      const want = className === "__all__" ? "__all__" : className;
      if (want !== "__all__" && !classCatalog.includes(want)) return;
      classSel.value = want;
      drain();
    };

    drain();
    applyTab("summary");
  }

  function detectIntentFromQuestion(question) {
    const ql = String(question || "").toLowerCase();
    const hasKtgToken = /ктг|готовност/i.test(ql);
    const reliabilityCombo =
      (/надёжност|надежност|снно|свв|mtbf|mttr|наработк|восстанов|простой/i.test(ql) || hasKtgToken) &&
      (/обзор|кратк|в целом|состояни|парк|дашборд|оцен|общ/i.test(ql));

    if (/прогноз|предска|forecast/i.test(ql)) return "forecast";
    if (/что делать|что спросить|рекоменд|действ/i.test(ql)) return "recommendation";
    if (reliabilityCombo) return "overview_reliability";
    if (/кратк|обзор|проанализ|весь дашборд|всего дашборд|в целом|что важного/i.test(ql)) return "dashboard_overview";
    if (/почему.*затрат|затрат.*почему|выросл.*затрат|снизил.*затрат/i.test(ql)) return "why_costs_changed";
    if (/почему.*отказ|отказ.*почему|выросл.*отказ|снизил.*отказ/i.test(ql)) return "why_failures_changed";
    if (
      /сравн|vs|против/i.test(ql) &&
      /месяц|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/.test(ql)
    )
      return "compare_costs_by_month";
    if (/материал|трудозатрат|труд.*материал|структур.*работ/i.test(ql)) return "material_labor_structure";
    if (/доля.*затрат.*класс|затрат.*по класс|структур.*затрат.*класс/i.test(ql)) return "class_cost_structure";
    if (hasKtgToken && /снно|mtbf|наработк/i.test(ql) && /причин|причины|отказов/i.test(ql)) return "reliability_combo_qa";
    if (/mtbf|снно|наработк/i.test(ql)) return "mtbf_by_equipment";
    if (/mttr|свв|восстанов/i.test(ql)) return "mttr_by_equipment";
    if (hasKtgToken) return "ktg_by_equipment";
    if (/топ.*затрат|лидер.*затрат|сам.*дорог|больше всего.*затрат|затрат.*оборуд/i.test(ql)) return "top_cost_equipment";
    if (/причин|отказ|дефект/i.test(ql)) return "top_failure_causes";
    if (/месяц|динам|тренд|пик/i.test(ql)) return "trend_costs_by_month";
    if (/сколько|общ.*затрат|дефектов|оборудовани/i.test(ql)) return "kpi_fact";
    if (/структур|класс|парк/.test(ql)) return "equipment_cost_detail";
    return "unsupported";
  }

  function topEquipmentCosts(equipmentCosts, limit = 5) {
    return Object.entries(equipmentCosts || {})
      .map(([name, info]) => ({ name, total: Number(info?.total || 0) }))
      .filter((r) => r.total > 0)
      .sort((x, y) => y.total - x.total)
      .slice(0, limit);
  }

  function classCostSummary(equipmentCosts) {
    const rows = Object.entries(equipmentCosts || {})
      .map(([name, info]) => ({ name, className: classifyClass(name), total: Number(info?.total || 0) }))
      .filter((r) => r.total > 0);
    const byClass = new Map();
    for (const r of rows) byClass.set(r.className, (byClass.get(r.className) || 0) + r.total);
    return [...byClass.entries()].map(([cls, val]) => ({ class: cls, total: val }));
  }

  function aiAnswer(q, data) {
    const ql = q.toLowerCase();
    const a = data.analysis || {};
    const costsByMonth = data.charts?.costsByMonth || [];
    const failureCauses = a.top3_failure_causes || data.charts?.failureCauses || data.charts?.failure_causes || [];
    const mtbfRows = data.charts?.mtbfByEquipment || [];
    const mttrRows = data.charts?.mttrByEquipment || [];
    const materialLaborRows = data.charts?.materialLaborByMonth || [];
    const ktgMap = data.tables?.ktg || {};
    const equipmentCosts = data.tables?.equipmentCosts || {};

    const noAnswer = (extra = "") => {
      return {
        fact: "Сожалею, но пока не могу ответить на ваш вопрос.",
        conclusion: extra || "В доступных данных нет нужных полей для точного ответа.",
        action: "Уточните метрику и срез (например: месяц, класс оборудования, объект).",
      };
    };

    function extractMonthsFromQuestion(series) {
      const monthAliases = {
        январь: ["январ", "янв"],
        февраль: ["феврал", "фев"],
        март: ["март", "мар"],
        апрель: ["апрел", "апр"],
        май: ["май", "мая"],
        июнь: ["июн", "июня", "июне"],
        июль: ["июл", "июля", "июле"],
        август: ["август", "авг", "августе"],
        сентябрь: ["сентябр", "сен"],
        октябрь: ["октябр", "окт"],
        ноябрь: ["ноябр", "ноя"],
        декабрь: ["декабр", "дек"],
      };
      const asked = Object.entries(monthAliases)
        .filter(([, forms]) => forms.some((f) => ql.includes(f)))
        .map(([m]) => m);
      if (!asked.length) return [];
      return series.filter((row) => {
        const rowLower = String(row.month || "").toLowerCase();
        return asked.some((m) => rowLower.includes(m));
      });
    }

    const intent = detectIntentFromQuestion(q);

    if (intent === "reliability_combo_qa") {
      const ktgVals = Object.entries(ktgMap)
        .map(([name, x]) => ({ name, val: Number(x?.avg_ktg) || 0 }))
        .filter((x) => x.val > 0)
        .sort((a, b) => b.val - a.val)
        .slice(0, 3);
      const mtbfTop = [...mtbfRows]
        .sort((x, y) => (Number(y.mtbf_h) || 0) - (Number(x.mtbf_h) || 0))
        .slice(0, 3);
      const causesTop = [...failureCauses].slice(0, 3);
      if (!ktgVals.length && !mtbfTop.length && !causesTop.length) {
        return noAnswer("В выгрузке нет данных по КТГ, СННО и причинам отказов для совместного ответа.");
      }
      const factChunks = [];
      if (ktgVals.length) {
        factChunks.push(
          `КТГ (топ-3): ${ktgVals.map((x) => `${x.name} — ${x.val.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`).join("; ")}`
        );
      }
      if (mtbfTop.length) {
        factChunks.push(
          `СННО (топ-3, ч): ${mtbfTop.map((x) => `${x.equipment}: ${Math.round(Number(x.mtbf_h) || 0).toLocaleString("ru-RU")}`).join("; ")}`
        );
      }
      if (causesTop.length) {
        factChunks.push(`Частые причины отказов (топ-3): ${causesTop.map((x, i) => `${i + 1}) ${x.cause} — ${x.count}`).join("; ")}`);
      }
      return {
        fact: factChunks.join(" | "),
        conclusion:
          "По выгрузке видно расслоение готовности и наработки по объектам; частые причины отказов задают зоны, где стоит сверить регламенты и ресурсы.",
        action:
          "Сопоставьте объекты с более низким КТГ и меньшей СННО с перечнем причин и запланируйте точечные проверки по топ-3 причинам.",
      };
    }

    if (intent === "overview_reliability") {
      const total = Number(data.kpis?.total_cost);
      const defects = Number(data.kpis?.total_defects);
      const eqCount = Number(data.kpis?.equipment_count);
      const ktgVals = Object.values(ktgMap).map((k) => Number(k?.avg_ktg) || 0).filter((v) => v > 0);
      const ktgAvg = ktgVals.length ? ktgVals.reduce((a, b) => a + b, 0) / ktgVals.length : null;
      let mtbfAvg = null;
      if (mtbfRows.length) {
        const nums = mtbfRows.map((x) => Number(x.mtbf_h) || 0).filter((v) => v > 0);
        if (nums.length) mtbfAvg = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
      let mttrAvg = null;
      if (mttrRows.length) {
        const nums = mttrRows.map((x) => Number(x.mttr_h) || 0).filter((v) => v > 0);
        if (nums.length) mttrAvg = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
      const hasReliabilitySlice =
        Number.isFinite(defects) ||
        Number.isFinite(eqCount) ||
        mtbfAvg != null ||
        mttrAvg != null ||
        ktgAvg != null ||
        Number.isFinite(total);
      if (!hasReliabilitySlice) {
        return noAnswer("В выгрузке недостаточно показателей надёжности для обзора.");
      }
      const parts = [];
      if (Number.isFinite(defects)) parts.push(`отказов: ${U.formatCount(defects)}`);
      if (Number.isFinite(eqCount)) parts.push(`единиц парка: ${U.formatCount(eqCount)}`);
      if (mtbfAvg != null) parts.push(`средняя СННО: ${Math.round(mtbfAvg).toLocaleString("ru-RU")} ч`);
      if (mttrAvg != null) parts.push(`средняя СВВ: ${Math.round(mttrAvg).toLocaleString("ru-RU")} ч`);
      if (ktgAvg != null) parts.push(`средний КТГ: ${ktgAvg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
      const tail = Number.isFinite(total) ? `Затраты: ${U.formatMoneyMln(total)}` : "";
      const head = parts.length ? `${parts.join("; ")}.` : "";
      const fact = [head, tail].filter(Boolean).join(" ").trim();
      return {
        fact,
        conclusion: "Сводка по ключевым метрикам надёжности и доступности парка.",
        action: "Для узких мест разберите объекты с худшими СННО, КТГ и наибольшей СВВ.",
      };
    }

    if (intent === "forecast") {
      return noAnswer("Для прогноза не задан проверяемый метод расчёта.");
    }

    if (intent === "kpi_fact") {
      const total = Number(data.kpis?.total_cost);
      const defects = Number(data.kpis?.total_defects);
      const eqCount = Number(data.kpis?.equipment_count);
      if (!Number.isFinite(total) && !Number.isFinite(defects) && !Number.isFinite(eqCount)) {
        return noAnswer("В выгрузке нет KPI-агрегатов для ответа.");
      }
      return {
        fact: `Затраты: ${U.formatMoneyMln(total)}; отказов: ${U.formatCount(defects)}; единиц парка: ${U.formatCount(eqCount)}.`,
        conclusion: "Это базовый срез текущего состояния затрат и надежности парка.",
        action: "Уточните, какую метрику разобрать глубже: затраты, отказы, КТГ, СННО или динамику по месяцам.",
      };
    }

    if (intent === "compare_costs_by_month") {
      if (costsByMonth.length < 2) return noAnswer("Недостаточно помесячных данных для сравнения.");
      const monthHits = extractMonthsFromQuestion(costsByMonth);
      const pair = monthHits.length >= 2 ? monthHits.slice(0, 2) : costsByMonth.slice(-2);
      const m1 = pair[0];
      const m2 = pair[1];
      const diff = (Number(m2?.total) || 0) - (Number(m1?.total) || 0);
      return {
        fact: `${m1.month}: ${U.formatMoneyMln(m1.total)}; ${m2.month}: ${U.formatMoneyMln(m2.total)}.`,
        conclusion: `Разница: ${U.formatMoneyMln(Math.abs(diff))}; выше ${diff >= 0 ? m2.month : m1.month}.`,
        action: "Проверьте состав работ и причины отказов в месяце с более высоким уровнем затрат.",
      };
    }

    if (intent === "top_failure_causes") {
      if (!failureCauses.length) return noAnswer("В выгрузке нет агрегата причин отказов.");
      const top = [...failureCauses].slice(0, 3);
      return {
        fact: top.map((x, i) => `${i + 1}) ${x.cause} — ${x.count}`).join("; "),
        conclusion: "Эти причины формируют основной вклад в отказность.",
        action: "Запустите корректирующие меры по двум самым частым причинам и закрепите контроль результата.",
      };
    }

    if (intent === "top_cost_equipment") {
      const top = topEquipmentCosts(equipmentCosts, 3);
      if (!top.length) return noAnswer("В выгрузке нет детализации затрат по объектам.");
      return {
        fact: top.map((x, i) => `${i + 1}) ${x.name} — ${U.formatMoneyMln(x.total)}`).join("; "),
        conclusion: "Затраты сосредоточены в ограниченном наборе объектов.",
        action: "Проверьте повторяемость работ и материалов по этим объектам за последние месяцы.",
      };
    }

    if (intent === "equipment_cost_detail") {
      const top = topEquipmentCosts(equipmentCosts, 1)[0];
      if (!top) return noAnswer("Нет данных по затратам оборудования.");
      return {
        fact: `Наибольшие затраты у объекта ${top.name}: ${U.formatMoneyMln(top.total)}.`,
        conclusion: "Этот объект приоритетен для детального разбора затрат и надежности.",
        action: "Сопоставьте по объекту затраты, простои и отказы по месяцам.",
      };
    }

    if (intent === "mtbf_by_equipment") {
      if (!mtbfRows.length) return noAnswer("В выгрузке нет MTBF по оборудованию.");
      const top = [...mtbfRows].sort((x, y) => (Number(y.mtbf_h) || 0) - (Number(x.mtbf_h) || 0)).slice(0, 3);
      return {
        fact: top.map((x) => `${x.equipment}: ${Math.round(Number(x.mtbf_h) || 0).toLocaleString("ru-RU")} ч`).join("; "),
        conclusion: "СННО показывает устойчивость оборудования между отказами.",
        action: "Для объектов с наименьшей СННО пересмотрите набор превентивных работ.",
      };
    }

    if (intent === "mttr_by_equipment") {
      if (!mttrRows.length) return noAnswer("В выгрузке нет MTTR по оборудованию.");
      const worst = [...mttrRows].sort((x, y) => (Number(y.mttr_h) || 0) - (Number(x.mttr_h) || 0)).slice(0, 3);
      return {
        fact: worst.map((x) => `${x.equipment}: ${Math.round(Number(x.mttr_h) || 0).toLocaleString("ru-RU")} ч`).join("; "),
        conclusion: "СВВ отражает длительность восстановления: чем ниже, тем лучше.",
        action: "Проверьте обеспеченность ЗИП и регламенты ремонта для этих объектов.",
      };
    }

    if (intent === "material_labor_structure") {
      if (!materialLaborRows.length) return noAnswer("В выгрузке нет структуры работ по трудозатратам и материалам.");
      const totalMaterial = materialLaborRows.reduce((s, r) => s + (Number(r.material_h || r.material || 0) || 0), 0);
      const totalLabor = materialLaborRows.reduce((s, r) => s + (Number(r.labor_h || r.labor || 0) || 0), 0);
      const sum = totalMaterial + totalLabor;
      if (sum <= 0) return noAnswer("В структуре работ нет числовых значений по часам.");
      const matPct = (100 * totalMaterial) / sum;
      const labPct = (100 * totalLabor) / sum;
      return {
        fact: `Материальные работы: ${Math.round(totalMaterial).toLocaleString("ru-RU")} ч (${matPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%); трудозатраты: ${Math.round(totalLabor).toLocaleString("ru-RU")} ч (${labPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%).`,
        conclusion: labPct >= matPct ? "В текущем срезе преобладают трудозатраты." : "В текущем срезе преобладают материальные работы.",
        action: "Проверьте месяцы с максимальной суммарной нагрузкой и состав работ в них.",
      };
    }

    if (intent === "class_cost_structure") {
      const rows = Object.entries(equipmentCosts)
        .map(([name, info]) => ({ name, className: classifyClass(name), total: Number(info?.total || 0) }))
        .filter((r) => r.total > 0);
      if (!rows.length) return noAnswer("В выгрузке нет детализации затрат по классам.");
      const byClass = new Map();
      for (const r of rows) byClass.set(r.className, (byClass.get(r.className) || 0) + r.total);
      const total = [...byClass.values()].reduce((s, v) => s + v, 0);
      if (total <= 0) return noAnswer("В выгрузке нет сумм для структуры затрат по классам.");
      const top = [...byClass.entries()]
        .map(([cls, val]) => ({ cls, val, pct: (100 * val) / total }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 3);
      return {
        fact: top
          .map((x, i) => `${i + 1}) ${x.cls}: ${U.formatMoneyMln(x.val)} (${x.pct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%)`)
          .join("; "),
        conclusion: "Затраты концентрируются в ограниченном наборе классов оборудования.",
        action: "Сфокусируйте анализ работ и причин отказов сначала на этих классах.",
      };
    }

    if (intent === "ktg_by_equipment") {
      const vals = Object.entries(ktgMap)
        .map(([name, x]) => ({ name, val: Number(x?.avg_ktg) || 0 }))
        .filter((x) => x.val > 0)
        .sort((a1, b1) => b1.val - a1.val);
      if (!vals.length) return noAnswer("В выгрузке нет КТГ по оборудованию.");
      const top = vals.slice(0, 3);
      const risk85 = vals.filter((x) => x.val < 85);
      const risk90 = vals.filter((x) => x.val < 90);
      const riskNote =
        risk85.length > 0
          ? ` Ниже 85%: ${risk85.length} объект(ов) — зона повышенного риска.`
          : risk90.length > 0
            ? ` Ниже 90%: ${risk90.length} объект(ов) — требуют внимания.`
            : "";
      return {
        fact: `${top.map((x) => `${x.name}: ${x.val.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`).join("; ")}.${riskNote}`.trim(),
        conclusion: "КТГ отражает техническую готовность оборудования к работе.",
        action: "Сфокусируйтесь на объектах с минимальным КТГ и разберите причины недоступности.",
      };
    }

    if (intent === "trend_costs_by_month") {
      if (!costsByMonth.length) return noAnswer("В выгрузке нет динамики затрат по месяцам.");
      const minRow = [...costsByMonth].sort((x, y) => (Number(x.total) || 0) - (Number(y.total) || 0))[0];
      const maxRow = [...costsByMonth].sort((x, y) => (Number(y.total) || 0) - (Number(x.total) || 0))[0];
      return {
        fact: `Минимум: ${minRow.month} — ${U.formatMoneyMln(minRow.total)}; максимум: ${maxRow.month} — ${U.formatMoneyMln(maxRow.total)}.`,
        conclusion: "Динамика неравномерна, есть выраженные пики затрат.",
        action: "Разберите месяцы-пики и сравните состав работ с месяцами минимальных затрат.",
      };
    }

    if (intent === "why_costs_changed") {
      if (costsByMonth.length < 2) return noAnswer("Недостаточно данных, чтобы объяснить изменение затрат.");
      const prev = costsByMonth[costsByMonth.length - 2];
      const curr = costsByMonth[costsByMonth.length - 1];
      const delta = (Number(curr.total) || 0) - (Number(prev.total) || 0);
      return {
        fact: `${prev.month}: ${U.formatMoneyMln(prev.total)}; ${curr.month}: ${U.formatMoneyMln(curr.total)}; изменение: ${U.formatMoneyMln(Math.abs(delta))}.`,
        conclusion: "В данных видно факт изменения затрат, но прямой причины в доступном наборе нет.",
        action: "Сопоставьте рост/снижение с топом отказов и простоев за тот же период.",
      };
    }

    if (intent === "why_failures_changed") {
      const totalDefects = Number(data.kpis?.total_defects);
      if (!Number.isFinite(totalDefects)) return noAnswer("В выгрузке нет агрегата по отказам.");
      const top = [...failureCauses].slice(0, 3);
      return {
        fact: `Всего отказов: ${U.formatCount(totalDefects)}. Топ причин: ${top.map((x) => `${x.cause} (${x.count})`).join("; ") || "нет детализации по причинам"}.`,
        conclusion: "Прямой причинно-следственной связи в наборе нет, но лидирующие причины указывают на приоритетные зоны.",
        action: "Проведите разбор повторяющихся причин и назначьте владельцев корректирующих действий.",
      };
    }

    if (intent === "dashboard_overview") {
      const total = Number(data.kpis?.total_cost);
      const defects = Number(data.kpis?.total_defects);
      const eqCount = Number(data.kpis?.equipment_count);
      const peak = costsByMonth.length
        ? [...costsByMonth].sort((x, y) => (Number(y.total) || 0) - (Number(x.total) || 0))[0]
        : null;
      if (!Number.isFinite(total) && !peak) return noAnswer("В выгрузке недостаточно агрегатов для общего анализа.");
      return {
        fact: `Затраты: ${U.formatMoneyMln(total)}; отказов: ${U.formatCount(defects)}; единиц парка: ${U.formatCount(eqCount)}${peak ? `; пик: ${peak.month} (${U.formatMoneyMln(peak.total)})` : ""}.`,
        conclusion: "Ключевые отклонения концентрируются в отдельных месяцах и объектах.",
        action: "Начните с месяца-пика и топ-объектов по затратам/отказам, затем закрепите 2-3 приоритетные меры.",
      };
    }

    if (intent === "recommendation") {
      const topCauses = [...failureCauses].slice(0, 2);
      const topCost = topEquipmentCosts(equipmentCosts, 2);
      if (!topCauses.length && !topCost.length) return noAnswer("Недостаточно данных для обоснованной рекомендации.");
      return {
        fact: `${topCauses.length ? `Частые причины: ${topCauses.map((x) => `${x.cause} (${x.count})`).join("; ")}` : "Причины отказов не агрегированы"}${topCost.length ? `; лидеры по затратам: ${topCost.map((x) => `${x.name} (${U.formatMoneyMln(x.total)})`).join("; ")}` : ""}.`,
        conclusion: "Приоритизация по повторяющимся причинам и затратным объектам дает наибольший эффект.",
        action: "Согласуйте план: 1) меры по топ-2 причинам отказов, 2) аудит работ по топ-2 затратным объектам.",
      };
    }

    return noAnswer();
  }

  function hasValidStructuredAnswer(ans) {
    return Boolean(
      ans &&
        typeof ans.fact === "string" &&
        ans.fact.trim() &&
        typeof ans.conclusion === "string" &&
        ans.conclusion.trim() &&
        typeof ans.action === "string" &&
        ans.action.trim()
    );
  }

  function apiErrorAnswer(status, payload) {
    const code = payload?.errorCode || "";
    const msg = String(payload?.message || "").trim();
    const fact = "Сожалею, но пока не могу ответить на ваш вопрос.";
    if (code === "provider_not_configured") {
      return {
        fact,
        conclusion: "На сервере не задан ключ OpenRouter (переменная OPENROUTER_API_KEY в файле .env в корне проекта).",
        action: "Создайте .env по образцу .env.example, укажите ключ, перезапустите окно с API и обновите страницу дашборда.",
      };
    }
    if (code === "rate_limited") {
      return {
        fact,
        conclusion: "Провайдер модели вернул ограничение по частоте запросов (429).",
        action: "Подождите минуту и повторите вопрос или проверьте лимиты/тариф в кабинете OpenRouter.",
      };
    }
    if (status === 400 && msg) {
      return {
        fact,
        conclusion: `Запрос к API отклонён: ${msg}`,
        action: "Сократите или переформулируйте вопрос (максимум 4000 символов).",
      };
    }
    return {
      fact,
      conclusion: `API вернул ошибку (${status || "—"})${msg ? `: ${msg}` : ""}.`,
      action: "Проверьте консоль окна, где запущен node server/index.js, квоту ключа и повторите запрос.",
    };
  }

  async function askCloudLlm(question, data) {
    const fullContext = data;
    const body = JSON.stringify({
      question,
      context: fullContext,
      contextExpanded: fullContext,
    });
    const attempts = 5;
    const pauseMs = 600;

    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, pauseMs));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), runtimeLlm.timeoutMs);
      try {
        const res = await fetch(runtimeLlm.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body,
        });
        const raw = await res.text();
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (_) {
          json = null;
        }
        if (!res.ok) {
          const errCode = json?.errorCode || "";
          if (errCode === "provider_not_configured" || errCode === "rate_limited" || res.status === 400) {
            return apiErrorAnswer(res.status, json);
          }
          return aiAnswer(question, data);
        }
        const modelAnswer = {
          fact: json?.fact,
          conclusion: json?.conclusion,
          action: json?.action,
        };
        if (!hasValidStructuredAnswer(modelAnswer)) {
          return aiAnswer(question, data);
        }
        return modelAnswer;
      } catch {
        /* retry */
      } finally {
        clearTimeout(timer);
      }
    }

    return aiAnswer(question, data);
  }

  function wireAi(data) {
    const log = document.getElementById("aiLog");
    const input = document.getElementById("aiInput");
    const btn = document.getElementById("aiSend");

    function pushBubble(text, ai) {
      const div = document.createElement("div");
      div.className = `bubble ${ai ? "ai" : ""}`;
      div.innerHTML = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    const submitQuestion = async () => {
      const q = (input?.value || "").trim();
      if (!q) return;
      pushBubble(escapeHtml(q), false);
      input.value = "";
      const pending = pushBubble('<div class="block-title">Ответ</div>Думаю...', true);
      const { fact, conclusion, action } = await askCloudLlm(q, data);
      pending.innerHTML =
        `<div class="block-title">Факт</div>${escapeHtml(fact)}` +
          `<div class="block-title" style="margin-top:8px">Вывод</div>${escapeHtml(conclusion)}` +
          `<div class="block-title" style="margin-top:8px">Действие</div>${escapeHtml(action)}`;
      log.scrollTop = log.scrollHeight;
    };

    btn?.addEventListener("click", submitQuestion);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });
  }

  async function boot() {
    try {
      const [dashRes, brandRes] = await Promise.all([
        fetch("data/toir.json", { cache: "no-store" }),
        fetch("assets/brand.json", { cache: "no-store" }),
      ]);
      const data = await dashRes.json();
      window.dashboardData = data;
      if (brandRes.ok) {
        const brand = await brandRes.json();
        U.applyBrandTokens(brand);
      }
      wireUi(data);
      wireAi(data);
    } catch (e) {
      console.error(e);
      document.getElementById("footerSource").textContent = "Ошибка загрузки data/toir.json";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
