"use strict";

const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const SMOKE_PREFIX = "[SMOKE][failclosed-api]";
const PORT = Number(process.env.FAILCLOSED_TEST_PORT || 8795);
const START_TIMEOUT_MS = 30000;

function fail(message, extra) {
  console.error(`${SMOKE_PREFIX} FAIL: ${message}`);
  if (extra != null) {
    if (typeof extra === "string") console.error(extra);
    else console.error(JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function ensure(condition, message, extra) {
  if (!condition) fail(message, extra);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForServerReady(proc) {
  return new Promise((resolve, reject) => {
    let done = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`timeout while waiting server start (${START_TIMEOUT_MS}ms)`));
    }, START_TIMEOUT_MS);

    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ stdout, stderr });
    }

    proc.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      if (text.includes("TOIR API listening on")) finish(null);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    proc.on("error", (err) => finish(err));
    proc.on("exit", (code) => {
      if (!done) finish(new Error(`server exited before ready (code=${code})`));
    });
  });
}

async function stopServer(proc) {
  if (!proc || proc.exitCode != null) return;
  proc.kill();
  for (let i = 0; i < 20; i += 1) {
    if (proc.exitCode != null) return;
    await sleep(100);
  }
}

async function run() {
  const env = {
    ...process.env,
    API_PORT: String(PORT),
    OPENROUTER_MOCK_ENABLED: "true",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "mock-key",
    AUDIT_LOG_ENABLED: "false",
    FILTER_TRACE_LOG_ENABLED: "false",
    DLP_ENABLED: "true",
    DLP_BLOCK_ON_SECRETS: "true",
    DLP_KEY_PROVIDER: "env",
    DLP_ALLOW_EPHEMERAL_KEY: "false",
    DLP_REQUIRE_CONFIGURED_KEY: "true",
    DLP_MASTER_KEY_B64: crypto.randomBytes(32).toString("base64"),
    DLP_ML_ENABLED: "true",
    DLP_ML_FAIL_MODE: "closed",
    DLP_ML_MODEL: "Xenova/this-model-does-not-exist-failclosed-smoke",
    DLP_ML_WARMUP_TIMEOUT_MS: "1000",
    DLP_ML_TIMEOUT_MS: "500",
    RATE_LIMIT_ENABLED: "false",
  };

  const serverProc = spawn("node", ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(serverProc);

    const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Покажи сводку по ТОиР", context: { period: "2025" } }),
    });
    const body = await res.json().catch(() => ({}));

    ensure(res.status === 503, "fail-closed should return HTTP 503", { status: res.status, body });
    ensure(body && body.ok === false, "response must be ok=false", body);
    ensure(body.errorCode === "ml_unavailable", "errorCode must be ml_unavailable", body);
    ensure(/fail-closed|недоступен/i.test(String(body.message || "")), "message should mention ML unavailable", body);

    console.log(`${SMOKE_PREFIX} OK`);
    console.log(
      JSON.stringify(
        {
          status: res.status,
          errorCode: body.errorCode,
          message: body.message,
        },
        null,
        2
      )
    );
  } finally {
    await stopServer(serverProc);
  }
}

run().catch((err) => fail("unexpected error", String(err && err.message ? err.message : err)));
