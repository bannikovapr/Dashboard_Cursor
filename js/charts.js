class Charts {
  constructor() {
    this.instances = {};
  }

  destroy(id) {
    if (this.instances[id]) {
      this.instances[id].destroy();
      delete this.instances[id];
    }
  }

  renderTraffic({ el, series, categories }) {
    this.destroy(el);
    const base = DashboardUtils.getBaseChartOptions();
    const options = DashboardUtils.deepMerge(base, {
      chart: { type: "area", height: 340, stacked: true },
      colors: series.map((s) => s.color),
      series: series.map((s) => ({ name: s.name, data: s.data })),
      xaxis: { categories },
      fill: { type: "gradient", gradient: { opacityFrom: 0.28, opacityTo: 0.06 } },
      stroke: { width: 2, curve: "smooth" },
      legend: { position: "top" },
      tooltip: {
        y: { formatter: (v) => DashboardUtils.formatNumber(v, 0) },
      },
      yaxis: {
        labels: { formatter: (v) => DashboardUtils.formatNumber(v, 0) },
      },
    });
    this.instances[el] = new ApexCharts(document.querySelector(`#${el}`), options);
    this.instances[el].render();
  }

  renderCPL({ el, labels, values, colors }) {
    this.destroy(el);
    const base = DashboardUtils.getBaseChartOptions();
    const accent = DashboardUtils.getCssVar("--accent", "#1ED760");
    const options = DashboardUtils.deepMerge(base, {
      chart: { type: "bar", height: 340 },
      plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: "70%" } },
      colors: [accent],
      series: [{ name: "CPL", data: values }],
      xaxis: {
        categories: labels,
        labels: { formatter: (v) => `${DashboardUtils.formatNumber(v, 0)} ₽` },
        tickAmount: 5,
      },
      yaxis: { labels: { style: { colors } } },
      tooltip: { y: { formatter: (v) => `${DashboardUtils.formatNumber(v, 2)} ₽` } },
      dataLabels: { enabled: true, formatter: (v) => `${DashboardUtils.formatNumber(v, 0)} ₽` },
    });
    this.instances[el] = new ApexCharts(document.querySelector(`#${el}`), options);
    this.instances[el].render();
  }

  renderScatter({ el, series }) {
    this.destroy(el);
    const base = DashboardUtils.getBaseChartOptions();

    const flat = (series || []).flatMap((s) => (s.data || []).map((p) => ({ ...p, _color: s.color, _name: s.name })));
    const xs = flat.map((p) => p.x);
    const ys = flat.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = (maxX - minX || 1) * 0.2;
    const padY = (maxY - minY || 1) * 0.2;

    const options = DashboardUtils.deepMerge(base, {
      chart: { type: "scatter", height: 340, zoom: { enabled: false } },
      series: (series || []).map((s) => ({ name: s.name, data: s.data })),
      colors: (series || []).map((s) => s.color),
      markers: { size: 7, strokeWidth: 0 },
      xaxis: {
        title: { text: "CPL (₽)", style: { color: DashboardUtils.getCssVar("--text-secondary", "rgba(17,17,17,0.55)") } },
        min: minX - padX,
        max: maxX + padX,
        labels: { formatter: (v) => DashboardUtils.formatNumber(v, 0) },
        tickAmount: 5,
      },
      yaxis: {
        title: { text: "ROAS", style: { color: DashboardUtils.getCssVar("--text-secondary", "rgba(17,17,17,0.55)") } },
        min: minY - padY,
        max: maxY + padY,
        labels: { formatter: (v) => DashboardUtils.formatNumber(v, 1) },
      },
      tooltip: {
        custom: ({ series, seriesIndex, dataPointIndex, w }) => {
          const d = w.globals.initialSeries[seriesIndex].data[dataPointIndex];
          const isLight = (DashboardUtils.getCssVar("--bg-base", "").toLowerCase() === "#ffffff");
          const fg = isLight ? "#000" : "#f0f2f5";
          const bg = isLight ? "#fff" : "#0d0e0f";
          const border = DashboardUtils.getCssVar("--accent", "#1ED760");
          return `
            <div style="padding:10px 10px 9px; color:${fg}; background:${bg}; border:1px solid ${border}; border-radius:10px;">
              <div style="font-weight:700; margin-bottom:6px;">${d.channel}</div>
              <div style="opacity:.85">CPL: <b>${DashboardUtils.formatNumber(d.x, 2)} ₽</b></div>
              <div style="opacity:.85">ROAS: <b>${DashboardUtils.formatNumber(d.y, 2)}</b></div>
            </div>
          `;
        },
      },
    });

    this.instances[el] = new ApexCharts(document.querySelector(`#${el}`), options);
    this.instances[el].render();
  }

  renderFunnel({ el, stages }) {
    this.destroy(el);
    const base = DashboardUtils.getBaseChartOptions();
    const accent = DashboardUtils.getCssVar("--accent", "#1ED760");
    const first = Math.max(1, stages[0].value);
    const perc = stages.map((s) => (s.value / first) * 100);

    const options = DashboardUtils.deepMerge(base, {
      chart: { type: "bar", height: 340 },
      plotOptions: { bar: { horizontal: true, borderRadius: 8, barHeight: "70%" } },
      colors: [accent],
      series: [{ name: "Воронка", data: perc }],
      xaxis: {
        categories: stages.map((s) => s.label),
        labels: { formatter: (v) => `${DashboardUtils.formatNumber(v, 0)}%` },
        max: 100,
      },
      dataLabels: {
        enabled: true,
        formatter: (v, opts) => {
          const idx = opts.dataPointIndex;
          const abs = stages[idx].value;
          return `${DashboardUtils.formatNumber(v, 0)}%  ·  ${DashboardUtils.formatNumber(abs, 0)}`;
        },
      },
      tooltip: {
        y: { formatter: (v, opts) => `${DashboardUtils.formatNumber(v, 1)}%` },
      },
    });

    this.instances[el] = new ApexCharts(document.querySelector(`#${el}`), options);
    this.instances[el].render();
  }
}

window.DashboardCharts = new Charts();

