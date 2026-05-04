"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const SMOKE_PREFIX = "[SMOKE][filter-trace]";
const PORT = Number(process.env.FILTER_TRACE_TEST_PORT || 8794);
const TRACE_LOG_PATH = path.resolve(process.env.FILTER_TRACE_TEST_LOG_PATH || "logs/filter-trace-test.log");
const START_TIMEOUT_MS = 25000;

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
      if (text.includes("TOIR API listening on")) {
        finish(null);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    proc.on("error", (err) => finish(err));
    proc.on("exit", (code) => {
      if (!done) {
        finish(new Error(`server exited before ready (code=${code})`));
      }
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
  fs.mkdirSync(path.dirname(TRACE_LOG_PATH), { recursive: true });
  fs.writeFileSync(TRACE_LOG_PATH, "", "utf8");

  const env = {
    ...process.env,
    API_PORT: String(PORT),
    OPENROUTER_MOCK_ENABLED: "true",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "mock-key",
    FILTER_TRACE_LOG_ENABLED: "true",
    FILTER_TRACE_LOG_PATH: TRACE_LOG_PATH,
    FILTER_TRACE_MAX_STRING: "20000",
    AUDIT_LOG_ENABLED: "false",
    DLP_ENABLED: "true",
    DLP_BLOCK_ON_SECRETS: "true",
    DLP_KEY_PROVIDER: "env",
    DLP_ALLOW_EPHEMERAL_KEY: "false",
    DLP_REQUIRE_CONFIGURED_KEY: "true",
    DLP_MASTER_KEY_B64: crypto.randomBytes(32).toString("base64"),
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_BYPASS_LOCALHOST: "true",
  };

  const serverProc = spawn("node", ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(serverProc);

    const payload = {
      question: "Покажи по сотруднику Иванов Иван Иванович трудозатраты и контакт: ivanov@example.com, +7 (999) 123-45-67",
      context: {
        period: "2025",
        dashboard: "toir",
        notes: "Сверка по структуре работ по месяцам",
      },
    };

    const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const responseJson = await res.json().catch(() => ({}));
    ensure(res.ok, "chat request failed", { status: res.status, response: responseJson });
    ensure(responseJson && responseJson.ok === true, "chat response is not ok", responseJson);

    await sleep(200);

    const traceText = fs.readFileSync(TRACE_LOG_PATH, "utf8");
    const lines = traceText
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    ensure(lines.length >= 5, "trace log has too few events", { lines: lines.length });

    const events = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: "invalid_json_line" };
      }
    });

    const required = [
      "chat_request_received",
      "chat_dlp_protect_result",
      "chat_model_request",
      "chat_model_response",
      "chat_dlp_restore_result",
      "chat_response_to_dashboard",
    ];
    for (const eventName of required) {
      ensure(events.some((e) => e.event === eventName), `missing trace event: ${eventName}`);
    }
    ensure(
      events.every((e) => Number.isFinite(Number(e.schemaVersion)) && Number(e.schemaVersion) > 0),
      "trace event without valid schemaVersion"
    );
    ensure(
      events.every((e) => e.logType === "filter_trace"),
      "trace event without expected logType=filter_trace"
    );

    // Regression guard: no raw PII should be sent to model.
    const modelRequest = events.find((e) => e.event === "chat_model_request");
    ensure(modelRequest, "chat_model_request event missing");
    const sentQuestion = String(modelRequest?.sentToModel?.question || "");
    ensure(sentQuestion.length > 0, "chat_model_request.sentToModel.question is empty", modelRequest);
    ensure(!/ivanov@example\.com/i.test(sentQuestion), "raw email leaked into sentToModel.question", sentQuestion);
    ensure(!/\+7\s*\(999\)\s*123-45-67/.test(sentQuestion), "raw phone leaked into sentToModel.question", sentQuestion);
    ensure(
      /\[\[DLP_[A-Z0-9_]+_\d{4,}\]\]/.test(sentQuestion),
      "expected DLP token placeholder in sentToModel.question",
      sentQuestion
    );

    console.log(`${SMOKE_PREFIX} OK`);
    console.log(
      JSON.stringify(
        {
          traceLogPath: TRACE_LOG_PATH,
          totalEvents: events.length,
          events: events.map((e) => e.event),
          dashboardResponse: {
            fact: String(responseJson.fact || "").slice(0, 180),
            conclusion: String(responseJson.conclusion || "").slice(0, 180),
            action: String(responseJson.action || "").slice(0, 180),
          },
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
