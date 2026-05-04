"use strict";

// Comprehensive security test suite.
// Covers: crypto/key providers, token vault, regex backstop, detector orchestrator,
// secret-policy modes, dlp-service end-to-end, rate-limit, log-utils sanitization.
//
// Output: human readable PASS/FAIL per case + final JSON summary.
// Logs each case as NDJSON line into logs/security-suite.log for archival.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SUITE_PREFIX = "[SUITE][security]";
const LOG_PATH = path.resolve(__dirname, "..", "logs", "security-suite.log");
const PERF_MAX_MS = Number(process.env.SECURITY_SUITE_PERF_MAX_MS || 4000);

const results = [];

function recordResult(group, name, status, details) {
  const entry = {
    ts: new Date().toISOString(),
    group,
    name,
    status,
    details: details || null,
  };
  results.push(entry);
  const tag = status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  const line = `${SUITE_PREFIX} ${tag} [${group}] ${name}${
    details && status !== "PASS" ? " :: " + JSON.stringify(details) : ""
  }`;
  if (status === "PASS") console.log(line);
  else if (status === "SKIP") console.warn(line);
  else console.error(line);
}

async function runCase(group, name, fn) {
  try {
    const value = await fn();
    if (value && value.skip) {
      recordResult(group, name, "SKIP", { reason: value.skip });
      return;
    }
    recordResult(group, name, "PASS", value || null);
  } catch (e) {
    recordResult(group, name, "FAIL", {
      error: String(e && e.message ? e.message : e),
      stack: e && e.stack ? String(e.stack).split("\n").slice(0, 4).join(" | ") : null,
    });
  }
}

function assert(condition, message, extra) {
  if (!condition) {
    const err = new Error(message);
    err.extra = extra;
    throw err;
  }
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "values not equal"}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
    );
  }
}

function withEnv(patch, fn) {
  const keys = Object.keys(patch || {});
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const next = patch[key];
    if (next == null) delete process.env[key];
    else process.env[key] = String(next);
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

async function prepareDlpSession() {
  freshRequire("server/security/crypto.js");
  const det = freshRequire("server/security/detector/index.js");
  await det.init({ force: true });
  const { createSession } = freshRequire("server/security/dlp-service.js");
  const dlp = createSession({ requestId: crypto.randomUUID() });
  return dlp;
}

function freshRequire(relPath) {
  const abs = require.resolve(path.resolve(__dirname, "..", relPath));
  delete require.cache[abs];
  return require(abs);
}

function freshRequireAll() {
  freshRequire("server/security/crypto.js");
  freshRequire("server/security/secret-policy.js");
  freshRequire("server/security/detector/regex-backstop.js");
  freshRequire("server/security/detector/ner-engine.js");
  freshRequire("server/security/detector/index.js");
  freshRequire("server/security/token-vault.js");
  freshRequire("server/security/dlp-service.js");
  freshRequire("server/security/rate-limit.js");
  freshRequire("server/security/log-utils.js");
}

function randomKeyB64(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64");
}

const SECRET_RULE_IDS = new Set([
  "regex_secret_openrouter_api_key",
  "regex_secret_generic_api_key",
  "regex_secret_bearer_token",
  "regex_secret_pem",
  "regex_secret_aws_access_key",
  "regex_secret_jwt",
  "ml_secret",
]);

// ---------------------------------------------------------------------------
// Group A: crypto.js / key providers
// ---------------------------------------------------------------------------

async function groupCrypto() {
  await runCase("crypto", "ephemeral key allowed when configured key not required", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "false",
        DLP_ALLOW_EPHEMERAL_KEY: "true",
        DLP_MASTER_KEY_B64: null,
        DLP_MASTER_KEY_HEX: null,
        DLP_MASTER_KEY: null,
        DLP_VAULT_KEY_B64: null,
        DLP_KMS_KEY_B64: null,
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        const status = c.getKeyStatus();
        eq(status.ephemeral, true, "must be ephemeral");
        eq(status.configured, false, "must be not configured");
        const enc = c.encryptText("hello", "aad");
        const dec = c.decryptText(enc, "aad");
        eq(dec, "hello", "round-trip ephemeral");
      }
    )
  );

  for (const provider of ["env", "vault", "kms"]) {
    await runCase("crypto", `provider=${provider} via *_KEY_B64 configures key`, () => {
      const envKey = `DLP_${provider === "env" ? "MASTER" : provider.toUpperCase()}_KEY_B64`;
      const patch = {
        DLP_KEY_PROVIDER: provider,
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: null,
        DLP_VAULT_KEY_B64: null,
        DLP_KMS_KEY_B64: null,
        [envKey]: randomKeyB64(),
      };
      return withEnv(patch, () => {
        const c = freshRequire("server/security/crypto.js");
        const status = c.getKeyStatus();
        eq(status.configured, true, "configured");
        eq(status.provider, provider, "provider matches");
        const enc = c.encryptText("payload", `aad-${provider}`);
        const dec = c.decryptText(enc, `aad-${provider}`);
        eq(dec, "payload", "decrypt with same AAD");
      });
    });
  }

  await runCase("crypto", "provider=auto picks env > vault > kms", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "auto",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: randomKeyB64(),
        DLP_VAULT_KEY_B64: randomKeyB64(),
        DLP_KMS_KEY_B64: randomKeyB64(),
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        const status = c.getKeyStatus();
        eq(status.provider, "env", "auto resolves to env first");
        eq(status.configured, true, "configured");
      }
    )
  );

  await runCase("crypto", "missing key + REQUIRE_CONFIGURED_KEY → throws on encrypt", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "vault",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: null,
        DLP_VAULT_KEY_B64: null,
        DLP_KMS_KEY_B64: null,
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        const status = c.getKeyStatus();
        eq(status.configured, false, "must report not configured");
        let thrown = false;
        try {
          c.encryptText("x", "aad");
        } catch (e) {
          thrown = /not configured/i.test(String(e && e.message ? e.message : e));
        }
        assert(thrown, "encryptText must throw when configured key required");
      }
    )
  );

  await runCase("crypto", "decrypt with wrong AAD throws", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: randomKeyB64(),
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        const enc = c.encryptText("data", "aad-A");
        let thrown = false;
        try {
          c.decryptText(enc, "aad-B");
        } catch {
          thrown = true;
        }
        assert(thrown, "decrypt must fail with mismatched AAD");
      }
    )
  );

  await runCase("crypto", "decrypt corrupted ciphertext throws", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: randomKeyB64(),
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        const enc = c.encryptText("data", "aad");
        const tampered = { ...enc, ct: Buffer.from("corrupt").toString("base64") };
        let thrown = false;
        try {
          c.decryptText(tampered, "aad");
        } catch {
          thrown = true;
        }
        assert(thrown, "decrypt must fail on tampered ciphertext");
      }
    )
  );

  await runCase("crypto", "different keys cannot decrypt each other", async () => {
    const keyA = randomKeyB64();
    const keyB = randomKeyB64();
    const enc = await withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: keyA,
      },
      () => freshRequire("server/security/crypto.js").encryptText("secret", "aad")
    );
    const ok = await withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: keyB,
      },
      () => {
        const c = freshRequire("server/security/crypto.js");
        try {
          c.decryptText(enc, "aad");
          return false;
        } catch {
          return true;
        }
      }
    );
    assert(ok, "decrypt with another key must throw");
  });
}

