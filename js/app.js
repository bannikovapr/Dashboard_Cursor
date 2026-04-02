const state = {
  data: null,
  selectedChannels: new Set(),
  range: "6m", // 1m | 3m | 6m | all
};

function addChatMessage({ role, text }) {
  const chat = document.getElementById("aiChat");
  if (!chat) return;

  const row = document.createElement("div");
  row.className = `msgRow ${role}`;

  const bubble = document.createElement("div");
  bubble.className = `msg ${role}`;
  bubble.textContent = text;

  row.appendChild(bubble);
  // Using column-reverse in CSS: prepend for "scroll up history"
  chat.prepend(row);
}

function calcChannelKpis(marketingData) {
  const channels = (marketingData?.channels || []).map((c) => {
    const budget = Number(c.totals?.budget) || 0;
    const leads = Number(c.totals?.leads) || 0;
    const roas = Number(c.totals?.roas) || 0;
    const cpl = leads > 0 ? budget / leads : Infinity;
    return { channel: c.channel, budget, leads, roas, cpl };
  });
  return channels;
}

function aiAnswer(question) {
  const q = String(question || "").trim().toLowerCase();
  const data = window.marketingData;
  const channels = calcChannelKpis(data);

  const totalBudget = channels.reduce((s, x) => s + x.budget, 0);
  const totalLeads = channels.reduce((s, x) => s + x.leads, 0);
  const bestRoas = channels.slice().sort((a, b) => b.roas - a.roas)[0];
  const bestCpl = channels.slice().sort((a, b) => a.cpl - b.cpl)[0];
  const worstRoas = channels.slice().sort((a, b) => a.roas - b.roas)[0];
  const worstCpl = channels.slice().sort((a, b) => b.cpl - a.cpl)[0];

  if (!channels.length) {
    return "ФАКТ: данных нет → ВЫВОД: не могу посчитать метрики → ДЕЙСТВИЕ: проверьте `data/marketing.json`";
  }

  if (q.includes("отключ") || q.includes("урез") || q.includes("cut")) {
    const x = worstRoas || worstCpl;
    const fact = `ФАКТ: худший канал по ROAS — ${x.channel}: ROAS ${DashboardUtils.formatNumber(x.roas, 2)}, CPL ${DashboardUtils.formatNumber(x.cpl, 2)} ₽`;
    const concl = "ВЫВОД: этот канал даёт наименьшую окупаемость при сопоставимом объёме.";
    const act = `ДЕЙСТВИЕ: остановить/сильно урезать ${x.channel} и перенести тестовый бюджет в ${bestRoas.channel} (лучший ROAS) или ${bestCpl.channel} (лучший CPL).`;
    return `${fact} → ${concl} → ${act}`;
  }

  if (q.includes("лучший") && q.includes("roas")) {
    const x = bestRoas;
    return `ФАКТ: лучший ROAS — ${x.channel}: ${DashboardUtils.formatNumber(x.roas, 2)} → ВЫВОД: канал лучше всего окупает бюджет → ДЕЙСТВИЕ: масштабировать ${x.channel} (+10–20% бюджета) и контролировать CPL.`;
  }

  if (q.includes("лучший") && (q.includes("cpl") || q.includes("цена") || q.includes("лид"))) {
    const x = bestCpl;
    return `ФАКТ: лучший CPL — ${x.channel}: ${DashboardUtils.formatNumber(x.cpl, 2)} ₽ → ВЫВОД: канал даёт лиды дешевле остальных → ДЕЙСТВИЕ: перенаправить часть бюджета сюда и проверить, как меняется CPL при росте.`;
  }

  if (q.includes("бюджет") || q.includes("сколько потратили")) {
    return `ФАКТ: общий бюджет по всем каналам — ${DashboardUtils.formatCurrencyRub(totalBudget, 0)} → ВЫВОД: это масштаб текущих закупок трафика → ДЕЙСТВИЕ: сравнить бюджет с результатом: всего заявок ${DashboardUtils.formatNumber(totalLeads, 0)} и пересчитать CPL по каналам.`;
  }

  return `ФАКТ: сейчас лучший ROAS — ${bestRoas.channel} (${DashboardUtils.formatNumber(bestRoas.roas, 2)}), лучший CPL — ${bestCpl.channel} (${DashboardUtils.formatNumber(bestCpl.cpl, 2)} ₽) → ВЫВОД: бюджет стоит смещать в более эффективные каналы → ДЕЙСТВИЕ: скажите, какую цель оптимизируем (CPL или ROAS) — я дам точное перераспределение.`;
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = toLin(r), G = toLin(g), B = toLin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function applyBrand(brand) {
  const root = document.documentElement.style;
  const bg = brand.background || "#0d0e0f";
  const isLight = luminance(bg) > 0.65;

  root.setProperty("--bg-base", bg);
  root.setProperty("--bg-deep", isLight ? "#ffffff" : "#07080a");
  root.setProperty("--bg-elevated", brand.card || (isLight ? "#F3F5F6" : "#121416"));
  root.setProperty("--bg-card", brand.card || (isLight ? "#F3F5F6" : "rgba(255,255,255,0.045)"));
  root.setProperty("--accent", brand.accent || "#c8ff00");
  root.setProperty("--accent-dim", rgba(brand.accent || "#c8ff00", isLight ? 0.16 : 0.12));
  root.setProperty("--text-primary", brand.text || (isLight ? "#111111" : "#f0f2f5"));
  root.setProperty("--text-secondary", isLight ? "rgba(17,17,17,0.55)" : "rgba(240,242,245,0.55)");
  // Requirement: on white background borders should be green (accent)
  root.setProperty("--border", isLight ? rgba(brand.accent || "#1ED760", 0.45) : "rgba(255,255,255,0.08)");
  root.setProperty("--shadow", isLight ? "0 18px 60px rgba(17,17,17,0.10)" : "0 18px 60px rgba(0,0,0,0.55)");

  // Channel colors are defined by a fixed mapping (brand colors of platforms),
  // so we don't override them here.
}

function showLoading(show) {
  const el = document.getElementById("loading");
  el.classList.toggle("hidden", !show);
}

function computeRangeBounds(dates) {
  const sorted = [...dates].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const end = max;

  if (state.range === "all") return { start: min, end };

  const months = state.range === "1m" ? 1 : state.range === "3m" ? 3 : 6;
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { start, end };
}

function buildChannelToggles(channels) {
  const root = document.getElementById("channelToggles");
  root.innerHTML = "";
  channels.forEach((ch, idx) => {
    const btn = document.createElement("button");
    btn.className = "toggle";
    btn.dataset.channel = ch;
    btn.style.borderColor = "rgba(255,255,255,0.10)";
    btn.style.boxShadow = `0 0 0 1px rgba(0,0,0,0)`;
    btn.textContent = ch;
    btn.addEventListener("click", () => {
      if (state.selectedChannels.has(ch)) state.selectedChannels.delete(ch);
      else state.selectedChannels.add(ch);
      renderAll();
    });
    root.appendChild(btn);
  });
}

function updateTogglesUI() {
  const accent = DashboardUtils.getCssVar("--accent", "#c8ff00");
  document.querySelectorAll(".toggle").forEach((el) => {
    const ch = el.dataset.channel;
    const on = state.selectedChannels.has(ch);
    el.classList.toggle("off", !on);
    el.style.borderColor = on ? rgba(accent, 0.45) : DashboardUtils.getCssVar("--border", "rgba(255,255,255,0.10)");
    el.style.background = on ? rgba(accent, 0.10) : "rgba(255,255,255,0.03)";
  });
}

function getFilteredDaily() {
  const all = [];
  const allDates = [];

  state.data.channels.forEach((chObj) => {
    if (!state.selectedChannels.has(chObj.channel)) return;
    chObj.daily.forEach((d) => {
      const dt = DashboardUtils.parseRuDate(d.date);
      if (!dt) return;
      all.push({ ...d, channel: chObj.channel, _dt: dt });
      allDates.push(dt);
    });
  });

  const { start, end } = computeRangeBounds(allDates);
  const filtered = all.filter((r) => r._dt >= start && r._dt <= end);
  return { rows: filtered, start, end };
}

function aggregateKPIs(rows) {
  let budget = 0;
  let leads = 0;
  const byChannel = new Map();

  rows.forEach((r) => {
    budget += Number(r.budget) || 0;
    leads += Number(r.leads) || 0;
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, { budget: 0, leads: 0, roasSum: 0, roasN: 0 });
    const x = byChannel.get(r.channel);
    x.budget += Number(r.budget) || 0;
    x.leads += Number(r.leads) || 0;
    if (Number.isFinite(r.roas)) {
      x.roasSum += Number(r.roas) || 0;
      x.roasN += 1;
    }
  });

  const channelStats = [...byChannel.entries()].map(([channel, s]) => {
    const cpl = s.leads > 0 ? s.budget / s.leads : Infinity;
    const roas = s.roasN > 0 ? s.roasSum / s.roasN : 0;
    return { channel, budget: s.budget, leads: s.leads, cpl, roas };
  });

  const bestRoas = channelStats.slice().sort((a, b) => b.roas - a.roas)[0] || null;
  const bestCpl = channelStats.slice().sort((a, b) => a.cpl - b.cpl)[0] || null;

  return { budget, leads, channelStats, bestRoas, bestCpl };
}

