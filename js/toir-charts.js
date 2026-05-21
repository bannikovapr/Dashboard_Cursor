(function (global) {
  const U = global.ToirUtils || {};

  /** Фирменный зелёный Desnol: assets/brand.json, desnol-mark.svg */
  const BRAND_ACCENT_FALLBACK = "#1ed760";

  const chartBarColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--chart-bar").trim() || BRAND_ACCENT_FALLBACK;

  const chartAxisColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--chart-axis").trim() || "#64748b";

  /** Многоцветные диаграммы: один оттенок зелёного — как --chart-bar / бренд. */
  const categoricalPalette = () => {
    const accent = chartBarColor();
    return [
      "#1e88e5",
      accent,
      "#f59e0b",
      "#f43f5e",
      "#7e57c2",
      "#0ea5e9",
      "#6366f1",
      "#fbbf24",
    ];
  };

  const apexBySelector = {};
  const PHONE_CHART_BREAKPOINT = 576;
  const MONTH_SHORT_LABELS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

  /** Единые отступы plot area для всех графиков дашборда. */
  const DASHBOARD_CHART_GRID_PADDING = Object.freeze({ left: 12, right: 12, top: 10, bottom: 24 });
  /** Фиксированная ширина колонки подписей (px) — Apex иначе пересчитывает её при каждом render/resize. */
  const HBAR_YAXIS_AREA_PX = 156;
  const HBAR_YAXIS_LABEL_MAX_WIDTH = HBAR_YAXIS_AREA_PX - 12;
  const HBAR_CATEGORY_LABEL_MAX_LEN = 28;

  function dispose(sel) {
    const c = apexBySelector[sel];
    if (Array.isArray(c)) {
      c.forEach((chart) => {
        if (chart && typeof chart.destroy === "function") {
          try {
            chart.destroy();
          } catch (_) {}
        }
      });
    } else if (c && typeof c.destroy === "function") {
      try {
        c.destroy();
      } catch (_) {}
    }
    delete apexBySelector[sel];
  }

  function chartHintHtml(text) {
    return `<p class="chart-hint">${text}</p>`;
  }

  function baseOpts() {
    return U.getBaseChartOptions ? U.getBaseChartOptions() : U.getBaseChartOptionsLight();
  }

  function compactAxisNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? "").trim();
    const abs = Math.abs(num);
    if (abs >= 1e9) return `${Number(num / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млрд`;
    if (abs >= 1e6) return `${Number(num / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
    if (abs >= 1e3) return `${Number(num / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} тыс`;
    return num.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  }

  function compactMonthLabel(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const numberMonth = raw.match(/^(0?[1-9]|1[0-2])$/);
    const isoMonth = raw.match(/^\d{4}[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?$/);
    const monthIndex = Number((isoMonth || numberMonth || [])[1]);
    if (monthIndex >= 1 && monthIndex <= 12) return MONTH_SHORT_LABELS[monthIndex - 1];
    const first = raw.split(/\s+/)[0].replace(/\.$/, "");
    return first.length > 3 ? first.slice(0, 3) : first;
  }

  function mobileColumnXAxis(axisColor, rotate = -42, formatter = null, hideOverlappingLabels = false) {
    const labels = {
      rotate,
      rotateAlways: true,
      hideOverlappingLabels,
      trim: false,
      minHeight: 40,
      maxHeight: 58,
      style: { colors: axisColor, fontSize: "10px", fontWeight: 600 },
    };
    if (typeof formatter === "function") labels.formatter = formatter;
    return {
      labels: {
        ...labels,
      },
      tickPlacement: "on",
    };
  }

  function withPhoneXAxis(responsive, xaxis) {
    return (responsive || []).map((entry) =>
      entry && entry.breakpoint === PHONE_CHART_BREAKPOINT
        ? { ...entry, options: { ...(entry.options || {}), xaxis } }
        : entry
    );
  }

  function hbarCategoryYAxis(axisColor, fontSize = "12px") {
    return {
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        formatter: (v) => String(v ?? "").trim(),
        maxWidth: HBAR_YAXIS_LABEL_MAX_WIDTH,
        trim: true,
        style: { colors: axisColor, fontSize },
      },
    };
  }

  function hbarNumericXAxisLabels(axisColor, fontSize = "11px") {
    return {
      formatter: compactAxisNumber,
      style: { colors: axisColor, fontSize },
    };
  }

  function isHorizontalBarChart(chart) {
    return !!(chart && chart.w && chart.w.config && chart.w.config.plotOptions?.bar?.horizontal);
  }

  function lockHorizontalBarYAxisWidth(chart) {
    if (!isHorizontalBarChart(chart) || !chart.w?.globals) return false;
    const prev = chart.w.globals.yAxisScaleWidth;
    chart.w.globals.yAxisScaleWidth = HBAR_YAXIS_AREA_PX;
    return prev !== HBAR_YAXIS_AREA_PX;
  }

  /** Один раз после mount: без updated/resized, иначе updateOptions → updated → цикл и лаги. */
  function stabilizeHorizontalBarChart(chart) {
    if (!chart || chart._hbarLayoutStable) return;
    if (!lockHorizontalBarYAxisWidth(chart)) {
      chart._hbarLayoutStable = true;
      return;
    }
    if (chart._hbarStabilizing) return;
    chart._hbarStabilizing = true;
    requestAnimationFrame(() => {
      chart._hbarStabilizing = false;
      if (!isHorizontalBarChart(chart)) return;
      lockHorizontalBarYAxisWidth(chart);
      try {
        chart.updateOptions({}, false, false, false);
      } catch (_) {}
      chart._hbarLayoutStable = true;
    });
  }

  function horizontalBarChartEvents() {
    return {
      mounted: (ctx) => stabilizeHorizontalBarChart(ctx),
      resized: (ctx) => lockHorizontalBarYAxisWidth(ctx),
    };
  }

  function renderHorizontalBarChart(el, opts, selector) {
    const chart = new ApexCharts(el, opts);
    apexBySelector[selector] = chart;
    const done = chart.render();
    if (done && typeof done.then === "function") {
      return done.then(() => stabilizeHorizontalBarChart(chart));
    }
    stabilizeHorizontalBarChart(chart);
    return done;
  }

  /** Горизонтальные бары: слева категории (yaxis), снизу числа (xaxis). Без responsive — отступы не прыгают при resize/перезагрузке. */
  function horizontalBarLayout(height) {
    const b = baseOpts();
    const axisColor = chartAxisColor();
    const gridBlock = { padding: { ...DASHBOARD_CHART_GRID_PADDING } };
    return {
      ...b,
      grid: { ...(b.grid || {}), ...gridBlock },
      yaxis: hbarCategoryYAxis(axisColor),
      xaxis: { labels: hbarNumericXAxisLabels(axisColor) },
      chart: {
        ...b.chart,
        type: "bar",
        height,
        width: "100%",
        redrawOnParentResize: true,
        redrawOnWindowResize: true,
        animations: {
          enabled: true,
          dynamicAnimation: { enabled: false },
        },
        events: horizontalBarChartEvents(),
      },
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: "68%",
          borderRadius: 4,
        },
      },
      legend: {
        ...(b.legend || {}),
        position: "top",
      },
      responsive: [],
    };
  }

  function chartLayout(height, chartType) {
    const b = baseOpts();
    const tabletHeight = Math.max(220, Math.round(height * 0.9));
    const phoneHeight = Math.max(238, Math.round(height * 0.88));
    const axisColor = chartAxisColor();
    const colGrid = { padding: { ...DASHBOARD_CHART_GRID_PADDING } };
    return {
      ...b,
      grid: { ...(b.grid || {}), ...colGrid },
      chart: {
        ...b.chart,
        type: chartType,
        height,
        width: "100%",
        redrawOnParentResize: true,
        redrawOnWindowResize: true,
      },
      legend: {
        ...(b.legend || {}),
        position: "top",
      },
      responsive: [
        {
          breakpoint: 992,
          options: {
            chart: { height: tabletHeight },
            legend: { position: "bottom", fontSize: "10px" },
            xaxis: { labels: { rotate: -20, hideOverlappingLabels: true, trim: true } },
          },
        },
        {
          breakpoint: PHONE_CHART_BREAKPOINT,
          options: {
            chart: { height: phoneHeight },
            legend: {
              position: "top",
              horizontalAlign: "center",
              fontSize: "10px",
              itemMargin: { horizontal: 6, vertical: 2 },
            },
            xaxis: mobileColumnXAxis(axisColor, -38, null, true),
          },
        },
      ],
    };
  }

  function dualAxisMobileResponsive(height) {
    const axisColor = chartAxisColor();
    const phoneHeight = Math.max(286, Math.round(height * 0.96));
    return [
      {
        breakpoint: 992,
        options: {
          chart: { height: Math.max(260, Math.round(height * 0.95)) },
          legend: { position: "top", horizontalAlign: "center", fontSize: "10px" },
          xaxis: { labels: { rotate: -28, rotateAlways: true, hideOverlappingLabels: false, trim: false } },
          yaxis: [
            {
              title: { text: "" },
              labels: { formatter: compactAxisNumber, maxWidth: 70, style: { colors: axisColor, fontSize: "10px" } },
            },
            {
              opposite: true,
              title: { text: "" },
              labels: { formatter: compactAxisNumber, maxWidth: 52, style: { colors: axisColor, fontSize: "10px" } },
            },
          ],
          grid: { padding: { ...DASHBOARD_CHART_GRID_PADDING } },
        },
      },
      {
        breakpoint: PHONE_CHART_BREAKPOINT,
        options: {
          chart: { height: phoneHeight },
          legend: {
            position: "top",
            horizontalAlign: "center",
            fontSize: "10px",
            itemMargin: { horizontal: 5, vertical: 1 },
          },
          xaxis: mobileColumnXAxis(axisColor, -44, compactMonthLabel, false),
          yaxis: [
            {
              title: { text: "" },
              labels: { formatter: compactAxisNumber, maxWidth: 58, style: { colors: axisColor, fontSize: "10px" } },
            },
            {
              opposite: true,
              title: { text: "" },
              labels: { formatter: compactAxisNumber, maxWidth: 40, style: { colors: axisColor, fontSize: "10px" } },
            },
          ],
          grid: { padding: { ...DASHBOARD_CHART_GRID_PADDING } },
          plotOptions: { bar: { horizontal: false, columnWidth: "68%", borderRadius: 4 } },
        },
      },
    ];
  }

  function resizeAll() {
    const run = () => {
      Object.values(apexBySelector).forEach((entry) => {
        const charts = Array.isArray(entry) ? entry : [entry];
        charts.forEach((chart) => {
          if (!chart || typeof chart.resize !== "function") return;
          try {
            lockHorizontalBarYAxisWidth(chart);
            chart.resize();
          } catch (_) {}
        });
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function renderStructureByClass(categories, values, targetSel = "#chartStructure", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!categories.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const axisColor = chartAxisColor();
    const cat = categories.map((c) => shortenLabel(c, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "65%", borderRadius: 4 } },
      series: [{ name: "Доля, %", data: values }],
      colors: [chartBarColor()],
      xaxis: {
        categories: cat,
        max: 100,
        tickAmount: 5,
        labels: { formatter: (v) => `${v}%`, style: { colors: axisColor, fontSize: "11px" } },
      },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderCostsByMonth(labels, seriesMln, targetSel = "#chartCosts", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const axisColor = chartAxisColor();
    const layout = chartLayout(height, "bar");
    const opts = {
      ...layout,
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } },
      series: [{ name: "Затраты, млн ₽", data: seriesMln }],
      colors: [chartBarColor()],
      xaxis: {
        categories: labels,
        labels: {
          rotate: -42,
          rotateAlways: true,
          hideOverlappingLabels: false,
          trim: false,
          formatter: compactMonthLabel,
        },
      },
      yaxis: {
        title: { text: "Млн ₽" },
        labels: { formatter: (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) },
      },
      responsive: withPhoneXAxis(layout.responsive, mobileColumnXAxis(axisColor, -44, compactMonthLabel, false)),
      tooltip: {
        y: {
          formatter: (val) =>
            `${Number(val).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млн ₽`,
        },
      },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderFailureCauses(categories, values, targetSel = "#chartCauses", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!categories.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = categories.map((c) => shortenLabel(c, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: "65%",
          borderRadius: 4,
        },
      },
      series: [{ name: "Кол-во", data: values }],
      colors: [chartBarColor()],
      legend: { show: false },
      xaxis: { categories: cat },
      tooltip: { y: { formatter: (val) => `${val} отказов` } },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  /** Горизонтальный бар: затраты по объектам, млн ₽ */
  function renderTopEquipmentCost(names, costsMln, targetSel = "#chartTopCostEquip", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "млн ₽", data: costsMln }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      dataLabels: {
        enabled: true,
        formatter: (v) => `${Number(v).toFixed(2)}`,
        style: { fontSize: "10px" },
      },
      tooltip: {
        y: {
          formatter: (val, { dataPointIndex }) =>
            `${names[dataPointIndex]}: ${Number(val).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млн ₽`,
        },
      },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderClassCostDonut(labels, costsRub, targetSel = "#chartClassCostDonut", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length || costsRub.every((x) => !x)) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "donut"),
      labels,
      series: costsRub,
      colors: categoricalPalette(),
      legend: { position: "bottom", fontSize: "11px" },
      plotOptions: {
        pie: {
          donut: {
            size: "68%",
          },
        },
      },
      tooltip: {
        y: {
          formatter: (val) =>
            `${(val / 1e6).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млн ₽`,
        },
      },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  /** Круговая диаграмма долей парка по диапазонам «Процент использования» (оформление как «Доля затрат по классам»). */
  function renderEquipmentUsageDonut(labels, counts, targetSel = "#chartEquipmentUsageDonut", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    const total = counts.reduce((a, b) => a + b, 0);
    if (!labels.length || !total) {
      el.innerHTML = chartHintHtml("Нет данных по проценту использования.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "donut"),
      labels,
      series: counts,
      colors: categoricalPalette(),
      legend: { position: "bottom", fontSize: "11px" },
      plotOptions: {
        pie: {
          donut: {
            size: "68%",
          },
        },
      },
      tooltip: {
        y: {
          formatter: (val) => {
            const n = Number(val);
            const pctShare = total ? (100 * n) / total : 0;
            return `${n.toLocaleString("ru-RU")} ед. (${pctShare.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% парка)`;
          },
        },
      },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderTopDowntime(names, hours, targetSel = "#chartTopDowntime", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = chartHintHtml("Нет данных КТГ.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "Часы", data: hours }],
      colors: [chartBarColor()],
      legend: { show: false },
      xaxis: { categories: cat },
      tooltip: { y: { formatter: (v) => `${Math.round(v)} ч` } },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderTopDefects(names, counts, targetSel = "#chartTopDefects", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = chartHintHtml("Нет данных по отказам.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "Отказов", data: counts }],
      colors: [chartBarColor()],
      legend: { show: false },
      xaxis: { categories: cat },
      tooltip: { y: { formatter: (v) => `${v} шт.` } },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderClassQtyColumn(classes, qtys, targetSel = "#chartClassQty", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!classes.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "bar"),
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } },
      series: [{ name: "Единиц", data: qtys }],
      colors: [chartBarColor()],
      xaxis: { categories: classes.map((c) => shortenLabel(c, 22)), labels: { rotate: -35 } },
      yaxis: { title: { text: "Шт." }, min: 0, tickAmount: 4 },
      tooltip: { y: { formatter: (v) => `${v} шт.` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderClassCostsBar(classes, costsMln, targetSel = "#chartClassCostsBar", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!classes.length) {
      el.innerHTML = chartHintHtml("Нет данных.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "bar"),
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } },
      series: [{ name: "млн ₽", data: costsMln }],
      colors: [chartBarColor()],
      xaxis: { categories: classes.map((c) => shortenLabel(c, 22)), labels: { rotate: -35 } },
      yaxis: {
        title: { text: "Млн ₽" },
        labels: { formatter: (v) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) },
      },
      tooltip: {
        y: {
          formatter: (val) =>
            `${Number(val).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} млн ₽`,
        },
      },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderKtgLine(labels, values, targetSel = "#chartKtgTrend", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length || !values.length) {
      el.innerHTML = chartHintHtml("Нет данных КТГ по месяцам.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const axisColor = chartAxisColor();
    const layout = chartLayout(height, "line");
    const opts = {
      ...layout,
      stroke: { curve: "smooth", width: 3 },
      markers: { size: 4 },
      series: [{ name: "КТГ", data: values }],
      colors: [chartBarColor()],
      xaxis: {
        categories: labels,
        labels: {
          rotate: -35,
          rotateAlways: true,
          hideOverlappingLabels: false,
          trim: false,
          formatter: compactMonthLabel,
        },
      },
      yaxis: {
        min: 0,
        max: 1,
        tickAmount: 5,
        labels: { formatter: (v) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) },
      },
      tooltip: {
        y: { formatter: (v) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) },
      },
      responsive: withPhoneXAxis(layout.responsive, mobileColumnXAxis(axisColor, -44, compactMonthLabel, false)),
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderMtbfTop(names, hours, targetSel = "#chartMtbfTop", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = chartHintHtml("Нет данных СННО в срезе.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "СННО, ч", data: hours }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderMttrTop(names, hours, targetSel = "#chartMttrTop", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = chartHintHtml("Нет данных СВР в срезе.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, HBAR_CATEGORY_LABEL_MAX_LEN));
    const opts = {
      ...horizontalBarLayout(height),
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "СВР, ч", data: hours }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    renderHorizontalBarChart(el, opts, targetSel);
  }

  function renderMaterialLaborStacked(labels, materialRub, laborHours, targetSel = "#chartMaterialLabor", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length) {
      el.innerHTML = chartHintHtml("Нет данных по структуре затрат и труда.");
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const pal = categoricalPalette();
    const layout = chartLayout(height, "line");
    const opts = {
      ...layout,
      chart: {
        ...layout.chart,
        type: "line",
        stacked: false,
        toolbar: { show: false },
      },
      plotOptions: { bar: { horizontal: false, columnWidth: "62%", borderRadius: 4 } },
      series: [
        { name: "Материальные затраты, ₽", type: "column", data: materialRub },
        { name: "Трудозатраты, ч", type: "column", data: laborHours },
      ],
      stroke: { width: [0, 0], curve: "straight" },
      colors: [pal[0], chartBarColor()],
      xaxis: {
        categories: labels,
        labels: {
          rotate: -35,
          rotateAlways: true,
          hideOverlappingLabels: false,
          trim: false,
          formatter: compactMonthLabel,
        },
      },
      yaxis: [
        {
          seriesName: "Материальные затраты, ₽",
          title: { text: "Материалы, ₽" },
          labels: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")}` },
        },
        {
          seriesName: "Трудозатраты, ч",
          opposite: true,
          title: { text: "Труд, ч" },
          labels: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")}` },
        },
      ],
      legend: {
        position: "top",
        horizontalAlign: "center",
        fontSize: "11px",
        itemMargin: { horizontal: 8, vertical: 2 },
      },
      dataLabels: { enabled: false },
      responsive: dualAxisMobileResponsive(height),
      tooltip: {
        shared: true,
        y: {
          formatter: (v, ctx) =>
            (ctx && ctx.seriesIndex === 0)
              ? `${Math.round(v).toLocaleString("ru-RU")} ₽`
              : `${Math.round(v).toLocaleString("ru-RU")} ч`,
        },
      },
    };
    try {
      const chart = new ApexCharts(el, opts);
      apexBySelector[targetSel] = chart;
      const renderResult = chart.render();
      if (renderResult && typeof renderResult.catch === "function") {
        renderResult.catch((err) => {
          console.error("[TOIR] renderMaterialLaborStacked render failed:", err);
          dispose(targetSel);
          const msg = (err && err.message) ? String(err.message) : "unknown";
          el.innerHTML = chartHintHtml(`Не удалось отрисовать график структуры затрат. Ошибка: ${String(msg).slice(0, 400)}`);
        });
      }
    } catch (err) {
      console.error("[TOIR] renderMaterialLaborStacked init failed:", err);
      dispose(targetSel);
      const msg = (err && err.message) ? String(err.message) : "unknown";
      el.innerHTML = chartHintHtml(`Не удалось отрисовать график структуры затрат. Ошибка: ${String(msg).slice(0, 400)}`);
    }
  }

  function shortenLabel(s, max = 42) {
    const t = String(s);
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function formatCompactNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    const abs = Math.abs(num);
    if (abs >= 1e9) return `${(num / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млрд`;
    if (abs >= 1e6) return `${(num / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
    if (abs >= 1e3) return `${(num / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} тыс`;
    return num.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  /** Цвета серий: горизонтальные bar как на дашборде; факт/план — синий + --chart-bar. */
  function resolveAgentChartColors(spec, series, categories, type) {
    if (Array.isArray(spec.colors) && spec.colors.length) return spec.colors;
    const palette = categoricalPalette();
    const n = series.length || 1;
    const isHorizontalBar = type === "bar" && categories.length >= 4;
    if (type === "bar" && n === 1) return [chartBarColor()];
    if (!isHorizontalBar) return palette.slice(0, n);
    if (n === 1) return [chartBarColor()];
    if (n === 2) {
      const names = series.map((s) => String(s?.name || "").toLowerCase());
      if (names.some((x) => /факт/.test(x)) && names.some((x) => /план/.test(x))) {
        return [palette[0], chartBarColor()];
      }
    }
    return palette.slice(0, n);
  }

  function renderAgentChart(spec, targetSel, height = 260) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    dispose(targetSel);

    const type = spec.chartType || "bar";
    const palette = categoricalPalette();
    const series = spec.series || [];
    const axisTint = chartAxisColor();
    const isHorizontalBar = type === "bar" && (spec.categories || []).length >= 4;
    const categories = (spec.categories || []).map((c) =>
      shortenLabel(c, isHorizontalBar ? HBAR_CATEGORY_LABEL_MAX_LEN : 30)
    );
    const layoutType = isHorizontalBar ? "bar" : type;
    const layoutOnce = isHorizontalBar ? horizontalBarLayout(height) : chartLayout(height, layoutType);

    const isPie = type === "pie" || type === "donut";

    if (isPie) {
      const data = series[0]?.data || [];
      const opts = {
        ...layoutOnce,
        chart: { ...layoutOnce.chart, type, foreColor: axisTint },
        labels: categories,
        series: data,
        colors: palette.slice(0, data.length),
        legend: { position: "bottom", fontSize: "10px", labels: { colors: axisTint } },
      };
      apexBySelector[targetSel] = new ApexCharts(el, opts);
      apexBySelector[targetSel].render();
      return;
    }

    const opts = {
      ...layoutOnce,
      chart: {
        ...layoutOnce.chart,
        type: type === "area" ? "area" : type === "line" ? "line" : "bar",
        foreColor: axisTint,
      },
      plotOptions: isHorizontalBar
        ? { bar: { horizontal: true, barHeight: "60%", borderRadius: 3 } }
        : { bar: { columnWidth: "55%", borderRadius: 3 } },
      legend: {
        ...(layoutOnce.legend || {}),
        labels: { colors: axisTint },
      },
      xaxis: {
        ...layoutOnce.xaxis,
        categories,
        labels: isHorizontalBar
          ? hbarNumericXAxisLabels(axisTint, "10px")
          : {
              ...((layoutOnce.xaxis && layoutOnce.xaxis.labels) || {}),
              style: { colors: axisTint, fontSize: "10px" },
              hideOverlappingLabels: true,
              rotate: -35,
              maxHeight: 80,
            },
      },
      yaxis: isHorizontalBar
        ? hbarCategoryYAxis(axisTint)
        : {
            labels: {
              style: { colors: axisTint, fontSize: "11px" },
              formatter: (v) => formatCompactNumber(v),
            },
          },
      series: series.map((s, i) => ({
        name: s.name || `Серия ${i + 1}`,
        data: s.data || [],
      })),
      tooltip: {
        ...((layoutOnce.tooltip && typeof layoutOnce.tooltip === "object") ? layoutOnce.tooltip : {}),
        y: {
          formatter: (v) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }),
        },
      },
      colors: resolveAgentChartColors(spec, series, categories, type),
      stroke:
        type === "line" || type === "area"
          ? {
              width: 2,
              curve: "smooth",
              dashArray: series.map((s) =>
                /нижн|верхн|интервал/i.test(String(s?.name || "")) ? 6 : 0
              ),
            }
          : {},
      fill: type === "area" ? { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } } : {},
    };

    renderHorizontalBarChart(el, opts, targetSel);
  }

  global.ToirCharts = {
    renderStructureByClass,
    renderCostsByMonth,
    renderFailureCauses,
    renderTopEquipmentCost,
    renderClassCostDonut,
    renderEquipmentUsageDonut,
    renderTopDowntime,
    renderTopDefects,
    renderClassQtyColumn,
    renderClassCostsBar,
    renderKtgLine,
    renderMtbfTop,
    renderMttrTop,
    renderMaterialLaborStacked,
    renderAgentChart,
    resizeAll,
    dispose,
  };
})(typeof window !== "undefined" ? window : globalThis);
