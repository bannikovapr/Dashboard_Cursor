"use strict";

const path = require("path");
const { runBuildDashboardJson } = require("./lib/run-build-dashboard-json");

const rootDir = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[build-dashboard-json] ${message}`);
  process.exit(1);
}

const result = runBuildDashboardJson({ rootDir });
if (!result.ok) {
  fail(result.message || "Сборка не удалась.");
}
console.log(`[build-dashboard-json] OK: ${path.join(rootDir, "data", "toir.json")}`);
