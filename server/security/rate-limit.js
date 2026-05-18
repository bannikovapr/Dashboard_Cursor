"use strict";

const crypto = require("crypto");
const LIMITS = new Map();
const LAST_SWEEP_BY_ROUTE = new Map();
const MIN_SWEEP_INTERVAL_MS = 30 * 1000;

function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "off", "no"].includes(v);
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function routeKey(routeId) {
  return String(routeId || "default").trim().toLowerCase();
}

function resolveLimit(routeId) {
  const normalized = routeKey(routeId);
  const common = parsePositiveInt(process.env.RATE_LIMIT_MAX, 120);
  if (normalized === "chat") {
    return parsePositiveInt(process.env.RATE_LIMIT_CHAT_MAX, common);
  }
  if (normalized === "agent") {
    return parsePositiveInt(process.env.RATE_LIMIT_AGENT_MAX, common);
  }
  if (normalized === "report_edit") {
    const chat = parsePositiveInt(process.env.RATE_LIMIT_CHAT_MAX, common);
    return parsePositiveInt(process.env.RATE_LIMIT_REPORT_EDIT_MAX, chat);
  }
  return common;
}

function resolveWindowMs(routeId) {
  const normalized = routeKey(routeId);
  const common = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000);
  if (normalized === "chat") {
    return parsePositiveInt(process.env.RATE_LIMIT_CHAT_WINDOW_MS, common);
  }
  if (normalized === "agent") {
    return parsePositiveInt(process.env.RATE_LIMIT_AGENT_WINDOW_MS, common);
  }
  if (normalized === "report_edit") {
    return parsePositiveInt(process.env.RATE_LIMIT_REPORT_EDIT_WINDOW_MS, common);
  }
  return common;
}

function getClientIp(req) {
  const xff = req?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0] || "").split(",")[0].trim();
  }
  return String(req?.ip || req?.socket?.remoteAddress || "unknown");
}

function isLocalIp(ip) {
  const v = String(ip || "").toLowerCase();
  if (!v) return false;
  if (v === "::1" || v === "127.0.0.1" || v === "::ffff:127.0.0.1") return true;
  return false;
}

function digest16(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

function shouldBypass(req) {
  const bypassLocal = parseBool(process.env.RATE_LIMIT_BYPASS_LOCALHOST, true);
  if (!bypassLocal) return false;
  return isLocalIp(getClientIp(req));
}

function maybeSweep(routeId, nowTs) {
  const route = routeKey(routeId);
  const lastSweep = LAST_SWEEP_BY_ROUTE.get(route) || 0;
  if (nowTs - lastSweep < MIN_SWEEP_INTERVAL_MS) return;
  LAST_SWEEP_BY_ROUTE.set(route, nowTs);

  for (const [key, record] of LIMITS.entries()) {
    if (!record) {
      LIMITS.delete(key);
      continue;
    }
    if (record.routeId !== route) continue;
    if (record.resetAt <= nowTs) {
      LIMITS.delete(key);
    }
  }
}

function checkRateLimit({ req, routeId }) {
  const enabled = parseBool(process.env.RATE_LIMIT_ENABLED, true);
  if (!enabled) {
    return {
      enabled: false,
      applied: false,
      allowed: true,
      bypassed: false,
      routeId: routeKey(routeId),
    };
  }

  const route = routeKey(routeId);
  const limit = resolveLimit(route);
  const windowMs = resolveWindowMs(route);
  const nowTs = Date.now();
  maybeSweep(route, nowTs);

  if (shouldBypass(req)) {
    return {
      enabled: true,
      applied: false,
      allowed: true,
      bypassed: true,
      routeId: route,
      limit,
      remaining: limit,
      windowMs,
      retryAfterSec: 0,
      resetAt: nowTs + windowMs,
      keyDigest: "localhost",
    };
  }

  const ip = getClientIp(req);
  const keySource = `${route}:${ip}`;
  const keyDigest = digest16(keySource);
  const mapKey = `rate:${route}:${keyDigest}`;

  let record = LIMITS.get(mapKey);
  if (!record || record.resetAt <= nowTs) {
    record = {
      routeId: route,
      used: 0,
      resetAt: nowTs + windowMs,
    };
    LIMITS.set(mapKey, record);
  }

  record.used += 1;
  const remaining = Math.max(0, limit - record.used);
  const allowed = record.used <= limit;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((record.resetAt - nowTs) / 1000));

  return {
    enabled: true,
    applied: true,
    allowed,
    bypassed: false,
    routeId: route,
    limit,
    remaining,
    windowMs,
    retryAfterSec,
    resetAt: record.resetAt,
    keyDigest,
  };
}

function summarizeRateLimit() {
  return {
    enabled: parseBool(process.env.RATE_LIMIT_ENABLED, true),
    bypassLocalhost: parseBool(process.env.RATE_LIMIT_BYPASS_LOCALHOST, true),
    defaults: {
      limit: parsePositiveInt(process.env.RATE_LIMIT_MAX, 120),
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    },
    routes: {
      chat: {
        limit: resolveLimit("chat"),
        windowMs: resolveWindowMs("chat"),
      },
      agent: {
        limit: resolveLimit("agent"),
        windowMs: resolveWindowMs("agent"),
      },
    },
  };
}

module.exports = {
  checkRateLimit,
  summarizeRateLimit,
};
