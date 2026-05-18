"use strict";

const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function isAuthEnabled() {
  return parseBool(process.env.DASHBOARD_AUTH_ENABLED, false);
}

/**
 * Вызывать перед app.listen. Бросает Error при включённом auth и неверной конфигурации.
 */
function validateConfigAtBoot() {
  if (!isAuthEnabled()) return;
  const secret = (process.env.DASHBOARD_AUTH_SECRET || "").trim();
  const user = (process.env.DASHBOARD_AUTH_USER || "").trim();
  const pass = process.env.DASHBOARD_AUTH_PASSWORD;
  if (!secret || secret.length < 16) {
    throw new Error(
      "DASHBOARD_AUTH_ENABLED=true: задайте DASHBOARD_AUTH_SECRET не короче 16 символов (случайная строка с достаточной энтропией)."
    );
  }
  if (!user) {
    throw new Error("DASHBOARD_AUTH_ENABLED=true: задайте DASHBOARD_AUTH_USER.");
  }
  if (pass == null || String(pass) === "") {
    throw new Error("DASHBOARD_AUTH_ENABLED=true: задайте DASHBOARD_AUTH_PASSWORD.");
  }
}

function hashUtf8(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest();
}

function safeComparePassword(a, b) {
  try {
    return crypto.timingSafeEqual(hashUtf8(a), hashUtf8(b));
  } catch (_) {
    return false;
  }
}

function verifyCredentials(username, password) {
  const u = (process.env.DASHBOARD_AUTH_USER || "").trim();
  const p = process.env.DASHBOARD_AUTH_PASSWORD;
  if (p == null || username == null || password == null) return false;
  if (String(username).trim() !== u) return false;
  return safeComparePassword(password, p);
}

function createToken() {
  const secret = (process.env.DASHBOARD_AUTH_SECRET || "").trim();
  const now = Date.now();
  const payload = { iat: now, exp: now + TOKEN_TTL_MS, v: 1 };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);
  if (!body || !sigStr) return null;
  const secret = (process.env.DASHBOARD_AUTH_SECRET || "").trim();
  if (!secret) return null;
  let sigBuf;
  let expectedBuf;
  try {
    sigBuf = Buffer.from(sigStr, "base64url");
    expectedBuf = crypto.createHmac("sha256", secret).update(body).digest();
  } catch (_) {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

function extractBearer(req) {
  const h = req.headers && req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(\S+)/i);
  return m ? m[1].trim() : null;
}

function requireMiddleware(req, res, next) {
  if (!isAuthEnabled()) return next();
  if (req.method === "OPTIONS") return next();
  const tok = extractBearer(req);
  if (!tok || !verifyToken(tok)) {
    return res.status(401).json({
      ok: false,
      errorCode: "auth_required",
      message: "Требуется вход.",
    });
  }
  return next();
}

module.exports = {
  TOKEN_TTL_MS,
  isAuthEnabled,
  validateConfigAtBoot,
  verifyCredentials,
  createToken,
  verifyToken,
  requireMiddleware,
};
