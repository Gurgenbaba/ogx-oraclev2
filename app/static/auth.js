// app/static/auth.js
// JWT auth for OGX Oracle UI:
// - Stores token in localStorage
// - Provides window.ogxAuth + window.ogxFetch helpers
// - Shows login/register modal when needed
// CSP-safe: no inline JS, no eval.

(function () {
  "use strict";

  const TOKEN_KEY = "ogx_jwt";

  function qs(sel) { return document.querySelector(sel); }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? (meta.getAttribute("content") || "").trim() : "";
  }

  function getToken() {
    return (localStorage.getItem(TOKEN_KEY) || "").trim();
  }

  function setToken(t) {
    localStorage.setItem(TOKEN_KEY, String(t || ""));
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function setError(msg) {
    const box = qs("#auth-error");
    if (!box) return;
    if (!msg) {
      box.style.display = "none";
      box.textContent = "";
      return;
    }
    box.style.display = "";
    box.textContent = msg;
  }

  function openModal() {
    const m = qs("#auth-modal");
    if (!m) return;
    setError("");
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    const u = m.querySelector('#auth-login-form input[name="username"]');
    if (u) u.focus();
  }

  function closeModal() {
    const m = qs("#auth-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    setError("");
  }

  async function refreshStatus() {
    const status = qs("#auth-status");
    const openBtn = qs("#auth-open");
    const logoutBtn = qs("#auth-logout");

    const token = getToken();
    if (!token) {
      if (status) status.textContent = "Nicht eingeloggt";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      return;
    }

    // Ask backend who we are
    try {
      const resp = await fetch("/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) throw new Error("not_ok");
      const data = await resp.json();
      if (!data || !data.ok) throw new Error("bad");
      const label = data.is_admin ? `${data.username} (Admin)` : data.username;

      if (status) status.textContent = "Eingeloggt: " + label;
      if (openBtn) openBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
    } catch (e) {
      // Token invalid/expired/revoked
      clearToken();
      if (status) status.textContent = "Session abgelaufen – bitte neu einloggen";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
    }
  }

  async function login(username, password) {
    setError("");
    const resp = await fetch("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !data.ok || !data.token) {
      const err = data && data.error ? String(data.error) : "login_failed";
      throw new Error(err);
    }
    setToken(data.token);
    await refreshStatus();
    closeModal();
  }

  async function register(username, password) {
    setError("");
    const resp = await fetch("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !data.ok || !data.token) {
      const err = data && data.error ? String(data.error) : "register_failed";
      throw new Error(err);
    }
    setToken(data.token);
    await refreshStatus();
    closeModal();
  }

  // Global fetch helper that adds CSRF + JWT for same-origin requests
  async function ogxFetch(url, options) {
    const opts = options ? { ...options } : {};
    opts.headers = opts.headers ? { ...opts.headers } : {};

    const csrf = getCsrfToken();
    if (csrf && !opts.headers["x-csrf-token"]) opts.headers["x-csrf-token"] = csrf;

    const token = getToken();
    if (token && !opts.headers["Authorization"]) opts.headers["Authorization"] = "Bearer " + token;

    return fetch(url, opts);
  }

  function bindUi() {
    const openBtn = qs("#auth-open");
    const logoutBtn = qs("#auth-logout");

    if (openBtn) openBtn.addEventListener("click", openModal);
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        clearToken();
        await refreshStatus();
      });
    }

    // Close handlers
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.matches && t.matches("[data-auth-close]")) closeModal();
      const m = qs("#auth-modal");
      if (m && !m.hidden && t.closest && t.closest("[data-auth-close]")) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    const lf = qs("#auth-login-form");
    if (lf) {
      lf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(lf);
        const username = String(fd.get("username") || "");
        const password = String(fd.get("password") || "");
        try {
          await login(username, password);
        } catch (err) {
          setError("Login fehlgeschlagen: " + (err && err.message ? err.message : "unknown"));
        }
      });
    }

    const rf = qs("#auth-register-form");
    if (rf) {
      rf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(rf);
        const username = String(fd.get("username") || "");
        const password = String(fd.get("password") || "");
        try {
          await register(username, password);
        } catch (err) {
          setError("Registrierung fehlgeschlagen: " + (err && err.message ? err.message : "unknown"));
        }
      });
    }
  }

  // expose for other scripts
  window.ogxAuth = {
    openModal,
    closeModal,
    getToken,
    setToken,
    clearToken,
    refreshStatus,
  };
  window.ogxFetch = ogxFetch;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bindUi();
      refreshStatus();
    });
  } else {
    bindUi();
    refreshStatus();
  }
})();