// app/static/auth.js
// JWT auth for OGX Oracle — CSP-safe, no inline JS, no eval.
(function () {
  "use strict";

  var TOKEN_KEY = "ogx_jwt";

  function qs(sel) { return document.querySelector(sel); }
  function getCsrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? (m.getAttribute("content") || "").trim() : "";
  }
  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  // ── Token Popup ────────────────────────────────────────────────
  function openPopup() {
    var popup    = qs("#token-popup");
    var backdrop = qs("#token-popup-backdrop");
    var ta       = qs("#token-popup-ta");
    if (!popup) return;
    var token = getToken();
    if (ta) ta.value = token || "";
    popup.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
  }

  function closePopup() {
    var popup    = qs("#token-popup");
    var backdrop = qs("#token-popup-backdrop");
    var copied   = qs("#token-popup-copied");
    if (popup)    popup.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
    if (copied)   copied.textContent = "";
  }

  function bindPopup() {
    var usernameEl = qs("#auth-username");
    var closeBtn   = qs("#token-popup-close");
    var backdrop   = qs("#token-popup-backdrop");
    var copyBtn    = qs("#token-popup-copy");
    var ta         = qs("#token-popup-ta");
    var copied     = qs("#token-popup-copied");

    if (usernameEl) usernameEl.addEventListener("click", openPopup);
    if (closeBtn)   closeBtn.addEventListener("click", closePopup);
    if (backdrop)   backdrop.addEventListener("click", closePopup);

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") closePopup();
    });

    if (copyBtn && ta) {
      copyBtn.addEventListener("click", function() {
        var val = ta.value;
        if (!val) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(showCopied).catch(fallback);
        } else { fallback(); }
      });
    }

    function fallback() {
      if (!ta) return;
      ta.select();
      try { document.execCommand("copy"); showCopied(); } catch(e) {}
    }

    function showCopied() {
      var btn = qs("#token-popup-copy");
      if (btn) btn.textContent = "\u2713 Kopiert!";
      if (copied) copied.textContent = "\u2713 " + ((window.I18N && window.I18N["auth.copied"]) || "Kopiert!");
      setTimeout(function() {
        if (btn) btn.textContent = (window.I18N && window.I18N["auth.copy"]) || "Token kopieren";
        if (copied) copied.textContent = "";
      }, 2000);
    }
  }

  // ── Nav state ──────────────────────────────────────────────────
  function setLoggedIn(username) {
    var statusEl   = qs("#auth-status");
    var usernameEl = qs("#auth-username");
    var openEl     = qs("#auth-open");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");

    if (statusEl)   statusEl.setAttribute("hidden", "");
    if (usernameEl) { usernameEl.removeAttribute("hidden"); usernameEl.textContent = "\uD83C\uDFC6 " + username; }
    if (openEl)     openEl.setAttribute("hidden", "");
    if (logoutEl)   logoutEl.removeAttribute("hidden");
    if (prestigeEl) prestigeEl.removeAttribute("hidden");
  }

  function setLoggedOut(expired) {
    var statusEl   = qs("#auth-status");
    var usernameEl = qs("#auth-username");
    var openEl     = qs("#auth-open");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");

    if (statusEl) {
      statusEl.textContent = expired
        ? ((window.I18N && window.I18N["auth.session_expired"]) || "Session expired")
        : ((window.I18N && window.I18N["auth.not_logged_in"])   || "Not logged in");
      statusEl.removeAttribute("hidden");
    }
    if (usernameEl) usernameEl.setAttribute("hidden", "");
    if (openEl)     openEl.removeAttribute("hidden");
    if (logoutEl)   logoutEl.setAttribute("hidden", "");
    if (prestigeEl) prestigeEl.setAttribute("hidden", "");
    closePopup();
  }

  // ── Status check ───────────────────────────────────────────────
  function refreshStatus() {
    var token = getToken();
    if (!token) { setLoggedOut(false); return; }
    fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok) throw new Error("expired");
        var label = d.is_admin ? d.username + " (Admin)" : d.username;
        setLoggedIn(label);
      })
      .catch(function() { clearToken(); setLoggedOut(true); });
  }

  // ── Logout ─────────────────────────────────────────────────────
  function bindLogout() {
    var btn = qs("#auth-logout");
    if (!btn) return;
    btn.addEventListener("click", function() { clearToken(); setLoggedOut(false); });
  }

  // ── Fetch helper ───────────────────────────────────────────────
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

  window.ogxAuth = { getToken: getToken, clearToken: clearToken, refreshStatus: refreshStatus };
  window.ogxFetch = ogxFetch;

  function init() { bindPopup(); bindLogout(); refreshStatus(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

})();