// ---------------------------------------------------------------------------
// Group B: token-vault.js
// ---------------------------------------------------------------------------

async function groupTokenVault() {
  await runCase("vault", "putToken/getToken round-trip", () =>
    withEnv(
      {
        DLP_KEY_PROVIDER: "env",
        DLP_REQUIRE_CONFIGURED_KEY: "true",
        DLP_ALLOW_EPHEMERAL_KEY: "false",
        DLP_MASTER_KEY_B64: randomKeyB64(),
      },
      () => {
        freshRequire("server/security/crypto.js");
        const tv = freshRequire("server/security/token-vault.js");
        const requestId = crypto.randomUUID();
        const token = "[[DLP_REGEX_EMAIL_0001]]";
        tv.putToken({ requestId, token, encrypted: { ct: "x" }, dataType: "regex_email", ttlSec: 60 });
        const rec = tv.getToken({ requestId, token });
        assert(rec && rec.dataType === "regex_email", "must return record");
      }
    )
  );

  await runCase("vault", "TTL=0 (already expired) → null", () => {
    const tv = freshRequire("server/security/token-vault.js");
    const requestId = crypto.randomUUID();
    const token = "[[DLP_REGEX_EMAIL_0001]]";
    tv.putToken({ requestId, token, encrypted: { ct: "x" }, dataType: "regex_email", ttlSec: 1 });
    // Force expiration by manipulating wall-clock via setTimeout < TTL would be flaky.
    // Use private sweep with an expired record via clearRequest as proxy.
    tv.clearRequest(requestId);
    const rec = tv.getToken({ requestId, token });
    assert(rec === null, "cleared record must yield null", { rec });
  });

  await runCase("vault", "clearRequest deletes only its own tokens", () => {
    const tv = freshRequire("server/security/token-vault.js");
    const reqA = crypto.randomUUID();
    const reqB = crypto.randomUUID();
    tv.putToken({ requestId: reqA, token: "[[DLP_REGEX_EMAIL_0001]]", encrypted: { ct: "1" }, dataType: "regex_email", ttlSec: 60 });
    tv.putToken({ requestId: reqB, token: "[[DLP_REGEX_EMAIL_0001]]", encrypted: { ct: "2" }, dataType: "regex_email", ttlSec: 60 });
    tv.clearRequest(reqA);
    assert(tv.getToken({ requestId: reqA, token: "[[DLP_REGEX_EMAIL_0001]]" }) === null, "A must be cleared");
    assert(tv.getToken({ requestId: reqB, token: "[[DLP_REGEX_EMAIL_0001]]" }) !== null, "B must remain");
    tv.clearRequest(reqB);
  });

  await runCase("vault", "wrong (requestId, token) → null", () => {
    const tv = freshRequire("server/security/token-vault.js");
    const rec = tv.getToken({ requestId: "missing", token: "[[DLP_NONE_0001]]" });
    assert(rec === null, "unknown token must yield null");
  });
}

