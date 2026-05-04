"use strict";

const crypto = require("crypto");
const path = require("path");

const SMOKE_PREFIX = "[SMOKE][hardening]";
const TOKEN_RE = /\[\[DLP_[A-Z0-9_]+_\d{4}\]\]/g;

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

function randomB64Key32() {
  return crypto.randomBytes(32).toString("base64");
}

function resolveLocal(relPath) {
  return path.resolve(__dirname, "..", relPath);
}

function freshRequire(relPath) {
  const abs = require.resolve(resolveLocal(relPath));
  delete require.cache[abs];
  return require(abs);
}

async function withEnv(patch, fn) {
  const keys = Object.keys(patch || {});
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const nextValue = patch[key];
    if (nextValue == null) delete process.env[key];
    else process.env[key] = String(nextValue);
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function testKeyProvider(providerName, envPatch) {
  return withEnv(
    {
      DLP_KEY_PROVIDER: providerName,
      DLP_ALLOW_EPHEMERAL_KEY: "false",
      DLP_REQUIRE_CONFIGURED_KEY: "true",
      DLP_MASTER_KEY_B64: null,
      DLP_MASTER_KEY_HEX: null,
      DLP_MASTER_KEY: null,
      DLP_KMS_KEY_B64: null,
      DLP_KMS_KEY_HEX: null,
      DLP_KMS_KEY: null,
      DLP_VAULT_KEY_B64: null,
      DLP_VAULT_KEY_HEX: null,
      DLP_VAULT_KEY: null,
      ...envPatch,
    },
    () => {
      const c = freshRequire("server/security/crypto.js");
      const status = c.getKeyStatus();
      ensure(status && status.configured === true, `provider ${providerName} was not configured`, status);
      ensure(status.provider === providerName, `provider mismatch for ${providerName}`, status);
      const aad = `${providerName}-aad`;
      const sample = `secret-${providerName}`;
      const enc = c.encryptText(sample, aad);
      const dec = c.decryptText(enc, aad);
      ensure(dec === sample, `encrypt/decrypt failed for provider ${providerName}`);
      return status;
    }
  );
}

function testProviderFailure() {
  return withEnv(
    {
      DLP_KEY_PROVIDER: "vault",
      DLP_ALLOW_EPHEMERAL_KEY: "false",
      DLP_REQUIRE_CONFIGURED_KEY: "true",
      DLP_VAULT_KEY_B64: null,
      DLP_VAULT_KEY_HEX: null,
      DLP_VAULT_KEY: null,
    },
    () => {
      const c = freshRequire("server/security/crypto.js");
      const status = c.getKeyStatus();
      ensure(status && status.configured === false, "missing vault key must be reported", status);
      ensure(/not configured/i.test(String(status.error || "")), "status should mention not configured", status);

      let thrown = false;
      try {
        c.encryptText("x", "aad");
      } catch (e) {
        thrown = /not configured/i.test(String(e && e.message ? e.message : e));
      }
      ensure(thrown, "encryptText should fail when configured key is required");
    }
  );
}

// New ML-first ruleIds + backward-compat aliases for transitional smoke runs.
const FIO_RULE_IDS = ["ml_person", "ner_person", "morph_fio", "dictionary_employee", "fio"];
const ORG_RULE_IDS = ["ml_org", "ner_org", "dictionary_org", "structural_org", "company_name"];
const DEPT_RULE_IDS = ["dictionary_department", "department_name"];
const LOC_RULE_IDS = ["ml_location", "ner_location", "dictionary_installation", "structural_location", "installation_name"];
const EMAIL_RULE_IDS = ["regex_email", "ml_email", "email"];
const PHONE_RULE_IDS = ["regex_phone", "ml_phone", "phone"];
const EQUIPMENT_CODE_RULE_IDS = ["regex_equipment_code", "ml_equipment_code", "equipment_code_composite"];
const SECRET_RULE_IDS = [
  "regex_secret_openrouter_api_key",
  "regex_secret_generic_api_key",
  "regex_secret_bearer_token",
  "regex_secret_pem",
  "regex_secret_aws_access_key",
  "regex_secret_jwt",
  "ml_secret",
  "openrouter_api_key",
  "private_key",
];

function totalForRules(byType, ruleIds) {
  let total = 0;
  for (const id of ruleIds) {
    total += Number(byType?.[id]) || 0;
  }
  return total;
}

async function testDlpNegativeCases() {
  return withEnv(
    {
      DLP_ENABLED: "true",
      DLP_BLOCK_ON_SECRETS: "true",
      SECRET_POLICY_MODE: "strict",
      DLP_KEY_PROVIDER: "env",
      DLP_ALLOW_EPHEMERAL_KEY: "false",
      DLP_REQUIRE_CONFIGURED_KEY: "true",
      DLP_MASTER_KEY_B64: randomB64Key32(),
      // ML-engine off for deterministic offline smoke; regex backstop still covers
      // secrets, email, phone, equipment_code.
      DLP_ML_ENABLED: "false",
      DLP_ML_FAIL_MODE: "monitor",
      DLP_REGEX_BACKSTOP_ENABLED: "true",
    },
    async () => {
      freshRequire("server/security/crypto.js");
      // reset detector singleton state across tests
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const nonFioPayload = {
          text: "Станок токарный винторезный требует осмотр после смены.",
        };
        const protectedNonFio = await dlp.protectPayload(nonFioPayload);
        ensure(protectedNonFio.ok, "non-FIO machinery text should not be blocked", protectedNonFio);
        ensure(
          totalForRules(protectedNonFio.summary?.byType, FIO_RULE_IDS) === 0,
          "non-FIO machinery text must not be tokenized as person",
          protectedNonFio.summary
        );

        const piiPayload = {
          text: "Контакт Иванов Иван Иванович, тел. +7 (999) 123-45-67, email ivanov@example.com",
        };
        const protectedPii = await dlp.protectPayload(piiPayload);
        ensure(protectedPii.ok, "PII should be tokenized, not blocked", protectedPii);
        ensure(
          totalForRules(protectedPii.summary?.byType, PHONE_RULE_IDS) >= 1,
          "phone tokenization did not trigger via regex-backstop",
          protectedPii.summary
        );
        ensure(
          totalForRules(protectedPii.summary?.byType, EMAIL_RULE_IDS) >= 1,
          "email tokenization did not trigger via regex-backstop",
          protectedPii.summary
        );

        const equipmentCodePayload = {
          text: "Карточка оборудования INK_SIB_003_COMP_005 актуализирована.",
        };
        const protectedEquipment = await dlp.protectPayload(equipmentCodePayload);
        ensure(protectedEquipment.ok, "equipment_code payload should not be blocked", protectedEquipment);
        ensure(
          totalForRules(protectedEquipment.summary?.byType, EQUIPMENT_CODE_RULE_IDS) >= 1,
          "equipment_code tokenization did not trigger",
          protectedEquipment.summary
        );

        const genericEquipmentPayload = await dlp.protectPayload({
          text: "Компрессор центробежный Siemens",
        });
        ensure(genericEquipmentPayload.ok, "generic equipment payload should remain allowed", genericEquipmentPayload);
        ensure(
          (genericEquipmentPayload.summary?.tokensCreated || 0) === 0,
          "generic equipment payload should not be tokenized",
          genericEquipmentPayload.summary
        );
        TOKEN_RE.lastIndex = 0;
        ensure(!TOKEN_RE.test(genericEquipmentPayload.payload?.text || ""), "unexpected token in generic equipment payload");

        const secretPayload = {
          text: `Ключ sk-or-v1-${"A".repeat(24)}`,
        };
        const protectedSecret = await dlp.protectPayload(secretPayload);
        ensure(!protectedSecret.ok, "secret must be blocked", protectedSecret);
        ensure(
          SECRET_RULE_IDS.includes(protectedSecret.blockedBy),
          "blockedBy must be one of secret rule ids",
          protectedSecret
        );

        const pemPayload = {
          text: "PEM:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----",
        };
        const protectedPem = await dlp.protectPayload(pemPayload);
        ensure(!protectedPem.ok, "PEM private key must be blocked", protectedPem);
        ensure(
          SECRET_RULE_IDS.includes(protectedPem.blockedBy),
          "PEM blockedBy must be one of secret rule ids",
          protectedPem
        );
      } finally {
        dlp.dispose();
      }
    }
  );
}

