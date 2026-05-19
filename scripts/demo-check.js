"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jsonPath = path.join(root, "data", "toir.json");
const PREFIX = "[DEMO:check]";

function fail(msg) {
  console.error(`${PREFIX} FAIL: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`${PREFIX} WARN: ${msg}`);
}

function ok(msg) {
  console.log(`${PREFIX} OK: ${msg}`);
}

try {
  if (!fs.existsSync(jsonPath)) {
    fail(`Нет файла ${path.relative(root, jsonPath)}. Выполните npm run build:dashboard:json или скопируйте готовый toir.json в data/.`);
  }

  let raw;
  try {
    raw = fs.readFileSync(jsonPath, "utf8");
  } catch (e) {
    fail(`Не удалось прочитать toir.json: ${e.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`toir.json не является валидным JSON: ${e.message}`);
  }

  if (!data || typeof data !== "object") {
    fail("toir.json: ожидался объект в корне.");
  }

  const hasKpis = data.kpis && typeof data.kpis === "object";
  const hasCharts = data.charts && typeof data.charts === "object";
  if (!hasKpis && !hasCharts) {
    warn("В toir.json нет блоков kpis/charts — дашборд может выглядеть пустым.");
  } else {
    ok(`toir.json: есть ${hasKpis ? "kpis" : ""}${hasKpis && hasCharts ? " и " : ""}${hasCharts ? "charts" : ""}`);
  }

  const stat = fs.statSync(jsonPath);
  ok(`Размер toir.json: ${Math.round(stat.size / 1024)} КиБ`);

  const nm = path.join(root, "node_modules");
  if (!fs.existsSync(nm)) {
    warn("Нет каталога node_modules — перед демо выполните npm install.");
  } else {
    ok("node_modules на месте");
  }

  console.log(`${PREFIX} Готово. Дальше: START_DASHBOARD.cmd, или npm run desktop, см. docs/README-demo.md`);
  process.exit(0);
} catch (e) {
  fail(String(e && e.message ? e.message : e));
}