function renderKPI({ budget, leads, bestRoas, bestCpl }, rangeLabel) {
  document.getElementById("kpiBudget").textContent = DashboardUtils.formatCurrencyRub(budget, 0);
  document.getElementById("kpiBudgetMeta").textContent = rangeLabel;

  document.getElementById("kpiLeads").textContent = DashboardUtils.formatNumber(leads, 0);
  document.getElementById("kpiLeadsMeta").textContent = rangeLabel;

  document.getElementById("kpiBestRoas").textContent = bestRoas ? DashboardUtils.formatNumber(bestRoas.roas, 2) : "—";
  document.getElementById("kpiBestRoasMeta").textContent = bestRoas ? bestRoas.channel : "—";

  document.getElementById("kpiBestCpl").textContent = bestCpl && Number.isFinite(bestCpl.cpl) ? `${DashboardUtils.formatNumber(bestCpl.cpl, 2)} ₽` : "—";
  document.getElementById("kpiBestCplMeta").textContent = bestCpl ? bestCpl.channel : "—";
}

function renderTraffic(rows, start, end) {
  const byDate = new Map(); // iso -> { channel -> visits }
  const channels = [...state.selectedChannels];

  rows.forEach((r) => {
    const iso = DashboardUtils.toIsoDate(r._dt);
    if (!byDate.has(iso)) byDate.set(iso, new Map());
    const m = byDate.get(iso);
    m.set(r.channel, (m.get(r.channel) || 0) + (Number(r.visits) || 0));
  });

  const dates = [...byDate.keys()].sort();
  const categories = dates.map((iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const series = channels.map((ch, idx) => {
    const color = DashboardUtils.getChannelColor(ch);
    const data = dates.map((iso) => (byDate.get(iso).get(ch) || 0));
    return { name: ch, data, color };
  });

  DashboardCharts.renderTraffic({ el: "trafficChart", series, categories });
}

function renderCplAndScatter(channelStats) {
  const sortedCpl = channelStats
    .filter((x) => Number.isFinite(x.cpl))
    .sort((a, b) => a.cpl - b.cpl);

  const labels = sortedCpl.map((x) => x.channel);
  const values = sortedCpl.map((x) => Number(x.cpl.toFixed(2)));
  const colors = sortedCpl.map((x) => DashboardUtils.getChannelColor(x.channel));

  DashboardCharts.renderCPL({ el: "cplChart", labels, values, colors });

  const scatterSeries = channelStats
    .filter((x) => Number.isFinite(x.cpl))
    .map((x) => ({
      name: x.channel,
      color: DashboardUtils.getChannelColor(x.channel),
      data: [{ x: x.cpl, y: x.roas, channel: x.channel }],
    }));

  DashboardCharts.renderScatter({ el: "scatterChart", series: scatterSeries });
}

function renderFunnel(rows) {
  let impressions = 0;
  let clicks = 0;
  let leads = 0;

  rows.forEach((r) => {
    impressions += Number(r.impressions) || 0;
    clicks += Number(r.clicks) || 0;
    leads += Number(r.leads) || 0;
  });

  const sales = Math.round(leads * 0.25);

  DashboardCharts.renderFunnel({
    el: "funnelChart",
    stages: [
      { label: "Показы", value: impressions },
      { label: "Клики", value: clicks },
      { label: "Заявки", value: leads },
      { label: "Продажи", value: sales },
    ],
  });
}

function renderPeriodLabel(start, end) {
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const label = `Период: ${fmt(start)} — ${fmt(end)}`;
  document.getElementById("periodLabel").textContent = label;
  return label;
}

function renderAll() {
  updateTogglesUI();
  const { rows, start, end } = getFilteredDaily();
  const rangeLabel = renderPeriodLabel(start, end);

  const kpis = aggregateKPIs(rows);
  renderKPI(kpis, rangeLabel);
  renderTraffic(rows, start, end);
  renderCplAndScatter(kpis.channelStats);
  renderFunnel(rows);
}

async function init() {
  showLoading(true);
  DashboardUtils.setScrollProgress(document.getElementById("topProgress"));

  // Brand first (applies to CSS + charts + buttons)
  try {
    const brandRes = await fetch("assets/brand.json", { cache: "no-store" });
    if (brandRes.ok) {
      const brand = await brandRes.json();
      window.brand = brand;
      applyBrand(brand);
    }
  } catch (_) {
    // optional
  }

  const res = await fetch("data/marketing.json", { cache: "no-store" });
  const data = await res.json();

  // Requirement: load into window.marketingData at start
  window.marketingData = data;

  // AI assistant initial message
  addChatMessage({
    role: "assistant",
    text: "Данные загружены. Знаю ваши каналы, бюджеты и конверсии. Спрашивайте.",
  });

  const input = document.getElementById("aiInput");
  const send = document.getElementById("aiSend");
  const doSend = () => {
    const text = (input?.value || "").trim();
    if (!text) return;
    input.value = "";
    addChatMessage({ role: "user", text });
    addChatMessage({ role: "assistant", text: aiAnswer(text) });
  };
  send?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSend();
  });

  state.data = data;
  const channels = data.channels.map((c) => c.channel);
  channels.forEach((c) => state.selectedChannels.add(c));

  buildChannelToggles(channels);

  document.querySelectorAll("#periodPills .pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#periodPills .pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.range = btn.dataset.range;
      renderAll();
    });
  });

  renderAll();
  showLoading(false);
}

init().catch((e) => {
  console.error(e);
  const loading = document.getElementById("loading");
  loading.innerHTML = `<div class="loaderCard"><div style="color:#ef4444;font-weight:700">Ошибка</div><div style="color:rgba(240,242,245,0.72)">Не удалось загрузить данные. Проверьте, что файл <span class="mono">data/marketing.json</span> доступен.</div></div>`;
});

