// app/static/auth.js
// JWT auth for OGX Oracle — CSP-safe, no inline JS, no eval.
(function () {
  "use strict";

  var TOKEN_KEY = "ogx_jwt";
  var path = window.location.pathname;
  var IS_LOGIN_PAGE   = path === "/login";
  var IS_LANDING_PAGE = path === "/" && window.location.search.indexOf("app=1") < 0
                        && window.location.search.indexOf("q=") < 0
                        && window.location.search.indexOf("ally=") < 0;
  var IS_APP_PAGE = !IS_LOGIN_PAGE && !IS_LANDING_PAGE;

  function qs(sel) { return document.querySelector(sel); }
  function getCsrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? (m.getAttribute("content") || "").trim() : "";
  }
  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  // ── i18n helper ────────────────────────────────────────────────
  function t(key, fallback) {
    return (window.I18N && window.I18N[key]) || fallback || key;
  }

  // ── Token Popup ────────────────────────────────────────────────
  function openPopup() {
    var popup    = qs("#token-popup");
    var backdrop = qs("#token-popup-backdrop");
    var ta       = qs("#token-popup-ta");
    if (!popup) return;
    if (ta) ta.value = getToken() || "";
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
      var copiedLabel = t("auth.copied", "Copied!");
      var copyLabel   = t("auth.copy",   "Copy Token");
      if (btn) btn.textContent = "\u2713 " + copiedLabel;
      if (copied) copied.textContent = "\u2713 " + copiedLabel;
      setTimeout(function() {
        if (btn) btn.textContent = copyLabel;
        if (copied) copied.textContent = "";
      }, 2000);
    }
  }

  // ── Mobile hamburger ───────────────────────────────────────────
  function bindHamburger() {
    var btn = qs("#nav-hamburger");
    var nav = qs("#main-nav");
    if (!btn || !nav) return;
    btn.addEventListener("click", function() {
      var open = nav.classList.toggle("nav-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function(a) {
      a.addEventListener("click", function() {
        nav.classList.remove("nav-open");
        btn.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ── Nav state ──────────────────────────────────────────────────
  function setLoggedIn(username) {
    var usernameEl = qs("#auth-username");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");

    // username without emoji — plain text only
    if (usernameEl) {
      usernameEl.removeAttribute("hidden");
      usernameEl.textContent = username;
    }
    if (logoutEl)   logoutEl.removeAttribute("hidden");
    if (prestigeEl) prestigeEl.removeAttribute("hidden");

    // Landing page: eingeloggt -> sofort zur App
    if (IS_LANDING_PAGE) {
      window.location.replace("/?app=1");
      return;
    }
    // /login: nach erfolgreichem Login -> App
    if (IS_LOGIN_PAGE) {
      setTimeout(function() { window.location.replace("/?app=1"); }, 300);
    }
  }

  function setLoggedOut(expired) {
    var usernameEl = qs("#auth-username");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");

    if (usernameEl) usernameEl.setAttribute("hidden", "");
    if (logoutEl)   logoutEl.setAttribute("hidden", "");
    if (prestigeEl) prestigeEl.setAttribute("hidden", "");
    closePopup();

    // App-Seiten: Token ungültig/abgelaufen -> zurück zur Landing Page
    if (IS_APP_PAGE) {
      window.location.replace("/");
    }
  }

  // ── Status check ───────────────────────────────────────────────
  function refreshStatus() {
    var token = getToken();
    if (!token) { setLoggedOut(false); return; }
    fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok) throw new Error("expired");
        var label = d.is_admin ? d.username + " \u2605" : d.username;
        setLoggedIn(label);
      })
      .catch(function() { clearToken(); setLoggedOut(true); });
  }

  // ── Logout ─────────────────────────────────────────────────────
  function bindLogout() {
    var btn = qs("#auth-logout");
    if (!btn) return;
    btn.addEventListener("click", function() {
      clearToken();
      setLoggedOut(false);
    });
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

  function init() { bindPopup(); bindHamburger(); bindLogout(); refreshStatus(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

})();
