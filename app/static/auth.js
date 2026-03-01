// app/static/auth.js
// JWT auth for OGX Oracle UI (Option B):
// - Stores token in localStorage
// - Shows auth status in topbar
// - Clicking status opens token modal
// - Logout clears token
// CSP-safe: no inline JS, no eval.

(function () {
  "use strict";

  const TOKEN_KEY = "ogx_jwt";

  function qs(sel) { return document.querySelector(sel); }

  function getToken() {
    try { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
    catch { return ""; }
  }

  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, String(t || "")); } catch {}
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  // -------------------------------
  // Token modal helpers
  // -------------------------------
  function modalEls() {
    const modal = qs("#token-modal");
    return {
      modal,
      backdrop: qs("#token-modal .token-modal__backdrop"),
      close: qs("#token-close"),
      copy: qs("#token-copy"),
      hide: qs("#token-hide"),
      ta: qs("#token-ta"),
      copied: qs("#token-copied"),
      sub: qs("#token-modal-sub"),
      pill: qs("#token-pill"),
    };
  }

  function openTokenModal(usernameLabel) {
    const el = modalEls();
    if (!el.modal) return;

    const token = getToken();

    if (el.ta) {
      el.ta.value = token || "";
      el.ta.scrollTop = 0;
    }
    if (el.copied) el.copied.style.display = "none";
    if (el.sub) el.sub.textContent = usernameLabel ? ("Logged in: " + usernameLabel) : "Logged in";
    if (el.pill) el.pill.textContent = "Bearer JWT";

    el.modal.hidden = false;
    el.modal.setAttribute("aria-hidden", "false");

    // focus textarea for quick ctrl+c
    if (el.ta) {
      el.ta.focus();
      try { el.ta.setSelectionRange(0, 0); } catch {}
    }
  }

  function closeTokenModal() {
    const el = modalEls();
    if (!el.modal) return;
    el.modal.hidden = true;
    el.modal.setAttribute("aria-hidden", "true");
    if (el.copied) el.copied.style.display = "none";
  }

  async function copyToken() {
    const el = modalEls();
    if (!el.ta) return;

    const val = String(el.ta.value || "").trim();
    if (!val) return;

    try {
      await navigator.clipboard.writeText(val);
    } catch {
      // fallback
      el.ta.focus();
      el.ta.select();
      document.execCommand("copy");
      try { el.ta.setSelectionRange(0, 0); } catch {}
    }

    if (el.copied) {
      el.copied.style.display = "";
      window.setTimeout(() => {
        if (el.copied) el.copied.style.display = "none";
      }, 1200);
    }
  }

  function hideToken() {
    const el = modalEls();
    if (el.ta) el.ta.value = "";
    if (el.copied) el.copied.style.display = "none";
  }

  function bindModal() {
    const el = modalEls();
    if (!el.modal) return;

    if (el.close) el.close.addEventListener("click", closeTokenModal);
    if (el.backdrop) el.backdrop.addEventListener("click", closeTokenModal);
    if (el.copy) el.copy.addEventListener("click", copyToken);
    if (el.hide) el.hide.addEventListener("click", hideToken);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTokenModal();
    });
  }

  // -------------------------------
  // Status bar
  // -------------------------------
  async function refreshStatus() {
    const statusText = qs("#auth-status");
    const statusBtn  = qs("#auth-status-btn");
    const openBtn    = qs("#auth-open");
    const logoutBtn  = qs("#auth-logout");

    const token = getToken();
    if (!token) {
      if (statusText) statusText.textContent = window.I18N?.["auth.not_logged_in"] || "Not logged in";
      if (statusBtn) statusBtn.style.display = "none";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      return;
    }

    try {
      const resp = await fetch("/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });

      if (!resp.ok) throw new Error("not_ok");

      const data = await resp.json();
      if (!data || !data.ok) throw new Error("bad");

      const label = data.is_admin ? (data.username + " (Admin)") : data.username;

      if (statusText) statusText.textContent = "";
      if (statusBtn) {
        statusBtn.textContent = (window.I18N?.["auth.logged_in_as"] ? (window.I18N["auth.logged_in_as"] + " " + label) : ("Logged in: " + label));
        statusBtn.style.display = "";
        statusBtn.onclick = () => openTokenModal(label);
      }

      if (openBtn) openBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
    } catch (e) {
      clearToken();
      if (statusText) statusText.textContent = window.I18N?.["auth.session_expired"] || "Session expired – please log in again";
      if (statusBtn) statusBtn.style.display = "none";
      if (openBtn) openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
    }
  }

  function bindUi() {
    const logoutBtn = qs("#auth-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        clearToken();
        await refreshStatus();
      });
    }
  }

  // expose minimal API for login.js
  window.ogxAuth = {
    getToken,
    setToken,
    clearToken,
    refreshStatus,
    openTokenModal,
    closeTokenModal,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bindUi();
      bindModal();
      refreshStatus();
    });
  } else {
    bindUi();
    bindModal();
    refreshStatus();
  }
})();
