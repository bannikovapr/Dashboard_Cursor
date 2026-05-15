"use strict";

const fs = require("fs");
const path = require("path");

/**
 * PNG из шапки дашборда (тот же файл, что в index.html).
 * Несколько путей — на случай другого cwd при запуске API.
 */
function readDashboardUserpicBuffer() {
  const segments = ["assets", "desnol-userpic.png"];
  const candidates = [
    path.join(__dirname, "..", "..", ...segments),
    path.join(process.cwd(), ...segments),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p);
    } catch (e) {
      /* следующий путь */
    }
  }
  return null;
}

function toPngDataUri(buf) {
  if (!buf || !buf.length) return null;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

module.exports = { readDashboardUserpicBuffer, toPngDataUri };
