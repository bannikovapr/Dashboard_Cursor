"use strict";

const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  convertInchesToTwip,
} = require("docx");

const { buildExportLayout, buildFactPackPresentation } = require(path.join(__dirname, "..", "..", "js", "report-export-layout.js"));

function safeFilenameBase(title) {
  const raw = String(title || "toir-report")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return raw || "toir-report";
}

function suggestedDocxFilename(document_, stampIsoDate) {
  const stamp = stampIsoDate || new Date().toISOString().slice(0, 10);
  return `${safeFilenameBase(document_.title)}-${stamp}.docx`;
}

/** @param {string} text */
function mdRunsFromLine(text) {
  const s = String(text || "");
  const runs = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun(s.slice(last, m.index)));
    }
    runs.push(new TextRun({ text: m[1], bold: true }));
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    runs.push(new TextRun(s.slice(last)));
  }
  return runs.length ? runs : [new TextRun(s)];
}

/**
 * @param {string} md
 * @returns {import("docx").Paragraph[]}
 */
function markdownToParagraphs(md) {
  const trimmed = String(md || "").trim();
  if (!trimmed) {
    return [];
  }
  const chunks = trimmed.split(/\n\n+/);
  const out = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const allBullets = lines.every((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l));
    if (allBullets) {
      for (const line of lines) {
        const item = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
        out.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: mdRunsFromLine(item),
          })
        );
      }
    } else {
      out.push(
        new Paragraph({
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
          children: mdRunsFromLine(lines.join(" ")),
        })
      );
    }
  }
  return out;
}

function metaTableRows(layout) {
  const rows = [
    ["Вид документа", layout.documentKind],
    ["Идентификатор отчёта", layout.reportId],
    ["Версий (ревизий) в истории", String(layout.revisionCount)],
    ["Дата подготовки версии", layout.preparedAtFormatted],
    ["Период среза", layout.snapshot.periodLabel],
    ["Класс оборудования", layout.snapshot.classLabel],
    ["Источник данных", layout.snapshot.sourceName],
  ];
  if (layout.snapshot.organization) {
    rows.splice(5, 0, ["Организация", layout.snapshot.organization]);
  }
  return rows;
}

function buildMetaTable(layout) {
  const rows = metaTableRows(layout).map(
    ([k, v]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            margins: { top: convertInchesToTwip(0.05), bottom: convertInchesToTwip(0.05), left: convertInchesToTwip(0.08), right: convertInchesToTwip(0.08) },
            shading: { fill: "F1F5F9", type: ShadingType.CLEAR },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
            },
            children: [
              new Paragraph({
                children: [new TextRun({ text: k, bold: true })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            margins: { top: convertInchesToTwip(0.05), bottom: convertInchesToTwip(0.05), left: convertInchesToTwip(0.08), right: convertInchesToTwip(0.08) },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
            },
            children: [new Paragraph({ children: [new TextRun(String(v || "—"))] })],
          }),
        ],
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function buildPlainTwoColTable(headerPair, bodyPairs) {
  const rows = [
    new TableRow({
      children: headerPair.map(
        (text) =>
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: { fill: "F1F5F9", type: ShadingType.CLEAR },
            margins: {
              top: convertInchesToTwip(0.04),
              bottom: convertInchesToTwip(0.04),
              left: convertInchesToTwip(0.06),
              right: convertInchesToTwip(0.06),
            },
            children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
          })
      ),
    }),
    ...bodyPairs.map(
      ([a, b]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: {
                top: convertInchesToTwip(0.04),
                bottom: convertInchesToTwip(0.04),
                left: convertInchesToTwip(0.06),
                right: convertInchesToTwip(0.06),
              },
              children: [new Paragraph({ children: [new TextRun(String(a || "—"))] })],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: {
                top: convertInchesToTwip(0.04),
                bottom: convertInchesToTwip(0.04),
                left: convertInchesToTwip(0.06),
                right: convertInchesToTwip(0.06),
              },
              children: [new Paragraph({ children: [new TextRun(String(b || "—"))] })],
            }),
          ],
        })
    ),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

/**
 * @param {import("./schemas").makeDocument extends (...args: any) => infer R ? R : any} document_
 */
