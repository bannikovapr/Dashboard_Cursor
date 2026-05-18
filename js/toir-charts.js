(function (global) {
  const U = global.ToirUtils || {};

  const chartBarColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--chart-bar").trim() || "#1ed760";

  const chartAxisColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--chart-axis").trim() || "#64748b";

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

  function chartLayout(height, chartType) {
    const b = baseOpts();
    const tabletHeight = Math.max(220, Math.round(height * 0.9));
    const phoneHeight = Math.max(200, Math.round(height * 0.8));
    const axisColor = chartAxisColor();
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
            yaxis: {
              labels: {
                maxWidth: 180,
                style: { colors: axisColor, fontSize: "11px" },
              },
            },
          },
        },
        {
          breakpoint: 576,
          options: {
            chart: { height: phoneHeight },
            legend: { position: "bottom", fontSize: "9px" },
            xaxis: { labels: { rotate: 0, hideOverlappingLabels: true, trim: true, maxHeight: 52 } },
            yaxis: {
              labels: {
                maxWidth: 140,
                style: { fontSize: "11px", colors: axisColor },
              },
            },
            grid: { padding: { left: 4, right: 0 } },
          },
        },
      ],
    };
  }

  function resizeAll() {
    requestAnimationFrame(() => {
      Object.values(apexBySelector).forEach((entry) => {
        const charts = Array.isArray(entry) ? entry : [entry];
        charts.forEach((chart) => {
          if (chart && typeof chart.resize === "function") {
            try {
              chart.resize();
            } catch (_) {}
          }
        });
      });
    });
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
      el.innerHTML = chartHintHtml("Нет данных.");
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
      el.innerHTML = chartHintHtml("Нет данных.");
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
      el.innerHTML = chartHintHtml("Нет данных.");
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
      el.innerHTML = chartHintHtml("Нет данных по отказам.");
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
      el.innerHTML = chartHintHtml("Нет данных КТГ по месяцам.");
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
      el.innerHTML = chartHintHtml("Нет данных СННО в срезе.");
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
      el.innerHTML = chartHintHtml("Нет данных СВР в срезе.");
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
      series: [{ name: "СВР, ч", data: hours }],
      colors: [chartBarColor()],
      xaxis: { categories: cat },
      yaxis: { labels: { maxWidth: 220, style: { fontSize: "13px" } } },
      tooltip: { y: { formatter: (v) => `${Math.round(v).toLocaleString("ru-RU")} ч` } },
    };
    apexBySelector[targetSel] = new ApexCharts(el, opts);
    apexBySelector[targetSel].render();
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
      colors: [pal[0], pal[1]],
      xaxis: { categories: labels, labels: { rotate: -30 } },
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
      legend: { position: "top" },
      dataLabels: { enabled: false },
      grid: { padding: { left: 8, right: 8 } },
      // Для графика с двумя осями отключаем общий responsive из chartLayout:
      // там yaxis задаётся объектом, что конфликтует с массивом yaxis.
      responsive: [],
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

  function renderAgentChart(spec, targetSel, height = 260) {
    const el = document.querySelector(targetSel);
    if (!el) return;
    dispose(targetSel);

    const type = spec.chartType || "bar";
    const categories = (spec.categories || []).map((c) => shortenLabel(c, 30));
    const palette = categoricalPalette();
    const series = spec.series || [];
    const axisTint = chartAxisColor();
    const layoutType = type === "bar" && categories.length > 6 ? "bar" : type;
    const layoutOnce = chartLayout(height, layoutType);

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

    const isHorizontalBar = type === "bar" && categories.length > 6;

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
        labels: {
          ...((layoutOnce.xaxis && layoutOnce.xaxis.labels) || {}),
          style: { colors: axisTint, fontSize: "10px" },
          hideOverlappingLabels: true,
          rotate: isHorizontalBar ? 0 : -35,
          maxHeight: 80,
        },
      },
      yaxis: isHorizontalBar
        ? {
            labels: {
              maxWidth: 220,
              style: { colors: axisTint, fontSize: "12px" },
            },
          }
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
  };
})(typeof window !== "undefined" ? window : globalThis);