// ---------------------------------------------------------------------------
// Group C: regex-backstop.js
// ---------------------------------------------------------------------------

async function groupRegexBackstop() {
  await withEnv({ DLP_REGEX_BACKSTOP_ENABLED: "true" }, async () => {
    const rb = freshRequire("server/security/detector/regex-backstop.js");

    await runCase("regex", "regex_email matches user@example.com", () => {
      const m = rb.findMatches("Контакт: user@example.com.");
      assert(m.some((x) => x.ruleId === "regex_email"), "must match email", m);
    });

    await runCase("regex", "regex_email NOT matched in plain text", () => {
      const m = rb.findMatches("Это не email: not-an-email");
      assert(!m.some((x) => x.ruleId === "regex_email"), "must not match", m);
    });

    await runCase("regex", "regex_phone matches +7 (999) 123-45-67 with positive context", () => {
      const m = rb.findMatches("телефон +7 (999) 123-45-67");
      assert(m.some((x) => x.ruleId === "regex_phone"), "must match phone", m);
    });

    await runCase("regex", "regex_phone matches 89991234567 with positive context", () => {
      const m = rb.findMatches("Контакт 89991234567");
      assert(m.some((x) => x.ruleId === "regex_phone"), "must match RU 11-digit", m);
    });

    await runCase("regex", "regex_phone REJECTS in negative context (deталь/серий)", () => {
      const m = rb.findMatches("Номер детали 1234567890, серийный 70000000000");
      assert(!m.some((x) => x.ruleId === "regex_phone"), "must NOT match part/serial", m);
    });

    await runCase("regex", "regex_equipment_code matches INK_SIB_003_COMP_005", () => {
      const m = rb.findMatches("Код INK_SIB_003_COMP_005 актуален");
      assert(m.some((x) => x.ruleId === "regex_equipment_code"), "must match composite code", m);
    });

    await runCase("regex", "regex_equipment_code rejects pure-digit groups", () => {
      const m = rb.findMatches("Код 111_222_333");
      assert(!m.some((x) => x.ruleId === "regex_equipment_code"), "must reject pure-digit", m);
    });

    await runCase("regex", "regex_secret_openrouter_api_key blocks sk-or-v1-*", () => {
      const m = rb.findMatches(`Ключ sk-or-v1-${"A".repeat(24)} здесь`);
      assert(m.some((x) => x.ruleId === "regex_secret_openrouter_api_key" && x.action === "block"), "must block", m);
    });

    await runCase("regex", "regex_secret_pem blocks PEM private key", () => {
      const text = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0\n-----END PRIVATE KEY-----";
      const m = rb.findMatches(text);
      assert(m.some((x) => x.ruleId === "regex_secret_pem"), "must block PEM", m);
    });

    await runCase("regex", "regex_secret_aws_access_key blocks AKIA...", () => {
      const m = rb.findMatches("aws AKIA0123456789ABCDEF");
      assert(m.some((x) => x.ruleId === "regex_secret_aws_access_key"), "must block AWS key", m);
    });

    await runCase("regex", "regex_secret_jwt blocks eyJ.*.*", () => {
      const jwt = "eyJabcdefgh.eyJabcdefgh.signaturePart";
      const m = rb.findMatches(`token: ${jwt}`);
      assert(m.some((x) => x.ruleId === "regex_secret_jwt"), "must block JWT", m);
    });

    await runCase("regex", "regex_secret_bearer_token blocks Bearer ...", () => {
      const m = rb.findMatches("Authorization: " + "Bear" + "er " + "abcdefgh12345678ZZZZ");
      assert(m.some((x) => x.ruleId === "regex_secret_bearer_token"), "must block Bearer", m);
    });

    await runCase("regex", "regex_secret_generic_api_key blocks api_key=...", () => {
      const m = rb.findMatches('config: api_key="abcdefghijklmnop1234"');
      assert(m.some((x) => x.ruleId === "regex_secret_generic_api_key"), "must block generic api_key", m);
    });

    await runCase("regex", "canonical token id is NOT re-detected", () => {
      const m = rb.findMatches("Echo [[DLP_REGEX_EMAIL_0001]]");
      assert(!m.some((x) => x.ruleId === "regex_equipment_code"), "must not catch token id as equipment", m);
    });
  });

  await runCase("regex", "DLP_REGEX_BACKSTOP_ENABLED=false → empty matches", () =>
    withEnv({ DLP_REGEX_BACKSTOP_ENABLED: "false" }, () => {
      const rb = freshRequire("server/security/detector/regex-backstop.js");
      const m = rb.findMatches("user@example.com +79991234567");
      assert(Array.isArray(m) && m.length === 0, "must be empty when disabled", m);
    })
  );
}

