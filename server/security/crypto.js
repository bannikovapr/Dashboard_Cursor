"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey = null;
let cachedKeyStatus = null;
let warnedEphemeral = false;
let providerLogged = false;

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function normalizeProvider(value) {
  const v = String(value || "auto").trim().toLowerCase();
  if (v === "env" || v === "vault" || v === "kms" || v === "auto") return v;
  return "auto";
}

function hash16(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

function materialFromStrings({ b64, hex, plain }) {
  if (b64) {
    const raw = Buffer.from(String(b64).trim(), "base64");
    if (raw.length === KEY_BYTES) return raw;
  }
  if (hex) {
    const raw = Buffer.from(String(hex).trim(), "hex");
    if (raw.length === KEY_BYTES) return raw;
  }
  if (plain) {
    return crypto.createHash("sha256").update(String(plain).trim(), "utf8").digest();
  }
  return null;
}

function readKeyMaterialFile(filePath) {
  const resolved = path.resolve(String(filePath || "").trim());
  if (!resolved) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const text = fs.readFileSync(resolved, "utf8");
  const raw = String(text || "").trim();
  if (!raw) return null;

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      return materialFromStrings({
        b64: parsed?.key_b64 || parsed?.b64 || parsed?.value_b64,
        hex: parsed?.key_hex || parsed?.hex || parsed?.value_hex,
        plain: parsed?.key || parsed?.plain || parsed?.value,
      });
    } catch {
      return null;
    }
  }
  return materialFromStrings({ b64: raw, hex: raw, plain: raw });
}

function loadProviderFromEnv(provider) {
  const p = normalizeProvider(provider);
  if (p === "env") {
    const keyFromVars = materialFromStrings({
      b64: process.env.DLP_MASTER_KEY_B64,
      hex: process.env.DLP_MASTER_KEY_HEX,
      plain: process.env.DLP_MASTER_KEY,
    });
    if (keyFromVars) {
      return { key: keyFromVars, status: { source: "env:DLP_MASTER_KEY_*", provider: p, configured: true } };
    }
    const filePath = (process.env.DLP_MASTER_KEY_FILE || "").trim();
    if (filePath) {
      const keyFromFile = readKeyMaterialFile(filePath);
      if (keyFromFile) {
        return {
          key: keyFromFile,
          status: {
            source: "file:DLP_MASTER_KEY_FILE",
            provider: p,
            configured: true,
            fileDigest16: hash16(path.resolve(filePath)),
          },
        };
      }
    }
    return null;
  }

  if (p === "vault") {
    const keyFromVars = materialFromStrings({
      b64: process.env.DLP_VAULT_KEY_B64 || process.env.VAULT_DLP_MASTER_KEY_B64,
      hex: process.env.DLP_VAULT_KEY_HEX || process.env.VAULT_DLP_MASTER_KEY_HEX,
      plain: process.env.DLP_VAULT_KEY || process.env.VAULT_DLP_MASTER_KEY,
    });
    if (keyFromVars) {
      return { key: keyFromVars, status: { source: "env:DLP_VAULT_KEY_*", provider: p, configured: true } };
    }
    const filePath = (process.env.DLP_VAULT_KEY_FILE || "").trim();
    if (filePath) {
      const keyFromFile = readKeyMaterialFile(filePath);
      if (keyFromFile) {
        return {
          key: keyFromFile,
          status: {
            source: "file:DLP_VAULT_KEY_FILE",
            provider: p,
            configured: true,
            fileDigest16: hash16(path.resolve(filePath)),
          },
        };
      }
    }
    return null;
  }

  if (p === "kms") {
    const keyFromVars = materialFromStrings({
      b64: process.env.DLP_KMS_KEY_B64 || process.env.KMS_DLP_MASTER_KEY_B64,
      hex: process.env.DLP_KMS_KEY_HEX || process.env.KMS_DLP_MASTER_KEY_HEX,
      plain: process.env.DLP_KMS_KEY || process.env.KMS_DLP_MASTER_KEY,
    });
    if (keyFromVars) {
      return { key: keyFromVars, status: { source: "env:DLP_KMS_KEY_*", provider: p, configured: true } };
    }
    const filePath = (process.env.DLP_KMS_KEY_FILE || "").trim();
    if (filePath) {
      const keyFromFile = readKeyMaterialFile(filePath);
      if (keyFromFile) {
        return {
          key: keyFromFile,
          status: {
            source: "file:DLP_KMS_KEY_FILE",
            provider: p,
            configured: true,
            fileDigest16: hash16(path.resolve(filePath)),
          },
        };
      }
    }
    return null;
  }

  return null;
}

