---
name: dashboard-builder
description: >
  Use this skill when the user wants to create a premium dark-mode analytics dashboard
  from tabular data (Excel, CSV, JSON). Triggers on: "create dashboard", "build dashboard",
  "make dashboard from data", "visualize my table", "сделай дашборд", "создай дашборд",
  "дашборд из таблицы".
---
# Dashboard Builder — Premium SaaS Analytics

## Role

You are a senior frontend engineer specializing in data visualization dashboards.
You build production-quality, premium dark-mode dashboards from raw data using Vanilla JS + ApexCharts.

---

## ARCHITECTURE

The dashboard follows a strict file structure:

project/
├── index.html          ← Main entry (layout + sidebar + sections)
├── css/
│   └── styles.css      ← Design system
├── js/
│   ├── utils.js        ← Formatting, colors, animations, chart base options
│   ├── charts.js       ← All chart render functions (ApexCharts)
│   └── app.js          ← Data loading, KPI calc, filters, sparklines, initialization
├── data/
│   └── data.json       ← Normalized data
└── scripts/
    └── convert.py      ← Python script to convert Excel → JSON

CDN (no npm/build):
- Google Fonts: Inter (400–800) + JetBrains Mono (400–700)
- Lucide Icons: unpkg.com/lucide@latest/dist/umd/lucide.min.js
- ApexCharts: cdn.jsdelivr.net/npm/apexcharts@latest/dist/apexcharts.min.js

---

## STEP-BY-STEP INSTRUCTIONS

### Step 1 — Analyze Source Data
1. Find the user's data file (.xlsx, .csv, or .json) in the project
2. Read it, identify: Channels/Categories, Time dimension, Numeric metrics, Deal/transaction data
3. Print summary: "Found X channels, Y months, Z metrics"

### Step 2 — Normalize Data to JSON
Create data/data.json with schema:
{
  "meta": { "title": "...", "period": "Окт 2025 — Мар 2026", "channels": [{"key":"...", "name":"...", "icon":"..."}] },
  "daily": [{ "date":"2025-10-01", "channel":"key", "impressions":0, "clicks":0, "ctr":0, "budget":0 }],
  "funnel": [{ "month":"2025-10", "channel":"Name", "impressions":0, "clicks":0, "transitions":0, "leads":0, "sales":0, "revenue":0, "budget":0, "cpl":0, "roas":0 }],
  "deals": [{ "id":1, "status":"Закрыта", "product":"...", "amount":0, "manager":"...", "channel":"...", "date":"..." }]
}
Calculate derived: CPL = budget/leads, ROAS = revenue/budget, CR = sales/leads.
If no deals data → omit that section entirely.

### Step 3 — Design System (css/styles.css)
Colors:
  --bg-deep: #08090d
  --bg-base: #0d0f14
  --bg-elevated: #14161e
  --bg-card: #1a1d28
  --accent: #c8ff00
  --accent-dim: rgba(200,255,0,0.12)
  --text-primary: #f0f2f5
  --text-secondary: rgba(240,242,245,0.55)
  --border: rgba(255,255,255,0.07)

Typography: Inter for UI, JetBrains Mono for numbers.
Cards: glassmorphism with backdrop-filter: blur, border: 1px solid var(--border).
Hover glow: color-mix(in srgb, var(--kpi-color) 35%, transparent) border + box-shadow.
KPI grid: grid-template-columns: repeat(4, 1fr) — always 4 columns.
Sidebar: fixed left, 60px wide, icon-only navigation.
Scroll progress bar: fixed top, neon gradient.

### Step 4 — utils.js
CHANNEL_COLORS: ["#c8ff00","#22c55e","#3b82f6","#f59e0b","#ef4444","#a78bfa","#06b6d4","#f97316","#ec4899","#a855f7"]
Functions: formatNumber, formatShort, formatPercent, animateCounter, getBaseChartOptions, deepMerge.

### Step 5 — charts.js (Charts class)
renderTraffic(data)     → Stacked Area: daily/weekly traffic by channel
renderFunnel(data)      → Horizontal Bar: PERCENTAGE-based funnel (100%→X%), absolute values in labels
renderCPL(data)         → Horizontal Bar: CPL by channel, sorted ascending
renderROAS(data)        → Horizontal Bar: ROAS by channel, sorted descending
renderScatter(data)     → Scatter: CPL vs ROAS, each channel = 1 point
renderHeatmap(data)     → Heatmap: plan vs fact % deviation, always with dataLabels
renderDeals(data)       → Donut: deals by status
renderProducts(data)    → Vertical Bar: revenue by product
renderManagers(data)    → Horizontal Bar: revenue by manager
renderSparkline(id,data,color) → Area sparkline inside KPI cards

CRITICAL:
1. Funnel MUST be percentage-based — show each stage as % of first stage
2. CPL axis — use formatShort + tickAmount:5 to prevent label overlap
3. Scatter — calculate smart xaxis/yaxis min/max based on data bounds × 1.2
4. Heatmap — always enable dataLabels with +X% / -X% format
5. Product labels — use trim:true, hideOverlappingLabels:true

### Step 6 — app.js
1. fetch('data/data.json') → store in DATA
2. Channel filters: toggle buttons, click = toggle channel visibility
3. Month filters: pill buttons, "Все" selects all
4. KPI cards (8 cards, 4×2): Общий бюджет, Заявки, Выручка, Продажи, Лучший ROAS, Лучший CPL, CR%, CAC
5. Sparklines per-month trend for each KPI
6. Trend badges: ↑ +17.3% vs Фев (green=good, red=bad)
7. Scroll progress bar + sidebar scroll spy + loading overlay

### Step 7 — index.html
Sidebar (icon nav) + topbar (title + filters) + KPI grid + sections:
  Трафик (area + funnel)
  → Эффективность каналов (CPL + ROAS + scatter)
  → Бюджет (heatmap)
  → Сделки (donut + products + managers)
Skip sections where data is missing.

### Step 8 — Launch & Verify
npx -y serve . -p 3000
Verify: KPI cards correct, charts load, filters work, hover glow works, no console errors.

---

## ADAPTATION RULES
- Map columns to: channel, date, budget, impressions, clicks, leads, sales, revenue
- Missing data → skip that chart/section
- brand.json exists → read colors from there, replace CSS :root variables
- Labels stay in Russian

---

## QUALITY CHECKLIST
- No axis label overlap on any chart
- Funnel shows all stages visually (percentage-based)
- Heatmap has values visible in cells
- Scatter shows all points within visible area
- KPI grid is 4×N with no orphan cards
- Hover glow works on KPI and chart cards
- Trends show directional arrows: green=good, red=bad
- Responsive on 768px (2-col KPI) and 480px (1-col)
- No console errors
- Data matches source file
