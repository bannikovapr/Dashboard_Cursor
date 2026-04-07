(function (global) {
  function formatMoneyMln(rub) {
    if (rub == null || Number.isNaN(rub)) return "—";
    const mln = rub / 1_000_000;
    return `${mln.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млн ₽`;
  }

  function formatMoneyK(rub) {
    if (rub == null || Number.isNaN(rub)) return "—";
    const k = rub / 1000;
    return `${k.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} тыс. ₽`;
  }

  function formatHours(h) {
    if (h == null || Number.isNaN(h)) return "—";
    return `${Math.round(h).toLocaleString("ru-RU")} ч`;
  }

  function formatRatioFromPercent(p) {
    if (p == null || Number.isNaN(p)) return "—";
    const v = p / 100;
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatCount(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return `${Number(n).toLocaleString("ru-RU")}`;
  }

  /** @param {object} brandJson optional */
  function applyBrandTokens(brandJson) {
    if (!brandJson) return;
    const r = document.documentElement.style;
    if (brandJson.primary) r.setProperty("--brand-primary", brandJson.primary);
    if (brandJson.background) r.setProperty("--brand-bg", brandJson.background);
    if (brandJson.card) r.setProperty("--brand-card", brandJson.card);
    if (brandJson.text) r.setProperty("--brand-text", brandJson.text);
    if (brandJson.accent) {
      r.setProperty("--brand-accent", brandJson.accent);
      r.setProperty("--chart-bar", brandJson.accent);
    }
  }

  function getBaseChartOptionsLight() {
    return {
      chart: {
        fontFamily: "Montserrat, system-ui, sans-serif",
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      theme: { mode: "light" },
      grid: {
        borderColor: "#e2e8f0",
        strokeDashArray: 4,
        padding: { left: 4, right: 32, top: 10, bottom: 28 },
      },
      dataLabels: { enabled: false },
      legend: { position: "top", horizontalAlign: "right", fontSize: "11px" },
      tooltip: {
        theme: "light",
        y: {
          formatter(val) {
            if (typeof val !== "number") return String(val);
            return val.toLocaleString("ru-RU");
          },
        },
      },
      xaxis: {
        labels: {
          style: { colors: "#64748b", fontSize: "11px" },
          hideOverlappingLabels: true,
        },
      },
      yaxis: {
        labels: { style: { colors: "#64748b", fontSize: "11px" } },
      },
    };
  }

  function getChartGreenPalette() {
    const g = (n, fallback) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;
    return [
      g("--chart-g-1", "#14532d"),
      g("--chart-g-2", "#166534"),
      g("--chart-g-3", "#15803d"),
      g("--chart-g-4", "#16a34a"),
      g("--chart-g-5", "#22c55e"),
      g("--chart-g-6", "#4ade80"),
      g("--chart-g-7", "#86efac"),
      g("--chart-g-8", "#1ed760"),
    ];
  }

  global.ToirUtils = {
    formatMoneyMln,
    formatMoneyK,
    formatHours,
    formatRatioFromPercent,
    formatCount,
    applyBrandTokens,
    getBaseChartOptionsLight,
    getChartGreenPalette,
  };
})(typeof window !== "undefined" ? window : globalThis);
