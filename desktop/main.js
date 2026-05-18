"use strict";

const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const apiEntry = path.join(projectRoot, "server", "index.js");
const indexHtml = path.join(projectRoot, "index.html");
const preloadPath = path.join(__dirname, "preload.js");

/** @type {import('child_process').ChildProcess | null} */
let apiChild = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let forceKillTimer = null;
let lifecycleCleanupDone = false;

function getApiPort() {
  const p = Number(process.env.API_PORT || 8787);
  return Number.isFinite(p) && p > 0 ? p : 8787;
}

/**
 * Любой HTTP-ответ от /health (включая 503 до готовности ML) считается признаком, что порт слушает.
 */
function waitForAnyHealth(port, options) {
  const maxMs = (options && options.maxMs) || 90000;
  const intervalMs = (options && options.intervalMs) || 400;
  const deadline = Date.now() + maxMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    const attempt = () => {
      if (settled) return;
      if (Date.now() > deadline) {
        settled = true;
        reject(
          new Error(`API не ответил за ${Math.round(maxMs / 1000)} с (порт ${port}, /health).`)
        );
        return;
      }
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port,
          path: "/health",
          timeout: 2000,
        },
        (res) => {
          if (settled) return;
          settled = true;
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (settled) return;
        setTimeout(attempt, intervalMs);
      });
      req.on("timeout", () => {
        req.destroy();
        if (settled) return;
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

function raceHealthOrChildExit(child, port, maxMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanupAndFinish = (fn, arg) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      fn(arg);
    };

    const onExit = (code, signal) => {
      cleanupAndFinish(reject, new Error(
        `Процесс API завершился до готовности (код ${code}${signal ? `, ${signal}` : ""}). ` +
          `Проверьте, свободен ли порт ${port} (переменная API_PORT) и что Node доступен в PATH.`
      ));
    };

    const onError = (err) => {
      cleanupAndFinish(
        reject,
        new Error(`Не удалось запустить API (Node): ${String(err && err.message ? err.message : err)}`)
      );
    };

    child.once("exit", onExit);
    child.once("error", onError);

    waitForAnyHealth(port, { maxMs })
      .then(() => {
        cleanupAndFinish(resolve);
      })
      .catch((err) => {
        cleanupAndFinish(reject, err);
      });
  });
}

function clearForceKillTimer() {
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

function stopApiChild() {
  clearForceKillTimer();
  if (!apiChild) {
    return;
  }
  const ch = apiChild;
  if (ch.exitCode !== null || ch.signalCode) {
    apiChild = null;
    return;
  }

  try {
    if (process.platform === "win32") {
      ch.kill();
    } else {
      ch.kill("SIGTERM");
    }
  } catch (_) {
    /* ignore */
  }

  forceKillTimer = setTimeout(() => {
    forceKillTimer = null;
    try {
      if (!ch.killed && ch.exitCode === null) {
        ch.kill("SIGKILL");
      }
    } catch (_) {
      /* ignore */
    }
  }, 5000);

  apiChild = null;
}

function resolveNodeExecutable() {
  return (
    process.env.npm_node_execpath ||
    process.env.NODE_BINARY ||
    process.env.NODE_EXE ||
    "node"
  );
}

function spawnApiProcess() {
  const child = spawn(resolveNodeExecutable(), [apiEntry], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.on("exit", () => {
    clearForceKillTimer();
  });

  return child;
}

async function reportDashboardLifecycle(port, phase, surface) {
  const url = `http://127.0.0.1:${port}/api/dashboard/lifecycle`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ phase, surface }),
    });
    await r.arrayBuffer();
  } catch (_) {
    /* аудит не должен блокировать выход */
  } finally {
    clearTimeout(t);
  }
}

async function createWindow() {
  const port = getApiPort();

  apiChild = spawnApiProcess();

  try {
    await raceHealthOrChildExit(apiChild, port, 90000);
  } catch (e) {
    const msg = String((e && e.message) || e);
    try {
      dialog.showErrorBox("Дашборд ТОиР", `Не удалось запустить API.\n\n${msg}`);
    } catch (_) {
      /* без UI */
    }
    stopApiChild();
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  await win.loadFile(indexHtml);

  try {
    await reportDashboardLifecycle(port, "open", "electron");
  } catch (_) {
    /* ignore */
  }
}

app.whenReady().then(() => {
  createWindow().catch((e) => {
    console.error(e);
    dialog.showErrorBox("Дашборд ТОиР", String((e && e.message) || e));
    stopApiChild();
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (lifecycleCleanupDone) {
    return;
  }
  event.preventDefault();
  lifecycleCleanupDone = true;
  const port = getApiPort();
  (async () => {
    try {
      await reportDashboardLifecycle(port, "close", "electron");
    } catch (_) {
      /* ignore */
    } finally {
      stopApiChild();
      app.quit();
    }
  })();
});

process.on("SIGINT", () => {
  app.quit();
});

process.on("SIGTERM", () => {
  app.quit();
});
