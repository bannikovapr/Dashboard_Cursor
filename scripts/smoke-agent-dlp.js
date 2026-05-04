"use strict";

const crypto = require("crypto");

const SMOKE_PREFIX = "[SMOKE][agent-dlp]";
const TOKEN_RE = /\[\[DLP_[A-Z0-9_]+_\d{4,}\]\]/g;
const TOKEN_REF_RE = /(?:\[\[\s*DLP(?:\\?_[A-Z0-9]+)+\s*\]\])|(?<![A-Z0-9_])DLP(?:\\?_[A-Z0-9]+)+(?![A-Z0-9_])/i;

const SAMPLE = {
  employee: "Иванов Иван Иванович",
  email: "ivanov@example.com",
  phone: "+7 (999) 123-45-67",
  organization: "ООО СибИнк Сервис",
  department: "Отдел капитального строительства",
  installation: "Площадка Усть-каменогорская",
  equipment_code: "INK_SIB_003_COMP_005",
  equipment_name: "Компрессор центробежный Siemens",
};

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

function countTokens(text) {
  TOKEN_RE.lastIndex = 0;
  const m = String(text || "").match(TOKEN_RE);
  return Array.isArray(m) ? m.length : 0;
}

function unwrapToken(token) {
  return String(token || "").replace(/^\[\[/, "").replace(/\]\]$/, "");
}

function escapeTokenUnderscore(tokenId) {
  return String(tokenId || "").replace(/_/g, "\\_");
}

function containsTokenDeep(node) {
  if (typeof node === "string") {
    return TOKEN_REF_RE.test(node);
  }
  if (Array.isArray(node)) return node.some((x) => containsTokenDeep(x));
  if (node && typeof node === "object") return Object.values(node).some((x) => containsTokenDeep(x));
  return false;
}

function totalForRules(byType, ruleIds) {
  let total = 0;
  for (const id of ruleIds) {
    total += Number(byType?.[id]) || 0;
  }
  return total;
}

