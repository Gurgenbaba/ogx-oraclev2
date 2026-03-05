// lang-switcher.js — Language switcher logic
// Reads buttons injected by base.html (server-side, from lang/*.json discovery)
// No hardcoded language list — everything comes from the DOM
(function () {
  "use strict";

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

    // Persist via server (sets cookie ogx_lang=XX, 1 year)
    fetch("/api/set-lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: lang }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          // Reload without ?lang= to let cookie take over
          var url = new URL(window.location.href);
          url.searchParams.delete("lang");
          window.location.replace(url.toString());
        }
      })
      .catch(function () {
        // Fallback: use query param if fetch fails
        var url = new URL(window.location.href);
        url.searchParams.set("lang", lang);
        window.location.replace(url.toString());
      });
  });
})();