async function testDetectorMlDisabled() {
  return withEnv(
    {
      DLP_ML_ENABLED: "false",
      DLP_ML_FAIL_MODE: "monitor",
      DLP_REGEX_BACKSTOP_ENABLED: "true",
    },
    async () => {
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const status = det.getRuntimeStatus();
      ensure(status?.ml?.enabled === false, "ML engine should be disabled for fallback test", status);
      ensure(status?.regexBackstop?.enabled === true, "regex backstop should remain enabled", status);
      const matches = await det.detect("ivanov@example.com и +7 999 123 45 67");
      ensure(Array.isArray(matches) && matches.length >= 2, "regex backstop should detect email and phone", matches);
      const ids = new Set(matches.map((m) => m.ruleId));
      ensure(EMAIL_RULE_IDS.some((r) => ids.has(r)), "regex_email expected", matches);
      ensure(PHONE_RULE_IDS.some((r) => ids.has(r)), "regex_phone expected", matches);
      return {
        mlEnabled: status?.ml?.enabled,
        backstop: status?.regexBackstop?.enabled,
        sampleMatches: matches.length,
      };
    }
  );
}

async function testDetectorFailClosedGate() {
  return withEnv(
    {
      DLP_ENABLED: "true",
      DLP_KEY_PROVIDER: "env",
      DLP_REQUIRE_CONFIGURED_KEY: "true",
      DLP_ALLOW_EPHEMERAL_KEY: "false",
      DLP_MASTER_KEY_B64: randomB64Key32(),
      // ML enabled but unable to load (no real model in this environment),
      // fail-mode=closed must block PII routes.
      DLP_ML_ENABLED: "true",
      DLP_ML_FAIL_MODE: "closed",
      DLP_ML_MODEL: "Xenova/this-model-does-not-exist-smoke",
      DLP_ML_WARMUP_TIMEOUT_MS: "1000",
      DLP_ML_TIMEOUT_MS: "500",
      DLP_REGEX_BACKSTOP_ENABLED: "true",
    },
    async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const status = det.getRuntimeStatus();
      ensure(status?.ml?.ready === false, "ML must not be ready in this synthetic test", status);
      ensure(det.shouldBlockOnUnready() === true, "fail-closed must request to block on unready", status);
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const result = await dlp.protectPayload({ text: "Иван Иванов" });
        ensure(!result.ok, "fail-closed must return ok=false", result);
        ensure(result.blockedBy === "ml_unavailable", "blockedBy must be ml_unavailable", result);
      } finally {
        dlp.dispose();
      }
      return {
        mlReady: status?.ml?.ready === true,
        failMode: status?.failMode,
      };
    }
  );
}

