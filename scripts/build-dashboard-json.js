"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "data", "toir.json");
const analyzeScriptPath = path.join(rootDir, "scripts", "analyze_toir.py");
const reportNames = [
  "Анализ отказов.xlsx",
  "КТГ.xlsx",
  "Наработка на отказ.xlsx",
  "Простой.xlsx",
  "Процент износа.xlsx",
  "Список оборудования.xlsx",
  "Фактические затраты по ОР.xlsx",
];

function fail(message) {
  console.error(`[build-dashboard-json] ${message}`);
  process.exit(1);
}

function resolvePythonCommand() {
  const candidates = [
    { cmd: "py", args: ["-3"] },
    { cmd: "python", args: [] },
  ];
  for (const c of candidates) {
    const probe = spawnSync(c.cmd, [...c.args, "--version"], {
      cwd: rootDir,
      encoding: "utf8",
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0) {
      return c;
    }
  }
  return null;
}

function validateReports() {
  const dataDir = path.join(rootDir, "data");
  const missing = reportNames.filter((name) => !fs.existsSync(path.join(dataDir, name)));
  if (missing.length) {
    fail(`Не найдены обязательные отчёты в data/: ${missing.join(", ")}`);
  }
}

function runAnalyzeToir() {
  if (!fs.existsSync(analyzeScriptPath)) {
    fail(`Не найден скрипт генерации JSON: ${analyzeScriptPath}`);
  }
  const py = resolvePythonCommand();
  if (!py) {
    fail("Python не найден (ожидались команды py -3 или python).");
  }

  const run = spawnSync(py.cmd, [...py.args, analyzeScriptPath], {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true,
  });

  if (run.error) {
    fail(`Ошибка запуска Python: ${String(run.error.message || run.error)}`);
  }
  if (run.status !== 0) {
    const stderr = String(run.stderr || "").trim();
    const stdout = String(run.stdout || "").trim();
    fail(`analyze_toir.py завершился с кодом ${run.status}.${stderr ? ` stderr: ${stderr}` : ""}${stdout ? ` stdout: ${stdout}` : ""}`);
  }
}

function main() {
  validateReports();
  runAnalyzeToir();
  if (!fs.existsSync(outputPath)) {
    fail(`После анализа не создан файл: ${outputPath}`);
  }
  console.log(`[build-dashboard-json] OK: ${outputPath} (собрано из 7 Excel-отчетов)`);
}

main();