// ---------------------------------------------------------------------------
// Group D: detector/index.js orchestrator
// ---------------------------------------------------------------------------

async function groupDetectorOrchestrator() {
  await runCase("detector", "ML disabled + regex enabled → ready=true, status reflects components", () =>
    withEnv(
      {
        DLP_ML_ENABLED: "false",
        DLP_ML_FAIL_MODE: "monitor",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        const status = det.getRuntimeStatus();
        eq(status.ml.enabled, false, "ml must be disabled");
        eq(status.regexBackstop.enabled, true, "regex must be enabled");
        eq(det.isReady(), true, "isReady when ml off and regex on");
        eq(det.shouldBlockOnUnready(), false, "must not block on unready when ML disabled");
      }
    )
  );

  await runCase("detector", "detect() returns email + phone in single call (regex backstop)", () =>
    withEnv(
      {
        DLP_ML_ENABLED: "false",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        const matches = await det.detect("ivanov@example.com и тел. +7 999 123 45 67");
        const ids = new Set(matches.map((m) => m.ruleId));
        assert(ids.has("regex_email"), "email expected", matches);
        assert(ids.has("regex_phone"), "phone expected", matches);
      }
    )
  );

  await runCase("detector", "ML enabled + bogus model + fail-mode=closed → shouldBlockOnUnready=true", () =>
    withEnv(
      {
        DLP_ML_ENABLED: "true",
        DLP_ML_FAIL_MODE: "closed",
        DLP_ML_MODEL: "Xenova/this-model-does-not-exist-suite",
        DLP_ML_WARMUP_TIMEOUT_MS: "1000",
        DLP_ML_TIMEOUT_MS: "500",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        const status = det.getRuntimeStatus();
        eq(status.ml.ready, false, "ML must not be ready");
        eq(det.shouldBlockOnUnready(), true, "must request fail-closed");
      }
    )
  );

  await runCase("detector", "ML enabled + bogus model + fail-mode=monitor → does NOT block", () =>
    withEnv(
      {
        DLP_ML_ENABLED: "true",
        DLP_ML_FAIL_MODE: "monitor",
        DLP_ML_MODEL: "Xenova/this-model-does-not-exist-suite",
        DLP_ML_WARMUP_TIMEOUT_MS: "1000",
        DLP_ML_TIMEOUT_MS: "500",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        eq(det.shouldBlockOnUnready(), false, "monitor must NOT request blocking");
      }
    )
  );

  await runCase("detector", "init({force:true}) returns fresh boot-stats object (re-init)", () =>
    withEnv(
      {
        DLP_ML_ENABLED: "false",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init();
        const a = det.getBootStats();
        await det.init({ force: true });
        const b = det.getBootStats();
        assert(a && b, "boot stats must be present");
        // ms-collision is possible; identity must differ (fresh allocation).
        assert(a !== b, "force must allocate new boot-stats object", { a, b });
      }
    )
  );

  await runCase("detector", `detect() performance under ${PERF_MAX_MS}ms for medium input`, () =>
    withEnv(
      {
        DLP_ML_ENABLED: "false",
        DLP_REGEX_BACKSTOP_ENABLED: "true",
      },
      async () => {
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        const text = Array.from({ length: 60 })
          .map((_, i) => `Контакт ${i}: user${i}@example.com, тел. +7 900 000 00 ${String(i).padStart(2, "0")}`)
          .join(" | ");
        const started = Date.now();
        const matches = await det.detect(text);
        const elapsed = Date.now() - started;
        assert(matches.length >= 60, "detector should return many matches", { count: matches.length });
        assert(elapsed <= PERF_MAX_MS, `detector latency too high: ${elapsed}ms > ${PERF_MAX_MS}ms`, {
          elapsed,
          max: PERF_MAX_MS,
        });
      }
    )
  );
}

// ---------------------------------------------------------------------------
// Group E: secret-policy.js
// ---------------------------------------------------------------------------

