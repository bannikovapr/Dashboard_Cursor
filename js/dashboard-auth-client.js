(function (root) {
  "use strict";

  const STORAGE_KEY = "toir_dashboard_auth_token";
  const EXPIRED_EVENT = "toir-dashboard-auth-expired";

  function getApiOrigin() {
    try {
      const u = new URL(root.TOIR_API_URL || "http://localhost:8787/api/chat");
      return u.origin;
    } catch (_) {
      return "http://localhost:8787";
    }
  }

  async function fetchAuthStatus() {
    const r = await fetch(`${getApiOrigin()}/api/auth/status`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`auth_status_http_${r.status}`);
    const j = await r.json().catch(() => ({}));
    return j.enabled === true;
  }

  function getToken() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(STORAGE_KEY, t);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function clearToken() {
    setToken("");
  }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function apiFetch(url, init) {
    const i = init ? Object.assign({}, init) : {};
    const baseHeaders = Object.assign({ Accept: "application/json" }, i.headers || {});
    i.headers = Object.assign(baseHeaders, authHeaders());
    const hadToken = !!getToken();
    const res = await fetch(url, i);
    if (res.status === 401 && hadToken) {
      clearToken();
      root.dispatchEvent(new CustomEvent(EXPIRED_EVENT));
    }
    return res;
  }

  root.ToirDashboardAuth = {
    STORAGE_KEY,
    EXPIRED_EVENT,
    getApiOrigin,
    fetchAuthStatus,
    getToken,
    setToken,
    clearToken,
    authHeaders,
    apiFetch,
  };
})(window);
