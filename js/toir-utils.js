(function (global) {
  function formatMoneyMln(rub) {
    if (rub == null || Number.isNaN(rub)) return "—";
    const mln = rub / 1_000_000;
    const amount = mln.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return `${amount} млн\u00a0₽`;
  }

  function formatMoneyK(rub) {
    if (rub == null || Number.isNaN(rub)) return "—";
    const k = rub / 1000;
    return `${k.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} тыс. ₽`;
  }

  function formatHours(h) {
    if (h == null || Number.isNaN(h)) return "—";
    return `${Math.round(h).toLocaleString("ru-RU")}\u00a0ч`;
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
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      ["--brand-primary", "--brand-bg", "--brand-card", "--brand-text"].forEach((p) => r.removeProperty(p));
    }
    if (brandJson.accent) {
      const accent = String(brandJson.accent).trim();
      r.setProperty("--brand-accent", accent);
      r.setProperty("--chart-bar", accent);
      r.setProperty("--chart-g-5", accent);
      r.setProperty("--chart-g-8", accent);
    }
    if (isDark) return;
    if (brandJson.primary) r.setProperty("--brand-primary", brandJson.primary);
    if (brandJson.background) r.setProperty("--brand-bg", brandJson.background);
    if (brandJson.card) r.setProperty("--brand-card", brandJson.card);
    if (brandJson.text) r.setProperty("--brand-text", brandJson.text);
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    const t = (v && String(v).trim()) || "";
    return t || fallback;
  }

  function getBaseChartOptionsLight() {
    return getBaseChartOptions();
  }

  function getBaseChartOptions() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const grid = cssVar("--chart-grid", isDark ? "#334155" : "#e2e8f0");
    const axis = cssVar("--chart-axis", isDark ? "#94a3b8" : "#64748b");
    const chartBg = cssVar("--brand-card", isDark ? "#1e293b" : "#ffffff");
    return {
      chart: {
        fontFamily: "Montserrat, system-ui, sans-serif",
        toolbar: { show: false },
        zoom: { enabled: false },
        background: chartBg,
      },
      theme: { mode: isDark ? "dark" : "light" },
      grid: {
        borderColor: grid,
        strokeDashArray: 4,
        padding: { left: 12, right: 12, top: 10, bottom: 24 },
      },
      dataLabels: { enabled: false },
      legend: { position: "top", horizontalAlign: "right", fontSize: "11px" },
      tooltip: {
        theme: isDark ? "dark" : "light",
        y: {
          formatter(val) {
            if (typeof val !== "number") return String(val);
            return val.toLocaleString("ru-RU");
          },
        },
      },
      xaxis: {
        labels: {
          style: { colors: axis, fontSize: "11px" },
          hideOverlappingLabels: true,
        },
      },
      yaxis: {
        labels: { style: { colors: axis, fontSize: "11px" } },
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
      g("--chart-g-5", "#1ed760"),
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
    getBaseChartOptions,
    getChartGreenPalette,
  };
})(typeof window !== "undefined" ? window : globalThis);
