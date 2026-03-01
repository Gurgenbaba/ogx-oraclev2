// app/static/login.js
// Standalone login page for OGX Oracle (Option B compatible)
//
// Behavior:
// - Login/Register -> store JWT in localStorage (key: ogx_jwt) and redirect to next or /
// - No token display here (token is shown via topbar modal in the app)
// CSP-safe: no inline scripts, no eval

(function () {
  "use strict";

  var JWT_KEY = "ogx_jwt";

  function qs(id) { return document.getElementById(id); }

  function getToken() {
    try { return (localStorage.getItem(JWT_KEY) || "").trim(); } catch { return ""; }
  }

  function setToken(t) {
    try { localStorage.setItem(JWT_KEY, String(t || "")); } catch {}
    // optional cookie (not required), keep it safe-ish:
    try { document.cookie = "ogx_token=" + encodeURIComponent(String(t || "")) + "; path=/; SameSite=Strict; Max-Age=86400"; } catch {}
  }

  function nextUrl() {
    try {
      return new URLSearchParams(location.search).get("next") || "/";
    } catch {
      return "/";
    }
  }

  function t(key, fallback) {
    // minimal helper – doesn't require your JSON keys to exist
    try {
      var v = window.I18N && window.I18N[key];
      return (typeof v === "string" && v) ? v : (fallback || key);
    } catch {
      return fallback || key;
    }
  }

  function showError(msg) {
    var el = qs("auth-error");
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function clearError() {
    var el = qs("auth-error");
    if (!el) return;
    el.textContent = "";
    el.style.display = "none";
  }

  // already logged in -> go home (or next)
  var existing = getToken();
  if (existing) {
    fetch("/auth/me", { headers: { Authorization: "Bearer " + existing } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) window.location.href = nextUrl();
      })
      .catch(function () {});
  }

  // Tab switching
  function switchTab(tab) {
    var isLogin = tab === "login";
    var paneLogin = qs("pane-login");
    var paneReg = qs("pane-register");
    var tabLogin = qs("tab-login");
    var tabReg = qs("tab-register");

    if (paneLogin) paneLogin.hidden = !isLogin;
    if (paneReg) paneReg.hidden = isLogin;

    if (tabLogin) tabLogin.className = "login-tab" + (isLogin ? " active" : "");
    if (tabReg) tabReg.className = "login-tab" + (!isLogin ? " active" : "");

    clearError();

    var f = isLogin ? qs("login-user") : qs("reg-user");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  var tabLoginBtn = qs("tab-login");
  var tabRegBtn = qs("tab-register");
  if (tabLoginBtn) tabLoginBtn.addEventListener("click", function () { switchTab("login"); });
  if (tabRegBtn) tabRegBtn.addEventListener("click", function () { switchTab("register"); });

  // Error map (fallback strings; can be replaced by server-side i18n later)
  var ERROR_MAP = {
    invalid_login:         "Falscher Benutzername oder Passwort.",
    user_disabled:         "Account ist deaktiviert.",
    username_taken:        "Benutzername bereits vergeben.",
    password_too_short:    "Passwort zu kurz.",
    invalid_username:      "Benutzername ungültig (3–32 Zeichen).",
    registration_disabled: "Registrierung ist deaktiviert."
  };

  function setBusy(btn, busy, labelNormal) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) btn.textContent = "…";
    else if (labelNormal) btn.textContent = labelNormal;
  }

  // Login
  function doLogin() {
    var uEl = qs("login-user");
    var pEl = qs("login-pass");
    var btn = qs("btn-login");

    var u = uEl ? uEl.value.trim().toLowerCase() : "";
    var p = pEl ? pEl.value : "";

    if (!u || !p) {
      showError(t("auth.missing_fields", "Benutzername und Passwort erforderlich."));
      return;
    }

    clearError();
    setBusy(btn, true);

    fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (data) {
        if (data && data.ok && data.token) {
          setToken(data.token);

          // If auth.js exists on other pages, it will reflect status there.
          // No need to show token here; redirect.
          window.location.href = nextUrl();
          return;
        }

        var errKey = data && data.error ? String(data.error) : "login_failed";
        showError(ERROR_MAP[errKey] || errKey || t("auth.login_failed", "Login fehlgeschlagen."));
        setBusy(btn, false, t("auth.login", "Login"));
      })
      .catch(function () {
        showError(t("auth.network_error", "Netzwerkfehler. Bitte erneut versuchen."));
        setBusy(btn, false, t("auth.login", "Login"));
      });
  }

  // Register
  function doRegister() {
    var uEl = qs("reg-user");
    var pEl = qs("reg-pass");
    var btn = qs("btn-register");

    var u = uEl ? uEl.value.trim().toLowerCase() : "";
    var p = pEl ? pEl.value : "";

    if (!u || !p) {
      showError(t("auth.missing_fields", "Alle Felder erforderlich."));
      return;
    }

    clearError();
    setBusy(btn, true);

    fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (data) {
        if (data && data.ok && data.token) {
          setToken(data.token);
          window.location.href = nextUrl();
          return;
        }

        var errKey = data && data.error ? String(data.error) : "register_failed";
        showError(ERROR_MAP[errKey] || errKey || t("auth.register_failed", "Registrierung fehlgeschlagen."));
        setBusy(btn, false, t("auth.create_account", "Account erstellen"));
      })
      .catch(function () {
        showError(t("auth.network_error", "Netzwerkfehler. Bitte erneut versuchen."));
        setBusy(btn, false, t("auth.create_account", "Account erstellen"));
      });
  }

  var btnLogin = qs("btn-login");
  var btnRegister = qs("btn-register");
  if (btnLogin) btnLogin.addEventListener("click", doLogin);
  if (btnRegister) btnRegister.addEventListener("click", doRegister);

  // Enter key behavior
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;

    var active = document.activeElement;

    // focus next input if on username
    if (active && active.id === "login-user") {
      var lp = qs("login-pass");
      if (lp) lp.focus();
      return;
    }
    if (active && active.id === "reg-user") {
      var rp = qs("reg-pass");
      if (rp) rp.focus();
      return;
    }

    var paneLogin = qs("pane-login");
    if (paneLogin && !paneLogin.hidden) doLogin();
    else doRegister();
  });

})();