function findToken(tokenMatches, ruleIds) {
  const upper = ruleIds.map((id) => `DLP_${String(id).toUpperCase()}`);
  return tokenMatches.find((t) => upper.some((prefix) => t.includes(prefix))) || null;
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
  return Promise.resolve(fn()).finally(() => {
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

async function run() {
  await withEnv(
    {
      DLP_ENABLED: "true",
      DLP_BLOCK_ON_SECRETS: "true",
      SECRET_POLICY_MODE: "strict",
      DLP_KEY_PROVIDER: "env",
      DLP_ALLOW_EPHEMERAL_KEY: "true",
      DLP_REQUIRE_CONFIGURED_KEY: "false",
      DLP_MASTER_KEY_B64: crypto.randomBytes(32).toString("base64"),
      // ML offline, regex backstop on. Smoke covers regex-only path explicitly.
      DLP_ML_ENABLED: "false",
      DLP_ML_FAIL_MODE: "monitor",
      DLP_REGEX_BACKSTOP_ENABLED: "true",
    },
    async () => {
      const detectorAbs = require.resolve("../server/security/detector/index.js");
      delete require.cache[detectorAbs];
      const dlpAbs = require.resolve("../server/security/dlp-service.js");
      delete require.cache[dlpAbs];
      const cryptoAbs = require.resolve("../server/security/crypto.js");
      delete require.cache[cryptoAbs];

      const det = require(detectorAbs);
      await det.init({ force: true });
      const { createSession } = require(dlpAbs);

      const requestId = crypto.randomUUID();
      const dlp = createSession({ requestId });

      try {
        // 1. Structural PII gets tokenized via regex backstop.
        const piiText = `Контакт ${SAMPLE.employee}, тел. ${SAMPLE.phone}, email ${SAMPLE.email}, код ${SAMPLE.equipment_code}`;
        const protectedPii = await dlp.protectPayload({ text: piiText });
        ensure(protectedPii.ok, "structural PII payload was unexpectedly blocked", protectedPii);
        ensure(
          totalForRules(protectedPii.summary?.byType, EMAIL_RULE_IDS) >= 1,
          "email tokenization did not trigger",
          protectedPii.summary
        );
        ensure(
          totalForRules(protectedPii.summary?.byType, PHONE_RULE_IDS) >= 1,
          "phone tokenization did not trigger",
          protectedPii.summary
        );
        ensure(
          totalForRules(protectedPii.summary?.byType, EQUIPMENT_CODE_RULE_IDS) >= 1,
          "equipment_code tokenization did not trigger",
          protectedPii.summary
        );

        const protectedText = String(protectedPii.payload?.text || "");
        ensure(
          countTokens(protectedText) >= 3,
          "expected at least 3 token placeholders in protected payload",
          protectedText
        );

        const tokenMatches = protectedText.match(TOKEN_RE) || [];
        const emailToken = tokenMatches.find((t) => t.includes("DLP_REGEX_EMAIL_") || t.includes("DLP_EMAIL_"));
        const phoneToken = tokenMatches.find((t) => t.includes("DLP_REGEX_PHONE_") || t.includes("DLP_PHONE_"));
        const equipmentToken = findToken(tokenMatches, EQUIPMENT_CODE_RULE_IDS);
        ensure(emailToken && phoneToken && equipmentToken, "expected email/phone/equipment_code tokens", tokenMatches);

        // 2. Generic equipment name remains unmasked (no FIO/ORG layers active).
        const genericEquipmentPayload = await dlp.protectPayload({ text: SAMPLE.equipment_name });
        ensure(genericEquipmentPayload.ok, "generic equipment payload was unexpectedly blocked", genericEquipmentPayload);
        ensure(
          (genericEquipmentPayload.summary?.tokensCreated || 0) === 0,
          "generic equipment payload should not be tokenized when ML is off",
          genericEquipmentPayload.summary
        );
        ensure(
          genericEquipmentPayload.payload?.text === SAMPLE.equipment_name,
          "generic equipment payload should remain unchanged",
          genericEquipmentPayload.payload
        );

        // 3. Negative-context numbers are not tokenized as phone.
        const serialLikePayload = await dlp.protectPayload({
          text: "Номер детали 1234567890, серийный 70000000000",
        });
        ensure(serialLikePayload.ok, "serial-like payload was unexpectedly blocked", serialLikePayload);
        ensure(
          totalForRules(serialLikePayload.summary?.byType, PHONE_RULE_IDS) === 0,
          "serial/detail numbers should not be tokenized as phone",
          serialLikePayload.summary
        );

        // 4. Existing DLP token references must not be re-tokenized.
        const dlpTokenEcho = await dlp.protectPayload({
          toolResults: [{ tool: "echo", result: { text: `Echo token refs: ${emailToken}, ${phoneToken}` } }],
        });
        ensure(dlpTokenEcho.ok, "DLP token echo payload was unexpectedly blocked", dlpTokenEcho);
        ensure(
          totalForRules(dlpTokenEcho.summary?.byType, EQUIPMENT_CODE_RULE_IDS) === 0,
          "existing DLP tokens must not be re-tokenized as equipment_code",
          dlpTokenEcho.summary
        );

        // 5. Secrets get blocked across multiple shapes (defense in depth).
        const secretPayloads = [
          { name: "openrouter_key", text: `Key sk-or-v1-${"A".repeat(32)}` },
          { name: "pem_private_key", text: "PEM:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----" },
          { name: "bearer_token", text: `Authorization: Bearer ${"Z".repeat(24)}` },
        ];
        for (const sp of secretPayloads) {
          const result = await dlp.protectPayload({ text: sp.text });
          ensure(!result.ok, `secret '${sp.name}' must be blocked`, result);
          ensure(
            SECRET_RULE_IDS.includes(result.blockedBy),
            `secret '${sp.name}' blockedBy must be a known secret ruleId`,
            result
          );
        }

        // 6. Round-trip: tokenize → restore.
        const restored = dlp.restorePayload({ text: protectedText });
        ensure(!containsTokenDeep(restored.payload), "token placeholders remained after restore", restored.payload);
        ensure(
          String(restored.payload?.text || "").includes(SAMPLE.email),
          "email was not restored",
          restored.payload
        );
        ensure(
          String(restored.payload?.text || "").includes("999"),
          "phone digits were not restored",
          restored.payload
        );
        ensure(
          String(restored.payload?.text || "").includes(SAMPLE.equipment_code),
          "equipment_code was not restored",
          restored.payload
        );

        // 7. Restore tolerates token id variants (escaped underscore, lowercase).
        const variantsPayload = {
          text:
            `Variants: ${unwrapToken(emailToken)}, ` +
            `escaped: ${escapeTokenUnderscore(unwrapToken(phoneToken))}, ` +
            `lower: ${unwrapToken(equipmentToken).toLowerCase()}`,
        };
        const restoredVariants = dlp.restorePayload(variantsPayload);
        ensure(
          !containsTokenDeep(restoredVariants.payload),
          "token id variants remained after restore",
          restoredVariants.payload
        );

        console.log(`${SMOKE_PREFIX} OK`);
        console.log(
          JSON.stringify(
            {
              policy: protectedPii.summary?.policy?.version || null,
              tokensCreated: protectedPii.summary?.tokensCreated || 0,
              byType: protectedPii.summary?.byType || {},
              bySource: protectedPii.summary?.bySource || {},
              restoredCount: restored.summary?.restoredCount || 0,
              missingTokens: restored.summary?.missingTokens || 0,
            },
            null,
            2
          )
        );
      } finally {
        dlp.dispose();
      }
    }
  );
}

run().catch((err) => {
  console.error(`${SMOKE_PREFIX} UNHANDLED:`, err);
  process.exit(1);
});
