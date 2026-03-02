// i18n.js — populated server-side via data attribute, read by all client scripts
// CSP-safe: no inline scripts
(function () {
  "use strict";
  var el = document.getElementById("i18n-data");
  try {
    window.I18N = el ? JSON.parse(el.textContent) : {};
  } catch (e) {
    window.I18N = {};
  }
})();
