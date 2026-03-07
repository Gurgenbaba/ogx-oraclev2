// app/static/auth.js
// JWT auth for OGX Oracle — CSP-safe, no inline JS, no eval.
(function () {
  "use strict";

  var TOKEN_KEY    = "ogx_jwt";
  var PATH         = window.location.pathname;
  var IS_INDEX     = PATH === "/" || PATH === "";
  var IS_LOGIN     = PATH === "/login";

  function qs(sel) { return document.querySelector(sel); }
  function getCsrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? (m.getAttribute("content") || "").trim() : "";
  }
  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function t(key, fallback) {
    return (window.I18N && window.I18N[key]) || fallback || key;
  }

  // ── Index: show landing or app section ────────────────────────
  function showLanding() {
    var landing = qs("#landing-section");
    var app     = qs("#app-section");
    if (landing) landing.style.display = "";
    if (app)     app.style.display = "none";
  }

  function showApp() {
    var landing = qs("#landing-section");
    var app     = qs("#app-section");
    if (landing) landing.style.display = "none";
    if (app)     app.style.display = "";
  }

  // ── Token Popup ───────────────────────────────────────────────
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
          navigator.clipboard.writeText(val).then(showCopied).catch(fallbackCopy);
        } else { fallbackCopy(); }
      });
    }

    function fallbackCopy() {
      if (!ta) return;
      ta.select();
      try { document.execCommand("copy"); showCopied(); } catch(e) {}
    }

    function showCopied() {
      var btn = qs("#token-popup-copy");
      var copiedLabel = t("auth.copied", "Copied!");
      var copyLabel   = t("auth.copy",   "Copy Token");
      if (btn)    btn.textContent    = "\u2713 " + copiedLabel;
      if (copied) copied.textContent = "\u2713 " + copiedLabel;
      setTimeout(function() {
        if (btn)    btn.textContent    = copyLabel;
        if (copied) copied.textContent = "";
      }, 2000);
    }
  }

  // ── Mobile hamburger ──────────────────────────────────────────
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

  // ── Nav state ─────────────────────────────────────────────────
  function setLoggedIn(username) {
    var usernameEl = qs("#auth-username");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");
    var linkNavEl  = qs("#nav-link-account");

    if (usernameEl) { usernameEl.removeAttribute("hidden"); usernameEl.textContent = username; }
    if (logoutEl)   logoutEl.removeAttribute("hidden");
    if (prestigeEl) prestigeEl.removeAttribute("hidden");
    if (linkNavEl)  linkNavEl.removeAttribute("hidden");

    if (IS_INDEX)  showApp();
    if (IS_LOGIN)  window.location.replace("/");
  }

  function setLoggedOut() {
    var usernameEl = qs("#auth-username");
    var logoutEl   = qs("#auth-logout");
    var prestigeEl = qs("#nav-prestige");
    var linkNavEl  = qs("#nav-link-account");

    if (usernameEl) usernameEl.setAttribute("hidden", "");
    if (logoutEl)   logoutEl.setAttribute("hidden", "");
    if (prestigeEl) prestigeEl.setAttribute("hidden", "");
    if (linkNavEl)  linkNavEl.setAttribute("hidden", "");
    closePopup();

    if (IS_INDEX) {
      showLanding();
    } else if (!IS_LOGIN) {
      // Protected pages → back to index (shows landing)
      window.location.replace("/");
    }
  }

  // ── Status check ──────────────────────────────────────────────
  function refreshStatus() {
    var token = getToken();
    if (!token) { setLoggedOut(); return; }
    fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok) throw new Error("expired");
        var label = d.is_admin ? d.username + " \u2605" : d.username;
        setLoggedIn(label);
      })
      .catch(function() { clearToken(); setLoggedOut(); });
  }

  // ── Logout ────────────────────────────────────────────────────
  function bindLogout() {
    var btn = qs("#auth-logout");
    if (!btn) return;
    btn.addEventListener("click", function() {
      clearToken();
      setLoggedOut();
    });
  }

  // ── Fetch helper ──────────────────────────────────────────────
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
