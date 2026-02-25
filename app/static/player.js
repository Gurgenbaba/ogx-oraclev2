// app/static/player.js
// Player page UX + Auth-aware POST handling:
// - tr.tr-click rows toggle detail sections (data-detail="ID")
// - tr.tr-nav rows navigate to data-href on click/enter
// - Only one detail open at a time
// - ESC closes all
// - data-open button inside row also toggles
// - CSRF: inject hidden input into every POST form
// - AUTH: intercept POST forms (except #import-form) and submit via fetch with
//         Authorization: Bearer <token> + x-csrf-token
// - CSP-safe, no inline handlers

(function () {
  "use strict";

  const ONE_OPEN_AT_A_TIME = true;

  // ---------------------------------------------------------------------------
  // CSRF helpers
  // ---------------------------------------------------------------------------
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? (meta.getAttribute("content") || "").trim() : "";
  }

  function ensureCsrfInPostForms() {
    const token = getCsrfToken();
    if (!token) return;
    document.querySelectorAll('form[method="post"]').forEach((form) => {
      let input = form.querySelector('input[name="csrf_token"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "csrf_token";
        form.appendChild(input);
      }
      input.value = token;
    });
  }

  // ---------------------------------------------------------------------------
  // AUTH-aware POST submit
  // ---------------------------------------------------------------------------
  function getToken() {
    try {
      return window.ogxAuth && typeof window.ogxAuth.getToken === "function"
        ? (window.ogxAuth.getToken() || "").trim()
        : "";
    } catch {
      return "";
    }
  }

  function openLoginModal() {
    try {
      if (window.ogxAuth && typeof window.ogxAuth.openModal === "function") {
        window.ogxAuth.openModal();
      }
    } catch {}
  }

  async function submitPostFormWithAuth(form) {
    const token = getToken();
    if (!token) {
      openLoginModal();
      alert("Login required to save changes.");
      return;
    }

    const action = form.getAttribute("action") || window.location.pathname;
    const method = (form.getAttribute("method") || "post").toUpperCase();
    if (method !== "POST") {
      form.submit();
      return;
    }

    const formData = new FormData(form);

    // Prefer global helper (adds csrf + auth), fallback to manual fetch
    const doFetch =
      window.ogxFetch && typeof window.ogxFetch === "function"
        ? window.ogxFetch
        : (url, opts) => {
            const headers = (opts && opts.headers) ? { ...opts.headers } : {};
            const csrf = getCsrfToken();
            if (csrf) headers["x-csrf-token"] = csrf;
            headers["Authorization"] = "Bearer " + token;
            return fetch(url, { ...opts, headers });
          };

    const resp = await doFetch(action, {
      method: "POST",
      body: formData,
      redirect: "follow",
    });

    if (resp.status === 401 || resp.status === 403) {
      try {
        if (window.ogxAuth && typeof window.ogxAuth.clearToken === "function") {
          window.ogxAuth.clearToken();
        }
        if (window.ogxAuth && typeof window.ogxAuth.refreshStatus === "function") {
          await window.ogxAuth.refreshStatus();
        }
      } catch {}
      openLoginModal();
      alert("Session invalid/expired (or insufficient permissions). Please log in again.");
      return;
    }

    if (resp.status === 413) {
      alert("Request too large. Please use a smaller input/file.");
      return;
    }

    // RedirectResponse(303) etc.
    if (resp.redirected) {
      window.location.href = resp.url;
      return;
    }

    if (resp.ok) {
      window.location.reload();
      return;
    }

    alert("Save failed (HTTP " + resp.status + ").");
  }

  function interceptPostForms() {
    document.querySelectorAll('form[method="post"]').forEach((form) => {
      // import.js handles upload itself
      if (form.id === "import-form") return;

      if (form.__ogxIntercepted) return;
      form.__ogxIntercepted = true;

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitPostFormWithAuth(form).catch((err) => {
          console.error("POST form submit error:", err);
          alert("Network error while saving. Please try again.");
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function isInteractiveTarget(target) {
    return !!target.closest("a, button, input, select, textarea, label");
  }

  function getDetailRow(id) {
    return document.querySelector(`tr[data-detail-row="${cssEscape(id)}"]`);
  }

  function getTriggerRow(id) {
    return document.querySelector(`tr[data-detail="${cssEscape(id)}"]`);
  }

  function setExpandedState(id, expanded) {
    const trigger = getTriggerRow(id);
    if (trigger) trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function closeAllDetails(exceptId) {
    document.querySelectorAll("tr.tr-detail.open").forEach((row) => {
      const id = row.getAttribute("data-detail-row");
      if (!id) return;
      if (exceptId && String(id) === String(exceptId)) return;
      row.classList.remove("open");
      setExpandedState(id, false);
    });
  }

  function openDetail(id) {
    const row = getDetailRow(id);
    if (!row) return;
    if (ONE_OPEN_AT_A_TIME) closeAllDetails(id);
    row.classList.add("open");
    setExpandedState(id, true);
    const firstInput = row.querySelector("input, textarea, select, button");
    if (firstInput) firstInput.focus({ preventScroll: true });
  }

  function toggleDetail(idRaw) {
    const id = String(idRaw || "").trim();
    if (!id) return;
    const row = getDetailRow(id);
    if (!row) return;
    if (row.classList.contains("open")) {
      row.classList.remove("open");
      setExpandedState(id, false);
    } else {
      openDetail(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard accessibility for trigger rows
  // ---------------------------------------------------------------------------
  function enhanceTriggerRows() {
    // tr.tr-click = detail toggle rows
    document.querySelectorAll("tr.tr-click[data-detail]").forEach((tr) => {
      if (!tr.hasAttribute("tabindex")) tr.setAttribute("tabindex", "0");
      if (!tr.hasAttribute("role")) tr.setAttribute("role", "button");
      if (!tr.hasAttribute("aria-expanded")) tr.setAttribute("aria-expanded", "false");
    });

    // tr.tr-nav = navigation rows (galaxy overview)
    document.querySelectorAll("tr.tr-nav[data-href]").forEach((tr) => {
      if (!tr.hasAttribute("tabindex")) tr.setAttribute("tabindex", "0");
    });
  }

  // ---------------------------------------------------------------------------
  // Click handler
  // ---------------------------------------------------------------------------
  function onClick(e) {
    // data-open button (▸ expand button in table cell)
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleDetail(openBtn.getAttribute("data-open"));
      return;
    }

    // data-close button
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = closeBtn.getAttribute("data-close");
      closeAllDetails();
      const trigger = id ? getTriggerRow(id) : null;
      if (trigger) trigger.focus({ preventScroll: true });
      return;
    }

    // Don't steal clicks on interactive elements
    if (isInteractiveTarget(e.target)) return;

    // tr.tr-click — toggle detail
    const clickTr = e.target.closest("tr.tr-click[data-detail]");
    if (clickTr) {
      toggleDetail(clickTr.getAttribute("data-detail"));
      return;
    }

    // tr.tr-nav — navigate to href
    const navTr = e.target.closest("tr.tr-nav[data-href]");
    if (navTr) {
      window.location.href = navTr.getAttribute("data-href");
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Keydown handler
  // ---------------------------------------------------------------------------
  function onKeydown(e) {
    if (e.key === "Escape") {
      if (document.querySelector("tr.tr-detail.open")) {
        e.preventDefault();
        closeAllDetails();
      }
      return;
    }

    if (e.key !== "Enter" && e.key !== " ") return;

    const active = document.activeElement;
    if (!active) return;

    // tr.tr-click focused — toggle detail
    const clickTr = active.closest ? active.closest("tr.tr-click[data-detail]") : null;
    if (clickTr && !isInteractiveTarget(active)) {
      e.preventDefault();
      toggleDetail(clickTr.getAttribute("data-detail"));
      return;
    }

    // tr.tr-nav focused — navigate
    const navTr = active.closest ? active.closest("tr.tr-nav[data-href]") : null;
    if (navTr && e.key === "Enter") {
      e.preventDefault();
      window.location.href = navTr.getAttribute("data-href");
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function init() {
    ensureCsrfInPostForms();
    enhanceTriggerRows();
    interceptPostForms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
})();