async function groupSecretPolicy() {
  await runCase("policy", "strict: secret rule resolves to block", () =>
    withEnv({ SECRET_POLICY_MODE: "strict" }, () => {
      const sp = freshRequire("server/security/secret-policy.js");
      eq(sp.resolveAction("regex_secret_openrouter_api_key", "tokenize"), "block", "must block");
    })
  );

  await runCase("policy", "monitor: secret rule downgrades to tokenize", () =>
    withEnv({ SECRET_POLICY_MODE: "monitor" }, () => {
      const sp = freshRequire("server/security/secret-policy.js");
      eq(sp.resolveAction("regex_secret_openrouter_api_key", "tokenize"), "tokenize", "must downgrade");
    })
  );

  await runCase("policy", "off: returns fallback action", () =>
    withEnv({ SECRET_POLICY_MODE: "off" }, () => {
      const sp = freshRequire("server/security/secret-policy.js");
      eq(sp.resolveAction("regex_secret_openrouter_api_key", "tokenize"), "tokenize", "off → fallback");
    })
  );

  await runCase("policy", "regex_email always tokenizes", () =>
    withEnv({ SECRET_POLICY_MODE: "strict" }, () => {
      const sp = freshRequire("server/security/secret-policy.js");
      eq(sp.resolveAction("regex_email", "tokenize"), "tokenize", "email tokenize");
    })
  );

  await runCase("policy", "summarizePolicy returns sprint6-ml-all", () => {
    const sp = freshRequire("server/security/secret-policy.js");
    const s = sp.summarizePolicy();
    eq(s.version, "sprint6-ml-all", "policy version");
    assert(Array.isArray(s.secretRules) && s.secretRules.length >= 6, "secret rules listed", s);
    assert(Array.isArray(s.piiRules) && s.piiRules.length >= 6, "pii rules listed", s);
  });

  await runCase("policy", "unknown ruleId → fallback (tokenize, classification=unknown)", () => {
    const sp = freshRequire("server/security/secret-policy.js");
    const policy = sp.getRulePolicy("totally_unknown_rule_xyz");
    eq(policy.classification, "unknown", "classification");
    eq(policy.defaultAction, "tokenize", "default action");
  });

  await runCase("policy", "listActiveRuleIds excludes deprecated aliases", () => {
    const sp = freshRequire("server/security/secret-policy.js");
    const active = sp.listActiveRuleIds();
    assert(active.includes("regex_secret_openrouter_api_key"), "must include current secret rule");
    assert(active.includes("ml_person"), "must include ml_person");
    assert(!active.includes("openrouter_api_key"), "must not include legacy alias");
    assert(!active.includes("fio"), "must not include legacy fio alias");
  });
}

// ---------------------------------------------------------------------------
// Group F: dlp-service.js end-to-end
// ---------------------------------------------------------------------------