function testRateLimit() {
  return withEnv(
    {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_BYPASS_LOCALHOST: "false",
      RATE_LIMIT_CHAT_MAX: "2",
      RATE_LIMIT_CHAT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "50",
      RATE_LIMIT_WINDOW_MS: "60000",
    },
    () => {
      const rl = freshRequire("server/security/rate-limit.js");
      const req = { ip: "10.0.77.5", headers: { "user-agent": "smoke-hardening" } };
      const r1 = rl.checkRateLimit({ req, routeId: "chat" });
      const r2 = rl.checkRateLimit({ req, routeId: "chat" });
      const r3 = rl.checkRateLimit({ req, routeId: "chat" });
      ensure(r1.allowed === true, "first request should be allowed", r1);
      ensure(r2.allowed === true, "second request should be allowed", r2);
      ensure(r3.allowed === false, "third request should be blocked by limit", r3);
      ensure(r3.retryAfterSec >= 1, "retry-after should be provided", r3);
      return { first: r1.remaining, second: r2.remaining, thirdAllowed: r3.allowed };
    }
  );
}

async function run() {
  const kmsStatus = testKeyProvider("kms", { DLP_KMS_KEY_B64: randomB64Key32() });
  const vaultStatus = testKeyProvider("vault", { DLP_VAULT_KEY_B64: randomB64Key32() });
  testProviderFailure();
  await testDlpNegativeCases();
  const rate = testRateLimit();
  const detectorFallback = await testDetectorMlDisabled();
  const failClosed = await testDetectorFailClosedGate();

  console.log(`${SMOKE_PREFIX} OK`);
  console.log(
    JSON.stringify(
      {
        providers: {
          kms: { provider: kmsStatus.provider, source: kmsStatus.source, configured: kmsStatus.configured },
          vault: { provider: vaultStatus.provider, source: vaultStatus.source, configured: vaultStatus.configured },
        },
        rateLimit: rate,
        detectorFallback,
        failClosed,
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error(`${SMOKE_PREFIX} UNHANDLED:`, err);
  process.exit(1);
});
