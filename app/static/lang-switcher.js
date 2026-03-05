// lang-switcher.js — Language switcher
// No hardcoded language list — reads from DOM buttons injected by server
(function () {
  "use strict";

  function getCsrfToken() {
    // Read from <meta name="csrf-token"> set by base.html
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-lang]");
    if (!btn) return;

    var lang = btn.dataset.lang;
    if (!lang) return;

    // Optimistic UI: mark active immediately
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var isNow = b.dataset.lang === lang;
      b.classList.toggle("lang-btn--active", isNow);
      b.setAttribute("aria-pressed", isNow ? "true" : "false");
    });

    var csrf = getCsrfToken();

    fetch("/api/set-lang", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ lang: lang }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          var url = new URL(window.location.href);
          url.searchParams.delete("lang");
          window.location.replace(url.toString());
        }
      })
      .catch(function () {
        // Fallback: query param if fetch fails
        var url = new URL(window.location.href);
        url.searchParams.set("lang", lang);
        window.location.replace(url.toString());
      });
  });
})();
