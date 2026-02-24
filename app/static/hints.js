// app/static/hints.js
// CSP-safe: no inline JS, no eval.
// Shows a "glowing oracle" hint on Galaxy pages when dataset is large.

(function () {
  "use strict";

  const KEY_DISMISSED = "ogx_hint_dismissed_v1";

  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function dismissed() {
    try { return localStorage.getItem(KEY_DISMISSED) === "1"; } catch { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(KEY_DISMISSED, "1"); } catch {}
  }

  function isGalaxyPage() {
    const p = (location.pathname || "");
    return p === "/galaxy" || p.startsWith("/galaxy/");
  }

  function getScanCountFromDom() {
    // tries to find "XXX Systeme gescannt"
    const candidates = Array.from(document.querySelectorAll(".pill, .muted, .card, header, main"));
    for (const el of candidates) {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      const m = txt.match(/(\d+)\s*Systeme\s+gescannt/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function buildBuddy() {
    const wrap = ce("div", "oracle-buddy");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Oracle Hinweis");

    const img = ce("img", "oracle-buddy__img");
    img.src = "/static/oracle.png";
    img.alt = "OGX Oracle";

    const box = ce("div", "oracle-buddy__box");

    const title = ce("div", "oracle-buddy__title");
    title.textContent = "Oracle Hint";

    const msg = ce("div", "oracle-buddy__msg");
    msg.textContent =
      "Galaxy lädt gerade viele Daten. Bei vielen Systemen/Planeten kann das kurz dauern — das ist normal. " +
      "Tipp: nutze den Galaxie-Filter (1..9) oder öffne erst Details, nachdem die Liste geladen hat.";

    const actions = ce("div", "oracle-buddy__actions");

    const btnOk = ce("button", "btn btn-sm");
    btnOk.type = "button";
    btnOk.textContent = "Verstanden";
    btnOk.addEventListener("click", () => wrap.remove());

    const btnHide = ce("button", "btn btn-sm ghost");
    btnHide.type = "button";
    btnHide.textContent = "Nicht mehr anzeigen";
    btnHide.addEventListener("click", () => { setDismissed(); wrap.remove(); });

    actions.appendChild(btnOk);
    actions.appendChild(btnHide);

    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(actions);

    wrap.appendChild(img);
    wrap.appendChild(box);

    return wrap;
  }

  function maybeShow() {
    if (dismissed()) return;
    if (!isGalaxyPage()) return;
    if (qs(".oracle-buddy")) return;

    const count = getScanCountFromDom();
    // show hint if large dataset OR count unknown (still helpful)
    if (count !== null && count < 120) return;

    document.body.appendChild(buildBuddy());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShow);
  } else {
    maybeShow();
  }
})();