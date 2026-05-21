(function () {
  const U = window.ToirUtils;
  const Charts = window.ToirCharts;
  const THEME_STORAGE_KEY = "toir-theme";

  function syncThemeToggleButton() {
    const btn = document.getElementById("btnThemeToggle");
    if (!btn) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    const nextLabel = dark ? "Включить светлую тему" : "Включить тёмную тему";
    btn.title = nextLabel;
    btn.setAttribute("aria-label", nextLabel);
    btn.textContent = dark ? "☼" : "☾";
  }

  function applyDashboardTheme(mode) {
    const m = mode === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", m);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, m);
    } catch (_) {}
    syncThemeToggleButton();
    if (window.__toirBrandJson && U.applyBrandTokens) {
      U.applyBrandTokens(window.__toirBrandJson);
    }
  }

  const runtimeLlm = {
    baseUrl: window.TOIR_API_URL || "http://localhost:8787/api/chat",
    timeoutMs: 45000,
  };

  let assistantContextLive = null;
  /** Устанавливается внутри wireUi после первой инициализации. */
  let applyFreshDashboardData = null;

  function getDashboardApiOrigin() {
    try {
      const u = new URL(window.TOIR_API_URL || "http://localhost:8787/api/chat");
      return u.origin;
    } catch (e) {
      return "http://localhost:8787";
    }
  }

  function dashboardApiFetch(url, init) {
    const T = window.ToirDashboardAuth;
    if (T && typeof T.apiFetch === "function") return T.apiFetch(url, init);
    return fetch(url, init);
  }

  const dashboardSessionId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let dashboardLifecyclePagehideBound = false;

  function postDashboardLifecycle(phase) {
    const url = `${getDashboardApiOrigin()}/api/dashboard/lifecycle`;
    const body = JSON.stringify({ phase, surface: "web", sessionId: dashboardSessionId });
    const headers = Object.assign(
      { "Content-Type": "application/json", Accept: "application/json" },
      window.ToirDashboardAuth && typeof window.ToirDashboardAuth.authHeaders === "function"
        ? window.ToirDashboardAuth.authHeaders()
        : {}
    );
    if (phase === "close") {
      fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {});
      return;
    }
    dashboardApiFetch(url, { method: "POST", headers, body }).catch(() => {});
  }

  function isElectronRenderer() {
    return typeof navigator !== "undefined" && String(navigator.userAgent || "").includes("Electron");
  }

  function wireDashboardLifecycleAudit() {
    if (isElectronRenderer()) return;
    if (dashboardLifecyclePagehideBound) return;
    dashboardLifecyclePagehideBound = true;
    postDashboardLifecycle("open");
    window.addEventListener("pagehide", () => postDashboardLifecycle("close"));
  }

  function classifyClass(name) {
    if (!name) return "Прочее";
    const s = String(name);
    if (
      /станок|токарн|фрезер|сверлил|шлиф|пресс|долб|заточ|расточ|протяж|электроэрозион|ленточнопиль|форматно|кромкооблицов|рейсмус|фуговальн|зубофрезерн|токарно-карусельн|продольно-фрезерн|листогибочн|гильотин/i.test(s)
    )
      return "Станки и металлообработка";
    if (/насос/i.test(s)) return "Насосы";
    if (/компрессор/i.test(s)) return "Компрессоры";
    if (/кран|тельфер|\bталь\b/i.test(s)) return "Крановое оборудование";
    if (/погрузчик|экскаватор|самосвал|бульдозер|тягач/i.test(s)) return "Самоходная техника";
    if (/трансформатор|электродвигатель|генератор|вентилятор/i.test(s)) return "Электрооборудование";
    if (/робот|сварочн/i.test(s)) return "Сварка и роботы";
    if (/конвейер|грохот|дробилк|мельниц|центрифуг|котёл|холодильн|гидропресс/i.test(s)) return "Прочее промышленное";
    return "Прочее";
  }

  /** Класс из отчёта «Список оборудования» (tables.equipmentClassByName), иначе эвристика classifyClass. */
  function equipmentClassFromData(data, name) {
    if (name == null) return "Прочее";
    const nm = String(name);
    if (nm === "Итого") return classifyClass(nm);
    const map = data && data.tables && data.tables.equipmentClassByName;
    if (map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, nm)) {
      const v = map[nm];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return classifyClass(nm);
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

  function periodFilterLabel(periodValue) {
    if (periodValue === "h1") return "1-е полугодие 2025";
    if (periodValue === "h2") return "2-е полугодие 2025";
    return "12 мес.";
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  const chartHeightCache = Object.create(null);
  let chartHeightLayoutMode = null;

  function chartHeightLayoutModeKey() {
    return window.matchMedia("(max-width: 899px)").matches ? "mobile" : "desktop";
  }

  function clearChartHeightCache() {
    for (const key of Object.keys(chartHeightCache)) delete chartHeightCache[key];
    chartHeightLayoutMode = null;
  }

  /** Высота только из карточки (.chart-box), с кэшем — при догрузке данных размеры не прыгают. */
  function getChartHeight(targetSel, options = {}) {
    const { fallback = 260, min = 200, max = 460, force = false } = options;
    const layoutMode = chartHeightLayoutModeKey();
    if (chartHeightLayoutMode !== layoutMode) {
      clearChartHeightCache();
      chartHeightLayoutMode = layoutMode;
    }
    if (!force && targetSel && chartHeightCache[targetSel] > 0) {
      return chartHeightCache[targetSel];
    }

    const el = targetSel ? document.querySelector(targetSel) : null;
    const box = el?.closest?.(".chart-box") || el;
    let measured = 0;
    if (box) {
      measured = Math.round(box.getBoundingClientRect().height || 0);
      if (measured < 48) {
        const minCss = parseFloat(getComputedStyle(box).minHeight);
        if (Number.isFinite(minCss) && minCss > 0) measured = Math.round(minCss);
      }
    }
    const height = Math.round(clampNumber(measured > 0 ? measured : fallback, min, max));
    if (targetSel) chartHeightCache[targetSel] = height;
    return height;
  }

  function getSeriesPointCount(chartSpec) {
    const categoriesCount = Array.isArray(chartSpec?.categories) ? chartSpec.categories.length : 0;
    if (categoriesCount > 0) return categoriesCount;
    const firstSeries = Array.isArray(chartSpec?.series) ? chartSpec.series[0] : null;
    return Array.isArray(firstSeries?.data) ? firstSeries.data.length : 0;
  }

  function round2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function sumMonthlyBySet(monthlyMap, monthSet) {
    if (!monthlyMap || typeof monthlyMap !== "object") return null;
    let sum = 0;
    let hasValues = false;
    for (const [monthKey, raw] of Object.entries(monthlyMap)) {
      if (monthSet && monthSet.size > 0 && !monthSet.has(monthKey)) continue;
      const value = Number(raw) || 0;
      sum += value;
      hasValues = true;
    }
    return hasValues ? round2(sum) : null;
  }

  function resolvePersonnelMonths(personnelOrgPayload) {
    const metaMonths = Array.isArray(personnelOrgPayload?.meta?.months)
      ? personnelOrgPayload.meta.months.map((m) => String(m || "").trim()).filter(Boolean)
      : [];
    if (metaMonths.length > 0) return metaMonths;

    const rowWithMonths = (personnelOrgPayload?.table?.rows || []).find((r) => r && r.monthly_fact_h);
    if (rowWithMonths && rowWithMonths.monthly_fact_h && typeof rowWithMonths.monthly_fact_h === "object") {
      const keys = Object.keys(rowWithMonths.monthly_fact_h);
      if (keys.length > 0) return keys;
    }

    const departmentWithMonths = (personnelOrgPayload?.departments || []).find((r) => r && r.monthly_fact_h);
    if (
      departmentWithMonths &&
      departmentWithMonths.monthly_fact_h &&
      typeof departmentWithMonths.monthly_fact_h === "object"
    ) {
      const keys = Object.keys(departmentWithMonths.monthly_fact_h);
      if (keys.length > 0) return keys;
    }
    return [];
  }

  function buildPersonnelRowsForPeriod(personnelPayload, personnelOrgPayload, periodValue) {
    const fallbackRows = Array.isArray(personnelPayload?.table?.rows) ? personnelPayload.table.rows : [];
    const orgRows = Array.isArray(personnelOrgPayload?.table?.rows) ? personnelOrgPayload.table.rows : [];
    if (orgRows.length === 0) return fallbackRows;

    const months = resolvePersonnelMonths(personnelOrgPayload);
    const monthSet = monthSetFromPeriod(periodValue || "all", months);
    const byEmployee = new Map();

    for (const row of orgRows) {
      const employee = String(row?.employee || "").trim();
      if (!employee) continue;
      const factFromMonths = sumMonthlyBySet(row?.monthly_fact_h, monthSet);
      const planFromMonths = sumMonthlyBySet(row?.monthly_plan_h, monthSet);
      const fact = factFromMonths != null ? factFromMonths : round2(Number(row?.fact_h) || 0);
      const plan = planFromMonths != null ? planFromMonths : round2(Number(row?.plan_h) || 0);
      if (!byEmployee.has(employee)) {
        byEmployee.set(employee, { employee, fact_h: 0, plan_h: 0 });
      }
      const acc = byEmployee.get(employee);
      acc.fact_h = round2(acc.fact_h + fact);
      acc.plan_h = round2(acc.plan_h + plan);
    }

    const rows = [...byEmployee.values()].map((r) => ({
      employee: r.employee,
      fact_h: round2(r.fact_h),
      plan_h: round2(r.plan_h),
      utilization_pct: r.plan_h > 0 ? round2((r.fact_h / r.plan_h) * 100) : null,
    }));
    rows.sort((a, b) => b.fact_h - a.fact_h);
    return rows;
  }

  function buildPersonnelChartFromRows(rows, fallbackChart) {
    if (!Array.isArray(rows) || rows.length === 0) return fallbackChart || null;
    const topRows = [...rows].sort((a, b) => b.fact_h - a.fact_h).slice(0, 10);
    return {
      type: "chart",
      title: fallbackChart?.title || "",
      chartType: fallbackChart?.chartType || "bar",
      categories: topRows.map((r) => r.employee),
      series: [
        { name: "Факт, ч", data: topRows.map((r) => round2(r.fact_h)) },
        { name: "План, ч", data: topRows.map((r) => round2(r.plan_h)) },
      ],
    };
  }

  function buildDepartmentRowsForPeriod(personnelOrgPayload, periodValue) {
    const departments = Array.isArray(personnelOrgPayload?.departments) ? personnelOrgPayload.departments : [];
    if (departments.length === 0) return [];

    const months = resolvePersonnelMonths(personnelOrgPayload);
    const monthSet = monthSetFromPeriod(periodValue || "all", months);
    const rows = departments.map((row) => {
      const factFromMonths = sumMonthlyBySet(row?.monthly_fact_h, monthSet);
      const planFromMonths = sumMonthlyBySet(row?.monthly_plan_h, monthSet);
      const fact = factFromMonths != null ? factFromMonths : round2(Number(row?.fact_h) || 0);
      const plan = planFromMonths != null ? planFromMonths : round2(Number(row?.plan_h) || 0);
      return {
        organization: String(row?.organization || ""),
        department: String(row?.department || ""),
        fact_h: round2(fact),
        plan_h: round2(plan),
      };
    });
    rows.sort((a, b) => b.fact_h - a.fact_h);
    return rows;
  }

  function buildDepartmentChartFromRows(rows, fallbackChart) {
    if (!Array.isArray(rows) || rows.length === 0) return fallbackChart || null;
    const top = rows.slice(0, 12);
    return {
      type: "chart",
      title: fallbackChart?.title || "",
      chartType: fallbackChart?.chartType || "bar",
      categories: top.map((r) => `${r.department} · ${r.organization}`),
      series: [
        { name: "Факт, ч", data: top.map((r) => round2(r.fact_h)) },
        { name: "План, ч", data: top.map((r) => round2(r.plan_h)) },
      ],
    };
  }

  function buildEquipmentRows(data, monthSet, classNameFilter) {
    const costs = data.tables.equipmentCosts || {};
    const ktgMap = data.tables.ktg || {};
    const defects = data.tables.equipmentDefects || {};
    const rows = [];
    for (const [name, info] of Object.entries(costs)) {
      const cls = equipmentClassFromData(data, name);
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
        if (equipmentClassFromData(data, name) !== classFilter) continue;
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
        .map((r) => {
          const cls = shortenTableLabel(r.class, 18);
          return `<tr>
          <td title="${escapeAttr(r.class)}">${escapeHtml(cls)}</td>
          <td>${r.qty}</td>
          <td>${U.formatMoneyMln(r.costs)}</td>
          <td>${U.formatHours(r.downtime)}</td>
          <td>${r.failures}</td>
          <td>${r.ktg != null ? r.ktg.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}</td>
        </tr>`;
        })
        .join("");
    }
    if (tbodyTop) {
      tbodyTop.innerHTML = topRows
        .map((r) => {
          const name = shortenTableLabel(r.name, 22);
          return `<tr>
          <td title="${escapeAttr(r.name)}">${escapeHtml(name)}</td>
          <td>${U.formatMoneyMln(r.cost)}</td>
          <td>${U.formatHours(r.downtime)}</td>
          <td>${r.failures}</td>
          <td>${r.ktg != null ? (r.ktg / 100).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}</td>
        </tr>`;
        })
        .join("");
    }
  }

  function isMobileTableLayout() {
    return window.matchMedia("(max-width: 899px)").matches;
  }

  function shortenTableLabel(value, maxLen) {
    const text = String(value ?? "").trim();
    if (!isMobileTableLayout() || text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
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

  function renderPersonnelDlp(payload, options = {}) {
    const section = document.getElementById("personnelDlpSection");
    if (!section) return;

    const periodValue = options?.periodValue || "all";
    const personnelOrgPayload = options?.personnelOrgPayload || null;
    const rows = buildPersonnelRowsForPeriod(payload, personnelOrgPayload, periodValue);
    if (!Array.isArray(rows) || rows.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const sub = document.getElementById("personnelDlpSub");
    if (sub) {
      const source = payload?.meta?.source || "встроено в data/toir.json";
      const count = rows.length;
      sub.textContent = `Source: ${source} · employees: ${count} · slice: ${periodFilterLabel(periodValue)}`;
    }

    const chartBox = document.getElementById("chartPersonnelDlp");
    if (chartBox) {
      const chartSpec = buildPersonnelChartFromRows(rows, payload?.chart || null);
      if (chartSpec && typeof Charts?.renderAgentChart === "function") {
        const points = getSeriesPointCount(chartSpec);
        const personnelHeight = getChartHeight("#chartPersonnelDlp", {
          fallback: 320,
          min: 260,
          max: 440,
          ratio: 0.56,
          items: points,
          perItem: 20,
          basePad: 96,
        });
        Charts.renderAgentChart(chartSpec, "#chartPersonnelDlp", personnelHeight);
      } else {
        chartBox.textContent = "В data/toir.json нет блока personnelUsage или нет данных для графика";
      }
    }
  }

  function renderPersonnelOrgUsage(payload, options = {}) {
    const section = document.getElementById("personnelOrgSection");
    if (!section) return;

    const periodValue = options?.periodValue || "all";
    const rows = payload?.table?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const sub = document.getElementById("personnelOrgSub");
    if (sub) {
      const source = payload?.meta?.source || "встроено в data/toir.json";
      const orgCount = Number(payload?.meta?.organizations_count) || 0;
      const depCount = Number(payload?.meta?.departments_count) || 0;
      const empCount = rows.length;
      sub.textContent = `Source: ${source} · orgs: ${orgCount} · departments: ${depCount} · employees: ${empCount} · slice: ${periodFilterLabel(periodValue)}`;
    }

    const chartBox = document.getElementById("chartPersonnelOrg");
    if (chartBox) {
      const departmentRows = buildDepartmentRowsForPeriod(payload, periodValue);
      const chartSpec = buildDepartmentChartFromRows(departmentRows, payload?.chart || null);
      if (chartSpec && typeof Charts?.renderAgentChart === "function") {
        const points = getSeriesPointCount(chartSpec);
        const personnelHeight = getChartHeight("#chartPersonnelOrg", {
          fallback: 320,
          min: 260,
          max: 440,
          ratio: 0.56,
          items: points,
          perItem: 20,
          basePad: 96,
        });
        Charts.renderAgentChart(chartSpec, "#chartPersonnelOrg", personnelHeight);
      } else {
        chartBox.textContent = "В data/toir.json нет блока personnelOrgUsage или нет данных для графика";
      }
    }
  }

  function buildAssistantContext(data, personnelData, personnelOrgData) {
    const semanticDictionary = {
      repairs_staff_workload:
        "Запросы про ремонты сотрудников, выполненные работы сотрудников, загрузку персонала и трудозатраты сотрудников относятся к одному и тому же годовому срезу по персоналу.",
      link_to_material_labor:
        "Годовой срез по сотрудникам нужно сопоставлять со структурой работ по месяцам, где labor_h отражает трудозатраты в часах, а material_rub — материальные затраты в рублях.",
      org_department_slice:
        "Запросы про загрузку персонала по организациям и подразделениям относятся к детализированному срезу по сотрудникам с группировками organization и department.",
    };

    const ctx = { ...data, semanticDictionary };

    if (personnelData && Array.isArray(personnelData?.table?.rows)) {
      ctx.personnel = {
        meta: personnelData.meta || {},
        table: {
          title: personnelData?.table?.title || "",
          columns: Array.isArray(personnelData?.table?.columns) ? personnelData.table.columns : [],
          rows: personnelData.table.rows,
        },
      };
    }

    if (personnelOrgData && Array.isArray(personnelOrgData?.table?.rows)) {
      ctx.personnelByOrganization = {
        meta: personnelOrgData.meta || {},
        table: {
          title: personnelOrgData?.table?.title || "",
          columns: Array.isArray(personnelOrgData?.table?.columns) ? personnelOrgData.table.columns : [],
          rows: personnelOrgData.table.rows,
        },
        departments: Array.isArray(personnelOrgData?.departments) ? personnelOrgData.departments : [],
        organizations: Array.isArray(personnelOrgData?.organizations) ? personnelOrgData.organizations : [],
      };
    }

    return ctx;
  }


  function aggregateEquipmentUsageForDonut(pctMap) {
    const ORDER = ["0–50%", "50–100%", "100–150%", "150–200%", "Свыше 200%"];
    const agg = {};
    ORDER.forEach((k) => {
      agg[k] = 0;
    });
    let units = 0;
    for (const pct of Object.values(pctMap || {})) {
      if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0) continue;
      units++;
      let lab = ORDER[4];
      if (pct < 50) lab = ORDER[0];
      else if (pct < 100) lab = ORDER[1];
      else if (pct < 150) lab = ORDER[2];
      else if (pct < 200) lab = ORDER[3];
      agg[lab]++;
    }
    const labels = [];
    const counts = [];
    for (const lab of ORDER) {
      if (agg[lab] > 0) {
        labels.push(lab);
        counts.push(agg[lab]);
      }
    }
    return { labels, counts, units };
  }

  function renderEquipmentUsageDonutChart(data) {
    const pctMap = data.tables?.equipmentUsagePct || {};
    const sub = document.getElementById("chartWearSub");
    const { labels, counts, units } = aggregateEquipmentUsageForDonut(pctMap);
    if (sub) {
      sub.textContent =
        units > 0
          ? `Отчёт «Список оборудования» · столбец «Процент использования» · всего ${units} ед. с числом`
          : 'Не удалось прочитать «Процент использования» — проверьте столбец в файле «Список оборудования».';
    }
    const donutHeight = getChartHeight("#chartEquipmentUsageDonut", {
      fallback: 320,
      min: 240,
      max: 420,
      ratio: 0.56,
    });
    Charts.renderEquipmentUsageDonut(labels, counts, "#chartEquipmentUsageDonut", donutHeight);
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
    syncFilterSelectTitle(selectEl);
  }

  function syncFilterSelectTitle(selectEl) {
    if (!selectEl) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    const label = opt ? String(opt.textContent || "").trim() : "";
    if (label) selectEl.title = label;
    else selectEl.removeAttribute("title");
  }

  function updateHeaderChips(periodValue, classValue, rows) {
    const periodChip = document.getElementById("chipPeriod");
    const classChip = document.getElementById("chipClass");
    const countChip = document.getElementById("chipEquipCount");

    const periodMap = {
      all: "Последние 12 мес.",
      h1: "1-е полугодие 2025",
      h2: "2-е полугодие 2025",
    };
    if (periodChip) periodChip.textContent = periodMap[periodValue] || "Последние 12 мес.";
    if (classChip) classChip.textContent = classValue === "__all__" ? "Все классы" : classValue;
    if (countChip) countChip.textContent = String(rows.length || 0);
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

  const diagChartInstances = new Map();

  function disposeDiagCharts() {
    diagChartInstances.forEach((chart) => {
      try {
        if (chart && typeof chart.destroy === "function") chart.destroy();
      } catch (_) {}
    });
    diagChartInstances.clear();
  }

  function diagFormatValue(value, format) {
    if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) {
      return "—";
    }
    if (format === "pct") {
      const v = Number(value);
      return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
    }
    if (format === "money") {
      const v = Number(value);
      return Number.isFinite(v) ? v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—";
    }
    if (format === "hours" || format === "num1") {
      const v = Number(value);
      return Number.isFinite(v)
        ? v.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })
        : "—";
    }
    if (format === "int") {
      const v = Number(value);
      return Number.isFinite(v) ? v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—";
    }
    if (format === "ratio") {
      const v = Number(value);
      return Number.isFinite(v) ? v.toFixed(2) : "—";
    }
    return String(value);
  }

  function renderDiagEvidence(container, evidence, diagId) {
    if (!evidence) return;
    if (evidence.type === "table") {
      const wrap = document.createElement("div");
      wrap.className = "diag-evidence diag-evidence--table";
      if (evidence.title) {
        const cap = document.createElement("div");
        cap.className = "diag-evidence-title";
        cap.textContent = evidence.title;
        wrap.appendChild(cap);
      }
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      (evidence.columns || []).forEach((c) => {
        const th = document.createElement("th");
        th.textContent = c.label || c.key;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      (evidence.rows || []).forEach((row) => {
        const trb = document.createElement("tr");
        (evidence.columns || []).forEach((c) => {
          const td = document.createElement("td");
          td.textContent = diagFormatValue(row[c.key], c.format);
          trb.appendChild(td);
        });
        tbody.appendChild(trb);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      return;
    }
    if (evidence.type === "chart") {
      const wrap = document.createElement("div");
      wrap.className = "diag-evidence diag-evidence--chart";
      if (evidence.title) {
        const cap = document.createElement("div");
        cap.className = "diag-evidence-title";
        cap.textContent = evidence.title;
        wrap.appendChild(cap);
      }
      const chartEl = document.createElement("div");
      chartEl.className = "diag-evidence-chart";
      chartEl.id = `diag-chart-${diagId}`;
      wrap.appendChild(chartEl);
      container.appendChild(wrap);
      try {
        if (typeof ApexCharts !== "undefined") {
          const base = U.getBaseChartOptions ? U.getBaseChartOptions() : {};
          const opts = {
            ...base,
            chart: Object.assign({}, base.chart || {}, {
              type: evidence.chartType || "bar",
              height: 220,
              toolbar: { show: false },
              parentHeightOffset: 0,
            }),
            series: evidence.series || [],
            xaxis: Object.assign({}, base.xaxis || {}, { categories: evidence.categories || [] }),
            dataLabels: { enabled: false },
            grid: Object.assign({}, base.grid || {}, { padding: { left: 0, right: 0, top: 4, bottom: 0 } }),
            legend: Object.assign({}, base.legend || {}, { position: "top", fontSize: "11px" }),
          };
          const ch = new ApexCharts(chartEl, opts);
          ch.render();
          diagChartInstances.set(diagId, ch);
        }
      } catch (_) {}
    }
  }

  function diagStatusLabel(status) {
    if (status === "triggered") return "Сработала";
    if (status === "not_triggered") return "Не сработала";
    return "Нет данных";
  }

  function diagConfidenceLabel(conf) {
    if (conf === "high") return "Уверенность: высокая";
    if (conf === "low") return "Уверенность: низкая";
    return "Уверенность: средняя";
  }

  function diagEvidenceIsEmpty(evidence) {
    if (!evidence) return true;
    if (evidence.type === "table") {
      return !Array.isArray(evidence.rows) || evidence.rows.length === 0;
    }
    if (evidence.type === "chart") {
      const cats = Array.isArray(evidence.categories) ? evidence.categories : [];
      const series = Array.isArray(evidence.series) ? evidence.series : [];
      const hasData = series.some((s) =>
        Array.isArray(s && s.data) && s.data.some((v) => Number.isFinite(Number(v)) && Number(v) !== 0)
      );
      return !cats.length || !hasData;
    }
    return false;
  }

  function diagBasisFootnote(lines) {
    if (!Array.isArray(lines) || !lines.length) return "";
    const joined = lines
      .map((s) => String(s || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" · ");
    if (!joined) return "";
    return joined.length > 240 ? `${joined.slice(0, 237)}…` : joined;
  }

  function renderDiagCard(diag) {
    const card = document.createElement("div");
    card.className = `card diag-card diag-card--${diag.status}`;
    card.dataset.diagId = diag.id;

    const head = document.createElement("div");
    head.className = "diag-card-head";

    const title = document.createElement("div");
    title.className = "diag-card-title";
    const idEl = document.createElement("span");
    idEl.className = "diag-card-id";
    idEl.textContent = diag.id;
    const titleText = document.createElement("span");
    titleText.className = "diag-card-titletext";
    titleText.textContent = diag.title;
    title.appendChild(idEl);
    title.appendChild(titleText);

    const badge = document.createElement("span");
    badge.className = `diag-badge diag-badge--${diag.status}`;
    badge.textContent = diagStatusLabel(diag.status);

    const confEl = document.createElement("span");
    const conf = diag.confidence || "medium";
    confEl.className = `diag-confidence diag-confidence--${conf}`;
    confEl.textContent = diagConfidenceLabel(conf);

    const badges = document.createElement("div");
    badges.className = "diag-card-badges";
    badges.appendChild(badge);
    badges.appendChild(confEl);

    head.appendChild(title);
    head.appendChild(badges);

    const body = document.createElement("div");
    body.className = "diag-card-body";

    const summary = document.createElement("div");
    summary.className = "diag-card-summary";
    summary.innerHTML = `<b>Факт.</b> ${diag.summary || ""}`;
    body.appendChild(summary);

    if (diag.recommendation) {
      const rec = document.createElement("div");
      rec.className = "diag-card-recommendation";
      rec.innerHTML = `<b>Что делать.</b> ${diag.recommendation}`;
      body.appendChild(rec);
    }

    if (diag.evidence_notes && diag.evidence_notes.length) {
      const notes = document.createElement("ul");
      notes.className = "diag-card-notes";
      diag.evidence_notes.forEach((n) => {
        const li = document.createElement("li");
        li.textContent = n;
        notes.appendChild(li);
      });
      body.appendChild(notes);
    }

    if (diag.warning && diag.status !== "insufficient_data") {
      const warn = document.createElement("div");
      warn.className = "diag-card-warning";
      warn.textContent = diag.warning;
      body.appendChild(warn);
    }

    const explainLines = Array.isArray(diag.explanation) ? diag.explanation : [];
    if (explainLines.length) {
      const explain = document.createElement("details");
      explain.className = "diag-card-explain";
      const sumEx = document.createElement("summary");
      sumEx.textContent = "Развёрнуто: логика проверки";
      explain.appendChild(sumEx);
      const exBody = document.createElement("div");
      exBody.className = "diag-card-explain-body";
      explainLines.forEach((para) => {
        const p = document.createElement("p");
        p.textContent = para;
        exBody.appendChild(p);
      });
      explain.appendChild(exBody);
      body.appendChild(explain);
    }

    const metLines = Array.isArray(diag.confidence_metrics) ? diag.confidence_metrics : [];
    const basisText = diagBasisFootnote(metLines);
    if (basisText) {
      const basis = document.createElement("div");
      basis.className = "diag-card-basis";
      basis.textContent = basisText;
      body.appendChild(basis);
    }

    if (diag.evidence && !diagEvidenceIsEmpty(diag.evidence)) {
      const details = document.createElement("details");
      details.className = "diag-card-details";
      const sum = document.createElement("summary");
      sum.textContent = "Показать данные";
      details.appendChild(sum);
      const evWrap = document.createElement("div");
      evWrap.className = "diag-card-evidence-wrap";
      details.appendChild(evWrap);
      details.addEventListener("toggle", () => {
        if (details.open && !evWrap.dataset.rendered) {
          renderDiagEvidence(evWrap, diag.evidence, diag.id);
          evWrap.dataset.rendered = "1";
        }
      });
      body.appendChild(details);
    }

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  let lastDiagState = null;
  let lastDiagWideMode = null;

  function isDiagWide() {
    return !!(window.matchMedia && window.matchMedia("(min-width: 721px)").matches);
  }

  function renderDiagnostics(data, period, classFilter) {
    const Diag = window.ToirDiagnostics;
    const list = document.getElementById("diagnosticsList");
    if (!list || !Diag) return;

    lastDiagState = { data, period: period || "all", class: classFilter || "__all__" };
    lastDiagWideMode = isDiagWide();

    disposeDiagCharts();
    list.innerHTML = "";

    const results = Diag.analyzeAll(data, { period: lastDiagState.period, class: lastDiagState.class });
    const summary = Diag.summarize(results);

    const cnTr = document.getElementById("diagCountTriggered");
    const cnIn = document.getElementById("diagCountInsufficient");
    const cnTot = document.getElementById("diagCountTotal");
    if (cnTr) cnTr.textContent = String(summary.triggered);
    if (cnIn) cnIn.textContent = String(summary.insufficient_data);
    if (cnTot) cnTot.textContent = String(summary.total);

    const cov = document.getElementById("diagCoverage");
    if (cov) {
      const classNote = classFilter && classFilter !== "__all__" ? ` · класс: ${classFilter}` : "";
      const periodLabel = period === "h1" ? "1-е полугодие 2025" : period === "h2" ? "2-е полугодие 2025" : "12 мес.";
      cov.textContent = `Сработало ${summary.triggered} из ${summary.total} гипотез. ` +
        `Недостаточно данных для ${summary.insufficient_data} гипотез. ` +
        `Срез: ${periodLabel}${classNote}.`;
    }

    const order = { triggered: 0, not_triggered: 1, insufficient_data: 2 };
    const sorted = [...results].sort((a, b) => {
      const sa = order[a.status] !== undefined ? order[a.status] : 9;
      const sb = order[b.status] !== undefined ? order[b.status] : 9;
      if (sa !== sb) return sa - sb;
      return String(a.id).localeCompare(String(b.id), "en");
    });

    if (lastDiagWideMode) {
      const leftCol = document.createElement("div");
      leftCol.className = "diag-column";
      const rightCol = document.createElement("div");
      rightCol.className = "diag-column";
      list.appendChild(leftCol);
      list.appendChild(rightCol);
      sorted.forEach((diag, idx) => {
        const target = idx % 2 === 0 ? leftCol : rightCol;
        target.appendChild(renderDiagCard(diag));
      });
    } else {
      sorted.forEach((diag) => {
        list.appendChild(renderDiagCard(diag));
      });
    }
  }

  function reflowDiagnosticsIfNeeded() {
    if (!lastDiagState) return;
    const wide = isDiagWide();
    if (wide === lastDiagWideMode) return;
    renderDiagnostics(lastDiagState.data, lastDiagState.period, lastDiagState.class);
  }

  /* Таблицы под графиками скрываем только на диагностике (длинная страница). «Отчёт ТОиР»: таблицы в потоке под отчётом — после фикса [hidden]+layout они не перекрывают контент. */
  const TABS_WITHOUT_GLOBAL_TABLES = new Set(["diagnostics"]);
  const TABS_WITHOUT_KPI_BLOCK = new Set(["reports"]);

  const MOBILE_LAYOUT_MQ = window.matchMedia("(max-width: 899px)");

  function wireFilterPickers(selectEls) {
    const pickers = [];
    let docClickBound = false;

    function closePicker(picker, restoreFocus) {
      if (!picker || !picker.wrap.classList.contains("is-open")) return;
      picker.wrap.classList.remove("is-open");
      picker.trigger.setAttribute("aria-expanded", "false");
      picker.menu.hidden = true;
      if (restoreFocus !== false) picker.trigger.focus();
    }

    function closeAllPickers() {
      for (const p of pickers) closePicker(p, false);
    }

    function syncPicker(picker) {
      const { native, menu, valueEl } = picker;
      menu.replaceChildren();
      const selected = native.value;
      for (const opt of native.options) {
        const li = document.createElement("li");
        li.className = "filter-picker__option";
        li.setAttribute("role", "option");
        li.dataset.value = opt.value;
        li.textContent = opt.textContent;
        const isSel = opt.value === selected;
        li.setAttribute("aria-selected", isSel ? "true" : "false");
        li.classList.toggle("is-selected", isSel);
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          if (native.value !== opt.value) {
            native.value = opt.value;
            native.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            syncPicker(picker);
          }
          closePicker(picker);
        });
        menu.appendChild(li);
      }
      const cur = native.options[native.selectedIndex];
      valueEl.textContent = cur ? cur.textContent : "";
      syncFilterSelectTitle(native);
    }

    function openPicker(picker) {
      for (const p of pickers) {
        if (p !== picker) closePicker(p, false);
      }
      syncPicker(picker);
      picker.menu.hidden = false;
      picker.wrap.classList.add("is-open");
      picker.trigger.setAttribute("aria-expanded", "true");
    }

    function bindLabelFor(picker) {
      const labelId = picker.native.id === "panelPeriod" ? "panelPeriodLabel" : "panelClassLabel";
      const label = document.getElementById(labelId);
      if (!label) return;
      label.htmlFor = MOBILE_LAYOUT_MQ.matches ? picker.trigger.id : picker.native.id;
    }

    function mountPicker(native) {
      if (!native || native.dataset.filterPickerMounted === "1") return null;
      const field = native.closest(".filter-field");
      if (!field) return null;

      const wrap = document.createElement("div");
      wrap.className = "filter-picker";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "filter-picker__trigger";
      trigger.id = `${native.id}Picker`;
      trigger.setAttribute("aria-haspopup", "listbox");
      const labelId = native.id === "panelPeriod" ? "panelPeriodLabel" : "panelClassLabel";
      if (document.getElementById(labelId)) trigger.setAttribute("aria-labelledby", labelId);

      const valueEl = document.createElement("span");
      valueEl.className = "filter-picker__value";
      trigger.appendChild(valueEl);

      const menu = document.createElement("ul");
      menu.className = "filter-picker__menu";
      menu.setAttribute("role", "listbox");
      menu.id = `${native.id}Listbox`;
      menu.hidden = true;
      trigger.setAttribute("aria-controls", menu.id);

      native.classList.add("filter-picker__native");
      field.insertBefore(wrap, native);
      wrap.append(trigger, menu, native);

      const picker = { wrap, native, trigger, menu, valueEl };
      pickers.push(picker);
      native.dataset.filterPickerMounted = "1";

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!MOBILE_LAYOUT_MQ.matches) return;
        if (picker.wrap.classList.contains("is-open")) closePicker(picker);
        else openPicker(picker);
      });

      trigger.addEventListener("keydown", (e) => {
        if (!MOBILE_LAYOUT_MQ.matches) return;
        if (e.key === "Escape") {
          closePicker(picker);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker(picker);
        }
      });

      native.addEventListener("change", () => syncPicker(picker));
      const mo = new MutationObserver(() => syncPicker(picker));
      mo.observe(native, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected"] });

      syncPicker(picker);
      bindLabelFor(picker);
      return picker;
    }

    for (const sel of selectEls) mountPicker(sel);

    if (!docClickBound) {
      docClickBound = true;
      document.addEventListener("click", (e) => {
        if (e.target.closest(".filter-picker")) return;
        closeAllPickers();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAllPickers();
      });
    }

    const onMq = () => {
      closeAllPickers();
      for (const p of pickers) bindLabelFor(p);
    };
    if (typeof MOBILE_LAYOUT_MQ.addEventListener === "function") {
      MOBILE_LAYOUT_MQ.addEventListener("change", onMq);
    } else if (typeof MOBILE_LAYOUT_MQ.addListener === "function") {
      MOBILE_LAYOUT_MQ.addListener(onMq);
    }

    return { closeAllPickers, syncAll: () => pickers.forEach(syncPicker) };
  }

  function applyNavToolbarPlacement() {
    const toolbar = document.getElementById("navCardToolbar");
    const tabsBar = document.getElementById("filtersTabsBar");
    const host = document.getElementById("filtersRowHost");
    const mobileBar = document.getElementById("mobileFilterBar");
    if (!toolbar || !host) return;
    if (MOBILE_LAYOUT_MQ.matches) {
      if (mobileBar) host.insertBefore(toolbar, mobileBar);
      else if (toolbar.parentElement !== host) host.prepend(toolbar);
      return;
    }
    if (tabsBar && toolbar.parentElement !== tabsBar) {
      tabsBar.appendChild(toolbar);
    }
  }

  function wireMobileFiltersSheet(handlers) {
    const filtersRow = document.getElementById("filtersRow");
    const slot = document.getElementById("filtersRowSlot");
    const sheetBody = document.getElementById("mobileFiltersSheetBody");
    const sheet = document.getElementById("mobileFiltersSheet");
    const btnOpen = document.getElementById("btnMobileFilters");
    const btnClose = document.getElementById("btnMobileFiltersClose");
    const backdrop = document.getElementById("mobileFiltersBackdrop");
    if (!filtersRow || !sheet || !sheetBody) return { closeSheet: () => {} };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let closeTimer = null;

    function applyPlacement() {
      if (MOBILE_LAYOUT_MQ.matches) {
        document.body.classList.add("mobile-filters-mode");
        if (filtersRow.parentElement !== sheetBody) sheetBody.appendChild(filtersRow);
      } else {
        closeSheet(false);
        document.body.classList.remove("mobile-filters-mode", "mobile-filters-sheet-open");
        if (slot && filtersRow.parentElement !== slot) slot.appendChild(filtersRow);
      }
      applyNavToolbarPlacement();
    }

    function openSheet() {
      if (!MOBILE_LAYOUT_MQ.matches) return;
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      sheet.hidden = false;
      sheet.setAttribute("aria-hidden", "false");
      sheet.classList.remove("is-closing");
      document.body.classList.add("mobile-filters-sheet-open");
      if (btnOpen) btnOpen.setAttribute("aria-expanded", "true");
      // Force the closed transform to be committed before opening, so the sheet
      // animates reliably even when requestAnimationFrame is throttled.
      void sheet.offsetHeight;
      sheet.classList.add("is-open");
    }

    function closeSheet(restoreFocus) {
      if (sheet.hidden) return;
      if (typeof handlers?.closeFilterPickers === "function") handlers.closeFilterPickers();
      sheet.classList.remove("is-open");
      sheet.classList.add("is-closing");
      sheet.setAttribute("aria-hidden", "true");
      if (btnOpen) {
        btnOpen.setAttribute("aria-expanded", "false");
      }

      const finish = () => {
        sheet.hidden = true;
        sheet.classList.remove("is-closing");
        document.body.classList.remove("mobile-filters-sheet-open");
        closeTimer = null;
        if (btnOpen && restoreFocus !== false) btnOpen.focus();
      };

      if (reduceMotion.matches) {
        finish();
        return;
      }

      closeTimer = setTimeout(finish, 280);
    }

    applyPlacement();

    if (btnOpen) btnOpen.addEventListener("click", openSheet);
    if (btnClose) btnClose.addEventListener("click", () => closeSheet());
    if (backdrop) backdrop.addEventListener("click", () => closeSheet());

    filtersRow.addEventListener("click", (e) => {
      const tabBtn = e.target.closest(".tab");
      if (!tabBtn || !MOBILE_LAYOUT_MQ.matches) return;
      closeSheet(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !sheet.hidden) closeSheet();
    });

    const onMqChange = () => {
      clearChartHeightCache();
      applyPlacement();
      if (typeof handlers?.onLayoutChange === "function") handlers.onLayoutChange();
    };
    if (typeof MOBILE_LAYOUT_MQ.addEventListener === "function") {
      MOBILE_LAYOUT_MQ.addEventListener("change", onMqChange);
    } else if (typeof MOBILE_LAYOUT_MQ.addListener === "function") {
      MOBILE_LAYOUT_MQ.addListener(onMqChange);
    }

    return { closeSheet, applyPlacement };
  }

  function applyTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    document.querySelectorAll(".panel-charts").forEach((p) => {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
    const tablesRow = document.getElementById("tablesRow");
    if (tablesRow) {
      tablesRow.hidden = TABS_WITHOUT_GLOBAL_TABLES.has(name);
    }
    const kpiBlock = document.getElementById("kpiBlock");
    if (kpiBlock) {
      kpiBlock.hidden = TABS_WITHOUT_KPI_BLOCK.has(name);
    }
    const layoutEl = document.querySelector(".layout");
    if (layoutEl) layoutEl.dataset.activeTab = name;
    syncMobileAiDock();
  }

  function wireUi(initialData) {
    let liveData = initialData;
    let allMonths = (liveData.charts && liveData.charts.costsByMonth ? liveData.charts.costsByMonth : []).map(
      (m) => m.month
    );
    let classCatalog = [];

    const periodSel = document.getElementById("panelPeriod");
    const classSel = document.getElementById("panelClass");
    const layoutMain = document.querySelector(".layout-main");
    let resizeTimer = null;

    const filterPickers = wireFilterPickers([periodSel, classSel].filter(Boolean));

    wireMobileFiltersSheet({
      closeFilterPickers: () => filterPickers?.closeAllPickers?.(),
      onLayoutChange: () => {
        filterPickers?.syncAll?.();
        queueChartsResize();
        syncMobileAiDock();
      },
    });

    function queueChartsResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        clearChartHeightCache();
        Charts.resizeAll();
        clearLegacyAiSidebarInlineStyles();
        reflowDiagnosticsIfNeeded();
      }, 120);
    }

    function resetAiSidebarSizing(sidebar) {
      if (!sidebar) return;
      sidebar.style.height = "";
      sidebar.style.alignSelf = "";
      sidebar.style.maxHeight = "";
    }

    /* Высота AI-панели задаётся в CSS (--ai-sidebar-height), без привязки к графикам/вкладкам. */
    function clearLegacyAiSidebarInlineStyles() {
      resetAiSidebarSizing(document.querySelector(".layout-sidebar"));
    }

    function refreshClassOptionsFromLiveData() {
      const monthsAll = (liveData.charts && liveData.charts.costsByMonth ? liveData.charts.costsByMonth : []).map(
        (m) => m.month
      );
      const allRowsForClasses = buildEquipmentRows(liveData, monthSetFromPeriod("all", monthsAll), "__all__");
      const fromRows = allRowsForClasses.map((r) => r.class);
      const map = liveData.tables && liveData.tables.equipmentClassByName;
      const fromReport =
        map && typeof map === "object"
          ? Object.values(map)
              .map((v) => String(v || "").trim())
              .filter(Boolean)
          : [];
      classCatalog = [...new Set([...fromRows, ...fromReport])].sort();
      const prev = classSel?.value || "__all__";
      const preferred = prev !== "__all__" && classCatalog.includes(prev) ? prev : "__all__";
      fillClassSelect(classSel, classCatalog, preferred);
    }

    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTab(btn.dataset.tab);
        queueChartsResize();
        clearLegacyAiSidebarInlineStyles();
        if (btn.dataset.tab === "reports" && window.ToirReports && typeof window.ToirReports.onTabActivated === "function") {
          window.ToirReports.onTabActivated();
        }
      });
    });

    window.addEventListener("resize", queueChartsResize);
    if (layoutMain && typeof ResizeObserver === "function") {
      const layoutResizeObserver = new ResizeObserver(() => {
        queueChartsResize();
      });
      layoutResizeObserver.observe(layoutMain);
    }

    refreshClassOptionsFromLiveData();

    if (window.ToirReports && typeof window.ToirReports.init === "function") {
      window.ToirReports.init({
        getCurrentFilters: () => ({
          period: periodSel?.value || "all",
          class: classSel?.value || "__all__",
        }),
      });
    }

    function renderPersonnelChartsForCurrentFilters() {
      const personnelData =
        liveData.personnelUsage && typeof liveData.personnelUsage === "object" ? liveData.personnelUsage : null;
      const personnelOrgData =
        liveData.personnelOrgUsage && typeof liveData.personnelOrgUsage === "object" ? liveData.personnelOrgUsage : null;
      const periodValue = periodSel?.value || "all";
      renderPersonnelDlp(personnelData, { periodValue, personnelOrgPayload: personnelOrgData });
      renderPersonnelOrgUsage(personnelOrgData, { periodValue });
    }

    const drain = () => {
      syncFilterSelectTitle(periodSel);
      syncFilterSelectTitle(classSel);
      const monthSet = monthSetFromPeriod(periodSel?.value || "all", allMonths);
      const cls = classSel?.value || "__all__";
      const rows = buildEquipmentRows(liveData, monthSet, cls);
      updateHeaderChips(periodSel?.value || "all", cls, rows);
      const agg = aggregateClasses(rows);
      const totalEq = agg.reduce((s, a) => s + a.qty, 0) || 1;
      const cats = agg.map((a) => a.class);
      const vals = agg.map((a) => (100 * a.qty) / totalEq);
      const structPct = vals.map((v) => Math.round(v * 10) / 10);
      const structureHeight = getChartHeight("#chartStructure", {
        fallback: 260,
        min: 220,
        max: 380,
        ratio: 0.52,
        items: cats.length,
        perItem: 24,
        basePad: 92,
      });
      const structureEqHeight = getChartHeight("#chartStructureEq", {
        fallback: 260,
        min: 220,
        max: 380,
        ratio: 0.52,
        items: cats.length,
        perItem: 24,
        basePad: 92,
      });
      Charts.renderStructureByClass(cats, structPct, "#chartStructure", structureHeight);
      Charts.renderStructureByClass(cats, structPct, "#chartStructureEq", structureEqHeight);

      const cm = ((liveData.charts && liveData.charts.costsByMonth) || []).filter((m) => monthSet.has(m.month));
      const costsMln = monthlyCostsSeriesMln(liveData, cm, cls);
      const monthLbl = cm.map((m) => shortMonthLabel(m.month));
      const costsHeroHeight = getChartHeight("#chartCosts", {
        fallback: 320,
        min: 240,
        max: 420,
        ratio: 0.44,
      });
      const costsTabHeight = getChartHeight("#chartCostsTab", {
        fallback: 300,
        min: 250,
        max: 420,
        ratio: 0.54,
      });
      Charts.renderCostsByMonth(monthLbl, costsMln, "#chartCosts", costsHeroHeight);
      Charts.renderCostsByMonth(monthLbl, costsMln, "#chartCostsTab", costsTabHeight);

      const fc = [...((liveData.charts && (liveData.charts.failure_causes || liveData.charts.failureCauses)) || [])].sort(
        (a, b) => b.count - a.count
      );
      const fcLabels = fc.map((x) => x.cause);
      const fcCounts = fc.map((x) => x.count);
      const causesHeight = getChartHeight("#chartCauses", {
        fallback: 260,
        min: 240,
        max: 440,
        ratio: 0.5,
        items: fcLabels.length,
        perItem: 24,
        basePad: 96,
      });
      const causesRelHeight = getChartHeight("#chartCausesRel", {
        fallback: 260,
        min: 240,
        max: 440,
        ratio: 0.5,
        items: fcLabels.length,
        perItem: 24,
        basePad: 96,
      });
      Charts.renderFailureCauses(fcLabels, fcCounts, "#chartCauses", causesHeight);
      Charts.renderFailureCauses(fcLabels, fcCounts, "#chartCausesRel", causesRelHeight);

      const topCostRows = [...rows]
        .filter((r) => r.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);
      const topCostHeight = getChartHeight("#chartTopCostEquip", {
        fallback: 300,
        min: 250,
        max: 440,
        ratio: 0.54,
        items: topCostRows.length,
        perItem: 26,
        basePad: 96,
      });
      Charts.renderTopEquipmentCost(
        topCostRows.map((r) => r.name),
        topCostRows.map((r) => r.cost / 1e6),
        "#chartTopCostEquip",
        topCostHeight
      );

      const aggByCost = [...agg].sort((a, b) => b.costs - a.costs);
      const classDonutHeight = getChartHeight("#chartClassCostDonut", {
        fallback: 300,
        min: 250,
        max: 420,
        ratio: 0.54,
      });
      Charts.renderClassCostDonut(
        aggByCost.map((a) => a.class),
        aggByCost.map((a) => a.costs),
        "#chartClassCostDonut",
        classDonutHeight
      );

      const ktgMonthlyMap = new Map();
      rows.forEach((r) => {
        const k = (liveData.tables.ktg || {})[r.name];
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
        getChartHeight("#chartKtgTrend", {
          fallback: 260,
          min: 220,
          max: 340,
          ratio: 0.5,
        })
      );

      const mtbfTop = ((liveData.charts && liveData.charts.mtbfByEquipment) || [])
        .filter((x) => cls === "__all__" || equipmentClassFromData(liveData, x.equipment) === cls)
        .slice(0, 10);
      Charts.renderMtbfTop(
        mtbfTop.map((x) => x.equipment),
        mtbfTop.map((x) => Number(x.mtbf_h) || 0),
        "#chartMtbfTop",
        getChartHeight("#chartMtbfTop", {
          fallback: 260,
          min: 240,
          max: 440,
          ratio: 0.52,
          items: mtbfTop.length,
          perItem: 24,
          basePad: 96,
        })
      );
      const mttrTop = ((liveData.charts && liveData.charts.mttrByEquipment) || [])
        .filter((x) => cls === "__all__" || equipmentClassFromData(liveData, x.equipment) === cls)
        .slice(0, 10);
      Charts.renderMttrTop(
        mttrTop.map((x) => x.equipment),
        mttrTop.map((x) => Number(x.mttr_h) || 0),
        "#chartMttrTop",
        getChartHeight("#chartMttrTop", {
          fallback: 260,
          min: 240,
          max: 440,
          ratio: 0.52,
          items: mttrTop.length,
          perItem: 24,
          basePad: 96,
        })
      );
      const mlRows = ((liveData.charts && liveData.charts.materialLaborByMonth) || []).filter((m) =>
        monthSet.has(m.month)
      );
      Charts.renderMaterialLaborStacked(
        mlRows.map((m) => shortMonthLabel(m.month)),
        mlRows.map((m) => Number(m.material_rub || m.material || m.material_h || 0)),
        mlRows.map((m) => Number(m.labor_h || m.labor || 0)),
        "#chartMaterialLabor",
        getChartHeight("#chartMaterialLabor", {
          fallback: 300,
          min: 250,
          max: 420,
          ratio: 0.54,
        })
      );

      Charts.renderClassCostsBar(
        aggByCost.map((a) => a.class),
        aggByCost.map((a) => a.costs / 1e6),
        "#chartClassCostsBar",
        getChartHeight("#chartClassCostsBar", {
          fallback: 260,
          min: 230,
          max: 340,
          ratio: 0.5,
        })
      );

      const monthShort = cm.map((m) => m.month);
      renderKpis(rows, liveData, monthShort);

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
            ? `Топ-10 по СВР · класс: ${cls}`
            : "Топ-10 по СВР · все классы";
      }
      const matLabSub = document.getElementById("chartMaterialLaborSub");
      if (matLabSub) {
        matLabSub.textContent =
          cls !== "__all__"
            ? `Материалы (₽) и труд (ч) по месяцам · класс: ${cls}`
            : "Материальные затраты (₽) и трудозатраты (ч) по месяцам";
      }
      const eqStructSub = document.getElementById("chartStructureEqSub");
      if (eqStructSub) {
        eqStructSub.textContent =
          cls !== "__all__" ? "Срез по выбранному классу" : "Доля единиц парка по классам";
      }
      renderEquipmentUsageDonutChart(liveData);

      renderTables(agg, topProblemRows(liveData, monthSet, cls));

      renderDiagnostics(liveData, periodSel?.value || "all", cls);
      renderPersonnelChartsForCurrentFilters();

      document.getElementById("footerSource").textContent =
        `Источник: ${liveData.meta?.source || "—"} → data/toir.json · ${liveData.meta?.period || ""}`;

      requestAnimationFrame(() => {
        Charts.resizeAll();
        clearLegacyAiSidebarInlineStyles();
      });

      if (window.ToirReports && typeof window.ToirReports.syncSliceFromDashboard === "function") {
        window.ToirReports.syncSliceFromDashboard();
      }
    };

    applyFreshDashboardData = function (next) {
      if (!next || typeof next !== "object") return;
      liveData = next;
      window.dashboardData = next;
      allMonths = (liveData.charts && liveData.charts.costsByMonth ? liveData.charts.costsByMonth : []).map(
        (m) => m.month
      );
      refreshClassOptionsFromLiveData();
      drain();
      const personnelData =
        next.personnelUsage && typeof next.personnelUsage === "object" ? next.personnelUsage : null;
      const personnelOrgData =
        next.personnelOrgUsage && typeof next.personnelOrgUsage === "object" ? next.personnelOrgUsage : null;
      assistantContextLive = buildAssistantContext(next, personnelData, personnelOrgData);
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

    function refreshTablesForLayout() {
      const monthSet = monthSetFromPeriod(periodSel?.value || "all", allMonths);
      const cls = classSel?.value || "__all__";
      const rows = buildEquipmentRows(liveData, monthSet, cls);
      renderTables(aggregateClasses(rows), topProblemRows(liveData, monthSet, cls));
    }

    const onLayoutModeMq = () => refreshTablesForLayout();
    if (typeof MOBILE_LAYOUT_MQ.addEventListener === "function") {
      MOBILE_LAYOUT_MQ.addEventListener("change", onLayoutModeMq);
    } else if (typeof MOBILE_LAYOUT_MQ.addListener === "function") {
      MOBILE_LAYOUT_MQ.addListener(onLayoutModeMq);
    }

    drain();
    applyTab("summary");

    syncThemeToggleButton();
    const themeBtn = document.getElementById("btnThemeToggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        applyDashboardTheme(cur === "dark" ? "light" : "dark");
        drain();
        renderDiagnostics(liveData, periodSel?.value || "all", classSel?.value || "__all__");
        if (typeof Charts.applyThemeToAllCharts === "function") Charts.applyThemeToAllCharts();
        Charts.resizeAll();
      });
    }

    const refreshDataBtn = document.getElementById("btnRefreshDashboardData");
    const dataRefreshStatus = document.getElementById("dataRefreshStatus");
    if (refreshDataBtn) {
      refreshDataBtn.addEventListener("click", async () => {
        if (!applyFreshDashboardData) return;
        const prevLabel = refreshDataBtn.textContent;
        refreshDataBtn.disabled = true;
        const setStatus = (text, isError) => {
          if (dataRefreshStatus) {
            dataRefreshStatus.textContent = text || "";
            dataRefreshStatus.dataset.kind = isError ? "error" : "";
          }
        };
        setStatus("", false);
        try {
          setStatus("Загрузка…", false);
          refreshDataBtn.textContent = "Подгрузка…";

          const dashRes = await fetch("data/toir.json", { cache: "no-store" });
          if (!dashRes.ok) throw new Error(`Не удалось прочитать data/toir.json (HTTP ${dashRes.status}).`);
          const next = await dashRes.json();
          if (!next || typeof next !== "object" || (!next.charts && !next.meta)) {
            throw new Error("Файл data/toir.json имеет неожиданный формат.");
          }
          applyFreshDashboardData(next);
          setStatus("", false);
        } catch (err) {
          const msg = String((err && err.message) || err || "Ошибка");
          setStatus(msg, true);
        } finally {
          refreshDataBtn.disabled = false;
          refreshDataBtn.textContent = prevLabel;
        }
      });
    }

    clearLegacyAiSidebarInlineStyles();
  }

  function detectIntentFromQuestion(question) {
    const ql = String(question || "").toLowerCase();
    const hasKtgToken = /ктг|готовност/i.test(ql);
    const hasPersonnelToken = /сотрудник|персонал|бригад|мастер|слесар/i.test(ql);
    const hasRepairWorkToken = /ремонт|работ|трудозатрат|загрузк|выполнен/i.test(ql);
    const hasOrgToken = /организац|компан|подраздел|цех|отдел/i.test(ql);
    const reliabilityCombo =
      (/надёжност|надежност|снно|свв|свр|mtbf|mttr|наработк|восстанов|простой/i.test(ql) || hasKtgToken) &&
      (/обзор|кратк|в целом|состояни|парк|дашборд|оцен|общ/i.test(ql));

    if (/прогноз|предска|forecast/i.test(ql)) return "forecast";
    if (/что делать|что спросить|рекоменд|действ/i.test(ql)) return "recommendation";
    if (reliabilityCombo) return "overview_reliability";
    if ((hasPersonnelToken || hasRepairWorkToken) && hasOrgToken) return "personnel_org_breakdown";
    if (/по\s+(организац|подраздел)/i.test(ql) && /факт|план|выполн|загрузк|трудозатрат/i.test(ql)) return "personnel_org_breakdown";
    if (hasPersonnelToken && hasRepairWorkToken) return "personnel_repair_workload";
    if (/кто.*(ремонт|работ)|сколько.*(ремонт|работ).*(сотруд|персонал)/i.test(ql)) return "personnel_repair_workload";
    if (/кратк|обзор|проанализ|весь дашборд|всего дашборд|в целом|что важного/i.test(ql)) return "dashboard_overview";
    if (/почему.*затрат|затрат.*почему|выросл.*затрат|снизил.*затрат/i.test(ql)) return "why_costs_changed";
    if (/почему.*отказ|отказ.*почему|выросл.*отказ|снизил.*отказ/i.test(ql)) return "why_failures_changed";
    if (
      /сравн|vs|против/i.test(ql) &&
      /месяц|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/.test(ql)
    )
      return "compare_costs_by_month";
    if (/материал|трудозатрат|труд.*материал|структур.*работ|структур.*ремонт|ремонт.*по месяц/i.test(ql)) return "material_labor_structure";
    if (/доля.*затрат.*класс|затрат.*по класс|структур.*затрат.*класс/i.test(ql)) return "class_cost_structure";
    if (hasKtgToken && /снно|mtbf|наработк/i.test(ql) && /причин|причины|отказов/i.test(ql)) return "reliability_combo_qa";
    if (/mtbf|снно|наработк/i.test(ql)) return "mtbf_by_equipment";
    if (/mttr|свв|свр|восстанов/i.test(ql)) return "mttr_by_equipment";
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
      .map(([name, info]) => ({ name, className: equipmentClassFromData(data, name), total: Number(info?.total || 0) }))
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
    const personnelRows = data.personnel?.table?.rows || [];
    const personnelOrgRows = data.personnelByOrganization?.table?.rows || [];
    const departmentRows = data.personnelByOrganization?.departments || [];
    const organizationRows = data.personnelByOrganization?.organizations || [];

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
      if (mttrAvg != null) parts.push(`средняя СВР: ${Math.round(mttrAvg).toLocaleString("ru-RU")} ч`);
      if (ktgAvg != null) parts.push(`средний КТГ: ${ktgAvg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
      const tail = Number.isFinite(total) ? `Затраты: ${U.formatMoneyMln(total)}` : "";
      const head = parts.length ? `${parts.join("; ")}.` : "";
      const fact = [head, tail].filter(Boolean).join(" ").trim();
      return {
        fact,
        conclusion: "Сводка по ключевым метрикам надёжности и доступности парка.",
        action: "Для узких мест разберите объекты с худшими СННО, КТГ и наибольшей СВР.",
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
        conclusion: "СВР отражает длительность восстановления: чем ниже, тем лучше.",
        action: "Проверьте обеспеченность ЗИП и регламенты ремонта для этих объектов.",
      };
    }

    if (intent === "personnel_org_breakdown") {
      if (!personnelOrgRows.length) {
        return noAnswer("В выгрузке нет детализации сотрудников по организациям и подразделениям.");
      }

      const rows = personnelOrgRows
        .map((r) => ({
          organization: r.organization || "—",
          department: r.department || "—",
          employee: r.employee || "—",
          fact: Number(r.fact_h) || 0,
          plan: Number(r.plan_h) || 0,
          utilization: Number(r.utilization_pct) || 0,
        }))
        .sort((a, b) => b.fact - a.fact);

      const totalFact = rows.reduce((s, r) => s + r.fact, 0);
      const totalPlan = rows.reduce((s, r) => s + r.plan, 0);
      const totalUtilization = totalPlan > 0 ? (totalFact / totalPlan) * 100 : 0;

      const topDepartments = departmentRows
        .map((r) => ({
          department: r.department || "—",
          organization: r.organization || "—",
          fact: Number(r.fact_h) || 0,
        }))
        .sort((a, b) => b.fact - a.fact)
        .slice(0, 3);

      const topOrganizations = organizationRows
        .map((r) => ({
          organization: r.organization || "—",
          fact: Number(r.fact_h) || 0,
          utilization: Number(r.utilization_pct) || 0,
        }))
        .sort((a, b) => b.fact - a.fact)
        .slice(0, 3);

      const topEmployees = rows.slice(0, 3);
      const orgFact =
        topOrganizations.length > 0
          ? `Организации (топ): ${topOrganizations
              .map(
                (x) =>
                  `${x.organization} — ${x.fact.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ч (выполнение ${x.utilization.toLocaleString("ru-RU", {
                    maximumFractionDigits: 1,
                  })}%)`
              )
              .join("; ")}. `
          : "";
      const depFact =
        topDepartments.length > 0
          ? `Подразделения (топ): ${topDepartments
              .map((x) => `${x.department} (${x.organization}) — ${x.fact.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ч`)
              .join("; ")}. `
          : "";

      return {
        fact:
          `По срезу организаций и подразделений: факт ${Math.round(totalFact).toLocaleString("ru-RU")} ч при плане ${Math.round(totalPlan).toLocaleString(
            "ru-RU"
          )} ч (${totalUtilization.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%). ` +
          orgFact +
          depFact +
          `Топ сотрудников по факту: ${topEmployees
            .map((x) => `${x.employee} (${x.department}) — ${x.fact.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ч`)
            .join("; ")}.`,
        conclusion:
          "Детализация по организациям и подразделениям показывает, где сосредоточены трудозатраты и какие команды формируют основной вклад.",
        action:
          "Для управленческих решений сравните топ-подразделения по факту с их планом и проверьте сотрудников с наибольшей загрузкой на устойчивость графика работ.",
      };
    }

    if (intent === "personnel_repair_workload") {
      const workloadRows = personnelOrgRows.length ? personnelOrgRows : personnelRows;
      if (!workloadRows.length) {
        return noAnswer("В выгрузке нет годового среза по сотрудникам и выполненным работам.");
      }

      const rows = workloadRows
        .map((r) => ({
          employee: r.employee || "—",
          fact: Number(r.fact_h) || 0,
          plan: Number(r.plan_h) || 0,
          utilization: Number(r.utilization_pct) || 0,
        }))
        .sort((a, b) => b.fact - a.fact);

      const top = rows.slice(0, 3);
      const totalFact = rows.reduce((s, r) => s + r.fact, 0);
      const totalPlan = rows.reduce((s, r) => s + r.plan, 0);
      const totalUtilization = totalPlan > 0 ? (totalFact / totalPlan) * 100 : 0;
      const laborTotal = materialLaborRows.reduce((s, r) => s + (Number(r.labor_h || r.labor || 0) || 0), 0);

      const relationText =
        laborTotal > 0
          ? ` Срез сотрудников соотносится со структурой работ по месяцам: суммарные трудозатраты по месяцам = ${Math.round(laborTotal).toLocaleString("ru-RU")} ч.`
          : "";

      return {
        fact:
          `В годовом срезе сотрудников фактический объем выполненных работ: ${Math.round(totalFact).toLocaleString("ru-RU")} ч при плане ${Math.round(totalPlan).toLocaleString("ru-RU")} ч ` +
          `(${totalUtilization.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%). ` +
          `Топ сотрудников по факту: ${top.map((x) => `${x.employee} — ${x.fact.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ч`).join("; ")}.` +
          relationText,
        conclusion:
          "Запросы про ремонты сотрудников, выполненные работы персонала и трудозатраты сотрудников относятся к одному и тому же годовому показателю по персоналу.",
        action:
          "Для расшифровки динамики сопоставьте этот срез со структурой работ по месяцам и проверьте месяцы с максимальными трудозатратами.",
      };
    }

    if (intent === "material_labor_structure") {
      if (!materialLaborRows.length) return noAnswer("В выгрузке нет структуры работ по трудозатратам и материалам.");
      const totalMaterial = materialLaborRows.reduce(
        (s, r) => s + (Number(r.material_rub || r.material || r.material_h || 0) || 0),
        0
      );
      const totalLabor = materialLaborRows.reduce((s, r) => s + (Number(r.labor_h || r.labor || 0) || 0), 0);
      if (totalMaterial <= 0 && totalLabor <= 0) {
        return noAnswer("В структуре работ нет числовых значений по материалам и труду.");
      }
      const peakMaterial = [...materialLaborRows]
        .map((r) => ({
          month: r.month,
          value: Number(r.material_rub || r.material || r.material_h || 0) || 0,
        }))
        .sort((a, b) => b.value - a.value)[0];
      const peakLabor = [...materialLaborRows]
        .map((r) => ({
          month: r.month,
          value: Number(r.labor_h || r.labor || 0) || 0,
        }))
        .sort((a, b) => b.value - a.value)[0];
      return {
        fact:
          `Материальные затраты: ${Math.round(totalMaterial).toLocaleString("ru-RU")} ₽; ` +
          `трудозатраты: ${Math.round(totalLabor).toLocaleString("ru-RU")} ч. ` +
          `Пик материалов — ${peakMaterial?.month || "н/д"} (${Math.round(peakMaterial?.value || 0).toLocaleString("ru-RU")} ₽); ` +
          `пик труда — ${peakLabor?.month || "н/д"} (${Math.round(peakLabor?.value || 0).toLocaleString("ru-RU")} ч).`,
        conclusion: "Материалы и труд измеряются в разных единицах, поэтому сравнение долей напрямую некорректно.",
        action: "Оценивайте динамику по двум осям: отдельно пики материальных затрат (₽) и отдельно пики трудозатрат (ч).",
      };
    }

    if (intent === "class_cost_structure") {
      const rows = Object.entries(equipmentCosts)
        .map(([name, info]) => ({ name, className: equipmentClassFromData(data, name), total: Number(info?.total || 0) }))
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
    });
    const attempts = 5;
    const pauseMs = 600;

    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, pauseMs));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), runtimeLlm.timeoutMs);
      try {
        const res = await dashboardApiFetch(runtimeLlm.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
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

  const runtimeAgent = {
    baseUrl: window.TOIR_API_URL
      ? window.TOIR_API_URL.replace("/api/chat", "/api/agent")
      : "http://localhost:8787/api/agent",
    timeoutMs: 70000,
  };

  let currentAiMode = "agent";
  let lastAgentArtifacts = null;

  function isMobileAiLayout() {
    return MOBILE_LAYOUT_MQ.matches;
  }

  function getLastAgentAnswerBubble() {
    const log = document.getElementById("aiLog");
    if (!log) return null;
    const bubbles = log.querySelectorAll(".bubble.ai");
    return bubbles.length ? bubbles[bubbles.length - 1] : null;
  }

  function cloneArtifacts(artifacts) {
    if (!artifacts?.length) return null;
    try {
      return JSON.parse(JSON.stringify(artifacts));
    } catch {
      return artifacts.map((a) => ({ ...a }));
    }
  }

  function removeLegacyArtifactsHost() {
    const log = document.getElementById("aiLog");
    if (!log) return;
    log.querySelectorAll(
      ".ai-artifacts--turn, .ai-artifact-bundle-mobile, .ai-mobile-turn"
    ).forEach((el) => el.remove());
  }

  function scrollAiChatToEnd() {
    const log = document.getElementById("aiLog");
    requestAnimationFrame(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  /** На мобилке показываем последний ответ, а не только низ лога (график). */
  function scrollAiChatToAnswer(answerBubble) {
    const log = document.getElementById("aiLog");
    const target = answerBubble || getLastAgentAnswerBubble();
    requestAnimationFrame(() => {
      if (!log) return;
      if (!target || !isMobileAiLayout()) {
        log.scrollTop = log.scrollHeight;
        return;
      }
      log.scrollTop = Math.max(0, target.offsetTop - 8);
    });
  }

  /** Разобрать старые .ai-chat-block — всё снова в #aiLog списком. */
  function flattenChatBlocks() {
    const logEl = document.getElementById("aiLog");
    if (!logEl) return;
    logEl.querySelectorAll(".ai-chat-block").forEach((block) => {
      const parent = block.parentNode;
      while (block.firstChild) parent.insertBefore(block.firstChild, block);
      block.remove();
    });
    logEl.querySelectorAll(".ai-chat-block__question").forEach((el) => {
      el.classList.remove("ai-chat-block__question");
    });
  }

  const MOBILE_ARTIFACT_PREVIEW_TABLE_ROWS = 3;

  function mobilePreviewChartHeight(artifact) {
    const n = Array.isArray(artifact?.categories) ? artifact.categories.length : 0;
    const isHBar = (artifact?.chartType || "bar") === "bar" && n >= 4;
    if (n <= 0) return isHBar ? 188 : 168;
    if (isHBar) {
      return Math.min(340, Math.max(200, Math.round(n * 46 + 80)));
    }
    if (n < 4) return 172;
    return Math.min(280, Math.max(188, Math.round(n * 34 + 72)));
  }

  function mobileWorkspaceChartHeight(artifact) {
    const n = Array.isArray(artifact?.categories) ? artifact.categories.length : 0;
    const isHBar = (artifact?.chartType || "bar") === "bar" && n >= 4;
    if (isHBar) {
      return Math.min(420, Math.max(240, Math.round(n * 48 + 96)));
    }
    return Math.min(320, Math.max(220, mobilePreviewChartHeight(artifact) + 24));
  }

  /** Десктоп: высота графика агента по числу категорий (как getChartHeight на дашборде). */
  function desktopAgentChartHeight(artifact) {
    const n = Array.isArray(artifact?.categories) ? artifact.categories.length : 0;
    if (n <= 0) return 200;
    if (n < 4) return 200;
    return Math.min(380, Math.max(220, Math.round(n * 28 + 72)));
  }

  function measureDesktopArtifactsPanelMaxHeight(artifacts) {
    const charts = (artifacts || []).filter((a) => a?.type === "chart");
    const tables = (artifacts || []).filter((a) => a?.type === "table");
    let h = 16;
    for (const c of charts) {
      h += desktopAgentChartHeight(c) + 52;
    }
    for (const t of tables) {
      const rowCount = Math.min(Array.isArray(t.rows) ? t.rows.length : 0, 14);
      h += Math.min(240, 44 + rowCount * 24) + 44;
    }
    return Math.min(Math.max(h, 180), Math.round(window.innerHeight * 0.48));
  }

  function syncDesktopArtifactsPanelLayout() {
    const container = document.getElementById("aiArtifacts");
    if (!container) return;
    container.hidden = true;
    container.style.maxHeight = "";
  }

  function getAnswerBubbleForArtifactHost(host) {
    if (host?.classList?.contains("ai-chat-turn")) {
      let el = host.previousElementSibling;
      while (el) {
        if (el.classList?.contains("bubble") && el.classList.contains("ai")) return el;
        if (el.classList?.contains("ai-chat-turn")) break;
        el = el.previousElementSibling;
      }
    }
    const prev = host?.previousElementSibling;
    if (prev?.classList?.contains("bubble") && prev.classList.contains("ai")) return prev;
    return getLastAgentAnswerBubble();
  }

  /** В #aiLog: вопрос → ответ → график (соседние блоки, одна тёмная карточка-лог со скроллом). */
  function attachChatTurnAfterBubble(answerBubble, artifacts) {
    const charts = (artifacts || []).filter((a) => a?.type === "chart");
    const tables = (artifacts || []).filter((a) => a?.type === "table");
    if (!answerBubble || (!charts.length && !tables.length)) return null;

    const mobile = isMobileAiLayout();
    const existingTurn = answerBubble.nextElementSibling;
    if (existingTurn?.classList?.contains("ai-chat-turn")) existingTurn.remove();

    const turn = document.createElement("div");
    turn.className = "ai-chat-turn";
    turn._toirArtifacts = artifacts;

    charts.forEach((art, idx) => {
      const chartWrap = document.createElement("div");
      chartWrap.className = "ai-chat-turn__chart ai-artifact-card--chart";

      if (charts.length > 1 || art.title) {
        const title = document.createElement("div");
        title.className = "ai-chat-turn__chart-title";
        title.textContent = art.title || `График ${idx + 1}`;
        chartWrap.appendChild(title);
      }

      const chartH = mobile ? mobilePreviewChartHeight(art) : desktopAgentChartHeight(art);
      const chartBox = document.createElement("div");
      chartBox.className = "ai-artifact-chart-box";
      chartBox.style.minHeight = `${chartH}px`;
      chartBox.style.height = `${chartH}px`;
      const chartId = `agentChart_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      chartBox.id = chartId;
      chartWrap.appendChild(chartBox);

      const expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "ai-artifact-expand-btn ai-chat-turn__expand";
      expandBtn.textContent = charts.length > 1 ? "Развернуть график" : "Развернуть";
      expandBtn.addEventListener("click", () => expandMobileTurnWorkspace(turn));
      chartWrap.appendChild(expandBtn);

      turn.appendChild(chartWrap);

      requestAnimationFrame(() => {
        Charts.renderAgentChart(
          art,
          `#${chartId}`,
          chartH,
          mobile ? { mobileInline: true } : undefined
        );
      });
    });

    if (tables.length && !charts.length) {
      const expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "ai-artifact-expand-btn ai-chat-turn__expand";
      expandBtn.textContent = "Развернуть таблицу";
      expandBtn.addEventListener("click", () => expandMobileTurnWorkspace(turn));
      turn.appendChild(expandBtn);
    }

    answerBubble.insertAdjacentElement("afterend", turn);
    scrollAiChatToAnswer(answerBubble);
    return turn;
  }

  function attachArtifactsAfterBubble(bubble, artifacts) {
    if (!bubble || !artifacts?.length) return null;
    return attachChatTurnAfterBubble(bubble, artifacts);
  }

  function clearDesktopArtifactsContainer() {
    const desktopContainer = document.getElementById("aiArtifacts");
    if (!desktopContainer) return;
    desktopContainer.hidden = true;
    desktopContainer.innerHTML = "";
    desktopContainer._toirArtifacts = null;
  }

  function ensureMobileAiPanelOpen() {
    if (!isMobileAiLayout()) return;
    const panel = document.querySelector(".layout-sidebar.ai-panel");
    if (!panel) return;
    document.body.classList.remove("ai-mobile-dock-hidden");
    panel.classList.remove("ai-panel--user-collapsed");
    panel.classList.add("ai-panel--expanded");
  }

  function appendAgentAnswerToWorkspace(card, insertBeforeEl, answerBubble) {
    const answerEl = answerBubble || getLastAgentAnswerBubble();
    if (!answerEl) return;
    const answerWrap = document.createElement("div");
    answerWrap.className = "agent-workspace-answer bubble ai";
    answerWrap.innerHTML = answerEl.innerHTML;
    if (insertBeforeEl) card.insertBefore(answerWrap, insertBeforeEl);
    else card.appendChild(answerWrap);
  }

  function buildArtifactTableElement(artifact, { maxRows, preview = false, full = false } = {}) {
    const rows = Array.isArray(artifact?.rows) ? artifact.rows : [];
    const rowLimit = maxRows != null ? Math.min(rows.length, maxRows) : rows.length;
    const slice = rows.slice(0, rowLimit);

    const wrap = document.createElement("div");
    wrap.className = "ai-artifact-table-wrap";
    if (preview) wrap.classList.add("ai-artifact-table-wrap--preview-mobile");

    const table = document.createElement("table");
    table.className = preview
      ? "ai-artifact-table ai-artifact-table--preview-mobile"
      : full
        ? "ai-artifact-table ai-artifact-table--full"
        : "ai-artifact-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of artifact.columns || []) {
      const th = document.createElement("th");
      th.textContent = col.label || col.key;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const rowCap = full ? 200 : 100;
    for (const row of slice.slice(0, rowCap)) {
      const tr = document.createElement("tr");
      for (const col of artifact.columns || []) {
        const td = document.createElement("td");
        const val = row[col.key];
        if (typeof val === "number") {
          td.textContent = val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
        } else {
          td.textContent = val != null ? String(val) : "—";
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (preview && rows.length > rowLimit) {
      const more = document.createElement("div");
      more.className = "ai-artifact-table-more";
      more.textContent = `Ещё ${rows.length - rowLimit} — «Развернуть»`;
      wrap.appendChild(more);
    }
    return wrap;
  }

  function expandMobileTurnWorkspace(artifactHost) {
    const ws = document.getElementById("agentWorkspace");
    if (!ws || !artifactHost?._toirArtifacts?.length) return;

    const artifacts = artifactHost._toirArtifacts;
    const answerBubble = getAnswerBubbleForArtifactHost(artifactHost);
    const charts = artifacts.filter((a) => a?.type === "chart");
    const tables = artifacts.filter((a) => a?.type === "table");
    const chartSelectors = [];

    ws.innerHTML = "";
    ws.hidden = false;
    ws.classList.add("agent-workspace--fullscreen");
    document.body.classList.add("agent-workspace-open");

    const card = document.createElement("div");
    card.className = "card agent-workspace-card";

    const header = document.createElement("div");
    header.className = "agent-workspace-header";
    const h3 = document.createElement("h3");
    if (charts.length && tables.length) {
      h3.textContent = "Ответ, график и таблица";
    } else if (charts.length > 1) {
      h3.textContent = `Ответ и графики (${charts.length})`;
    } else {
      h3.textContent = "Ответ агента";
    }
    header.appendChild(h3);
    const closeBtn = document.createElement("button");
    closeBtn.className = "agent-workspace-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.addEventListener("click", () => closeAgentWorkspace(ws, chartSelectors));
    header.appendChild(closeBtn);
    card.appendChild(header);

    appendAgentAnswerToWorkspace(card, null, answerBubble);

    charts.forEach((art, idx) => {
      const chartH = mobileWorkspaceChartHeight(art);
      const block = document.createElement("div");
      block.className = "agent-workspace-artifact-block";
      if (charts.length > 1 || (charts.length && tables.length)) {
        const sub = document.createElement("h4");
        sub.className = "agent-workspace-artifact-title";
        sub.textContent = art.title || `График ${idx + 1}`;
        block.appendChild(sub);
      }
      const chartBox = document.createElement("div");
      const chartId = `wsChart_${Date.now()}_${idx}`;
      chartBox.id = chartId;
      const sel = `#${chartId}`;
      chartSelectors.push(sel);
      chartBox.className = "ai-artifact-chart-box";
      chartBox.style.minHeight = `${chartH}px`;
      chartBox.style.height = `${chartH}px`;
      block.appendChild(chartBox);
      card.appendChild(block);
      requestAnimationFrame(() => {
        Charts.renderAgentChart(art, sel, chartH, { mobileInline: true });
      });
    });

    tables.forEach((art, idx) => {
      const block = document.createElement("div");
      block.className = "agent-workspace-artifact-block";
      if (tables.length > 1 || (charts.length && tables.length)) {
        const sub = document.createElement("h4");
        sub.className = "agent-workspace-artifact-title";
        sub.textContent = art.title || `Таблица ${idx + 1}`;
        block.appendChild(sub);
      }
      block.appendChild(buildArtifactTableElement(art, { full: true }));
      card.appendChild(block);
    });

    ws.appendChild(card);
  }

  async function askAgent(question, filters) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtimeAgent.timeoutMs);
    try {
      const res = await dashboardApiFetch(runtimeAgent.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({ question, filters: filters || {} }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = String(json?.message || "").trim();
        return {
          ok: false,
          errorMessage: msg || `Ошибка сервера агента (${res.status}).`,
          errorCode: json?.errorCode || null,
        };
      }
      if (!json?.ok) {
        const msg = String(json?.message || "").trim();
        return {
          ok: false,
          errorMessage: msg || "Запрос агента отклонён.",
          errorCode: json?.errorCode || null,
        };
      }
      return json;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderArtifactTable(artifact, container) {
    const card = document.createElement("div");
    card.className = "ai-artifact-card";
    const title = document.createElement("div");
    title.className = "ai-artifact-title";
    title.textContent = artifact.title || "Таблица";
    card.appendChild(title);
    if (artifact?.meta?.forecast) {
      const badge = document.createElement("div");
      badge.className = "ai-artifact-badge";
      badge.textContent = "Прогноз";
      card.appendChild(badge);
    }

    card.appendChild(buildArtifactTableElement(artifact, { maxRows: 100 }));

    const expandBtn = document.createElement("button");
    expandBtn.className = "ai-artifact-expand-btn";
    expandBtn.textContent = "Развернуть";
    expandBtn.addEventListener("click", () => expandArtifact(artifact, container));
    card.appendChild(expandBtn);

    container.appendChild(card);
  }

  function chartArtifactsInBatch(container) {
    const list = container?._toirArtifacts;
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && a.type === "chart");
  }

  function renderArtifactChart(artifact, container, chartCountInBatch) {
    const card = document.createElement("div");
    card.className = "ai-artifact-card";
    const title = document.createElement("div");
    title.className = "ai-artifact-title";
    title.textContent = artifact.title || "График";
    card.appendChild(title);
    if (artifact?.meta?.forecast) {
      const badge = document.createElement("div");
      badge.className = "ai-artifact-badge";
      badge.textContent = "Прогноз";
      card.appendChild(badge);
    }

    const chartBox = document.createElement("div");
    chartBox.className = "ai-artifact-chart-box";
    const chartId = `agentChart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    chartBox.id = chartId;
    card.appendChild(chartBox);

    const expandBtn = document.createElement("button");
    expandBtn.className = "ai-artifact-expand-btn";
    expandBtn.textContent =
      chartCountInBatch > 1 ? "Развернуть все" : "Развернуть";
    expandBtn.addEventListener("click", () => expandArtifact(artifact, container));
    card.appendChild(expandBtn);

    container.appendChild(card);

    requestAnimationFrame(() => {
      const chartHeight = isMobileAiLayout()
        ? mobilePreviewChartHeight(artifact)
        : desktopAgentChartHeight(artifact);
      Charts.renderAgentChart(artifact, `#${chartId}`, chartHeight);
    });
  }

  function renderArtifacts(artifacts, answerBubble) {
    const cloned = cloneArtifacts(artifacts);
    lastAgentArtifacts = cloned;
    clearDesktopArtifactsContainer();
    syncDesktopArtifactsPanelLayout();

    if (!cloned?.length) {
      syncMobileAiDock();
      return;
    }

    const bubble = answerBubble || getLastAgentAnswerBubble();
    if (!bubble) {
      syncMobileAiDock();
      return;
    }

    attachArtifactsAfterBubble(bubble, cloned);
    if (isMobileAiLayout()) ensureMobileAiPanelOpen();
    syncMobileAiDock();
  }

  function artifactsToExpand(clicked, artifactHost) {
    const container =
      artifactHost ||
      document.querySelector(".ai-chat-turn:last-of-type") ||
      document.getElementById("aiArtifacts");
    if (clicked?.type === "chart") {
      const charts = chartArtifactsInBatch(container);
      if (charts.length > 1) return charts;
    }
    return [clicked];
  }

  function closeAgentWorkspace(ws, chartSelectors) {
    if (Array.isArray(chartSelectors)) {
      for (const sel of chartSelectors) {
        if (typeof Charts.dispose === "function") Charts.dispose(sel);
      }
    }
    ws.hidden = true;
    ws.innerHTML = "";
    ws.classList.remove("agent-workspace--fullscreen");
    document.body.classList.remove("agent-workspace-open");
  }

  function expandArtifact(artifact, artifactHost) {
    if (MOBILE_LAYOUT_MQ.matches && artifactHost?._toirArtifacts?.length) {
      expandMobileTurnWorkspace(artifactHost);
      return;
    }
    const ws = document.getElementById("agentWorkspace");
    if (!ws) return;
    const batch = artifactsToExpand(artifact, artifactHost);
    const mobileExpand = MOBILE_LAYOUT_MQ.matches;
    const chartSelectors = [];
    ws.innerHTML = "";
    ws.hidden = false;
    ws.classList.toggle("agent-workspace--fullscreen", mobileExpand);

    const card = document.createElement("div");
    card.className = "card agent-workspace-card";

    const header = document.createElement("div");
    header.className = "agent-workspace-header";
    const h3 = document.createElement("h3");
    const chartBatch = batch.filter((a) => a.type === "chart");
    if (chartBatch.length > 1) {
      h3.textContent = `Графики агента (${chartBatch.length})`;
    } else {
      h3.textContent = artifact.title || "Артефакт агента";
    }
    header.appendChild(h3);
    const closeBtn = document.createElement("button");
    closeBtn.className = "agent-workspace-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.addEventListener("click", () => closeAgentWorkspace(ws, chartSelectors));
    header.appendChild(closeBtn);
    card.appendChild(header);

    if (chartBatch.length > 1) {
      ws.appendChild(card);
      if (mobileExpand) appendAgentAnswerToWorkspace(card);
      chartBatch.forEach((art, idx) => {
        const chartHeight = mobileExpand ? mobileWorkspaceChartHeight(art) : desktopAgentChartHeight(art);
        const block = document.createElement("div");
        block.className = "agent-workspace-artifact-block";
        const sub = document.createElement("h4");
        sub.className = "agent-workspace-artifact-title";
        sub.textContent = art.title || `График ${idx + 1}`;
        block.appendChild(sub);
        const chartBox = document.createElement("div");
        const chartId = `wsChart_${Date.now()}_${idx}`;
        chartBox.id = chartId;
        const sel = `#${chartId}`;
        chartSelectors.push(sel);
        chartBox.className = "ai-artifact-chart-box";
        chartBox.style.minHeight = `${chartHeight}px`;
        chartBox.style.height = `${chartHeight}px`;
        block.appendChild(chartBox);
        card.appendChild(block);
        requestAnimationFrame(() => {
          Charts.renderAgentChart(art, sel, chartHeight, mobileExpand ? { mobileInline: true } : undefined);
        });
      });
      if (mobileExpand) document.body.classList.add("agent-workspace-open");
      if (!mobileExpand) ws.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const single = batch[0] || artifact;

    if (single.type === "table") {
      if (mobileExpand) appendAgentAnswerToWorkspace(card);
      card.appendChild(buildArtifactTableElement(single, { full: true }));
      ws.appendChild(card);
    } else if (single.type === "chart") {
      if (mobileExpand) appendAgentAnswerToWorkspace(card);
      const chartH = mobileExpand ? mobileWorkspaceChartHeight(single) : desktopAgentChartHeight(single);
      const chartBox = document.createElement("div");
      const chartId = `wsChart_${Date.now()}`;
      chartBox.id = chartId;
      const sel = `#${chartId}`;
      chartSelectors.push(sel);
      chartBox.className = "ai-artifact-chart-box";
      chartBox.style.minHeight = `${chartH}px`;
      chartBox.style.height = `${chartH}px`;
      card.appendChild(chartBox);
      ws.appendChild(card);
      if (mobileExpand) document.body.classList.add("agent-workspace-open");
      requestAnimationFrame(() => {
        Charts.renderAgentChart(single, sel, chartH, mobileExpand ? { mobileInline: true } : undefined);
      });
      if (!mobileExpand) ws.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    ws.appendChild(card);
    if (mobileExpand) document.body.classList.add("agent-workspace-open");
    if (!mobileExpand) ws.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  let syncMobileAiDock = () => {};

  function wireMobileAiDock() {
    const panel = document.querySelector(".layout-sidebar.ai-panel");
    const log = document.getElementById("aiLog");
    const artifactsContainer = document.getElementById("aiArtifacts");
    const btnHistory = document.getElementById("btnAiHistory");
    const layout = document.querySelector(".layout");

    if (!panel) return;
    if (!panel.id) panel.id = "aiPanel";

    const panelTop = panel.querySelector(".ai-panel-top") || panel;
    let btnHide = document.getElementById("btnAiDockHide");
    if (!btnHide) {
      btnHide = document.createElement("button");
      btnHide.type = "button";
      btnHide.id = "btnAiDockHide";
      btnHide.className = "btn-ai-dock-hide";
      btnHide.setAttribute("aria-controls", panel.id);
      btnHide.textContent = "Скрыть";
      panelTop.appendChild(btnHide);
    }

    const dockBar = document.getElementById("mobileDockBar");
    let btnLauncher = document.getElementById("btnAiMobileLauncher");
    if (!btnLauncher) {
      btnLauncher = document.createElement("button");
      btnLauncher.type = "button";
      btnLauncher.id = "btnAiMobileLauncher";
      btnLauncher.className = "ai-mobile-launcher";
      btnLauncher.setAttribute("aria-controls", panel.id);
      btnLauncher.textContent = "Ассистент";
    }
    if (dockBar && btnLauncher.parentElement !== dockBar) {
      dockBar.appendChild(btnLauncher);
    }

    function hasContent() {
      const hasLog = !!(log && log.children.length);
      const hasTurnArt = !!log?.querySelector(".ai-chat-turn:not([hidden])");
      const hasArt = hasTurnArt;
      return hasLog || hasArt;
    }

    function updateDockOffset() {
      if (!document.body.classList.contains("ai-mobile-dock-active")) {
        document.documentElement.style.removeProperty("--ai-mobile-dock-offset");
        if (dockBar) dockBar.hidden = true;
        return;
      }
      if (dockBar) dockBar.hidden = false;
      requestAnimationFrame(() => {
        const hidden = document.body.classList.contains("ai-mobile-dock-hidden");
        const measured =
          hidden && dockBar
            ? dockBar
            : hidden && btnLauncher && !btnLauncher.hidden
              ? btnLauncher
              : panel;
        const h = measured.getBoundingClientRect().height;
        document.documentElement.style.setProperty("--ai-mobile-dock-offset", `${Math.ceil(h) + 4}px`);
      });
    }

    function setDockHidden(hidden) {
      const dockable = MOBILE_LAYOUT_MQ.matches;
      document.body.classList.toggle("ai-mobile-dock-hidden", !!hidden && dockable);
      sync();
    }

    function sync() {
      const mobile = MOBILE_LAYOUT_MQ.matches;
      const dockable = mobile;
      document.body.classList.toggle("ai-mobile-dock-active", dockable);
      if (!dockable) document.body.classList.remove("ai-mobile-dock-hidden");
      const dockHidden = dockable && document.body.classList.contains("ai-mobile-dock-hidden");

      if (btnHide) {
        btnHide.hidden = !dockable;
        btnHide.setAttribute("aria-expanded", dockHidden ? "false" : "true");
      }
      if (btnLauncher) {
        const showLauncher = dockable && dockHidden;
        btnLauncher.hidden = !showLauncher;
        btnLauncher.setAttribute("aria-expanded", dockHidden ? "false" : "true");
      }
      if (dockBar) {
        dockBar.hidden = !dockable;
      }

      const hc = hasContent();
      panel.classList.toggle("ai-panel--has-content", hc);

      if (btnHistory) {
        btnHistory.hidden = !mobile || !hc;
        const expanded = panel.classList.contains("ai-panel--expanded");
        btnHistory.setAttribute("aria-expanded", expanded ? "true" : "false");
        btnHistory.textContent = expanded ? "Свернуть" : "История";
      }

      if (mobile && hc && !dockHidden) {
        panel.classList.add("ai-panel--has-content");
        if (!panel.classList.contains("ai-panel--user-collapsed")) {
          panel.classList.add("ai-panel--expanded");
        }
      }

      if (!hc) {
        panel.classList.remove("ai-panel--expanded", "ai-panel--user-collapsed");
      }

      updateDockOffset();
    }

    syncMobileAiDock = sync;

    if (btnHistory && !btnHistory._toirMobileDockBound) {
      btnHistory._toirMobileDockBound = true;
      btnHistory.addEventListener("click", () => {
        const willExpand = !panel.classList.contains("ai-panel--expanded");
        panel.classList.toggle("ai-panel--expanded", willExpand);
        panel.classList.toggle("ai-panel--user-collapsed", !willExpand);
        sync();
      });
    }
    if (btnHide && !btnHide._toirMobileDockBound) {
      btnHide._toirMobileDockBound = true;
      btnHide.addEventListener("click", () => setDockHidden(true));
    }
    if (btnLauncher && !btnLauncher._toirMobileDockBound) {
      btnLauncher._toirMobileDockBound = true;
      btnLauncher.addEventListener("click", () => setDockHidden(false));
    }

    if (log) {
      const mo = new MutationObserver(sync);
      mo.observe(log, { childList: true, subtree: true, characterData: true });
    }
    if (artifactsContainer) {
      const moArt = new MutationObserver(sync);
      moArt.observe(artifactsContainer, {
        childList: true,
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    const onMq = () => {
      panel.classList.remove("ai-panel--user-collapsed");
      document.body.classList.remove("ai-mobile-dock-hidden");
      flattenChatBlocks();
      removeLegacyArtifactsHost();
      document.querySelectorAll("#aiArtifacts .ai-artifacts--desktop-turn").forEach((el) => el.remove());
      clearDesktopArtifactsContainer();
      syncDesktopArtifactsPanelLayout();
      if (lastAgentArtifacts?.length && currentAiMode === "agent") {
        const bubble = getLastAgentAnswerBubble();
        if (bubble && !bubble.nextElementSibling?.classList?.contains("ai-chat-turn")) {
          attachArtifactsAfterBubble(bubble, cloneArtifacts(lastAgentArtifacts));
        }
      }
      sync();
    };
    if (typeof MOBILE_LAYOUT_MQ.addEventListener === "function") {
      MOBILE_LAYOUT_MQ.addEventListener("change", onMq);
    } else if (typeof MOBILE_LAYOUT_MQ.addListener === "function") {
      MOBILE_LAYOUT_MQ.addListener(onMq);
    }

    window.addEventListener("resize", updateDockOffset);
    flattenChatBlocks();
    sync();
  }

  function wireAi(data, assistantContext) {
    wireMobileAiDock();
    assistantContextLive = assistantContext;
    const log = document.getElementById("aiLog");
    const input = document.getElementById("aiInput");
    const btn = document.getElementById("aiSend");
    const artifactsContainer = document.getElementById("aiArtifacts");
    const modeToggle = document.getElementById("aiModeToggle");
    const descEl = document.getElementById("aiDesc");
    const aiPanel = document.querySelector(".layout-sidebar.ai-panel");

    const modeDescriptions = {
      agent: "Агент анализирует данные, выполняет вычисления и строит графики/таблицы.",
      chat: "Быстрый текстовый ответ по формату факт \u2192 вывод \u2192 действие.",
    };

    if (modeToggle) {
      modeToggle.addEventListener("click", (e) => {
        const btn2 = e.target.closest(".ai-mode-btn");
        if (!btn2) return;
        const mode = btn2.dataset.mode;
        if (!mode || mode === currentAiMode) return;
        currentAiMode = mode;
        modeToggle.querySelectorAll(".ai-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
        if (descEl) descEl.textContent = modeDescriptions[mode] || "";
        document.querySelectorAll(".ai-chat-turn").forEach((host) => {
          host.hidden = mode === "chat";
        });
        syncDesktopArtifactsPanelLayout();
        syncMobileAiDock();
      });
    }

    function pushBubble(text, ai) {
      const div = document.createElement("div");
      div.className = `bubble ${ai ? "ai" : ""}`;
      div.innerHTML = text;
      log.appendChild(div);
      if (ai) scrollAiChatToAnswer(div);
      else scrollAiChatToEnd();
      if (ai) ensureMobileAiPanelOpen();
      syncMobileAiDock();
      return div;
    }

    const submitQuestion = async () => {
      const q = (input?.value || "").trim();
      if (!q) return;
      ensureMobileAiPanelOpen();
      pushBubble(escapeHtml(q), false);
      input.value = "";

      if (currentAiMode === "agent") {
        const uiFilters = {
          period: document.getElementById("panelPeriod")?.value || null,
          class: document.getElementById("panelClass")?.value || null,
        };
        const pending = pushBubble('<div class="block-title">Агент</div><span class="agent-thinking">Анализирую данные\u2026</span>', true);

        const agentResult = await askAgent(q, uiFilters);
        if (agentResult && agentResult.answer) {
          const a = agentResult.answer;
          let traceHtml = "";
          if (agentResult.trace) {
            const t = agentResult.trace;
            traceHtml = `<div class="agent-trace">Шагов: ${t.steps || 0}${t.toolsUsed?.length ? ` \u00b7 Инструменты: ${t.toolsUsed.join(", ")}` : ""}</div>`;
          }
          pending.innerHTML =
            `<div class="block-title">Факт</div>${escapeHtml(a.fact)}` +
            `<div class="block-title" style="margin-top:8px">Вывод</div>${escapeHtml(a.conclusion)}` +
            `<div class="block-title" style="margin-top:8px">Действие</div>${escapeHtml(a.action)}` +
            traceHtml;

          if (agentResult.artifacts && agentResult.artifacts.length > 0) {
            renderArtifacts(agentResult.artifacts, pending);
          }
          ensureMobileAiPanelOpen();
          scrollAiChatToAnswer(pending);
        } else {
          const agentErr =
            agentResult && agentResult.ok === false && agentResult.errorMessage
              ? `<div class="agent-trace">${escapeHtml(agentResult.errorMessage)}</div>`
              : "";
          const errCode = agentResult?.errorCode || "";
          const skipCloudFallback =
            errCode === "rate_limited" ||
            errCode === "provider_error" ||
            /429|лимит запросов|too many requests/i.test(agentResult?.errorMessage || "");

          let fact;
          let conclusion;
          let action;
          let traceExtra = "";

          if (skipCloudFallback) {
            const mapped = apiErrorAnswer(
              errCode === "rate_limited" ? 429 : 502,
              { errorCode: errCode || "provider_error", message: agentResult?.errorMessage }
            );
            fact = mapped.fact;
            conclusion = mapped.conclusion;
            action = mapped.action;
            traceExtra =
              '<div class="agent-trace">Режим «Быстрый ответ» не вызывался: тот же лимит API.</div>';
          } else {
            ({ fact, conclusion, action } = await askCloudLlm(q, assistantContextLive));
            traceExtra = '<div class="agent-trace">Fallback: быстрый ответ</div>';
          }

          pending.innerHTML =
            agentErr +
            `<div class="block-title">Факт</div>${escapeHtml(fact)}` +
            `<div class="block-title" style="margin-top:8px">Вывод</div>${escapeHtml(conclusion)}` +
            `<div class="block-title" style="margin-top:8px">Действие</div>${escapeHtml(action)}` +
            traceExtra;
          ensureMobileAiPanelOpen();
        }
      } else {
        const pending = pushBubble('<div class="block-title">Ответ</div>Думаю\u2026', true);
        const { fact, conclusion, action } = await askCloudLlm(q, assistantContextLive);
        pending.innerHTML =
          `<div class="block-title">Факт</div>${escapeHtml(fact)}` +
          `<div class="block-title" style="margin-top:8px">Вывод</div>${escapeHtml(conclusion)}` +
          `<div class="block-title" style="margin-top:8px">Действие</div>${escapeHtml(action)}`;
        ensureMobileAiPanelOpen();
      }
      scrollAiChatToAnswer(getLastAgentAnswerBubble());
      syncMobileAiDock();
    };

    btn?.addEventListener("click", submitQuestion);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });
  }

  window.addEventListener("toir-dashboard-auth-expired", () => {
    window.location.reload();
  });

  function showDashboardAuthGate(onSuccess) {
    const gate = document.getElementById("dashboardAuthGate");
    const form = document.getElementById("dashboardAuthForm");
    const msg = document.getElementById("dashboardAuthMsg");
    const DashAuth = window.ToirDashboardAuth;
    if (!gate || !form || !DashAuth) {
      onSuccess();
      return;
    }
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
    document.body.classList.add("dashboard-auth-active");
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const uEl = document.getElementById("dashboardAuthUser");
      const pEl = document.getElementById("dashboardAuthPass");
      const u = uEl && uEl.value ? String(uEl.value).trim() : "";
      const p = pEl && pEl.value != null ? String(pEl.value) : "";
      const btn = document.getElementById("dashboardAuthSubmit");
      if (btn) btn.disabled = true;
      if (msg) msg.textContent = "Проверка…";
      try {
        const origin = DashAuth.getApiOrigin();
        const r = await fetch(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ username: u, password: p }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.token) {
          if (msg) msg.textContent = (j && j.message) || "Неверный логин или пароль.";
          return;
        }
        DashAuth.setToken(j.token);
        gate.hidden = true;
        gate.setAttribute("aria-hidden", "true");
        document.body.classList.remove("dashboard-auth-active");
        onSuccess();
      } catch (_) {
        if (msg) msg.textContent = "Не удалось связаться с сервером. Проверьте, что API запущен.";
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  async function bootDashboardAfterAuth() {
    wireDashboardLifecycleAudit();
    try {
      const [dashRes, brandRes] = await Promise.all([
        fetch("data/toir.json", { cache: "no-store" }),
        fetch("assets/brand.json", { cache: "no-store" }),
      ]);
      const data = await dashRes.json();
      window.dashboardData = data;
      if (brandRes.ok) {
        const brand = await brandRes.json();
        window.__toirBrandJson = brand;
        U.applyBrandTokens(brand);
      }
      const personnelData =
        data.personnelUsage && typeof data.personnelUsage === "object" ? data.personnelUsage : null;
      const personnelOrgData =
        data.personnelOrgUsage && typeof data.personnelOrgUsage === "object" ? data.personnelOrgUsage : null;
      wireUi(data);
      const assistantContext = buildAssistantContext(data, personnelData, personnelOrgData);
      wireAi(data, assistantContext);
    } catch (e) {
      console.error(e);
      const foot = document.getElementById("footerSource");
      if (foot) foot.textContent = "Ошибка загрузки data/toir.json";
    }
  }

  async function boot() {
    const DashAuth = window.ToirDashboardAuth;
    if (!DashAuth) {
      await bootDashboardAfterAuth();
      return;
    }
    let authEnabled = false;
    try {
      authEnabled = await DashAuth.fetchAuthStatus();
    } catch (_) {
      const gate = document.getElementById("dashboardAuthGate");
      const msg = document.getElementById("dashboardAuthMsg");
      if (gate && msg) {
        gate.hidden = false;
        document.body.classList.add("dashboard-auth-active");
        msg.textContent =
          "Не удалось связаться с API входа. Убедитесь, что сервер запущен (node server/index.js, порт из .env).";
      } else {
        const foot = document.getElementById("footerSource");
        if (foot) foot.textContent = "Ошибка связи с API";
      }
      return;
    }
    if (authEnabled && !DashAuth.getToken()) {
      showDashboardAuthGate(() => {
        bootDashboardAfterAuth();
      });
      return;
    }
    await bootDashboardAfterAuth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
