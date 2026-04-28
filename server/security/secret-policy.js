"use strict";

const POLICY_VERSION = "sprint5-hybrid";

const RULE_POLICY = Object.freeze({
  // Secrets (block by default).
  openrouter_api_key: { classification: "secret", defaultAction: "block", severity: "critical" },
  generic_api_key: { classification: "secret", defaultAction: "block", severity: "high" },
  bearer_token: { classification: "secret", defaultAction: "block", severity: "high" },
  private_key: { classification: "secret", defaultAction: "block", severity: "critical" },

  // Pattern-based PII (kept after hybrid migration).
  email: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  phone: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  equipment_code_composite: { classification: "pii", defaultAction: "tokenize", severity: "medium" },

  // Hybrid detector layers (replaces strict-list legacy rules).
  dictionary_employee: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_department: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  dictionary_installation: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  morph_fio: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  structural_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  structural_location: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_person: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_org: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  ner_location: { classification: "pii", defaultAction: "tokenize", severity: "medium" },

  // Legacy aliases kept for backward compatibility with older logs/tokens
  // (not produced by the new detector, but recognized by policy lookups).
  fio: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  company_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  department_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
  installation_name: { classification: "pii", defaultAction: "tokenize", severity: "medium" },
});

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
  const known = listKnownRuleIds();
  const secrets = known.filter((id) => getRulePolicy(id).classification === "secret");
  const pii = known.filter((id) => getRulePolicy(id).classification === "pii");
  return {
    version: POLICY_VERSION,
    mode,
    knownRules: known.length,
    secretRules: secrets,
    piiRules: pii,
  };
}

module.exports = {
  POLICY_VERSION,
  listKnownRuleIds,
  getRulePolicy,
  resolveAction,
  summarizePolicy,
};
