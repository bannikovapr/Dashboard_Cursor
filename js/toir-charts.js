(function (global) {
  const U = global.ToirUtils || {};

  const chartBarColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--chart-bar").trim() || "#1ed760";

  const categoricalPalette = () => [
    "#1e88e5", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#f43f5e", // rose
    "#7e57c2", // purple
    "#0ea5e9", // sky
    "#22c55e", // emerald
    "#fbbf24", // yellow
  ];

  const apexBySelector = {};

  function dispose(sel) {
    const c = apexBySelector[sel];
    if (c && typeof c.destroy === "function") c.destroy();
    delete apexBySelector[sel];
  }

  function baseOpts() {
    return U.getBaseChartOptionsLight();
  }

  function chartLayout(height, chartType) {
    const b = baseOpts();
    const tabletHeight = Math.max(220, Math.round(height * 0.9));
    const phoneHeight = Math.max(200, Math.round(height * 0.8));
    return {
      ...b,
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
            yaxis: { labels: { maxWidth: 180 } },
          },
        },
        {
          breakpoint: 576,
          options: {
            chart: { height: phoneHeight },
            legend: { position: "bottom", fontSize: "9px" },
            xaxis: { labels: { rotate: 0, hideOverlappingLabels: true, trim: true, maxHeight: 52 } },
            yaxis: { labels: { maxWidth: 140, style: { fontSize: "11px" } } },
            grid: { padding: { left: 4, right: 0 } },
          },
        },
      ],
    };
  }

  function resizeAll() {
    requestAnimationFrame(() => {
      Object.values(apexBySelector).forEach((chart) => {
        if (chart && typeof chart.resize === "function") {
          try {
            chart.resize();
          } catch (_) {}
        }
      });
    });
  }

  function renderStructureByClass(categories, values, targetSel = "#chartStructure", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!categories.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 8, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "65%", borderRadius: 4 } },
      series: [{ name: "Доля, %", data: values }],
      colors: [chartBarColor()],
      xaxis: {
        categories,
        max: 100,
        tickAmount: 5,
        labels: { formatter: (v) => `${v}%` },
      },
      yaxis: { labels: { maxWidth: 200, style: { fontSize: "13px" } } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderCostsByMonth(labels, seriesMln, targetSel = "#chartCosts", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "bar"),
      plotOptions: { bar: { columnWidth: "55%", borderRadius: 4 } },
      series: [{ name: "Затраты, млн ₽", data: seriesMln }],
      colors: [chartBarColor()],
      xaxis: { categories: labels, labels: { rotate: -45 } },
      yaxis: {
        title: { text: "Млн ₽" },
        labels: { formatter: (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) },
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

  function renderFailureCauses(categories, values, targetSel = "#chartCauses", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!categories.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = targetSel === "#chartCausesRel" ? categories.map((c) => shortenLabel(c, 36)) : categories;
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
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
      xaxis: targetSel === "#chartCausesRel" ? { categories: cat, labels: { style: { fontSize: "11px" } } } : { categories: cat },
      yaxis: { labels: { maxWidth: targetSel === "#chartCausesRel" ? 200 : 220, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (val) => `${val} отказов` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  /** Горизонтальный бар: затраты по объектам, млн ₽ */
  function renderTopEquipmentCost(names, costsMln, targetSel = "#chartTopCostEquip", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, 40));
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "млн ₽", data: costsMln }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 200, style: { fontSize: "13px" } } },
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
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderClassCostDonut(labels, costsRub, targetSel = "#chartClassCostDonut", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length || costsRub.every((x) => !x)) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
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

  function renderTopDowntime(names, hours, targetSel = "#chartTopDowntime", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных КТГ.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, 40));
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "Часы", data: hours }],
      colors: [chartBarColor()],
      legend: { show: false },
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 200, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (v) => `${Math.round(v)} ч` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderTopDefects(names, counts, targetSel = "#chartTopDefects", height = 320) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных по отказам.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, 40));
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "Отказов", data: counts }],
      colors: [chartBarColor()],
      legend: { show: false },
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 200, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (v) => `${v} шт.` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderClassQtyColumn(classes, qtys, targetSel = "#chartClassQty", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!classes.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
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
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных.</p>';
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
      grid: { padding: { left: 6, right: 0 } },
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
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных КТГ по месяцам.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const opts = {
      ...chartLayout(height, "line"),
      stroke: { curve: "smooth", width: 3 },
      markers: { size: 4 },
      series: [{ name: "КТГ", data: values }],
      colors: [chartBarColor()],
      xaxis: { categories: labels },
      yaxis: {
        min: 0,
        max: 1,
        tickAmount: 5,
        labels: { formatter: (v) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) },
      },
      tooltip: {
        y: { formatter: (v) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) },
      },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderMtbfTop(names, hours, targetSel = "#chartMtbfTop", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных СННО в срезе.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, 38));
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "СННО, ч", data: hours }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 220, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderMttrTop(names, hours, targetSel = "#chartMttrTop", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных СВВ в срезе.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const cat = names.map((n) => shortenLabel(n, 38));
    const opts = {
      ...chartLayout(height, "bar"),
      grid: { padding: { left: 24, right: 0 } },
      plotOptions: { bar: { horizontal: true, barHeight: "70%", borderRadius: 3 } },
      series: [{ name: "СВВ, ч", data: hours }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 220, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  function renderMaterialLaborStacked(labels, materialHours, laborHours, targetSel = "#chartMaterialLabor", height = 300) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    if (!labels.length) {
      el.innerHTML = '<p class="hint" style="padding:24px;color:#64748b">Нет данных по структуре работ.</p>';
      dispose(targetSel);
      return;
    }
    dispose(targetSel);
    el.innerHTML = "";
    const pal = categoricalPalette();
    const opts = {
      ...chartLayout(height, "bar"),
      chart: { ...chartLayout(height, "bar").chart, stacked: true },
      plotOptions: { bar: { horizontal: false, columnWidth: "58%", borderRadius: 4 } },
      series: [
        { name: "Материальные работы, ч", data: materialHours },
        { name: "Трудозатраты, ч", data: laborHours },
      ],
      colors: [pal[0], pal[1]],
      xaxis: { categories: labels, labels: { rotate: -30 } },
      yaxis: { title: { text: "Часы" } },
      legend: { position: "top" },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
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

  function renderAgentChart(spec, targetSel, height = 260) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    dispose(targetSel);

    const type = spec.chartType || "bar";
    const categories = (spec.categories || []).map((c) => shortenLabel(c, 30));
    const palette = categoricalPalette();
    const series = spec.series || [];

    const isPie = type === "pie" || type === "donut";

    if (isPie) {
      const data = series[0]?.data || [];
      const opts = {
        ...chartLayout(height, type),
        chart: { ...chartLayout(height, type).chart, type },
        labels: categories,
        series: data,
        colors: palette.slice(0, data.length),
        legend: { position: "bottom", fontSize: "10px" },
      };
      apexBySelector[targetSel] = new ApexCharts(el, opts);
      apexBySelector[targetSel].render();
      return;
    }

    const isHorizontalBar = type === "bar" && categories.length > 6;

    const opts = {
      ...chartLayout(height, isHorizontalBar ? "bar" : type),
      chart: {
        ...chartLayout(height, type).chart,
        type: type === "area" ? "area" : type === "line" ? "line" : "bar",
      },
      plotOptions: isHorizontalBar
        ? { bar: { horizontal: true, barHeight: "60%", borderRadius: 3 } }
        : { bar: { columnWidth: "55%", borderRadius: 3 } },
      xaxis: {
        ...chartLayout(height, type).xaxis,
        categories,
        labels: {
          style: { colors: "#64748b", fontSize: "10px" },
          hideOverlappingLabels: true,
          rotate: isHorizontalBar ? 0 : -35,
          maxHeight: 80,
        },
      },
      yaxis: {
        labels: {
          formatter: (v) => formatCompactNumber(v),
        },
      },
      series: series.map((s, i) => ({
        name: s.name || `Серия ${i + 1}`,
        data: s.data || [],
      })),
      tooltip: {
        y: {
          formatter: (v) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }),
        },
      },
      colors: palette.slice(0, series.length || 1),
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

    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
  }

  global.ToirCharts = {
    renderStructureByClass,
    renderCostsByMonth,
    renderFailureCauses,
    renderTopEquipmentCost,
    renderClassCostDonut,
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
  };
})(typeof window !== "undefined" ? window : globalThis);
