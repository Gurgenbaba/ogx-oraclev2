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

  // --------------------------------------------
  // TOKEN PANEL (new base.html compatible)
  // --------------------------------------------
  function tokenEls() {
    return {
      panel: qs("#auth-token-panel"),
      badge: qs("#auth-token-badge"),
      title: qs("#auth-token-title"),
      wrap: qs("#auth-token-wrap"),
      ta: qs("#auth-token"),
      copied: qs("#auth-token-copied"),
      btnToggle: qs("#auth-token-toggle"),
      btnCopy: qs("#auth-token-copy"),
      btnHide: qs("#auth-token-hide"),
    };
  }

  function collapseTokenPanel() {
    const el = tokenEls();
    if (el.wrap) el.wrap.style.display = "none";
    if (el.btnToggle) el.btnToggle.textContent = "Show";
    if (el.btnCopy) el.btnCopy.disabled = true;
    if (el.copied) el.copied.style.display = "none";
    if (el.ta) el.ta.scrollTop = 0;
  }

  function hideTokenPanel() {
    const el = tokenEls();
    if (el.ta) el.ta.value = "";
    if (el.copied) el.copied.style.display = "none";
    if (el.panel) el.panel.style.display = "none";
    collapseTokenPanel();
  }

  function showTokenPanel(token, title, mode) {
    // mode: "login" | "register" | "info"
    const el = tokenEls();

    if (el.title) el.title.textContent = title || "Token";
    if (el.badge) {
      if (mode === "register") el.badge.textContent = "🎉 Registered";
      else if (mode === "login") el.badge.textContent = "✅ Logged in";
      else el.badge.textContent = "✅ Success";
    }

    if (el.ta) {
      el.ta.value = String(token || "");
      el.ta.scrollTop = 0;
    }

    if (el.panel) el.panel.style.display = "";
    collapseTokenPanel();
  }

  function toggleTokenPanel() {
    const el = tokenEls();
    if (!el.wrap || !el.btnToggle) return;

    const isOpen = el.wrap.style.display !== "none";
    if (isOpen) {
      collapseTokenPanel();
      return;
    }

    // open
    el.wrap.style.display = "";
    el.btnToggle.textContent = "Hide";
    if (el.btnCopy) el.btnCopy.disabled = false;
    if (el.ta) el.ta.focus();
  }

  async function copyTokenToClipboard() {
    const el = tokenEls();
    if (!el.ta) return;

    const val = String(el.ta.value || "").trim();
    if (!val) return;

    try {
      await navigator.clipboard.writeText(val);
    } catch {
      // fallback for older browsers / blocked clipboard
      el.ta.focus();
      el.ta.select();
      document.execCommand("copy");
      el.ta.setSelectionRange(0, 0);
    }

    if (el.copied) {
      el.copied.style.display = "";
      window.setTimeout(() => { el.copied.style.display = "none"; }, 1200);
    }
  }

  // --------------------------------------------
  // MODAL
  // --------------------------------------------
  function openModal() {
    const m = qs("#auth-modal");
    if (!m) return;
    setError("");
    hideTokenPanel();
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
    hideTokenPanel();
  }

  // --------------------------------------------
  // STATUS
  // --------------------------------------------
  async function refreshStatus() {
    const status = qs("#auth-status");
    const openBtn = qs("#auth-open");
    const logoutBtn = qs("#auth-logout");

    const token = getToken();
    if (!token) {
      if (status) status.textContent = "Not logged in";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      return;
    }

    try {
      const resp = await fetch("/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) throw new Error("not_ok");
      const data = await resp.json();
      if (!data || !data.ok) throw new Error("bad");

      const label = data.is_admin ? `${data.username} (Admin)` : data.username;
      if (status) status.textContent = "Logged in: " + label;
      if (openBtn) openBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
    } catch (e) {
      clearToken();
      if (status) status.textContent = "Session expired – please log in again";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
    }
  }

  // --------------------------------------------
  // AUTH CALLS
  // --------------------------------------------
  async function login(username, password) {
    setError("");
    hideTokenPanel();

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

    // token panel (collapsed)
    showTokenPanel(data.token, "Login successful – your JWT", "login");
  }

  async function register(username, password) {
    setError("");
    hideTokenPanel();

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

    // token panel (collapsed)
    showTokenPanel(data.token, "Registration successful – your JWT", "register");
  }

  // --------------------------------------------
  // FETCH HELPER
  // --------------------------------------------
  async function ogxFetch(url, options) {
    const opts = options ? { ...options } : {};
    opts.headers = opts.headers ? { ...opts.headers } : {};

    const csrf = getCsrfToken();
    if (csrf && !opts.headers["x-csrf-token"]) opts.headers["x-csrf-token"] = csrf;

    const token = getToken();
    if (token && !opts.headers["Authorization"]) opts.headers["Authorization"] = "Bearer " + token;

    return fetch(url, opts);
  }

  // --------------------------------------------
  // UI BINDINGS
  // --------------------------------------------
  function bindUi() {
    const openBtn = qs("#auth-open");
    const logoutBtn = qs("#auth-logout");

    if (openBtn) openBtn.addEventListener("click", openModal);
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        clearToken();
        hideTokenPanel();
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

    // Token panel buttons
    const el = tokenEls();
    if (el.btnToggle) el.btnToggle.addEventListener("click", toggleTokenPanel);
    if (el.btnCopy) el.btnCopy.addEventListener("click", copyTokenToClipboard);
    if (el.btnHide) el.btnHide.addEventListener("click", hideTokenPanel);

    // Tab switching
    document.querySelectorAll(".auth-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll(".auth-pane").forEach(p => p.style.display = "none");
        const pane = qs("#auth-pane-" + target);
        if (pane) pane.style.display = "block";
        setError("");
        // Focus first input in the active pane
        const firstInput = pane && pane.querySelector("input");
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      });
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
          setError("Login failed: " + (err && err.message ? err.message : "unknown"));
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
          setError("Registration failed: " + (err && err.message ? err.message : "unknown"));
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