"use strict";

const { executeTool } = require("../server/agent/tools");

function run() {
  const result = executeTool("forecast_metric", {
    metric: "costs_monthly",
    horizon: 3,
    method: "auto",
    with_confidence: true,
    filters: { period: "all", class: "__all__" },
  });

  if (result.error || !result.ok) {
    console.error("[SMOKE][forecast] FAIL:", result.error || "unknown error");
    process.exit(1);
  }

  const points = result?.forecast?.series_forecast || [];
  if (!Array.isArray(points) || points.length !== 3) {
    console.error("[SMOKE][forecast] FAIL: invalid forecast points length");
    process.exit(1);
  }

  console.log("[SMOKE][forecast] OK");
  console.log(
    JSON.stringify(
      {
        model: result?.forecast?.model_info?.name || null,
        horizon: result?.forecast?.horizon || null,
        quality: result?.forecast?.quality || {},
      },
      null,
      2
    )
  );
}

run();
