/* app/static/i18n_boot.js
 * CSP-safe i18n bootstrap:
 * - Reads translations JSON from <meta name="ogx-i18n" content="...">
 * - Exposes window.I18N for all other scripts (auth.js, prestige.js, etc.)
 */
(function () {
  "use strict";

  function getMeta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute("content") : null;
  }

  try {
    var raw = getMeta("ogx-i18n");
    if (!raw) {
      window.I18N = window.I18N || {};
      return;
    }
    // content is JSON string (escaped for attribute), parse safely
    var obj = JSON.parse(raw);
    window.I18N = obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    window.I18N = window.I18N || {};
  }
})();