async function buildReportDocxBuffer(document_) {
  const layout = buildExportLayout(document_);
  const pres = buildFactPackPresentation(document_.fact_pack);

  const children = [];

  children.push(
    new Paragraph({
      text: layout.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: layout.documentKind, italics: true, size: 24 })],
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: layout.audienceNote, size: 22, color: "475569" })],
    })
  );
  children.push(buildMetaTable(layout));
  children.push(new Paragraph({ text: "", spacing: { after: 200 } }));

  children.push(
    new Paragraph({
      text: "Цель и охват анализа",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
    })
  );
  layout.introductionParagraphs.forEach((p) => {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun(p)],
      })
    );
  });
  children.push(
    new Paragraph({
      text: "Методика и фиксация среза:",
      spacing: { before: 120, after: 80 },
      children: [new TextRun({ text: "Методика и фиксация среза: ", bold: true })],
    })
  );
  layout.methodologyBullets.forEach((b) => {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: mdRunsFromLine(b),
      })
    );
  });

  children.push(
    new Paragraph({
      text: "Содержание",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 160 },
    })
  );
  layout.toc.forEach((row) => {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${row.num}. `, bold: true }),
          new TextRun(row.title),
        ],
      })
    );
  });

  children.push(
    new Paragraph({
      text: "Основная часть",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 200 },
    })
  );

  layout.numberedSections.forEach((s) => {
    const headText = `${s._num}. ${s.title || "Секция"}`;
    children.push(
      new Paragraph({
        text: headText,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
      })
    );
    const metaBits = [];
    if (s.mandatory) metaBits.push("обязательная секция");
    metaBits.push(`уверенность: ${s._confidenceLabel}`);
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: metaBits.join(" · "), italics: true, color: "64748B", size: 20 })],
      })
    );
    markdownToParagraphs(s.body_markdown).forEach((p) => children.push(p));

    if (s.fact_bullets && s.fact_bullets.length) {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: [new TextRun({ text: "Ключевые факты по данным", bold: true })],
        })
      );
      s.fact_bullets.forEach((b) => {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: mdRunsFromLine(b),
          })
        );
      });
    }
    if (s.evidence_refs && s.evidence_refs.length) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [
            new TextRun({ text: "Опора на данные: ", bold: true }),
            new TextRun(s.evidence_refs.join(", ")),
          ],
        })
      );
    }
    if (s.warnings && s.warnings.length) {
      s.warnings.forEach((w) => {
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 80 },
            shading: { fill: "FFFBEB", type: ShadingType.CLEAR },
            border: {
              left: { color: "F59E0B", space: 1, style: BorderStyle.SINGLE, size: 6 },
            },
            children: [
              new TextRun({ text: "Ограничение: ", bold: true, color: "92400E" }),
              new TextRun({ text: w, color: "78350F" }),
            ],
          })
        );
      });
    }
  });

  children.push(
    new Paragraph({
      text: "Сводные данные по срезу",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 120 },
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: 100 },
      alignment: AlignmentType.JUSTIFIED,
      children: [
        new TextRun({
          text: "Табличный снимок показателей из fact_pack (не копия экрана дашборда).",
          italics: true,
          color: "64748B",
        }),
      ],
    })
  );
  children.push(
    new Paragraph({
      text: "Ключевые показатели",
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 80, after: 80 },
    })
  );
  children.push(
    buildPlainTwoColTable(
      ["Показатель", "Значение"],
      (pres.kpisRows || []).map((r) => [r.k, r.v])
    )
  );
  if (pres.paretoLine) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 80 },
        children: [new TextRun({ text: pres.paretoLine, italics: true, color: "334155" })],
      })
    );
  }
  if ((pres.topCosts || []).length) {
    children.push(
      new Paragraph({
        text: "Топ объектов по затратам",
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 80 },
      })
    );
    children.push(
      buildPlainTwoColTable(
        ["Объект / класс", "Руб."],
        pres.topCosts.slice(0, 12).map((r) => [`${r.name} · ${r.cls}`, r.vFmt])
      )
    );
  }
  if ((pres.triggeredDiagnostics || []).length) {
    children.push(
      new Paragraph({
        text: "Сработавшие диагностики",
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 80 },
      })
    );
    children.push(
      buildPlainTwoColTable(
        ["ID", "Сигнал"],
        pres.triggeredDiagnostics.map((d) => [d.id, d.summary])
      )
    );
  }

  children.push(
    new Paragraph({
      text: layout.appendix.title,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 160 },
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun(layout.appendix.footerNote)],
    })
  );
  if (layout.appendix.evidenceRefs.length) {
    layout.appendix.evidenceRefs.forEach((ref) => {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [new TextRun(ref)],
        })
      );
    });
  } else {
    children.push(new Paragraph({ children: [new TextRun("Уникальные ссылки на фрагменты данных не указаны в секциях.")] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  buildReportDocxBuffer,
  suggestedDocxFilename,
};
