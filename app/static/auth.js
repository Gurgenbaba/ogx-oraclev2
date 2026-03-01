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
      if (status) status.style.display = "none";
      if (openBtn) openBtn.style.display = "none";
      const loginBtn = qs("#auth-loggedin-btn");
      if (loginBtn) { loginBtn.textContent = "Logged in: " + label; loginBtn.style.display = ""; loginBtn.setAttribute("aria-expanded","false"); }
      if (logoutBtn) logoutBtn.style.display = "";
    } catch (e) {
      clearToken();
      if (status) { status.textContent = "Session expired – please log in again"; status.style.display = ""; }
      const loginBtn2 = qs("#auth-loggedin-btn");
      if (loginBtn2) loginBtn2.style.display = "none";
      const drop2 = qs("#token-drop");
      if (drop2) drop2.classList.remove("open");
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
    // ── Token dropdown ──────────────────────────
    const loginBtn = qs("#auth-loggedin-btn");
    const drop = qs("#token-drop");

    function openDrop() {
      if (!drop) return;
      const token = getToken();
      // populate textarea
      const ta = qs("#token-drop-ta");
      if (ta) ta.value = token || "";
      drop.classList.add("open");
      if (loginBtn) loginBtn.setAttribute("aria-expanded","true");
    }
    function closeDrop() {
      if (!drop) return;
      drop.classList.remove("open");
      if (loginBtn) loginBtn.setAttribute("aria-expanded","false");
    }

    if (loginBtn) loginBtn.addEventListener("click", () => {
      drop && drop.classList.contains("open") ? closeDrop() : openDrop();
    });

    const closeBtn = qs("#token-drop-close");
    if (closeBtn) closeBtn.addEventListener("click", closeDrop);

    const showBtn = qs("#token-drop-show");
    const ta = qs("#token-drop-ta");
    if (showBtn && ta) {
      showBtn.addEventListener("click", () => {
        const hidden = ta.style.display === "none";
        ta.style.display = hidden ? "" : "none";
        showBtn.textContent = hidden ? (window.I18N && window.I18N["auth.show"] ? window.I18N["auth.show"].replace(/show/i,"Hide").replace(/Anzeigen/,"Verbergen").replace(/Afficher/,"Masquer") : "Hide") : (window.I18N && window.I18N["auth.show"] || "Show");
        if (hidden) ta.select();
      });
    }

    const copyBtn = qs("#token-drop-copy");
    const copiedMsg = qs("#token-drop-copied");
    if (copyBtn && ta) {
      copyBtn.addEventListener("click", async () => {
        const val = (ta.value || "").trim();
        if (!val) return;
        try { await navigator.clipboard.writeText(val); }
        catch { ta.select(); document.execCommand("copy"); }
        if (copiedMsg) { copiedMsg.style.display = ""; setTimeout(() => copiedMsg.style.display = "none", 1500); }
      });
    }

    // Close dropdown on outside click
    document.addEventListener("click", e => {
      if (drop && drop.classList.contains("open")) {
        if (!drop.contains(e.target) && e.target !== loginBtn) closeDrop();
      }
    });

    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrop(); });

    // ── Logout ──────────────────────────────────
    const logoutBtn = qs("#auth-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        closeDrop();
        clearToken();
        await refreshStatus();
      });
    }

    // ── Tab switching (login page) ───────────────
    document.querySelectorAll(".auth-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll(".auth-pane").forEach(p => p.style.display = "none");
        const pane = qs("#auth-pane-" + target);
        if (pane) pane.style.display = "block";
        setError("");
        const firstInput = pane && pane.querySelector("input");
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      });
    });

    const lf = qs("#auth-login-form");
    if (lf) {
      lf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(lf);
        try { await login(String(fd.get("username")||""), String(fd.get("password")||"")); }
        catch (err) { setError("Login failed: " + (err && err.message ? err.message : "unknown")); }
      });
    }
    const rf = qs("#auth-register-form");
    if (rf) {
      rf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(rf);
        try { await register(String(fd.get("username")||""), String(fd.get("password")||"")); }
        catch (err) { setError("Registration failed: " + (err && err.message ? err.message : "unknown")); }
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