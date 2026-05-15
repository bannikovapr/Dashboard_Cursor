/* HTML-отчёт с таблицами и SVG. Browser: globalThis.__ReportExportHtml */
(function initExportHtml(factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== "undefined") {
    globalThis.__ReportExportHtml = factory();
  }
})(function reportExportHtmlFactory() {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    return out;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const lines = String(text).split(/\r?\n/);
    const blocks = [];
    let buf = [];
    let listBuf = [];
    let inList = false;
    function flushPara() {
      if (buf.length) {
        blocks.push(`<p>${renderInline(buf.join(" "))}</p>`);
        buf = [];
      }
    }
    function flushList() {
      if (listBuf.length) {
        blocks.push(`<ul>${listBuf.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
        listBuf = [];
      }
      inList = false;
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flushPara();
        flushList();
        continue;
      }
      let m;
      if ((m = line.match(/^###\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h4>${renderInline(m[1])}</h4>`);
        continue;
      }
      if ((m = line.match(/^##\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h3>${renderInline(m[1])}</h3>`);
        continue;
      }
      if ((m = line.match(/^#\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<h2>${renderInline(m[1])}</h2>`);
        continue;
      }
      if ((m = line.match(/^[-*]\s+(.+)$/))) {
        flushPara();
        listBuf.push(m[1]);
        inList = true;
        continue;
      }
      if ((m = line.match(/^(\d+)\.\s+(.+)$/))) {
        flushPara();
        flushList();
        blocks.push(`<p><b>${m[1]}.</b> ${renderInline(m[2])}</p>`);
        continue;
      }
      if (inList) flushList();
      buf.push(line);
    }
    flushPara();
    flushList();
    return blocks.join("\n");
  }

  function buildMonthlyTrendSvg(pres) {
    const rows = pres.monthly || [];
    if (!rows.length) return "";
    const W = 640;
    const H = 210;
    const pad = 26;
    const n = rows.length;
    const gap = 3;
    const barW = Math.max(3, (W - pad * 2 - gap * Math.max(0, n - 1)) / n);
    const max = pres.maxMonthly || 1;
    const parts = [];
    rows.forEach((r, i) => {
      const bh = Math.max(2, (r.total / max) * (H - pad - 34));
      const x = pad + i * (barW + gap);
      const y = H - 30 - bh;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="#0d9488" rx="2"/>`
      );
      const label = String(r.month).trim().slice(0, 10);
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 6}" font-size="9" fill="#475569" text-anchor="middle">${escapeHtml(
          label
        )}</text>`
      );
    });
    return (
      `<div class="export-chart-wrap">` +
      `<p class="export-sheet-caption">Столбчатая диаграмма: затраты по месяцам (руб.), вектор SVG</p>` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-height:240px;display:block" role="img" aria-label="Тренд затрат по месяцам">${parts.join(
        ""
      )}</svg>` +
      `</div>`
    );
  }

  function buildDataSheetHtml(pres) {
    const kpiTable =
      `<table class="export-sheet-table"><thead><tr><th>Показатель</th><th>Значение</th></tr></thead><tbody>` +
      pres.kpisRows.map((r) => `<tr><td>${escapeHtml(r.k)}</td><td>${escapeHtml(r.v)}</td></tr>`).join("") +
      `</tbody></table>`;
    const mon = pres.monthly || [];
    const monTable =
      mon.length > 0
        ? `<table class="export-sheet-table export-sheet-table--compact"><thead><tr><th>Месяц</th><th>Затраты, руб.</th></tr></thead><tbody>` +
          mon.map((r) => `<tr><td>${escapeHtml(r.month)}</td><td>${escapeHtml(r.vFmt)}</td></tr>`).join("") +
          `</tbody></table>`
        : `<p class="export-sheet-empty">Нет ряда по месяцам в снимке.</p>`;
    const topCostRows = (pres.topCosts || [])
      .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.cls)}</td><td>${escapeHtml(r.vFmt)}</td></tr>`)
      .join("");
    const topCostTable =
      pres.topCosts && pres.topCosts.length
        ? `<table class="export-sheet-table"><thead><tr><th>Объект</th><th>Класс</th><th>Затраты, руб.</th></tr></thead><tbody>${topCostRows}</tbody></table>`
        : "";
    const dowRows = (pres.topDowntime || [])
      .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.downtimeFmt)}</td><td>${escapeHtml(r.ktgFmt)}</td></tr>`)
      .join("");
    const dowTable =
      pres.topDowntime && pres.topDowntime.length
        ? `<table class="export-sheet-table"><thead><tr><th>Объект</th><th>Простои, ч</th><th>КТГ, %</th></tr></thead><tbody>${dowRows}</tbody></table>`
        : "";
    const causeRows = (pres.causes || [])
      .map((r) => `<tr><td>${escapeHtml(r.cause)}</td><td>${escapeHtml(r.countFmt)}</td></tr>`)
      .join("");
    const causeTable =
      pres.causes && pres.causes.length
        ? `<table class="export-sheet-table"><thead><tr><th>Причина отказа</th><th>Кол-во</th></tr></thead><tbody>${causeRows}</tbody></table>`
        : "";
    const classRows = (pres.classSummary || [])
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.cls)}</td><td>${escapeHtml(r.eq)}</td><td>${escapeHtml(r.cost)}</td>` +
          `<td>${escapeHtml(r.dow)}</td><td>${escapeHtml(r.def)}</td><td>${escapeHtml(r.ktg)}</td><td>${escapeHtml(r.cShare)}</td></tr>`
      )
      .join("");
    const classTable =
      pres.classSummary && pres.classSummary.length
        ? `<table class="export-sheet-table export-sheet-table--sm"><thead><tr><th>Класс</th><th>Ед.</th><th>Затраты, руб.</th>` +
          `<th>Простои, ч</th><th>Отказы</th><th>КТГ, %</th><th>Доля затрат</th></tr></thead><tbody>${classRows}</tbody></table>`
        : "";
    const probRows = (pres.problems || [])
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.scoreFmt)}</td><td>${escapeHtml(r.cost)}</td>` +
          `<td>${escapeHtml(r.dow)}</td><td>${escapeHtml(r.def)}</td></tr>`
      )
      .join("");
    const probTable =
      pres.problems && pres.problems.length
        ? `<table class="export-sheet-table"><thead><tr><th>Объект</th><th>Индекс</th><th>Затраты, руб.</th>` +
          `<th>Простои, ч</th><th>Отказы</th></tr></thead><tbody>${probRows}</tbody></table>`
        : "";
    const diagRows = (pres.triggeredDiagnostics || [])
      .map((r) => `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.summary)}</td></tr>`)
      .join("");
    const diagTable =
      pres.triggeredDiagnostics && pres.triggeredDiagnostics.length
        ? `<table class="export-sheet-table"><thead><tr><th>ID</th><th>Сигнал</th></tr></thead><tbody>${diagRows}</tbody></table>`
        : "";
    const paretoP = pres.paretoLine ? `<p class="export-sheet-note">${escapeHtml(pres.paretoLine)}</p>` : "";
    return (
      `<section class="export-data-sheet" id="export-data-snapshot">` +
      `<h2 class="export-part-title">Сводные данные по срезу</h2>` +
      `<p class="export-sheet-lead">Таблицы и диаграмма построены из снимка отчёта (агрегаты toir.json), а не как копия экрана дашборда.</p>` +
      `<h3 class="export-subpart-title">Ключевые показатели</h3>${kpiTable}` +
      `<h3 class="export-subpart-title">Динамика затрат по месяцам</h3>${monTable}${buildMonthlyTrendSvg(pres)}` +
      `<h3 class="export-subpart-title">Топ объектов по затратам</h3>${topCostTable || '<p class="export-sheet-empty">Нет данных.</p>'}${paretoP}` +
      `<h3 class="export-subpart-title">Топ по простоям</h3>${dowTable || '<p class="export-sheet-empty">Нет данных.</p>'}` +
      `<h3 class="export-subpart-title">Причины отказов (топ)</h3>${causeTable || '<p class="export-sheet-empty">Нет данных.</p>'}` +
      `<h3 class="export-subpart-title">По классам оборудования</h3>${classTable || '<p class="export-sheet-empty">Нет данных.</p>'}` +
      `<h3 class="export-subpart-title">Объекты по композитному индексу риска</h3>${probTable || '<p class="export-sheet-empty">Нет данных.</p>'}` +
      `<h3 class="export-subpart-title">Сработавшие диагностики</h3>${diagTable || '<p class="export-sheet-empty">Нет сработавших правил.</p>'}` +
      `</section>`
    );
  }

  function exportPrintCss() {
    return `
    .export-data-sheet {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      border-left: 4px solid #94a3b8;
      box-shadow: var(--shadow);
      padding: 16px 18px;
      margin-bottom: 14px;
      break-inside: auto;
    }
    .export-sheet-lead { font-size: 0.9rem; color: var(--muted); line-height: 1.5; margin: 0 0 14px; }
    .export-sheet-caption { font-size: 0.82rem; color: var(--muted); margin: 8px 0 4px; }
    .export-sheet-note { font-size: 0.85rem; color: var(--tab-active); margin: 8px 0; }
    .export-sheet-empty { font-size: 0.88rem; color: var(--muted); font-style: italic; }
    .export-sheet-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
      margin: 0 0 14px;
    }
    .export-sheet-table--compact td, .export-sheet-table--compact th { padding: 5px 8px; }
    .export-sheet-table--sm { font-size: 0.78rem; }
    .export-sheet-table th,
    .export-sheet-table td {
      border: 1px solid var(--border);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    .export-sheet-table thead th {
      background: #f1f5f9;
      font-weight: 600;
      color: var(--tab-active);
    }
    .export-chart-wrap { margin: 10px 0 6px; overflow: auto; }
    @media print {
      .export-data-sheet { break-inside: auto; box-shadow: none; }
      .export-sheet-table { break-inside: auto; }
      .export-sheet-table thead { display: table-header-group; }
      .export-chart-wrap { break-inside: avoid; page-break-inside: avoid; }
    }`;
  }

  function buildReportHtmlDocument(doc_, logoDataUrl, options) {
    const EL = typeof globalThis !== "undefined" && globalThis.__ReportExportLayout;
    if (!EL || typeof EL.buildExportLayout !== "function" || typeof EL.buildFactPackPresentation !== "function") {
      throw new Error("Требуется report-export-layout.js (buildExportLayout, buildFactPackPresentation).");
    }
    const L = EL.buildExportLayout(doc_);
    const pres = EL.buildFactPackPresentation(doc_.fact_pack);
    const opts = options || {};
    const logoImg = logoDataUrl
      ? `<img class="brand-logo-img export-brand-logo" src="${logoDataUrl}" alt="Desnol" width="56" height="56" decoding="async" />`
      : "";

    const heroChipsHtml =
      `<div class="export-chips" aria-label="Параметры отчёта">` +
      `<span class="export-chip">Период: <b>${escapeHtml(L.snapshot.periodLabel)}</b></span>` +
      `<span class="export-chip">Класс: <b>${escapeHtml(L.snapshot.classLabel)}</b></span>` +
      `<span class="export-chip">Обновлён: <b>${escapeHtml(L.preparedAtFormatted)}</b></span>` +
      `<span class="export-chip">Ревизий: <b>${escapeHtml(String(L.revisionCount))}</b></span>` +
      `</div>`;

    const tocHtml =
      `<nav class="export-toc" aria-label="Содержание">` +
      `<h2 class="export-part-title">Содержание</h2>` +
      `<ol>` +
      L.toc.map((t) => `<li><a href="#${t.anchor}">${t.num}. ${escapeHtml(t.title)}</a></li>`).join("") +
      `<li><a href="#export-data-snapshot">Сводные данные по срезу (таблицы)</a></li>` +
      `<li><a href="#appendix-a">${escapeHtml(L.appendix.title)}</a></li>` +
      `</ol></nav>`;

    const introHtml = L.introductionParagraphs.map((p) => `<p class="export-narrative">${escapeHtml(p)}</p>`).join("");
    const methodologyHtml =
      `<h3 class="export-subpart-title">Методика и фиксация среза</h3>` +
      `<ul class="export-methodology-list">` +
      L.methodologyBullets.map((b) => `<li>${renderInline(b)}</li>`).join("") +
      `</ul>`;

    const sectionsHtml = L.numberedSections
      .map((s) => {
        const conf = s.confidence || "medium";
        const mandatory = s.mandatory ? '<span class="badge badge-mandatory">Обязательная</span>' : "";
        const mandatoryCls = s.mandatory ? " export-section--mandatory" : "";
        const factsBlock =
          s.fact_bullets && s.fact_bullets.length
            ? `<div class="export-subtitle">Подтверждающие факты</div><ul>${s.fact_bullets.map((b) => `<li>${renderInline(b)}</li>`).join("")}</ul>`
            : "";
        const refs =
          s.evidence_refs && s.evidence_refs.length
            ? `<div class="export-refs"><span class="export-refs-label">Опора на данные:</span> ${s.evidence_refs.map((r) => `<span class="ref">${escapeHtml(r)}</span>`).join(" ")}</div>`
            : "";
        const warns =
          s.warnings && s.warnings.length
            ? `<div class="export-warns"><div class="export-warns-title">Ограничения секции</div>${s.warnings.map((w) => `<div class="export-warn">${escapeHtml(w)}</div>`).join("")}</div>`
            : "";
        return `
      <article id="${s._anchor}" class="export-section export-section--${conf}${mandatoryCls}">
        <header class="export-section-head">
          <h2 class="export-section-title"><span class="export-sec-num">${s._num}.</span> ${escapeHtml(s.title || "")}</h2>
          <div class="export-section-meta">
            ${mandatory}
            <span class="badge badge-confidence-${conf}">Уверенность: ${escapeHtml(s._confidenceLabel)}</span>
          </div>
        </header>
        <div class="export-section-body">${renderMarkdown(s.body_markdown || "")}</div>
        ${factsBlock}
        ${refs}
        ${warns}
      </article>`;
      })
      .join("\n");

    const dataSheetHtml = buildDataSheetHtml(pres);

    const appendixList =
      L.appendix.evidenceRefs && L.appendix.evidenceRefs.length
        ? `<ul class="export-appendix-list">${L.appendix.evidenceRefs.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
        : `<p class="export-appendix-empty">Уникальные ссылки на фрагменты данных в секциях не указаны.</p>`;

    const appendixHtml =
      `<section class="export-appendix" id="appendix-a">` +
      `<h2 class="export-part-title">${escapeHtml(L.appendix.title)}</h2>` +
      `<p class="export-appendix-note">${escapeHtml(L.appendix.footerNote)}</p>` +
      appendixList +
      `</section>`;

    const printHint =
      opts.forPrint
        ? `<p class="export-footer print-hint">Служебная строка (скрыта при печати).</p>`
        : `<p class="export-footer">Документ сформирован в модуле отчётов ТОиР</p>`;

    const exportGuide = "";

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(L.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --page-bg: #e8edf3;
      --border: #d8dee6;
      --muted: #5c6570;
      --brand-text: #000000;
      --accent: #1ed760;
      --tab-active: #0f172a;
      --card: #ffffff;
      --shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Montserrat", system-ui, sans-serif;
      background: var(--page-bg);
      color: var(--brand-text);
      line-height: 1.45;
    }
    .export-wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    .export-guide {
      margin-bottom: 12px;
      background: #ecfdf5;
      border: 1px solid #bbf7d0;
      color: #14532d;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.9rem;
      font-weight: 500;
    }
    .export-guide span { font-weight: 700; margin-right: 4px; }
    .export-hero {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 20px 22px;
      margin-bottom: 18px;
      text-align: left;
    }
    .export-hero-brand.top-header {
      margin-bottom: 0;
    }
    .export-hero .brand-band {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 16px;
    }
    .export-hero .brand-logo-img {
      display: block;
      flex-shrink: 0;
      height: clamp(40px, 5vw, 56px);
      width: auto;
      max-width: clamp(40px, 5vw, 56px);
      margin-left: 0;
      object-fit: contain;
      object-position: center;
    }
    .export-hero .brand-lockup {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0;
      min-width: 0;
    }
    .export-hero .brand-lockup .titles h1 {
      margin: 0;
      font-size: clamp(1.15rem, 1rem + 1.1vw, 1.85rem);
      font-weight: 700;
      color: var(--tab-active);
      letter-spacing: -0.02em;
      line-height: 1.2;
      word-break: break-word;
    }
    .export-hero-tagline {
      margin: 10px 0 0;
      font-size: 0.92rem;
      color: var(--muted);
      font-weight: 500;
      line-height: 1.45;
    }
    .export-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .export-chip {
      font-size: 0.82rem;
      padding: 6px 12px;
      border-radius: 999px;
      background: #f8fafc;
      border: 1px solid var(--border);
      color: var(--tab-active);
      line-height: 1.3;
    }
    .export-chip b { font-weight: 600; }
    .export-front-matter {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      border-left: 4px solid #16a34a;
      box-shadow: var(--shadow);
      padding: 16px 18px;
      margin-bottom: 14px;
    }
    .export-part-title {
      margin: 0 0 12px;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--tab-active);
      padding-bottom: 6px;
      border-bottom: 2px solid #e2e8f0;
    }
    .export-subpart-title {
      margin: 16px 0 8px;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--tab-active);
    }
    .export-narrative { margin: 0 0 12px; font-size: 0.95rem; line-height: 1.55; text-align: justify; }
    .export-methodology-list { margin: 0; padding-left: 1.2em; font-size: 0.92rem; line-height: 1.5; }
    .export-toc {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      border-left: 4px solid #94a3b8;
      box-shadow: var(--shadow);
      padding: 16px 18px 12px;
      margin-bottom: 14px;
    }
    .export-toc ol { margin: 0; padding-left: 1.2em; }
    .export-toc li { margin-bottom: 6px; font-size: 0.92rem; }
    .export-toc a { color: #0f766e; text-decoration: none; font-weight: 500; }
    .export-toc a:hover { text-decoration: underline; }
    .export-main-part-head {
      margin: 8px 0 12px;
    }
    .export-sec-num { color: var(--muted); font-weight: 700; margin-right: 4px; }
    .export-appendix {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      border-left: 4px solid #94a3b8;
      padding: 16px 18px;
      margin-top: 20px;
      box-shadow: var(--shadow);
    }
    .export-appendix-note { font-size: 0.9rem; color: var(--muted); line-height: 1.5; margin: 0 0 12px; }
    .export-appendix-list { margin: 0; padding-left: 1.2em; font-size: 0.88rem; }
    .export-appendix-empty { font-size: 0.88rem; color: var(--muted); margin: 0; font-style: italic; }
    .export-section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 14px;
      border-left: 4px solid #94a3b8;
      box-shadow: var(--shadow);
    }
    .export-section--high { border-left-color: #16a34a; }
    .export-section--medium { border-left-color: #f59e0b; }
    .export-section--low { border-left-color: #94a3b8; }
    .export-section--mandatory { border-left-color: #16a34a; }
    .export-section-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .export-section > .export-section-body ~ .export-subtitle {
      margin-top: 14px;
    }
    .export-section > ul {
      margin: 0.5em 0;
      padding-left: 1.2em;
      font-size: 0.96rem;
      line-height: 1.55;
    }
    .export-section-title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--tab-active);
    }
    .export-section-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .badge {
      font-size: 0.78rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .badge-mandatory { background: #ecfdf5; color: #166534; border-color: #bbf7d0; }
    .badge-confidence-high { background: #ecfdf5; color: #166534; border-color: #bbf7d0; }
    .badge-confidence-medium { background: #fef3c7; color: #92400e; border-color: #fde68a; }
    .badge-confidence-low { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
    .export-section-body { font-size: 0.96rem; line-height: 1.55; min-width: 0; word-wrap: break-word; }
    .export-section-body h2, .export-section-body h3, .export-section-body h4 { margin: 0.8em 0 0.4em; color: var(--tab-active); }
    .export-section-body p { margin: 0.5em 0; }
    .export-section-body ul { margin: 0.5em 0; padding-left: 1.2em; }
    .export-subtitle { font-weight: 600; font-size: 0.88rem; margin: 12px 0 6px; color: var(--tab-active); }
    .export-refs { margin-top: 12px; font-size: 0.85rem; color: var(--muted); }
    .export-refs-label { font-weight: 600; margin-right: 6px; }
    .ref { display: inline-block; background: #f1f5f9; border-radius: 6px; padding: 2px 8px; margin: 2px 4px 2px 0; font-size: 0.8rem; color: #334155; }
    .export-warns { margin-top: 12px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
    .export-warns-title { font-weight: 600; font-size: 0.85rem; margin-bottom: 6px; color: #92400e; }
    .export-warn { font-size: 0.85rem; color: #78350f; margin-top: 4px; }
    .export-footer {
      font-size: 0.78rem;
      color: var(--muted);
      text-align: center;
      margin-top: 24px;
    }
    ${exportPrintCss()}
    @media print {
      @page { size: A4; margin: 12mm; }
      body {
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .export-wrap { padding: 0; max-width: none; }
      .export-guide,
      .print-hint { display: none !important; }
      .export-hero, .export-section, .export-front-matter, .export-toc, .export-appendix, .export-data-sheet { box-shadow: none; }
      .export-brand-logo,
      .export-hero .brand-band,
      .export-hero-tagline,
      .export-chips,
      .export-hero-brand {
        break-inside: avoid;
      }
      .export-hero,
      .export-front-matter,
      .export-toc,
      .export-appendix {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .export-part-title,
      .export-main-part-head {
        break-after: avoid-page;
        page-break-after: avoid;
      }
      .export-section {
        break-inside: auto;
        page-break-inside: auto;
        margin-bottom: 10mm;
      }
      .export-section-head {
        break-inside: avoid;
        page-break-inside: avoid;
        break-after: avoid-page;
        page-break-after: avoid;
      }
      .export-section-title,
      .export-subtitle {
        break-after: avoid;
        page-break-after: avoid;
      }
      .export-section-body p,
      .export-section-body li,
      .export-section > ul li,
      .export-narrative,
      .export-appendix-note,
      .export-warn {
        orphans: 3;
        widows: 3;
      }
      .export-section > .export-subtitle + ul {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .export-warns {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="export-wrap">
    ${exportGuide}
    <header class="export-hero">
      <div class="export-hero-brand top-header">
        <div class="brand-band">
          ${logoImg}
          <div class="brand-lockup">
            <div class="titles">
              <h1>${escapeHtml(L.title)}</h1>
            </div>
          </div>
        </div>
      </div>
      <p class="export-hero-tagline">Стратегический дашборд ТОиР · экспорт документа</p>
      ${heroChipsHtml}
    </header>
    <section class="export-front-matter">
      <h2 class="export-part-title">Цель и охват анализа</h2>
      ${introHtml}
      ${methodologyHtml}
    </section>
    ${tocHtml}
    <h2 class="export-part-title export-main-part-head">Основная часть</h2>
    <main class="export-main">
      ${sectionsHtml}
    </main>
    ${dataSheetHtml}
    ${appendixHtml}
    ${printHint}
  </div>
</body>
</html>`;
  }

  return { buildReportHtmlDocument, buildDataSheetHtml };
});
