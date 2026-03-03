// app/static/auth.js
(function () {
  "use strict";
  var TOKEN_KEY = "ogx_jwt";
  var IS_LOGIN_PAGE = window.location.pathname === "/login";
  function qs(sel) { return document.querySelector(sel); }
  function getCsrfToken() { var m = document.querySelector('meta[name="csrf-token"]'); return m ? (m.getAttribute("content") || "").trim() : ""; }
  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }
  function t(key, fallback) { return (window.I18N && window.I18N[key]) || fallback || key; }

  function openPopup() { var p = qs("#token-popup"), b = qs("#token-popup-backdrop"), ta = qs("#token-popup-ta"); if (!p) return; if (ta) ta.value = getToken() || ""; p.classList.add("open"); if (b) b.classList.add("open"); }
  function closePopup() { var p = qs("#token-popup"), b = qs("#token-popup-backdrop"), c = qs("#token-popup-copied"); if (p) p.classList.remove("open"); if (b) b.classList.remove("open"); if (c) c.textContent = ""; }

  function bindPopup() {
    var usernameEl = qs("#auth-username"), closeBtn = qs("#token-popup-close"), backdrop = qs("#token-popup-backdrop"), copyBtn = qs("#token-popup-copy"), ta = qs("#token-popup-ta"), copied = qs("#token-popup-copied");
    if (usernameEl) usernameEl.addEventListener("click", openPopup);
    if (closeBtn) closeBtn.addEventListener("click", closePopup);
    if (backdrop) backdrop.addEventListener("click", closePopup);
    document.addEventListener("keydown", function(e) { if (e.key === "Escape") closePopup(); });
    if (copyBtn && ta) {
      copyBtn.addEventListener("click", function() {
        var val = ta.value; if (!val) return;
        function showCopied() {
          var lbl = t("auth.copied", "Copied!"), copyLbl = t("auth.copy", "Copy Token");
          if (copyBtn) copyBtn.textContent = "\u2713 " + lbl;
          if (copied) copied.textContent = "\u2713 " + lbl;
          setTimeout(function() { if (copyBtn) copyBtn.textContent = copyLbl; if (copied) copied.textContent = ""; }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(val).then(showCopied).catch(function(){ ta.select(); try { document.execCommand("copy"); showCopied(); } catch(e){} }); }
        else { ta.select(); try { document.execCommand("copy"); showCopied(); } catch(e){} }
      });
    }
  }

  function bindHamburger() {
    var btn = qs("#nav-hamburger"), nav = qs("#main-nav"); if (!btn || !nav) return;
    btn.addEventListener("click", function() { var open = nav.classList.toggle("nav-open"); btn.setAttribute("aria-expanded", open ? "true" : "false"); });
    nav.querySelectorAll("a").forEach(function(a) { a.addEventListener("click", function() { nav.classList.remove("nav-open"); btn.setAttribute("aria-expanded", "false"); }); });
  }

  function setLoggedIn(username) {
    var s = qs("#auth-status"), u = qs("#auth-username"), o = qs("#auth-open"), l = qs("#auth-logout"), p = qs("#nav-prestige");
    if (s) s.setAttribute("hidden", ""); if (u) { u.removeAttribute("hidden"); u.textContent = "\uD83C\uDFC6 " + username; }
    if (o) o.setAttribute("hidden", ""); if (l) l.removeAttribute("hidden"); if (p) p.removeAttribute("hidden");
    if (IS_LOGIN_PAGE) setTimeout(function() { window.location.href = "/?app=1"; }, 300);
  }

  function setLoggedOut(expired) {
    var s = qs("#auth-status"), u = qs("#auth-username"), o = qs("#auth-open"), l = qs("#auth-logout"), p = qs("#nav-prestige");
    if (s) { s.textContent = expired ? t("auth.session_expired", "Session expired") : t("auth.not_logged_in", "Not logged in"); s.removeAttribute("hidden"); }
    if (u) u.setAttribute("hidden", ""); if (o) o.removeAttribute("hidden"); if (l) l.setAttribute("hidden", ""); if (p) p.setAttribute("hidden", "");
    closePopup();
    if (!IS_LOGIN_PAGE) window.location.href = "/login";
  }

  function refreshStatus() {
    var onLanding = window.location.pathname === "/" && window.location.search.indexOf("app=1") < 0 && !window.location.search.includes("q=") && !window.location.search.includes("ally=");
    var token = getToken(); if (!token) { setLoggedOut(false); return; }
    fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (!d || !d.ok) throw new Error(); if (onLanding) { window.location.replace("/?app=1"); return; }
        setLoggedIn(d.is_admin ? d.username + " \u2605" : d.username); })
      .catch(function() { clearToken(); setLoggedOut(true); });
  }

  function bindLogout() { var btn = qs("#auth-logout"); if (!btn) return; btn.addEventListener("click", function() { clearToken(); setLoggedOut(false); }); }

  function ogxFetch(url, options) {
    var opts = options || {}, hdrs = {}, eh = opts.headers || {};
    for (var k in eh) hdrs[k] = eh[k];
    var csrf = getCsrfToken(); if (csrf && !hdrs["x-csrf-token"]) hdrs["x-csrf-token"] = csrf;
    var token = getToken(); if (token && !hdrs["Authorization"]) hdrs["Authorization"] = "Bearer " + token;
    return fetch(url, { method: opts.method, headers: hdrs, body: opts.body });
  }

  window.ogxAuth = { getToken: getToken, clearToken: clearToken, refreshStatus: refreshStatus };
  window.ogxFetch = ogxFetch;
  function init() { bindPopup(); bindHamburger(); bindLogout(); refreshStatus(); }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();