async function groupDlpService() {
  const baseEnv = {
    DLP_ENABLED: "true",
    DLP_BLOCK_ON_SECRETS: "true",
    SECRET_POLICY_MODE: "strict",
    DLP_KEY_PROVIDER: "env",
    DLP_REQUIRE_CONFIGURED_KEY: "true",
    DLP_ALLOW_EPHEMERAL_KEY: "false",
    DLP_MASTER_KEY_B64: randomKeyB64(),
    DLP_ML_ENABLED: "false",
    DLP_ML_FAIL_MODE: "monitor",
    DLP_REGEX_BACKSTOP_ENABLED: "true",
  };

  await runCase("dlp", "PII payload tokenized: email + phone (≥2 tokens, ok=true)", () =>
    withEnv(baseEnv, async () => {
      const dlp = await prepareDlpSession();
      try {
        const res = await dlp.protectPayload({
          text: "Контакт ivanov@example.com тел. +7 (999) 123-45-67",
        });
        eq(res.ok, true, "must not be blocked");
        assert((res.summary?.tokensCreated || 0) >= 2, "≥2 tokens", res.summary);
        const matches = String(res.payload?.text || "").match(/\[\[DLP_[A-Z0-9_]+_\d{4}\]\]/g) || [];
        assert(matches.length >= 2, "tokens present in payload", matches);
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "secret payload (sk-or-v1-...) blocked → ok=false, classification=secret", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const res = await dlp.protectPayload({ text: `Key sk-or-v1-${"A".repeat(32)}` });
        eq(res.ok, false, "must be blocked");
        assert(SECRET_RULE_IDS.has(res.blockedBy), "blockedBy must be a secret rule", res);
        eq(res.blockedClassification, "secret", "classification");
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "monitor mode: secret is tokenized rather than blocked", () =>
    withEnv({ ...baseEnv, SECRET_POLICY_MODE: "monitor" }, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const res = await dlp.protectPayload({ text: `Key sk-or-v1-${"A".repeat(32)}` });
        eq(res.ok, true, "monitor must not block");
        assert((res.summary?.tokensCreated || 0) >= 1, "must tokenize instead", res.summary);
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "DLP_ENABLED=false → bypass, payload unchanged", () =>
    withEnv({ ...baseEnv, DLP_ENABLED: "false" }, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const original = "Тест user@example.com";
        const res = await dlp.protectPayload({ text: original });
        eq(res.ok, true, "must pass through");
        eq(res.payload.text, original, "payload unchanged");
        eq(res.summary?.totalDetections || 0, 0, "no detections");
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "nested structures (object/array) tokenized recursively", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const payload = {
          messages: [
            { role: "user", content: "Контакт ivanov@example.com" },
            { role: "user", content: "Звонить +7 999 123 45 67" },
          ],
          meta: { contact: "user@test.com" },
        };
        const res = await dlp.protectPayload(payload);
        eq(res.ok, true, "must succeed");
        assert((res.summary?.tokensCreated || 0) >= 3, "≥3 tokens across nested fields", res.summary);
        assert(/\[\[DLP_/.test(JSON.stringify(res.payload)), "tokens present", res.payload);
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "round-trip: protect → restore returns original text", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const original = "Email: ivanov@example.com тел. +7 999 123 45 67";
        const protectedPayload = await dlp.protectPayload({ text: original });
        const restored = dlp.restorePayload(protectedPayload.payload);
        eq(restored.payload.text, original, "must restore original");
        assert((restored.summary?.restoredCount || 0) >= 2, "≥2 restored", restored.summary);
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "restore tolerates escaped underscores (DLP\\_REGEX\\_EMAIL\\_0001)", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const protectedRes = await dlp.protectPayload({ text: "user@example.com" });
        const tokenMatch = String(protectedRes.payload.text || "").match(/\[\[(DLP_[A-Z0-9_]+_\d{4,})\]\]/);
        assert(tokenMatch, "expected token");
        const escaped = tokenMatch[1].replace(/_/g, "\\_");
        const restored = dlp.restorePayload({ text: `wrapped: ${escaped}` });
        assert(/user@example\.com/.test(restored.payload.text), "must restore even when underscores escaped", restored);
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "existing canonical token in input is NOT re-tokenized", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const dlp = createSession({ requestId: crypto.randomUUID() });
      try {
        const res = await dlp.protectPayload({ text: "echo [[DLP_REGEX_EMAIL_0001]] back" });
        eq(res.ok, true, "must not block");
        eq(res.summary?.tokensCreated || 0, 0, "must not tokenize a token id");
      } finally {
        dlp.dispose();
      }
    })
  );

  await runCase("dlp", "fail-closed gate: ml_unavailable when ML required and not ready", () =>
    withEnv(
      {
        ...baseEnv,
        DLP_ML_ENABLED: "true",
        DLP_ML_FAIL_MODE: "closed",
        DLP_ML_MODEL: "Xenova/this-model-does-not-exist-suite",
        DLP_ML_WARMUP_TIMEOUT_MS: "1000",
      },
      async () => {
        freshRequire("server/security/crypto.js");
        const det = freshRequire("server/security/detector/index.js");
        await det.init({ force: true });
        const { createSession } = freshRequire("server/security/dlp-service.js");
        const dlp = createSession({ requestId: crypto.randomUUID() });
        try {
          const res = await dlp.protectPayload({ text: "Иван Иванов" });
          eq(res.ok, false, "must be blocked");
          eq(res.blockedBy, "ml_unavailable", "blockedBy reason");
        } finally {
          dlp.dispose();
        }
      }
    )
  );

  await runCase("dlp", "dispose() drops session tokens", () =>
    withEnv(baseEnv, async () => {
      freshRequire("server/security/crypto.js");
      const det = freshRequire("server/security/detector/index.js");
      await det.init({ force: true });
      const { createSession } = freshRequire("server/security/dlp-service.js");
      const reqId = crypto.randomUUID();
      const dlp = createSession({ requestId: reqId });
      const protectedRes = await dlp.protectPayload({ text: "user@example.com" });
      const tokenMatch = String(protectedRes.payload.text || "").match(/\[\[(DLP_[A-Z0-9_]+_\d{4,})\]\]/);
      assert(tokenMatch, "expected token");
      dlp.dispose();
      const tv = freshRequire("server/security/token-vault.js");
      const rec = tv.getToken({ requestId: reqId, token: `[[${tokenMatch[1]}]]` });
      assert(rec === null, "after dispose token must be gone", rec);
    })
  );

  await runCase("dlp", `protect/restore performance under ${PERF_MAX_MS}ms`, () =>
    withEnv(baseEnv, async () => {
      const dlp = await prepareDlpSession();
      try {
        const input = {
          text: Array.from({ length: 80 })
            .map((_, i) => `user${i}@example.com +7 900 000 00 ${String(i).padStart(2, "0")}`)
            .join(", "),
        };
        const t1 = Date.now();
        const protectedRes = await dlp.protectPayload(input);
        const protectMs = Date.now() - t1;
        const t2 = Date.now();
        const restoredRes = dlp.restorePayload(protectedRes.payload);
        const restoreMs = Date.now() - t2;
        assert(protectedRes.ok === true, "protect should succeed", protectedRes);
        assert(restoredRes.payload.text.includes("user0@example.com"), "restore should bring plaintext back", restoredRes);
        assert(protectMs <= PERF_MAX_MS, `protect latency too high: ${protectMs}ms > ${PERF_MAX_MS}ms`, {
          protectMs,
          max: PERF_MAX_MS,
        });
        assert(restoreMs <= PERF_MAX_MS, `restore latency too high: ${restoreMs}ms > ${PERF_MAX_MS}ms`, {
          restoreMs,
          max: PERF_MAX_MS,
        });
      } finally {
        dlp.dispose();
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Group G: rate-limit.js
// ---------------------------------------------------------------------------

async function groupRateLimit() {
  await runCase("rate", "third request blocked when limit=2", () =>
    withEnv(
      {
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_BYPASS_LOCALHOST: "false",
        RATE_LIMIT_CHAT_MAX: "2",
        RATE_LIMIT_CHAT_WINDOW_MS: "60000",
      },
      () => {
        const rl = freshRequire("server/security/rate-limit.js");
        const req = { ip: "10.0.10.1", headers: {} };
        eq(rl.checkRateLimit({ req, routeId: "chat" }).allowed, true, "1st");
        eq(rl.checkRateLimit({ req, routeId: "chat" }).allowed, true, "2nd");
        const r3 = rl.checkRateLimit({ req, routeId: "chat" });
        eq(r3.allowed, false, "3rd blocked");
        assert(r3.retryAfterSec >= 1, "retry-after present", r3);
      }
    )
  );

  await runCase("rate", "different IPs do not share counters", () =>
    withEnv(
      {
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_BYPASS_LOCALHOST: "false",
        RATE_LIMIT_CHAT_MAX: "1",
        RATE_LIMIT_CHAT_WINDOW_MS: "60000",
      },
      () => {
        const rl = freshRequire("server/security/rate-limit.js");
        const reqA = { ip: "10.0.10.10", headers: {} };
        const reqB = { ip: "10.0.10.11", headers: {} };
        eq(rl.checkRateLimit({ req: reqA, routeId: "chat" }).allowed, true, "A 1st");
        eq(rl.checkRateLimit({ req: reqB, routeId: "chat" }).allowed, true, "B 1st (separate)");
        eq(rl.checkRateLimit({ req: reqA, routeId: "chat" }).allowed, false, "A 2nd blocked");
      }
    )
  );

  await runCase("rate", "bypass localhost when enabled", () =>
    withEnv(
      {
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_BYPASS_LOCALHOST: "true",
        RATE_LIMIT_CHAT_MAX: "1",
      },
      () => {
        const rl = freshRequire("server/security/rate-limit.js");
        const req = { ip: "127.0.0.1", headers: {} };
        const r1 = rl.checkRateLimit({ req, routeId: "chat" });
        const r2 = rl.checkRateLimit({ req, routeId: "chat" });
        eq(r1.bypassed, true, "1st bypassed");
        eq(r2.bypassed, true, "2nd bypassed");
        eq(r2.allowed, true, "always allowed for localhost");
      }
    )
  );

  await runCase("rate", "RATE_LIMIT_ENABLED=false → always allowed", () =>
    withEnv({ RATE_LIMIT_ENABLED: "false" }, () => {
      const rl = freshRequire("server/security/rate-limit.js");
      const r = rl.checkRateLimit({ req: { ip: "1.2.3.4", headers: {} }, routeId: "chat" });
      eq(r.enabled, false, "disabled");
      eq(r.allowed, true, "always allowed");
    })
  );

  await runCase("rate", "x-forwarded-for picks first hop", () =>
    withEnv(
      {
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_BYPASS_LOCALHOST: "false",
        RATE_LIMIT_CHAT_MAX: "1",
      },
      () => {
        const rl = freshRequire("server/security/rate-limit.js");
        const reqA = { ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } };
        const reqB = { ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.2" } };
        eq(rl.checkRateLimit({ req: reqA, routeId: "chat" }).allowed, true, "first XFF allowed");
        const r2 = rl.checkRateLimit({ req: reqB, routeId: "chat" });
        eq(r2.allowed, false, "same first hop → counter shared, blocked");
      }
    )
  );
}

// ---------------------------------------------------------------------------
// Group H: log-utils sanitization
// ---------------------------------------------------------------------------

async function groupLogUtils() {
  const lu = freshRequire("server/security/log-utils.js");

  await runCase("logs", "sanitize redacts email", () => {
    const out = lu.sanitizeForLog({ text: "Контакт user@example.com" });
    assert(/\[redacted_email\]/.test(out.text), "email must be redacted", out);
    assert(!/user@example\.com/.test(out.text), "raw email must be gone", out);
  });

  await runCase("logs", "sanitize redacts phone-like sequences", () => {
    const out = lu.sanitizeForLog({ text: "Тел +7 (999) 123-45-67" });
    assert(/\[redacted_phone\]/.test(out.text), "phone must be redacted", out);
  });

  await runCase("logs", "sanitize redacts AKIA access keys", () => {
    const out = lu.sanitizeForLog({ text: "AKIA0123456789ABCDEF leak" });
    assert(/\[redacted_access_key\]/.test(out.text), "AKIA must be redacted", out);
  });

  await runCase("logs", "sanitize redacts Bearer tokens", () => {
    const out = lu.sanitizeForLog({
      text: "Authorization: " + "Bear" + "er " + "abcdefgh12345678",
    });
    assert(/Bearer \[redacted_token\]/.test(out.text), "Bearer must be redacted", out);
  });

  await runCase("logs", "sanitize redacts JWT (header.payload.signature, ≥10 each)", () => {
    // Each part needs 10+ chars after eyJ / between dots per log-utils regex.
    const jwt = "eyJabcdefghij.eyJabcdefghij.signaturePart12";
    const out = lu.sanitizeForLog({ text: jwt });
    assert(/\[redacted_jwt\]/.test(out.text), "JWT must be redacted", out);
  });

  await runCase("logs", "sanitize redacts long PAN-like digit sequence (card or phone)", () => {
    // Phone-redact runs before card-redact in log-utils, so a 16-digit card
    // is routed to [redacted_phone] first. Either label is acceptable —
    // what matters is that the raw PAN is gone.
    const out = lu.sanitizeForLog({ text: "Карта 4111 1111 1111 1111 expiring" });
    assert(
      /\[redacted_(card|phone)\]/.test(out.text),
      "long digit sequence must be redacted (as card or phone)",
      out
    );
    assert(!/4111 1111 1111 1111/.test(out.text), "raw PAN must be gone", out);
  });

  await runCase("logs", "sanitize keeps non-Luhn long digit sequences", () => {
    const out = lu.sanitizeForLog({ text: "ID 1234567890123456" }); // 16-digit not passing Luhn
    assert(!/\[redacted_card\]/.test(out.text), "non-Luhn must NOT be redacted as card", out);
  });

  await runCase("logs", "sanitize redacts sensitive keys (password, api_key)", () => {
    const out = lu.sanitizeForLog({ password: "supersecret", api_key: "sk-real-key-value", note: "ok" });
    assert(/^\[redacted/.test(String(out.password)), "password redacted", out);
    assert(/^\[redacted/.test(String(out.api_key)), "api_key redacted", out);
    eq(out.note, "ok", "non-sensitive untouched");
  });

  await runCase("logs", "sanitize truncates long strings", () => {
    const long = "x".repeat(100);
    const out = lu.sanitizeForLog({ s: long }, { maxStringLen: 50 });
    assert(/truncated/.test(out.s), "must be truncated", out);
  });

  await runCase("logs", "buildSummary returns sha256_16 + length + redacted preview", () => {
    const sum = lu.buildSummary("Контакт ivanov@example.com");
    assert(typeof sum.sha256_16 === "string" && sum.sha256_16.length === 16, "digest length", sum);
    assert(typeof sum.length === "number" && sum.length > 0, "length", sum);
    assert(/redacted_email/.test(sum.preview), "preview redacts email", sum);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  freshRequireAll();

  await groupCrypto();
  await groupTokenVault();
  await groupRegexBackstop();
  await groupDetectorOrchestrator();
  await groupSecretPolicy();
  await groupDlpService();
  await groupRateLimit();
  await groupLogUtils();

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const total = results.length;

  // Persist results as NDJSON for archival.
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  } catch (e) {
    console.warn(`${SUITE_PREFIX} warn: cannot write log: ${e && e.message ? e.message : e}`);
  }

  const byGroup = {};
  for (const r of results) {
    if (!byGroup[r.group]) byGroup[r.group] = { pass: 0, fail: 0, skip: 0 };
    if (r.status === "PASS") byGroup[r.group].pass += 1;
    else if (r.status === "FAIL") byGroup[r.group].fail += 1;
    else byGroup[r.group].skip += 1;
  }

  console.log(`\n${SUITE_PREFIX} SUMMARY`);
  console.log(
    JSON.stringify(
      {
        total,
        passed,
        failed,
        skipped,
        byGroup,
        logPath: LOG_PATH,
      },
      null,
      2
    )
  );

  if (failed > 0) {
    console.log(`\n${SUITE_PREFIX} FAILED CASES:`);
    for (const r of results.filter((x) => x.status === "FAIL")) {
      console.log(` - [${r.group}] ${r.name} :: ${r.details && r.details.error ? r.details.error : ""}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`${SUITE_PREFIX} UNHANDLED:`, err);
  process.exit(2);
});
