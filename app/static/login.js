// login.js — OGX Oracle standalone login page
// CSP-safe: no inline scripts, no eval
(function () {
  "use strict";

  var JWT_KEY = "ogx_jwt";
  var redirectTimer = null;
  var countdownInterval = null;

  function getToken() {
    try { return localStorage.getItem(JWT_KEY) || ""; } catch { return ""; }
  }
  function setToken(t) {
    try { localStorage.setItem(JWT_KEY, t); } catch {}
    document.cookie = "ogx_token=" + t + "; path=/; SameSite=Strict; Max-Age=86400";
  }

  // already logged in → go home
  var existing = getToken();
  if (existing) {
    fetch("/auth/me", { headers: { Authorization: "Bearer " + existing } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) window.location.href = new URLSearchParams(location.search).get("next") || "/";
      })
      .catch(function () {});
  }

  function qs(id) { return document.getElementById(id); }

  function showError(msg) {
    var el = qs("auth-error");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }
  function clearError() {
    qs("auth-error").style.display = "none";
  }

  // ── Tab switching ──
  function switchTab(tab) {
    var isLogin = tab === "login";
    qs("pane-login").hidden = !isLogin;
    qs("pane-register").hidden = isLogin;
    qs("tab-login").className = "login-tab" + (isLogin ? " active" : "");
    qs("tab-register").className = "login-tab" + (!isLogin ? " active" : "");
    qs("token-panel").style.display = "none";
    clearError();
    clearTimers();
    var f = isLogin ? qs("login-user") : qs("reg-user");
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  qs("tab-login").addEventListener("click", function () { switchTab("login"); });
  qs("tab-register").addEventListener("click", function () { switchTab("register"); });

  // ── Token panel ──
  function clearTimers() {
    if (redirectTimer) { clearTimeout(redirectTimer); redirectTimer = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function showTokenPanel(token, badgeText, nextUrl) {
    // hide both panes, show token panel
    qs("pane-login").hidden = true;
    qs("pane-register").hidden = true;
    qs("tab-login").hidden = true;
    qs("tab-register").hidden = true;
    clearError();

    qs("token-badge").textContent = badgeText;
    qs("token-ta").value = token;
    qs("token-panel").style.display = "block";
    qs("token-copied").style.display = "none";

    // countdown 5s → redirect
    var secs = 5;
    qs("token-countdown").textContent = secs;
    countdownInterval = setInterval(function () {
      secs--;
      if (qs("token-countdown")) qs("token-countdown").textContent = secs;
      if (secs <= 0) {
        clearTimers();
        window.location.href = nextUrl;
      }
    }, 1000);
  }

  // Copy button
  qs("token-copy-btn").addEventListener("click", function () {
    var ta = qs("token-ta");
    var val = ta.value;
    if (!val) return;
    navigator.clipboard.writeText(val).then(function () {
      qs("token-copied").style.display = "block";
      setTimeout(function () {
        if (qs("token-copied")) qs("token-copied").style.display = "none";
      }, 1500);
    }).catch(function () {
      // fallback
      ta.select();
      document.execCommand("copy");
      qs("token-copied").style.display = "block";
      setTimeout(function () {
        if (qs("token-copied")) qs("token-copied").style.display = "none";
      }, 1500);
    });
  });

  // Manual continue
  qs("token-continue-btn").addEventListener("click", function () {
    clearTimers();
    window.location.href = new URLSearchParams(location.search).get("next") || "/";
  });

  // ── Error map ──
  var ERROR_MAP = {
    "invalid_login":         "Falscher Benutzername oder Passwort.",
    "user_disabled":         "Account ist deaktiviert.",
    "username_taken":        "Benutzername bereits vergeben.",
    "password_too_short":    "Passwort zu kurz.",
    "invalid_username":      "Benutzername ungültig (3–32 Zeichen).",
    "registration_disabled": "Registrierung ist deaktiviert.",
  };

  // ── Login ──
  function doLogin() {
    var u = qs("login-user").value.trim().toLowerCase();
    var p = qs("login-pass").value;
    if (!u || !p) { showError("Benutzername und Passwort erforderlich."); return; }
    var btn = qs("btn-login");
    btn.disabled = true;
    btn.textContent = "…";
    clearError();
    fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          setToken(data.token);
          var label = "✓ " + (data.username || u) + (data.is_admin ? " (Admin)" : "");
          showTokenPanel(data.token, label, new URLSearchParams(location.search).get("next") || "/");
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

  // ── Register ──
  function doRegister() {
    var u = qs("reg-user").value.trim().toLowerCase();
    var p = qs("reg-pass").value;
    if (!u || !p) { showError("Alle Felder erforderlich."); return; }
    var btn = qs("btn-register");
    btn.disabled = true;
    btn.textContent = "…";
    clearError();
    fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          setToken(data.token);
          var label = "🎉 " + (data.username || u) + (data.is_admin ? " (Admin)" : "");
          showTokenPanel(data.token, label, new URLSearchParams(location.search).get("next") || "/");
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
    // don't fire while token panel is visible
    if (qs("token-panel").style.display === "block") return;
    var active = document.activeElement;
    if (active && active.id === "login-user") { qs("login-pass").focus(); return; }
    if (active && active.id === "reg-user")   { qs("reg-pass").focus(); return; }
    if (!qs("pane-login").hidden) doLogin();
    else doRegister();
  });

})();