function loadConfiguredKey() {
  const provider = normalizeProvider(process.env.DLP_KEY_PROVIDER || "auto");
  if (provider === "auto") {
    const order = ["env", "vault", "kms"];
    for (const item of order) {
      const loaded = loadProviderFromEnv(item);
      if (loaded && loaded.key) {
        return {
          key: loaded.key,
          status: {
            ...loaded.status,
            providerRequested: "auto",
          },
        };
      }
    }
    return null;
  }

  const loaded = loadProviderFromEnv(provider);
  if (!loaded || !loaded.key) return null;
  return {
    key: loaded.key,
    status: {
      ...loaded.status,
      providerRequested: provider,
    },
  };
}

function logProviderStatusOnce(status) {
  if (providerLogged) return;
  providerLogged = true;
  console.info(
    JSON.stringify({
      level: "info",
      event: "dlp_key_provider_selected",
      provider: status?.provider || "unknown",
      providerRequested: status?.providerRequested || "auto",
      source: status?.source || "unknown",
      ephemeral: Boolean(status?.ephemeral),
      configured: Boolean(status?.configured),
    })
  );
}

function getKey() {
  if (cachedKey) return cachedKey;

  const loaded = loadConfiguredKey();
  if (loaded && loaded.key) {
    cachedKey = loaded.key;
    cachedKeyStatus = {
      configured: true,
      ephemeral: false,
      provider: loaded.status.provider,
      providerRequested: loaded.status.providerRequested || loaded.status.provider,
      source: loaded.status.source,
      fileDigest16: loaded.status.fileDigest16 || null,
      keyDigest16: hash16(loaded.key.toString("base64")),
      rolloutStage: String(process.env.DLP_EPHEMERAL_ROLLOUT_STAGE || "transition"),
    };
    logProviderStatusOnce(cachedKeyStatus);
    return cachedKey;
  }

  const allowEphemeral = parseBool(process.env.DLP_ALLOW_EPHEMERAL_KEY, true);
  const requireConfigured = parseBool(process.env.DLP_REQUIRE_CONFIGURED_KEY, false);
  if (requireConfigured || !allowEphemeral) {
    throw new Error("DLP master key is not configured");
  }
  cachedKey = crypto.randomBytes(KEY_BYTES);
  cachedKeyStatus = {
    configured: false,
    ephemeral: true,
    provider: "ephemeral",
    providerRequested: normalizeProvider(process.env.DLP_KEY_PROVIDER || "auto"),
    source: "ephemeral:random",
    fileDigest16: null,
    keyDigest16: hash16(cachedKey.toString("base64")),
    rolloutStage: String(process.env.DLP_EPHEMERAL_ROLLOUT_STAGE || "transition"),
    deprecationTarget: String(process.env.DLP_EPHEMERAL_DISABLE_AFTER || "next-release"),
  };
  logProviderStatusOnce(cachedKeyStatus);
  if (!warnedEphemeral) {
    warnedEphemeral = true;
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "dlp_ephemeral_key_enabled",
        message:
          "DLP runs with ephemeral key. This mode is transitional and must be disabled in production.",
      })
    );
  }
  return cachedKey;
}

function getKeyStatus() {
  if (cachedKeyStatus) return { ...cachedKeyStatus };
  try {
    getKey();
    return cachedKeyStatus ? { ...cachedKeyStatus } : null;
  } catch (e) {
    return {
      configured: false,
      ephemeral: false,
      provider: normalizeProvider(process.env.DLP_KEY_PROVIDER || "auto"),
      providerRequested: normalizeProvider(process.env.DLP_KEY_PROVIDER || "auto"),
      source: "unavailable",
      error: String(e && e.message ? e.message : e).slice(0, 160),
    };
  }
}

function encryptText(plainText, aad) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  if (aad) {
    cipher.setAAD(Buffer.from(String(aad), "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: ALGO,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  };
}

function decryptText(payload, aad) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid encrypted payload");
  }
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ct = Buffer.from(payload.ct, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  if (aad) {
    decipher.setAAD(Buffer.from(String(aad), "utf8"));
  }
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

module.exports = {
  encryptText,
  decryptText,
  getKeyStatus,
};
