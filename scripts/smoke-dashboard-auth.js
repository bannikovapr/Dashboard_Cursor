"use strict";

/**
 * Смок логики входа дашборда (без поднятого HTTP-сервера).
 * Полный e2e: включите API с DASHBOARD_AUTH_* и проверьте вручную или расширьте скрипт.
 */

const crypto = require("crypto");

function fail(msg) {
  console.error(`[SMOKE][dashboard-auth] FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`[SMOKE][dashboard-auth] OK: ${msg}`);
}

function loadAuthFresh() {
  const path = require.resolve("../server/auth/dashboard-auth");
  delete require.cache[path];
  return require(path);
}

(function main() {
  const saved = {
    DASHBOARD_AUTH_ENABLED: process.env.DASHBOARD_AUTH_ENABLED,
    DASHBOARD_AUTH_USER: process.env.DASHBOARD_AUTH_USER,
    DASHBOARD_AUTH_PASSWORD: process.env.DASHBOARD_AUTH_PASSWORD,
    DASHBOARD_AUTH_SECRET: process.env.DASHBOARD_AUTH_SECRET,
  };

  try {
    process.env.DASHBOARD_AUTH_ENABLED = "false";
    let auth = loadAuthFresh();
    if (auth.isAuthEnabled()) fail("expected auth disabled");
    try {
      auth.validateConfigAtBoot();
    } catch (e) {
      fail(`validateConfigAtBoot should not throw when disabled: ${e.message}`);
    }
    pass("disabled: validate OK, isAuthEnabled false");

    process.env.DASHBOARD_AUTH_ENABLED = "true";
    process.env.DASHBOARD_AUTH_USER = "testuser";
    process.env.DASHBOARD_AUTH_PASSWORD = "test_pass_9";
    process.env.DASHBOARD_AUTH_SECRET = crypto.randomBytes(24).toString("hex");
    auth = loadAuthFresh();
    let threw = false;
    try {
      auth.validateConfigAtBoot();
    } catch (e) {
      threw = true;
    }
    if (threw) fail("validateConfigAtBoot threw with valid config");
    pass("enabled: validateConfigAtBoot OK");

    if (!auth.verifyCredentials("testuser", "test_pass_9")) fail("verifyCredentials should accept good password");
    if (auth.verifyCredentials("testuser", "wrong")) fail("verifyCredentials should reject bad password");
    if (auth.verifyCredentials("other", "test_pass_9")) fail("verifyCredentials should reject bad user");
    pass("verifyCredentials OK");

    const tok = auth.createToken();
    if (!tok || typeof tok !== "string") fail("createToken returned empty");
    const payload = auth.verifyToken(tok);
    if (!payload || !payload.exp) fail("verifyToken should return payload");
    if (auth.verifyToken("garbage")) fail("verifyToken should reject garbage");
    pass("createToken / verifyToken OK");
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  console.log("[SMOKE][dashboard-auth] ALL OK");
  process.exit(0);
})();
