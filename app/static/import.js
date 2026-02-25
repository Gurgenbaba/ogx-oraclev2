/**
 * app/static/import.js — OGX Oracle CSV Upload (AUTH + CSRF)
 *
 * - Sends the CSV via fetch() as multipart/form-data
 * - Includes x-csrf-token header (read from <meta name="csrf-token">)
 * - Includes Authorization: Bearer <token> (from auth.js / localStorage)
 * - If not logged in, opens login modal and aborts
 *
 * CSP: script-src 'self' — loaded as external static file.
 */
(function () {
  "use strict";

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? (meta.getAttribute("content") || "").trim() : "";
  }

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

  async function init() {
    const form = document.getElementById("import-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      // Require login for import
      const token = getToken();
      if (!token) {
        openLoginModal();
        alert("Login required to import CSV.");
        return;
      }

      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        alert("Please select a CSV file.");
        return;
      }

      const csrfToken = getCsrfToken();
      if (!csrfToken) {
        alert("CSRF token missing. Please reload the page and try again.");
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn ? btn.textContent : "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Importing…";
      }

      try {
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);

        // Prefer global helper (adds csrf+auth), fallback to manual fetch
        const doFetch =
          window.ogxFetch && typeof window.ogxFetch === "function"
            ? window.ogxFetch
            : (url, opts) => {
                const headers = (opts && opts.headers) ? { ...opts.headers } : {};
                headers["x-csrf-token"] = csrfToken;
                headers["Authorization"] = "Bearer " + token;
                return fetch(url, { ...opts, headers });
              };

        const response = await doFetch("/import", {
          method: "POST",
          headers: {
            "x-csrf-token": csrfToken,
            Authorization: "Bearer " + token,
          },
          body: formData,
          redirect: "follow",
        });

        if (response.status === 401 || response.status === 403) {
          try {
            if (window.ogxAuth && typeof window.ogxAuth.clearToken === "function") {
              window.ogxAuth.clearToken();
            }
            if (window.ogxAuth && typeof window.ogxAuth.refreshStatus === "function") {
              await window.ogxAuth.refreshStatus();
            }
          } catch {}
          openLoginModal();

          if (response.status === 403) {
            alert("Access denied (403). If logged in: reload the page and try again.");
          } else {
            alert("Session expired. Please log in again.");
          }
          return;
        }

        if (response.ok || response.redirected) {
          window.location.href = response.url || "/import-ui";
        } else if (response.status === 413) {
          alert("File too large. Maximum size: 2 MB / 25,000 rows.");
        } else {
          alert("Import failed (HTTP " + response.status + "). Please try again.");
        }
      } catch (err) {
        console.error("Import fetch error:", err);
        alert("Network error during import. Please try again.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();