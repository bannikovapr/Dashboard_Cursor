"use strict";

const POLICY_VERSION = "sprint6-ml-all";

const RULE_POLICY = Object.freeze({
  // Secrets — block by default. Coming from regex-backstop and ML.
  regex_secret_openrouter_api_key: { classification: "secret", defaultAction: "block", severity: "critical" },
  regex_secret_generic_api_key: { classification: "secret", defaultAction: "block", severity: "high" },
  regex_secret_bearer_token: { classification: "secret", defaultAction: "block", severity: "high" },
  regex_secret_pem: { classification: "secret", defaultAction: "block", severity: "critical" },
  regex_secret_aws_access_key: { classification: "secret", defaultAction: "block", severity: "critical" },
  regex_secret_jwt: { classification: "secret", defaultAction: "block", severity: "high" },
  ml_secret: { classification: "secret", defaultAction: "block", severity: "high" },

  // Structural PII via regex-backstop (fail-safe coverage).
  regex_email: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  regex_phone: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  regex_equipment_code: { classification: "pii", defaultAction: "tokenize", severity: "medium" },

  // Semantic PII via ML.
  ml_person: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ml_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ml_location: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ml_email: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ml_phone: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ml_equipment_code: { classification: "pii", defaultAction: "tokenize", severity: "medium" },

  // Backward-compat aliases for older log readers / persisted tokens.
  // The new pipeline does not produce these IDs but policy lookups still resolve.
  openrouter_api_key: { classification: "secret", defaultAction: "block", severity: "critical" },
  generic_api_key: { classification: "secret", defaultAction: "block", severity: "high" },
  bearer_token: { classification: "secret", defaultAction: "block", severity: "high" },
  private_key: { classification: "secret", defaultAction: "block", severity: "critical" },
  email: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  phone: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  equipment_code_composite: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_person: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_location: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_employee: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_department: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_installation: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  morph_fio: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  structural_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  structural_location: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  fio: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  company_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  department_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  installation_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
});

// Active rule IDs produced by the current pipeline (excludes back-compat aliases).
const ACTIVE_RULE_IDS = Object.freeze([
  "regex_secret_openrouter_api_key",
  "regex_secret_generic_api_key",
  "regex_secret_bearer_token",
  "regex_secret_pem",
  "regex_secret_aws_access_key",
  "regex_secret_jwt",
  "ml_secret",
  "regex_email",
  "regex_phone",
  "regex_equipment_code",
  "ml_person",
  "ml_org",
  "ml_location",
  "ml_email",
  "ml_phone",
  "ml_equipment_code",
]);

function normalizeMode(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "strict" || v === "monitor" || v === "off") return v;
  return "strict";
}

function currentMode() {
  return normalizeMode(process.env.SECRET_POLICY_MODE || "strict");
}

function listKnownRuleIds() {
  return Object.keys(RULE_POLICY);
}

function listActiveRuleIds() {
  return [...ACTIVE_RULE_IDS];
}

function getRulePolicy(ruleId) {
  return RULE_POLICY[ruleId] || { classification: "unknown", defaultAction: "tokenize", severity: "low" };
}

function resolveAction(ruleId, fallbackAction) {
  const mode = currentMode();
  if (mode === "off") return fallbackAction || "tokenize";

  const policy = getRulePolicy(ruleId);
  const baseAction = policy.defaultAction || fallbackAction || "tokenize";

  if (mode === "monitor" && baseAction === "block") {
    return "tokenize";
  }

  return baseAction;
}

function summarizePolicy() {
  const mode = currentMode();
  const active = ACTIVE_RULE_IDS;
  const secrets = active.filter((id) => getRulePolicy(id).classification === "secret");
  const pii = active.filter((id) => getRulePolicy(id).classification === "pii");
  return {
    version: POLICY_VERSION,
    mode,
    knownRules: active.length,
    secretRules: secrets,
    piiRules: pii,
  };
}

module.exports = {
  POLICY_VERSION,
  listKnownRuleIds,
  listActiveRuleIds,
  getRulePolicy,
  resolveAction,
  summarizePolicy,
};
