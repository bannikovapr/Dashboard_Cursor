"use strict";

/**
 * Только ASCII в Content-Disposition: filename="..." — без filename*.
 * Иначе Chrome/Node при кириллице или вложенных параметрах дают
 * «Invalid character in header content ["Content-Disposition"]».
 * Красивое имя задаётся на клиенте (a.download).
 */
function asciiAttachmentDispositionForReport(document_, ext) {
  const e = String(ext || ".bin").startsWith(".") ? String(ext || ".bin") : `.${ext || "bin"}`;
  const safeExt = e.replace(/[^a-z0-9.]/gi, "").slice(0, 8) || ".bin";
  const stamp = new Date().toISOString().slice(0, 10);
  const id =
    String((document_ && document_.report_id) || "export")
      .replace(/[^a-zA-Z0-9._-]+/g, "")
      .slice(0, 48) || "export";
  const filename = `toir-report-${id}-${stamp}${safeExt}`;
  return `attachment; filename="${filename}"`;
}

module.exports = { asciiAttachmentDispositionForReport };
