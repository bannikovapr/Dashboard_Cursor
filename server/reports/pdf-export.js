"use strict";

const path = require("path");
const pdfMake = require("pdfmake/build/pdfmake");
const pdfVfs = require("pdfmake/build/vfs_fonts");

const { buildExportLayout, buildFactPackPresentation } = require(path.join(__dirname, "..", "..", "js", "report-export-layout.js"));

let vfsInited = false;
function ensurePdfFonts() {
  if (vfsInited) return;
  pdfMake.vfs = pdfVfs;
  pdfMake.addFonts({
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  });
  vfsInited = true;
}

function plainMd(s) {
  return String(s || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

function safeFilenameBase(title) {
  const raw = String(title || "toir-report")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return raw || "toir-report";
}

function suggestedPdfFilename(document_, stampIsoDate) {
  const stamp = stampIsoDate || new Date().toISOString().slice(0, 10);
  return `${safeFilenameBase(document_.title)}-${stamp}.pdf`;
}

function lightTableLayout() {
  return {
    fillColor: (row) => (row === 0 ? "#eef2f7" : null),
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => "#c5ccd6",
    vLineColor: () => "#c5ccd6",
    paddingLeft: () => 5,
    paddingRight: () => 5,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };
}

function dataTable(headerRow, dataRows, widths, margin) {
  return {
    table: {
      headerRows: 1,
      widths: widths || headerRow.map(() => "*"),
      body: [headerRow, ...dataRows],
    },
    layout: lightTableLayout(),
    margin: margin || [0, 0, 0, 10],
  };
}

function keyValRows(L) {
  const rows = [
    ["Вид документа", L.documentKind],
    ["Идентификатор отчёта", L.reportId],
    ["Число ревизий", String(L.revisionCount)],
    ["Дата подготовки", L.preparedAtFormatted],
    ["Период среза", L.snapshot.periodLabel],
    ["Класс оборудования", L.snapshot.classLabel],
    ["Источник данных", L.snapshot.sourceName],
  ];
  if (L.snapshot.organization) {
    rows.splice(5, 0, ["Организация", L.snapshot.organization]);
  }
  return rows.map(([k, v]) => [{ text: k, bold: true }, String(v || "—")]);
}

function monthlyBarsCanvas(monthly, maxVal, cw, ch) {
  const m = monthly || [];
  if (!m.length) return null;
  const n = m.length;
  const gap = 2;
  const barW = Math.max(3, (cw - 24 - gap * Math.max(0, n - 1)) / n);
  const els = [];
  const mv = Math.max(1, maxVal);
  m.forEach((r, i) => {
    const bh = Math.max(1, (Number(r.total) / mv) * (ch - 20));
    const x = 12 + i * (barW + gap);
    const y = ch - 16 - bh;
    els.push({ type: "rect", x, y, w: barW, h: bh, color: "#0d9488" });
  });
  return {
    stack: [
      { text: "Затраты по месяцам (столбцы, вектор PDF)", style: "h3", margin: [0, 6, 0, 2] },
      { canvas: els, width: cw, height: ch },
    ],
    margin: [0, 0, 0, 10],
  };
}

async function buildReportPdfBuffer(document_) {
  ensurePdfFonts();
  const L = buildExportLayout(document_);
  const pres = buildFactPackPresentation(document_.fact_pack);

  const content = [];

  content.push({ text: L.title, style: "title" });
  content.push({
    text: "Стратегический дашборд ТОиР · экспорт документа",
    style: "tagline",
    margin: [0, 0, 0, 10],
  });
  content.push({
    text: [
      { text: `Период: ${L.snapshot.periodLabel}`, color: "#0f172a" },
      { text: "     ", color: "#94a3b8" },
      { text: `Класс: ${L.snapshot.classLabel}`, color: "#0f172a" },
      { text: "     ", color: "#94a3b8" },
      { text: `Обновлён: ${L.preparedAtFormatted}`, color: "#0f172a" },
      { text: "     ", color: "#94a3b8" },
      { text: `Ревизий: ${L.revisionCount}`, color: "#0f172a" },
    ],
    style: "chipRow",
    margin: [0, 0, 0, 14],
  });

  content.push({ text: "Реквизиты документа", style: "h2" });
  content.push({
    table: {
      widths: ["36%", "*"],
      body: keyValRows(L),
    },
    layout: lightTableLayout(),
    margin: [0, 0, 0, 10],
  });

  content.push({ text: "Цель и охват анализа", style: "h2" });
  L.introductionParagraphs.forEach((p) => {
    content.push({ text: p, style: "body", margin: [0, 0, 0, 6] });
  });
  content.push({ text: "Методика и фиксация среза", style: "h3" });
  L.methodologyBullets.forEach((b) => {
    content.push({ text: "• " + plainMd(b), style: "body", margin: [0, 0, 0, 2] });
  });

  content.push({ text: "Содержание разделов", style: "h2" });
  L.toc.forEach((t) => {
    content.push({ text: `${t.num}. ${t.title}`, style: "body", margin: [0, 0, 0, 2] });
  });

  content.push({ text: "Основная часть", style: "h2" });
  L.numberedSections.forEach((s) => {
    content.push({ text: `${s._num}. ${s.title}`, style: "h2", margin: [0, 10, 0, 4] });
    const metaBits = [];
    if (s.mandatory) metaBits.push("обязательная секция");
    metaBits.push(`уверенность: ${s._confidenceLabel}`);
    content.push({ text: metaBits.join(" · "), style: "tiny", margin: [0, 0, 0, 4] });
    const bodyText = plainMd(s.body_markdown);
    if (bodyText) {
      content.push({ text: bodyText, style: "body", margin: [0, 0, 0, 6] });
    }
    if (s.fact_bullets && s.fact_bullets.length) {
      content.push({ text: "Ключевые факты по данным", style: "h3" });
      s.fact_bullets.forEach((b) => {
        content.push({ text: "• " + plainMd(b), style: "body", margin: [0, 0, 0, 2] });
      });
    }
    if (s.evidence_refs && s.evidence_refs.length) {
      content.push({
        text: "Опора на данные: " + s.evidence_refs.join(", "),
        style: "small",
        margin: [0, 4, 0, 2],
      });
    }
    if (s.warnings && s.warnings.length) {
      s.warnings.forEach((w) => {
        content.push({
          text: "Ограничение: " + plainMd(w),
          style: "warn",
          margin: [0, 4, 0, 2],
        });
      });
    }
  });

  content.push({ text: "Сводные данные по срезу (таблицы)", style: "h2" });
  content.push({
    text: "Агрегированные показатели из fact_pack; не растровая копия дашборда.",
    style: "small",
    margin: [0, 0, 0, 6],
  });

  content.push({ text: "Ключевые показатели", style: "h3" });
  content.push(
    dataTable(
      [{ text: "Показатель", bold: true }, { text: "Значение", bold: true }],
      pres.kpisRows.map((r) => [r.k, r.v]),
      ["*", "*"]
    )
  );

  content.push({ text: "Динамика затрат по месяцам", style: "h3" });
  if ((pres.monthly || []).length) {
    content.push(
      dataTable(
        [{ text: "Месяц", bold: true }, { text: "Руб.", bold: true }],
        pres.monthly.map((r) => [r.month, r.vFmt]),
        ["42%", "*"]
      )
    );
    const canvasBlock = monthlyBarsCanvas(pres.monthly, pres.maxMonthly, 480, 110);
    if (canvasBlock) content.push(canvasBlock);
  } else {
    content.push({ text: "Нет ряда по месяцам.", style: "small" });
  }

  content.push({ text: "Топ по затратам", style: "h3" });
  if ((pres.topCosts || []).length || pres.paretoLine) {
    if (pres.paretoLine) {
      content.push({ text: pres.paretoLine, style: "small", margin: [0, 0, 0, 4] });
    }
    if ((pres.topCosts || []).length) {
      content.push(
        dataTable(
          [
            { text: "Объект", bold: true },
            { text: "Класс", bold: true },
            { text: "Руб.", bold: true },
          ],
          pres.topCosts.map((r) => [r.name, r.cls, r.vFmt]),
          ["*", "22%", "18%"]
        )
      );
    }
  } else {
    content.push({ text: "Нет данных.", style: "small" });
  }

  content.push({ text: "Топ по простоям", style: "h3" });
  if ((pres.topDowntime || []).length) {
    content.push(
      dataTable(
        [
          { text: "Объект", bold: true },
          { text: "Ч", bold: true },
          { text: "КТГ %", bold: true },
        ],
        pres.topDowntime.map((r) => [r.name, r.downtimeFmt, r.ktgFmt]),
        ["*", "14%", "14%"]
      )
    );
  } else {
    content.push({ text: "Нет данных.", style: "small" });
  }

  content.push({ text: "Причины отказов", style: "h3" });
  if ((pres.causes || []).length) {
    content.push(
      dataTable(
        [{ text: "Причина", bold: true }, { text: "Кол-во", bold: true }],
        pres.causes.map((c) => [c.cause, c.countFmt]),
        ["*", "18%"]
      )
    );
  } else {
    content.push({ text: "Нет данных.", style: "small" });
  }

  content.push({ text: "По классам оборудования", style: "h3" });
  if ((pres.classSummary || []).length) {
    content.push(
      dataTable(
        [
          { text: "Класс", bold: true },
          { text: "Ед.", bold: true },
          { text: "Руб.", bold: true },
          { text: "Ч пр.", bold: true },
          { text: "Отк.", bold: true },
          { text: "КТГ", bold: true },
          { text: "% затрат", bold: true },
        ],
        pres.classSummary.map((r) => [r.cls, r.eq, r.cost, r.dow, r.def, r.ktg, r.cShare]),
        ["*", "6%", "12%", "10%", "8%", "8%", "10%"]
      )
    );
  } else {
    content.push({ text: "Нет данных.", style: "small" });
  }

  content.push({ text: "Композитный индекс риска (топ)", style: "h3" });
  if ((pres.problems || []).length) {
    content.push(
      dataTable(
        [
          { text: "Объект", bold: true },
          { text: "Инд.", bold: true },
          { text: "Руб.", bold: true },
          { text: "Ч", bold: true },
          { text: "Отк.", bold: true },
        ],
        pres.problems.map((r) => [r.name, r.scoreFmt, r.cost, r.dow, r.def]),
        ["*", "10%", "14%", "10%", "10%"]
      )
    );
  } else {
    content.push({ text: "Нет данных.", style: "small" });
  }

  content.push({ text: "Сработавшие диагностики", style: "h3" });
  if ((pres.triggeredDiagnostics || []).length) {
    content.push(
      dataTable(
        [{ text: "ID", bold: true }, { text: "Сигнал", bold: true }],
        pres.triggeredDiagnostics.map((d) => [d.id, d.summary]),
        ["12%", "*"]
      )
    );
  } else {
    content.push({ text: "Нет сработавших правил.", style: "small" });
  }

  content.push({ text: L.appendix.title, style: "h2" });
  content.push({ text: L.appendix.footerNote, style: "small", margin: [0, 0, 0, 6] });
  if (L.appendix.evidenceRefs.length) {
    L.appendix.evidenceRefs.forEach((ref) => {
      content.push({ text: "• " + ref, style: "body", margin: [0, 0, 0, 1] });
    });
  } else {
    content.push({ text: "Ссылки на наборы в секции не указаны.", style: "small" });
  }

  const docDefinition = {
    content,
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      lineHeight: 1.2,
    },
    styles: {
      title: { fontSize: 16, bold: true, color: "#0f172a" },
      tagline: { fontSize: 9, color: "#64748b" },
      chipRow: { fontSize: 8.5, color: "#0f172a" },
      subtitle: { fontSize: 11, bold: true, color: "#334155" },
      h2: { fontSize: 12, bold: true, color: "#0f172a", margin: [0, 8, 0, 4] },
      h3: { fontSize: 10, bold: true, color: "#1e293b", margin: [0, 6, 0, 3] },
      body: { fontSize: 9, color: "#1e293b" },
      small: { fontSize: 8, color: "#64748b" },
      tiny: { fontSize: 8, italics: true, color: "#64748b" },
      warn: { fontSize: 8.5, color: "#92400e", background: "#fffbeb", margin: [2, 2, 2, 2] },
    },
    pageSize: "A4",
    pageMargins: [42, 50, 42, 50],
  };

  const pdfDoc = pdfMake.createPdf(docDefinition);
  return new Promise((resolve, reject) => {
    try {
      pdfDoc.getBuffer((buf) => {
        if (!buf) {
          reject(new Error("PDF: пустой буфер"));
          return;
        }
        resolve(buf);
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  buildReportPdfBuffer,
  suggestedPdfFilename,
};
