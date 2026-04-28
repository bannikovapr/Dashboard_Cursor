"use strict";

const crypto = require("crypto");
const { createSession } = require("../server/security/dlp-service");

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

const FIO_RULE_IDS = ["morph_fio", "dictionary_employee", "ner_person", "fio"];
const ORG_RULE_IDS = ["dictionary_org", "structural_org", "ner_org", "company_name"];
const DEPT_RULE_IDS = ["dictionary_department", "department_name"];
const LOC_RULE_IDS = ["dictionary_installation", "structural_location", "ner_location", "installation_name"];

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

async function run() {
  const requestId = crypto.randomUUID();
  const dlp = createSession({ requestId });

  try {
    const rawToolResults = [
      {
        tool: "query_data",
        params: { dataset: "personnel_utilization", limit: 1 },
        result: { rows: [SAMPLE] },
      },
    ];

    const protectedToolResults = await dlp.protectPayload({ toolResults: rawToolResults });
    ensure(protectedToolResults.ok, "toolResults were unexpectedly blocked", protectedToolResults);
    ensure(
      (protectedToolResults.summary?.tokensCreated || 0) >= 6,
      "expected tokenized entities in toolResults",
      protectedToolResults.summary
    );

    const byType = protectedToolResults.summary?.byType || {};
    ensure(totalForRules(byType, FIO_RULE_IDS) >= 1, "FIO tokenization did not trigger (morph/dictionary/ner)", byType);
    ensure((byType.email || 0) >= 1, "email tokenization did not trigger", byType);
    ensure((byType.phone || 0) >= 1, "phone tokenization did not trigger", byType);
    ensure(totalForRules(byType, ORG_RULE_IDS) >= 1, "organization tokenization did not trigger", byType);
    ensure(totalForRules(byType, DEPT_RULE_IDS) >= 1, "department tokenization did not trigger", byType);
    ensure(totalForRules(byType, LOC_RULE_IDS) >= 1, "installation tokenization did not trigger", byType);
    ensure(
      (byType.equipment_code_composite || 0) >= 1,
      "equipment_code_composite tokenization did not trigger",
      byType
    );

    const encodedToolResults = protectedToolResults.payload?.toolResults || [];
    const encodedText = JSON.stringify(encodedToolResults);
    ensure(countTokens(encodedText) >= 6, "token placeholders were not created in encoded toolResults", encodedToolResults);
    ensure(
      encodedText.includes(SAMPLE.equipment_name),
      "generic equipment name should not be tokenized",
      encodedToolResults
    );

    const tokenMatches = encodedText.match(TOKEN_RE) || [];
    const fioToken = findToken(tokenMatches, FIO_RULE_IDS);
    const emailToken = tokenMatches.find((t) => t.includes("DLP_EMAIL_"));
    const phoneToken = tokenMatches.find((t) => t.includes("DLP_PHONE_"));
    const orgToken = findToken(tokenMatches, ORG_RULE_IDS);
    const deptToken = findToken(tokenMatches, DEPT_RULE_IDS);
    const locToken = findToken(tokenMatches, LOC_RULE_IDS);
    const equipmentCodeToken = tokenMatches.find((t) => t.includes("DLP_EQUIPMENT_CODE_COMPOSITE_"));

    ensure(
      fioToken && emailToken && phoneToken && orgToken && deptToken && locToken && equipmentCodeToken,
      "failed to locate expected token types",
      tokenMatches
    );

    const fioTokenId = unwrapToken(fioToken);
    const emailTokenId = unwrapToken(emailToken);
    const phoneTokenId = unwrapToken(phoneToken);
    const orgTokenId = unwrapToken(orgToken);
    const deptTokenId = unwrapToken(deptToken);
    const locTokenId = unwrapToken(locToken);
    const equipmentCodeTokenId = unwrapToken(equipmentCodeToken);

    const genericEquipmentPayload = await dlp.protectPayload({ text: SAMPLE.equipment_name });
    ensure(genericEquipmentPayload.ok, "generic equipment payload was unexpectedly blocked", genericEquipmentPayload);
    ensure(
      (genericEquipmentPayload.summary?.tokensCreated || 0) === 0,
      "generic equipment payload should not be tokenized",
      genericEquipmentPayload.summary
    );
    ensure(
      genericEquipmentPayload.payload?.text === SAMPLE.equipment_name,
      "generic equipment payload should remain unchanged",
      genericEquipmentPayload.payload
    );
    const genericInstallationPayload = await dlp.protectPayload({
      text: "Установка компрессорная основная требует диагностики",
    });
    ensure(genericInstallationPayload.ok, "generic installation payload was unexpectedly blocked", genericInstallationPayload);
    ensure(
      (genericInstallationPayload.summary?.tokensCreated || 0) === 0,
      "generic installation phrase should not be tokenized",
      genericInstallationPayload.summary
    );

    const serialLikePayload = await dlp.protectPayload({
      text: "Номер детали 1234567890, серийный 70000000000",
    });
    ensure(serialLikePayload.ok, "serial-like payload was unexpectedly blocked", serialLikePayload);
    ensure(
      (serialLikePayload.summary?.byType?.phone || 0) === 0,
      "serial/detail numbers should not be tokenized as phone",
      serialLikePayload.summary
    );
    ensure(
      (serialLikePayload.summary?.tokensCreated || 0) === 0,
      "serial/detail numbers should remain unchanged",
      serialLikePayload.summary
    );

    const dlpTokenEchoPayload = await dlp.protectPayload({
      toolResults: [{ tool: "echo", result: { text: `Echo token refs: ${fioToken}, ${emailToken}` } }],
    });
    ensure(dlpTokenEchoPayload.ok, "DLP token echo payload was unexpectedly blocked", dlpTokenEchoPayload);
    ensure(
      (dlpTokenEchoPayload.summary?.byType?.equipment_code_composite || 0) === 0,
      "existing DLP tokens must not be re-tokenized as equipment_code_composite",
      dlpTokenEchoPayload.summary
    );
    ensure(
      String(dlpTokenEchoPayload.payload?.toolResults?.[0]?.result?.text || "").includes(fioToken),
      "existing DLP token reference should remain unchanged in protected payload",
      dlpTokenEchoPayload.payload
    );

    const agentOutputWithTokens = {
      answer: {
        fact: `Сотрудник ${fioToken} выполнил работы на ${locToken}. Контакт: ${emailToken}, ${phoneToken}.`,
        conclusion: "Данные по сотруднику доступны.",
        action: `Сверьте ${orgToken}, ${deptToken} и код ${equipmentCodeToken} с графиком по месяцам.`,
      },
      artifacts: [
        {
          type: "table",
          title: "Test detokenize artifacts",
          columns: [
            { key: "employee", label: "Сотрудник" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Телефон" },
            { key: "company", label: "Компания" },
            { key: "department", label: "Подразделение" },
            { key: "installation", label: "Установка" },
            { key: "equipment_code", label: "Код" },
            { key: "equipment_name", label: "Оборудование" },
          ],
          rows: [
            {
              employee: fioToken,
              email: emailToken,
              phone: phoneToken,
              company: orgToken,
              department: deptToken,
              installation: locToken,
              equipment_code: equipmentCodeToken,
              equipment_name: SAMPLE.equipment_name,
            },
          ],
        },
      ],
      trace: { steps: 1, toolsUsed: ["query_data"] },
    };

    const restored = dlp.restorePayload(agentOutputWithTokens);
    ensure(!containsTokenDeep(restored.payload), "token placeholders remained after restore", restored.payload);
    ensure(
      restored.payload?.answer?.fact?.includes(SAMPLE.employee),
      "FIO was not restored in answer.fact",
      restored.payload?.answer
    );

    const restoredRow = restored.payload?.artifacts?.[0]?.rows?.[0] || {};
    ensure(restoredRow.email === SAMPLE.email, "email was not restored in artifacts", restoredRow);
    ensure(String(restoredRow.phone || "").includes("999"), "phone was not restored in artifacts", restoredRow);
    ensure(restoredRow.company === SAMPLE.organization, "organization was not restored in artifacts", restoredRow);
    ensure(restoredRow.department === SAMPLE.department, "department was not restored in artifacts", restoredRow);
    ensure(restoredRow.installation === SAMPLE.installation, "installation was not restored in artifacts", restoredRow);
    ensure(
      restoredRow.equipment_code === SAMPLE.equipment_code,
      "equipment_code was not restored in artifacts",
      restoredRow
    );
    ensure(
      restoredRow.equipment_name === SAMPLE.equipment_name,
      "generic equipment name should remain unchanged in artifacts",
      restoredRow
    );

    const modelOutputWithTokenVariants = {
      answer: {
        fact:
          `Raw token ids: ${fioTokenId}, ` +
          `escaped: ${escapeTokenUnderscore(phoneTokenId)}, ` +
          `lower: ${emailTokenId.toLowerCase()}.`,
        conclusion: `Org token: ${orgTokenId}, dept token: ${deptTokenId}.`,
        action: `Check installation ${locTokenId} and code ${equipmentCodeTokenId}.`,
      },
      artifacts: [],
      trace: { steps: 1, toolsUsed: [] },
    };
    const restoredVariants = dlp.restorePayload(modelOutputWithTokenVariants);
    ensure(!containsTokenDeep(restoredVariants.payload), "token variants remained after restore", restoredVariants.payload);
    ensure(
      String(restoredVariants.payload?.answer?.fact || "").includes(SAMPLE.employee),
      "bare token id variant was not restored",
      restoredVariants.payload?.answer
    );
    ensure(
      String(restoredVariants.payload?.answer?.fact || "").includes(SAMPLE.phone),
      "escaped token variant was not restored",
      restoredVariants.payload?.answer
    );
    ensure(
      String(restoredVariants.payload?.answer?.fact || "").includes(SAMPLE.email),
      "lowercase token variant was not restored",
      restoredVariants.payload?.answer
    );

    console.log(`${SMOKE_PREFIX} OK`);
    console.log(
      JSON.stringify(
        {
          tokensCreated: protectedToolResults.summary?.tokensCreated || 0,
          byType,
          restoredCount: restored.summary?.restoredCount || 0,
          missingTokens: restored.summary?.missingTokens || 0,
          decryptErrors: restored.summary?.decryptErrors || 0,
        },
        null,
        2
      )
    );
  } finally {
    dlp.dispose();
  }
}

run().catch((err) => {
  console.error(`${SMOKE_PREFIX} UNHANDLED:`, err);
  process.exit(1);
});
