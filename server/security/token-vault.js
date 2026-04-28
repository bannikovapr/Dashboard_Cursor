"use strict";

const DEFAULT_TTL_SEC = 15 * 60;
const MIN_SWEEP_INTERVAL_MS = 30 * 1000;

const vault = new Map();
let lastSweepAt = 0;

function nowMs() {
  return Date.now();
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sweepExpired(force) {
  const ts = nowMs();
  if (!force && ts - lastSweepAt < MIN_SWEEP_INTERVAL_MS) return;
  lastSweepAt = ts;
  for (const [key, record] of vault.entries()) {
    if (!record || record.expiresAt <= ts) {
      vault.delete(key);
    }
  }
}

function tokenKey(requestId, token) {
  return `${requestId}:${token}`;
}

function putToken({ requestId, token, encrypted, dataType, ttlSec }) {
  sweepExpired(false);
  const ttl = toPositiveInt(ttlSec, DEFAULT_TTL_SEC);
  vault.set(tokenKey(requestId, token), {
    encrypted,
    dataType: String(dataType || "unknown"),
    expiresAt: nowMs() + ttl * 1000,
  });
}

function getToken({ requestId, token }) {
  sweepExpired(false);
  const item = vault.get(tokenKey(requestId, token));
  if (!item) return null;
  if (item.expiresAt <= nowMs()) {
    vault.delete(tokenKey(requestId, token));
    return null;
  }
  return item;
}

function clearRequest(requestId) {
  const prefix = `${requestId}:`;
  for (const key of vault.keys()) {
    if (key.startsWith(prefix)) {
      vault.delete(key);
    }
  }
}

module.exports = {
  putToken,
  getToken,
  clearRequest,
  sweepExpired,
};

