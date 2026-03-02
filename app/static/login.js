/**
 * OGX Oracle — Login page logic
 * CSP-safe: external file only
 * After login: shows token inline on the same page, no redirect to success page
 */
(function () {
  "use strict";

  var tabLogin    = document.getElementById("tab-login");
  var tabReg      = document.getElementById("tab-register");
  var paneLogin   = document.getElementById("pane-login");
  var paneReg     = document.getElementById("pane-register");
  var errBox      = document.getElementById("auth-error");
  var btnLogin    = document.getElementById("btn-login");
  var btnRegister = document.getElementById("btn-register");

  // Token success panel elements
  var paneToken   = document.getElementById("pane-token");
  var tokenTa     = document.getElementById("token-ta");
  var btnCopy     = document.getElementById("btn-copy");
  var btnContinue = document.getElementById("btn-continue");
  var copiedMsg   = document.getElementById("copied-msg");
  var successTitle = document.getElementById("success-title");

  function showErr(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.style.display = msg ? "block" : "none";
  }

  function getCsrf() {
    var m = document.querySelector("meta[name=\"csrf-token\"]");
    return m ? m.content : "";
  }

  function getNext() {
    return new URLSearchParams(window.location.search).get("next") || "/";
  }

  function switchTab(toLogin) {
    if (tabLogin)  tabLogin.classList.toggle("active", toLogin);
    if (tabReg)    tabReg.classList.toggle("active", !toLogin);
    if (paneLogin) paneLogin.hidden = !toLogin;
    if (paneReg)   paneReg.hidden   = toLogin;
    showErr("");
  }

  if (tabLogin) tabLogin.addEventListener("click", function () { switchTab(true); });
  if (tabReg)   tabReg.addEventListener("click",   function () { switchTab(false); });

  function onSuccess(token, username) {
    // Persist token
    localStorage.setItem("ogx_jwt", token);

    // Show token panel
    if (paneLogin)  paneLogin.hidden  = true;
    if (paneReg)    paneReg.hidden    = true;
    if (paneToken)  paneToken.hidden  = false;
    if (tabLogin)   tabLogin.style.display = "none";
    if (tabReg)     tabReg.style.display   = "none";
    if (errBox)     errBox.style.display   = "none";

    if (successTitle) successTitle.textContent = (window.I18N && window.I18N["auth.welcome_user"] || "Willkommen, ") + username;
    if (tokenTa) tokenTa.value = token;

    // Set continue link
    if (btnContinue) btnContinue.href = getNext();
  }

  // Copy button
  if (btnCopy && tokenTa) {
    btnCopy.addEventListener("click", function () {
      var val = tokenTa.value;
      if (!val) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(showCopied).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    });
  }

  function fallbackCopy() {
    tokenTa.select();
    try { document.execCommand("copy"); showCopied(); } catch (e) {}
  }

  function showCopied() {
    if (btnCopy) btnCopy.textContent = "✓ Kopiert!";
    if (copiedMsg) copiedMsg.classList.add("visible");
    setTimeout(function () {
      if (btnCopy) btnCopy.textContent = window.I18N && window.I18N["auth.copy"] || "Token kopieren";
      if (copiedMsg) copiedMsg.classList.remove("visible");
    }, 2000);
  }

  function doLogin() {
    var username = document.getElementById("login-user").value.trim();
    var password = document.getElementById("login-pass").value;
    if (!username || !password) { showErr("Bitte alle Felder ausfüllen."); return; }
    btnLogin.disabled = true;
    btnLogin.textContent = "…";
    fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ username: username, password: password })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok && d.token) {
        onSuccess(d.token, username);
      } else {
        showErr(d.detail || d.error || d.message || "Login fehlgeschlagen.");
        btnLogin.disabled = false;
        btnLogin.textContent = window.I18N && window.I18N["auth.login"] || "Login";
      }
    })
    .catch(function () {
      showErr("Netzwerkfehler.");
      btnLogin.disabled = false;
      btnLogin.textContent = window.I18N && window.I18N["auth.login"] || "Login";
    });
  }

  function doRegister() {
    var username = document.getElementById("reg-user").value.trim();
    var password = document.getElementById("reg-pass").value;
    if (!username || !password) { showErr("Bitte alle Felder ausfüllen."); return; }
    btnRegister.disabled = true;
    btnRegister.textContent = "…";
    fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify({ username: username, password: password })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok && d.token) {
        onSuccess(d.token, username);
      } else {
        showErr(d.detail || d.error || d.message || "Registrierung fehlgeschlagen.");
        btnRegister.disabled = false;
        btnRegister.textContent = window.I18N && window.I18N["auth.create_account"] || "Account erstellen";
      }
    })
    .catch(function () {
      showErr("Netzwerkfehler.");
      btnRegister.disabled = false;
      btnRegister.textContent = window.I18N && window.I18N["auth.create_account"] || "Account erstellen";
    });
  }

  if (btnLogin)    btnLogin.addEventListener("click", doLogin);
  if (btnRegister) btnRegister.addEventListener("click", doRegister);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    if (paneLogin && !paneLogin.hidden) doLogin();
    else if (paneReg && !paneReg.hidden) doRegister();
  });
})();
