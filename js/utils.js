const CHANNEL_COLOR_MAP = {
  "YouTube": "#FF0000",
  "Google Ads": "#4285F4",
  "Telegram Ads": "#26A5E4",
  "ВКонтакте": "#0077FF",
  "Яндекс Директ": "#FFCC00"
};

function getChannelColor(channel) {
  return CHANNEL_COLOR_MAP[channel] || getCssVar("--accent", "#1ED760");
}

let CHANNEL_COLORS = Object.values(CHANNEL_COLOR_MAP);

function getCssVar(name, fallback = "") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function setChannelColors(colors) {
  if (Array.isArray(colors) && colors.length) CHANNEL_COLORS = colors;
}

function formatNumber(n, digits = 0) {
  const num = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(num);
}

function formatCurrencyRub(n, digits = 0) {
  const num = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(num);
}

function formatPercent(x, digits = 1) {
  const num = Number.isFinite(x) ? x : 0;
  return `${formatNumber(num * 100, digits)}%`;
}

function parseRuDate(ddmmyyyy) {
  // "DD.MM.YYYY"
  const [dd, mm, yyyy] = String(ddmmyyyy).split(".");
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function deepMerge(target, source) {
  if (!source) return target;
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function getBaseChartOptions() {
  const textPrimary = getCssVar("--text-primary", "rgba(240,242,245,0.92)");
  const textSecondary = getCssVar("--text-secondary", "rgba(240,242,245,0.55)");
  const border = getCssVar("--border", "rgba(255,255,255,0.08)");
  const bgBase = getCssVar("--bg-base", "#0d0e0f");
  const isLight = bgBase.toLowerCase() === "#ffffff" || bgBase.toLowerCase() === "white";

  return {
    chart: {
      background: "transparent",
      toolbar: { show: false },
      foreColor: textPrimary,
      animations: { enabled: true, easing: "easeinout", speed: 650 },
    },
    grid: {
      borderColor: border,
      strokeDashArray: 3,
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
    },
    legend: {
      labels: { colors: textPrimary },
      itemMargin: { horizontal: 10, vertical: 6 },
    },
    tooltip: {
      theme: isLight ? "light" : "dark",
    },
    dataLabels: { enabled: false },
    stroke: { width: 2, curve: "smooth" },
    xaxis: {
      labels: { style: { colors: textSecondary } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: textSecondary } },
    },
  };
}

function setScrollProgress(el) {
  const update = () => {
    const h = document.documentElement;
    const max = Math.max(1, h.scrollHeight - h.clientHeight);
    const p = clamp(h.scrollTop / max, 0, 1);
    el.style.transform = `scaleX(${p})`;
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

window.DashboardUtils = {
  CHANNEL_COLORS,
  CHANNEL_COLOR_MAP,
  getChannelColor,
  formatNumber,
  formatCurrencyRub,
  formatPercent,
  parseRuDate,
  toIsoDate,
  deepMerge,
  getBaseChartOptions,
  setScrollProgress,
  getCssVar,
  setChannelColors,
};

