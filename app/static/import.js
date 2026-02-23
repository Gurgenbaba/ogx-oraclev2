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
        alert("Login erforderlich, um CSV zu importieren.");
        return;
      }

      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        alert("Bitte eine CSV-Datei auswählen.");
        return;
      }

      const csrfToken = getCsrfToken();
      if (!csrfToken) {
        // Without CSRF token header, the middleware will likely reject unsafe requests.
        alert("CSRF-Token fehlt. Bitte Seite neu laden und erneut versuchen.");
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn ? btn.textContent : "";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Wird importiert…";
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
            // ogxFetch will set these too, but we keep explicit for clarity
            "x-csrf-token": csrfToken,
            Authorization: "Bearer " + token,
          },
          body: formData,
          redirect: "follow",
        });

        if (response.status === 401 || response.status === 403) {
          // Unauthorized: token expired/invalid OR CSRF issue
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
            alert("Zugriff verweigert (403). Falls eingeloggt: Seite neu laden und erneut versuchen.");
          } else {
            alert("Session abgelaufen. Bitte neu einloggen.");
          }
          return;
        }

        if (response.ok || response.redirected) {
          window.location.href = response.url || "/import-ui";
        } else if (response.status === 413) {
          alert("Datei zu groß. Maximale Größe: 2 MB / 25.000 Zeilen.");
        } else {
          alert("Import fehlgeschlagen (HTTP " + response.status + "). Bitte erneut versuchen.");
        }
      } catch (err) {
        console.error("Import fetch error:", err);
        alert("Netzwerkfehler beim Import. Bitte erneut versuchen.");
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