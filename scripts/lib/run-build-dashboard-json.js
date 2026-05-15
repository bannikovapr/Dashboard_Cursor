"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const defaultReportNames = [
  "Анализ отказов.xlsx",
  "КТГ.xlsx",
  "Наработка на отказ.xlsx",
  "Простой.xlsx",
  "Процент износа.xlsx",
  "Список оборудования.xlsx",
  "Фактические затраты по ОР.xlsx",
];

/** Как find_personnel_usage_xlsx в personnel_reports.py */
function dataDirHasPersonnelUsage(dataDir) {
  if (fs.existsSync(path.join(dataDir, "Использование персонала.xlsx"))) return true;
  let names;
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return false;
  }
  return names.some((f) => {
    if (!f.toLowerCase().endsWith(".xlsx")) return false;
    const low = f.toLowerCase();
    return low.includes("использован") && low.includes("персонал");
  });
}

/** Как find_org_personnel_analysis_xlsx в personnel_reports.py (упрощённо) */
function dataDirHasPersonnelOrgAnalysis(dataDir) {
  const candidates = [
    "Анализ использования персонала организация.xlsx",
    "Анализ использования персонала.xlsx",
    "org_personnel_usage.xlsx",
  ];
  if (candidates.some((n) => fs.existsSync(path.join(dataDir, n)))) return true;
  let names;
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return false;
  }
  return names.some((f) => {
    if (!f.toLowerCase().endsWith(".xlsx")) return false;
    const low = f.toLowerCase();
    if (low.includes("анализ") && low.includes("персонал")) return true;
    if (low.includes("организац") && low.includes("персонал")) return true;
    return false;
  });
}

function resolvePythonCommand(rootDir) {
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

/**
 * Собирает data/toir.json из Excel через analyze_toir.py (без process.exit).
 * @param {{ rootDir?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function runBuildDashboardJson(opts) {
  const rootDir = path.resolve(opts && opts.rootDir ? opts.rootDir : path.join(__dirname, "..", ".."));
  const outputPath = path.join(rootDir, "data", "toir.json");
  const analyzeScriptPath = path.join(rootDir, "scripts", "analyze_toir.py");
  const dataDir = path.join(rootDir, "data");

  const missing = defaultReportNames.filter((name) => !fs.existsSync(path.join(dataDir, name)));
  if (missing.length) {
    return {
      ok: false,
      message: `Не найдены обязательные отчёты в data/: ${missing.join(", ")}`,
    };
  }

  if (!dataDirHasPersonnelUsage(dataDir)) {
    return {
      ok: false,
      message:
        "Не найден обязательный отчёт по персоналу в data/: «Использование персонала.xlsx» или другой .xlsx, в имени которого есть «использован» и «персонал».",
    };
  }
  if (!dataDirHasPersonnelOrgAnalysis(dataDir)) {
    return {
      ok: false,
      message:
        "Не найден обязательный отчёт «анализ использования персонала» в data/ (например «Анализ использования персонала организация.xlsx» или «Анализ использования персонала.xlsx»; см. personnel_reports.py).",
    };
  }

  if (!fs.existsSync(analyzeScriptPath)) {
    return { ok: false, message: `Не найден скрипт генерации JSON: ${analyzeScriptPath}` };
  }

  const py = resolvePythonCommand(rootDir);
  if (!py) {
    return { ok: false, message: "Python не найден (ожидались команды py -3 или python)." };
  }

  const run = spawnSync(py.cmd, [...py.args, analyzeScriptPath], {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true,
  });

  if (run.error) {
    return {
      ok: false,
      message: `Ошибка запуска Python: ${String(run.error.message || run.error)}`,
    };
  }
  if (run.status !== 0) {
    const stderr = String(run.stderr || "").trim();
    const stdout = String(run.stdout || "").trim();
    const tail = [stderr && `stderr: ${stderr}`, stdout && `stdout: ${stdout}`].filter(Boolean).join(" · ");
    return {
      ok: false,
      message: `analyze_toir.py завершился с кодом ${run.status}${tail ? `. ${tail}` : ""}`,
    };
  }

  if (!fs.existsSync(outputPath)) {
    return { ok: false, message: `После анализа не создан файл: ${outputPath}` };
  }

  return { ok: true };
}

module.exports = {
  runBuildDashboardJson,
  defaultReportNames,
};
