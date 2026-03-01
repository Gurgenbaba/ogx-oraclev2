// login.js — OGX Oracle standalone login page
(function () {
  "use strict";

  const JWT_KEY = "ogx_jwt";

  function getToken() {
    try { return localStorage.getItem(JWT_KEY) || ""; } catch { return ""; }
  }
  function setToken(t) {
    try { localStorage.setItem(JWT_KEY, t); } catch {}
    document.cookie = "ogx_token=" + t + "; path=/; SameSite=Strict; Max-Age=86400";
  }

  // already logged in → go home
  var tok = getToken();
  if (tok) {
    fetch("/auth/me", { headers: { Authorization: "Bearer " + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) window.location.href = new URLSearchParams(location.search).get("next") || "/"; })
      .catch(function () {});
  }

  function qs(id) { return document.getElementById(id); }

  function showError(msg) {
    var el = qs("auth-error");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
    qs("auth-success").style.display = "none";
  }
  function showSuccess(msg) {
    var el = qs("auth-success");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
    qs("auth-error").style.display = "none";
  }
  function clearMessages() {
    qs("auth-error").style.display = "none";
    qs("auth-success").style.display = "none";
  }

  // Tab switching — use hidden attribute (CSP safe, no style manipulation)
  function switchTab(tab) {
    var isLogin = tab === "login";
    qs("pane-login").hidden = !isLogin;
    qs("pane-register").hidden = isLogin;
    qs("tab-login").className = "login-tab" + (isLogin ? " active" : "");
    qs("tab-register").className = "login-tab" + (!isLogin ? " active" : "");
    clearMessages();
    var f = isLogin ? qs("login-user") : qs("reg-user");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  qs("tab-login").addEventListener("click", function () { switchTab("login"); });
  qs("tab-register").addEventListener("click", function () { switchTab("register"); });

  var ERROR_MAP = {
    "invalid_login":         "Falscher Benutzername oder Passwort.",
    "user_disabled":         "Account ist deaktiviert.",
    "username_taken":        "Benutzername bereits vergeben.",
    "password_too_short":    "Passwort zu kurz.",
    "invalid_username":      "Benutzername ungültig (3–32 Zeichen).",
    "registration_disabled": "Registrierung ist deaktiviert.",
  };

  function doLogin() {
    var u = qs("login-user").value.trim().toLowerCase();
    var p = qs("login-pass").value;
    if (!u || !p) { showError("Benutzername und Passwort erforderlich."); return; }
    var btn = qs("btn-login");
    btn.disabled = true;
    btn.textContent = "…";
    clearMessages();
    fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          setToken(data.token);
          showSuccess("✓ " + (data.username || u) + (data.is_admin ? " (Admin)" : ""));
          setTimeout(function () {
            window.location.href = new URLSearchParams(location.search).get("next") || "/";
          }, 500);
        } else {
          showError(ERROR_MAP[data.error] || data.error || "Login fehlgeschlagen.");
          btn.disabled = false;
          btn.textContent = "Login";
        }
      })
      .catch(function () {
        showError("Netzwerkfehler. Bitte erneut versuchen.");
        btn.disabled = false;
        btn.textContent = "Login";
      });
  }

  function doRegister() {
    var u = qs("reg-user").value.trim().toLowerCase();
    var p = qs("reg-pass").value;
    if (!u || !p) { showError("Alle Felder erforderlich."); return; }
    var btn = qs("btn-register");
    btn.disabled = true;
    btn.textContent = "…";
    clearMessages();
    fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          setToken(data.token);
          showSuccess("✓ Account erstellt — " + (data.username || u));
          setTimeout(function () {
            window.location.href = new URLSearchParams(location.search).get("next") || "/";
          }, 600);
        } else {
          showError(ERROR_MAP[data.error] || data.error || "Registrierung fehlgeschlagen.");
          btn.disabled = false;
          btn.textContent = "Account erstellen";
        }
      })
      .catch(function () {
        showError("Netzwerkfehler. Bitte erneut versuchen.");
        btn.disabled = false;
        btn.textContent = "Account erstellen";
      });
  }

  qs("btn-login").addEventListener("click", doLogin);
  qs("btn-register").addEventListener("click", doRegister);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var active = document.activeElement;
    if (active && active.id === "login-user") { qs("login-pass").focus(); return; }
    if (active && active.id === "reg-user")   { qs("reg-pass").focus(); return; }
    if (!qs("pane-login").hidden) doLogin();
    else doRegister();
  });

})();
