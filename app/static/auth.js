// app/static/auth.js
// JWT auth for OGX Oracle — CSP-safe, no inline JS, no eval.
// Uses hidden attribute (not style.display) to show/hide elements.
(function () {
  "use strict";

  var TOKEN_KEY = "ogx_jwt";

  function qs(sel) { return document.querySelector(sel); }

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? (meta.getAttribute("content") || "").trim() : "";
  }

  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  // ─── Status refresh ────────────────────────────────────────────────────────
  function refreshStatus() {
    var token = getToken();
    var statusEl   = qs("#auth-status");
    var usernameEl = qs("#auth-username");
    var openEl     = qs("#auth-open");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");

    if (!token) {
      if (statusEl)   { statusEl.removeAttribute("hidden"); statusEl.textContent = (window.I18N && window.I18N["auth.not_logged_in"]) || "Not logged in"; }
      if (usernameEl) usernameEl.setAttribute("hidden", "");
      if (openEl)     openEl.removeAttribute("hidden");
      if (logoutEl)   logoutEl.setAttribute("hidden", "");
      if (prestigeEl) prestigeEl.setAttribute("hidden", "");
      return;
    }

    fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok) throw new Error("session_expired");
        var label = d.is_admin ? d.username + " (Admin)" : d.username;
        if (statusEl)   statusEl.setAttribute("hidden", "");
        if (usernameEl) { usernameEl.removeAttribute("hidden"); usernameEl.textContent = "\uD83C\uDFC6 " + label; }
        if (openEl)     openEl.setAttribute("hidden", "");
        if (logoutEl)   logoutEl.removeAttribute("hidden");
        if (prestigeEl) prestigeEl.removeAttribute("hidden");
      })
      .catch(function() {
        clearToken();
        if (statusEl)   { statusEl.removeAttribute("hidden"); statusEl.textContent = (window.I18N && window.I18N["auth.session_expired"]) || "Session expired"; }
        if (usernameEl) usernameEl.setAttribute("hidden", "");
        if (openEl)     openEl.removeAttribute("hidden");
        if (logoutEl)   logoutEl.setAttribute("hidden", "");
        if (prestigeEl) prestigeEl.setAttribute("hidden", "");
      });
  }

  // ─── Logout ────────────────────────────────────────────────────────────────
  function bindLogout() {
    var btn = qs("#auth-logout");
    if (!btn) return;
    btn.addEventListener("click", function () {
      clearToken();
      refreshStatus();
    });
  }

  // ─── Fetch helper ──────────────────────────────────────────────────────────
  function ogxFetch(url, options) {
    var opts = options || {};
    var hdrs = {};
    var eh = opts.headers || {};
    for (var k in eh) hdrs[k] = eh[k];
    var csrf = getCsrfToken();
    if (csrf && !hdrs["x-csrf-token"]) hdrs["x-csrf-token"] = csrf;
    var token = getToken();
    if (token && !hdrs["Authorization"]) hdrs["Authorization"] = "Bearer " + token;
    return fetch(url, { method: opts.method, headers: hdrs, body: opts.body });
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  window.ogxAuth = { getToken: getToken, clearToken: clearToken, refreshStatus: refreshStatus };
  window.ogxFetch = ogxFetch;

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() { bindLogout(); refreshStatus(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

})();
