// app/static/login.js
(function () {
  "use strict";
  var tabLogin = document.getElementById("tab-login"), tabReg = document.getElementById("tab-register");
  var loginTabs = document.getElementById("login-tabs"), paneLogin = document.getElementById("pane-login");
  var paneReg = document.getElementById("pane-register"), paneToken = document.getElementById("pane-token");
  var errBox = document.getElementById("auth-error"), btnLogin = document.getElementById("btn-login");
  var btnRegister = document.getElementById("btn-register"), tokenTa = document.getElementById("token-ta");
  var btnCopy = document.getElementById("btn-copy"), btnContinue = document.getElementById("btn-continue");
  var copiedMsg = document.getElementById("copied-msg"), successTitle = document.getElementById("success-title");
  var I18N = window.I18N || {};
  function t(key, fallback) { return I18N[key] || fallback || key; }
  function showErr(msg) { if (!errBox) return; errBox.textContent = msg || ""; if (msg) errBox.removeAttribute("hidden"); else errBox.setAttribute("hidden", ""); }
  function getCsrf() { var m = document.querySelector('meta[name="csrf-token"]'); return m ? m.content : ""; }
  function getNext() { return new URLSearchParams(window.location.search).get("next") || "/"; }
  function switchTab(toLogin) {
    if (tabLogin) tabLogin.classList.toggle("active", toLogin); if (tabReg) tabReg.classList.toggle("active", !toLogin);
    if (paneLogin) { if (toLogin) paneLogin.removeAttribute("hidden"); else paneLogin.setAttribute("hidden", ""); }
    if (paneReg) { if (!toLogin) paneReg.removeAttribute("hidden"); else paneReg.setAttribute("hidden", ""); }
    showErr("");
  }
  if (tabLogin) tabLogin.addEventListener("click", function() { switchTab(true); });
  if (tabReg) tabReg.addEventListener("click", function() { switchTab(false); });
  function onSuccess(token, username) {
    localStorage.setItem("ogx_jwt", token);
    if (loginTabs) loginTabs.setAttribute("hidden", ""); if (paneLogin) paneLogin.setAttribute("hidden", "");
    if (paneReg) paneReg.setAttribute("hidden", ""); if (errBox) errBox.setAttribute("hidden", "");
    if (paneToken) paneToken.removeAttribute("hidden");
    if (successTitle) successTitle.textContent = t("auth.welcome_user", "Welcome!") + " " + username;
    if (tokenTa) { tokenTa.value = token; tokenTa.focus(); tokenTa.select(); }
    if (btnContinue) btnContinue.href = getNext();
  }
  function showCopied() {
    var lbl = t("auth.copied", "Copied!"), copyLbl = t("auth.copy", "Copy Token");
    if (btnCopy) btnCopy.textContent = "\u2713 " + lbl;
    if (copiedMsg) copiedMsg.classList.add("visible");
    window.setTimeout(function() { if (btnCopy) btnCopy.textContent = copyLbl; if (copiedMsg) copiedMsg.classList.remove("visible"); }, 2000);
  }
  if (btnCopy) { btnCopy.addEventListener("click", function() { var v = tokenTa ? tokenTa.value : ""; if (!v) return; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(v).then(showCopied).catch(function(){ if(tokenTa){tokenTa.select();try{document.execCommand("copy");showCopied();}catch(e){}} }); } else { if(tokenTa){tokenTa.select();try{document.execCommand("copy");showCopied();}catch(e){}} } }); }
  function doLogin() {
    var u = document.getElementById("login-user").value.trim(), p = document.getElementById("login-pass").value;
    if (!u || !p) { showErr(t("auth.fill_all", "Please fill in all fields.")); return; }
    btnLogin.disabled = true; btnLogin.textContent = "\u2026";
    fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ username: u, password: p }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.ok && d.token) { onSuccess(d.token, u); } else { showErr(d.detail || d.error || d.message || t("auth.login_failed", "Login failed. Check your credentials.")); btnLogin.disabled = false; btnLogin.textContent = t("auth.login", "Login"); } })
      .catch(function() { showErr(t("auth.network_error", "Network error. Please try again.")); btnLogin.disabled = false; btnLogin.textContent = t("auth.login", "Login"); });
  }
  function doRegister() {
    var u = document.getElementById("reg-user").value.trim(), p = document.getElementById("reg-pass").value;
    if (!u || !p) { showErr(t("auth.fill_all", "Please fill in all fields.")); return; }
    btnRegister.disabled = true; btnRegister.textContent = "\u2026";
    fetch("/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": getCsrf() }, body: JSON.stringify({ username: u, password: p }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.ok && d.token) { onSuccess(d.token, u); } else { showErr(d.detail || d.error || d.message || t("auth.register_failed", "Registration failed.")); btnRegister.disabled = false; btnRegister.textContent = t("auth.create_account", "Create Account"); } })
      .catch(function() { showErr(t("auth.network_error", "Network error. Please try again.")); btnRegister.disabled = false; btnRegister.textContent = t("auth.create_account", "Create Account"); });
  }
  if (btnLogin) btnLogin.addEventListener("click", doLogin);
  if (btnRegister) btnRegister.addEventListener("click", doRegister);
  document.addEventListener("keydown", function(e) { if (e.key !== "Enter") return; if (paneToken && !paneToken.hasAttribute("hidden")) return; if (paneLogin && !paneLogin.hasAttribute("hidden")) doLogin(); else if (paneReg && !paneReg.hasAttribute("hidden")) doRegister(); });
})();
