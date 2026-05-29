// ── API layer ─────────────────────────────────────────────────────────────────
// Extracted from nexus.jsx. Import `api` from here everywhere.
//
// Usage:
//   import { api } from "../lib/api";
//   const data = await api.get("/posts/1");
//   await api.post("/posts", { title: "Hello" });

// ---------------------------------------------------------------------------
// PWA install prompt
// beforeinstallprompt fires before any React renders, so we capture it here
// at module scope and expose it via window so Sidebar can read it reactively.
// ---------------------------------------------------------------------------
window._installPrompt = null;
window._installPromptListeners = [];
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window._installPrompt = e;
  window._installPromptListeners.forEach(fn => fn(e));
});
window.addEventListener("appinstalled", () => {
  window._installPrompt = null;
  window._installPromptListeners.forEach(fn => fn(null));
});
window.onInstallPromptChange = function (fn) {
  window._installPromptListeners.push(fn);
  return () => {
    window._installPromptListeners = window._installPromptListeners.filter(f => f !== fn);
  };
};

// ---------------------------------------------------------------------------
// PWA visit counter
// Incremented once per page load at module scope so it runs before React.
// Used by AndroidInstallSheet to decide whether to show on this visit.
// ---------------------------------------------------------------------------
try {
  const _vc = parseInt(localStorage.getItem("pwa.visit_count") || "0", 10);
  window._pwaVisitCount = _vc + 1;
  localStorage.setItem("pwa.visit_count", String(window._pwaVisitCount));
} catch {
  window._pwaVisitCount = 1;
}

export const api = {
  token: localStorage.getItem("nexus_token"),
  refreshing: false,

  setToken(t) {
    this.token = t;
    t ? localStorage.setItem("nexus_token", t) : localStorage.removeItem("nexus_token");
  },

  async request(method, path, body, retry = true, silentAuth = false) {
    const h = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    try {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
      });

      if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
        const refreshed = await this.tryRefresh();
        if (refreshed) return this.request(method, path, body, false, silentAuth);
        this.setToken(null);
        localStorage.removeItem("nexus_user");
        if (!silentAuth) window.dispatchEvent(new Event("nexus:logout"));
        return {};
      }

      // Guard against non-JSON responses (e.g. 502 Bad Gateway returns HTML)
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return {};
      return res.json();
    } catch {
      return {};
    }
  },

  async tryRefresh() {
    if (this.refreshing) return false;
    this.refreshing = true;
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const d = await res.json();
        if (d.access_token) { this.setToken(d.access_token); return true; }
      }
      // Only treat as a hard failure if the server explicitly says the token is invalid.
      // A 503, network error, or "temporarily unavailable" should not clear the session.
      if (res.status === 401) {
        const d = await res.json().catch(() => ({}));
        if (d.error === "Invalid or expired refresh token") {
          this.setToken(null);
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      this.refreshing = false;
    }
  },

  // On PWA cold launch, iOS may not have the cookie jar ready on the very first
  // fetch. Retry once after a short delay before giving up.
  async tryRefreshWithRetry(maxAttempts = 2, delayMs = 800) {
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, delayMs));
      const ok = await this.tryRefresh();
      if (ok) return true;
      // If tryRefresh cleared the token (definitive server rejection), stop retrying
      if (!this.token) return false;
    }
    return false;
  },

  get:    (p)    => api.request("GET",    p),
  post:   (p, b) => api.request("POST",   p, b),
  patch:  (p, b) => api.request("PATCH",  p, b),
  delete: (p, b) => api.request("DELETE", p, b),

  // Multipart file upload. `file` is a File object, `params` is an object
  // of additional form fields (type, record_id, allowed_mime, etc.).
  // Returns the parsed JSON response.
  async upload(path, file, params = {}) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(params).forEach(([k, v]) => { if (v != null) fd.append(k, v); });

    const h = {};
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;

    try {
      const res = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: h,
        body: fd,
        credentials: "include",
      });

      if (res.status === 401) {
        const refreshed = await this.tryRefresh();
        if (refreshed) return this.upload(path, file, params);
        this.setToken(null);
        window.dispatchEvent(new Event("nexus:logout"));
        return {};
      }

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return {};
      return res.json();
    } catch {
      return {};
    }
  },
};
