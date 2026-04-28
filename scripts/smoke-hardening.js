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

function withEnv(patch, fn) {
  const keys = Object.keys(patch || {});
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const nextValue = patch[key];
    if (nextValue == null) delete process.env[key];
    else process.env[key] = String(nextValue);
  }
  try {
    return fn();
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

const FIO_RULE_IDS = ["morph_fio", "dictionary_employee", "ner_person", "fio"];
const ORG_RULE_IDS = ["dictionary_org", "structural_org", "ner_org", "company_name"];
const DEPT_RULE_IDS = ["dictionary_department", "department_name"];
const LOC_RULE_IDS = ["dictionary_installation", "structural_location", "ner_location", "installation_name"];

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
      DLP_DICT_ENABLED: "true",
      DLP_MORPH_FIO_ENABLED: "true",
      DLP_STRUCTURAL_ENABLED: "true",
      DLP_NER_ENABLED: "false",
    },
    async () => {
      freshRequire("server/security/crypto.js");
      // reset detector singleton state across tests
      const det = freshRequire("server/security/detector/index.js");
      det.init({ force: true });
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
        ensure((protectedPii.summary?.byType?.phone || 0) >= 1, "phone tokenization did not trigger", protectedPii.summary);
        ensure((protectedPii.summary?.byType?.email || 0) >= 1, "email tokenization did not trigger", protectedPii.summary);
        ensure(
          totalForRules(protectedPii.summary?.byType, FIO_RULE_IDS) >= 1,
          "FIO tokenization did not trigger via hybrid detector",
          protectedPii.summary
        );

        const domainSensitivePayload = {
          company: "ООО СибИнк Сервис",
          department: "Отдел капитального строительства",
          installation: "Площадка Усть-каменогорская",
          equipment_code: "INK_SIB_003_COMP_005",
          equipment_name: "Компрессор центробежный Siemens",
        };
        const protectedDomainSensitive = await dlp.protectPayload(domainSensitivePayload);
        ensure(protectedDomainSensitive.ok, "domain-sensitive entities should be tokenized, not blocked", protectedDomainSensitive);
        ensure(
          totalForRules(protectedDomainSensitive.summary?.byType, ORG_RULE_IDS) >= 1,
          "organization tokenization did not trigger",
          protectedDomainSensitive.summary
        );
        ensure(
          totalForRules(protectedDomainSensitive.summary?.byType, DEPT_RULE_IDS) >= 1,
          "department tokenization did not trigger",
          protectedDomainSensitive.summary
        );
        ensure(
          totalForRules(protectedDomainSensitive.summary?.byType, LOC_RULE_IDS) >= 1,
          "installation tokenization did not trigger",
          protectedDomainSensitive.summary
        );
        ensure(
          (protectedDomainSensitive.summary?.byType?.equipment_code_composite || 0) >= 1,
          "equipment_code_composite tokenization did not trigger",
          protectedDomainSensitive.summary
        );
        ensure(
          protectedDomainSensitive.payload?.equipment_name === domainSensitivePayload.equipment_name,
          "generic equipment name should stay unmasked",
          protectedDomainSensitive.payload
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
        ensure(protectedSecret.blockedBy === "openrouter_api_key", "blockedBy mismatch", protectedSecret);
      } finally {
        dlp.dispose();
      }
    }
  );
}

async function testDetectorNerOffFallback() {
  return withEnv(
    {
      DLP_NER_ENABLED: "false",
      DLP_DICT_ENABLED: "true",
      DLP_MORPH_FIO_ENABLED: "true",
      DLP_STRUCTURAL_ENABLED: "true",
    },
    async () => {
      const det = freshRequire("server/security/detector/index.js");
      det.init({ force: true });
      const status = det.getRuntimeStatus();
      ensure(status.layers.dictionary === true, "dictionary layer should be enabled", status);
      ensure(status.layers.morphFio === true, "morphFio layer should be enabled", status);
      ensure(status.layers.structural === true, "structural layer should be enabled", status);
      ensure(status.layers.ner === false, "NER layer should be disabled in fallback test", status);
      const matches = await det.detect("Сегодня Иванов Иван Иванович подписал документ");
      ensure(Array.isArray(matches) && matches.length >= 1, "morph FIO should produce a match without NER", matches);
      const fioFound = matches.some((m) => FIO_RULE_IDS.includes(m.ruleId));
      ensure(fioFound, "expected FIO rule among detector matches without NER", matches);
      return {
        nerEnabled: status.layers.ner,
        sampleMatches: matches.length,
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
  const detectorFallback = await testDetectorNerOffFallback();

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
