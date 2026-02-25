// app/static/hints.js
// CSP-safe: no inline JS, no eval.
// Immersive "hacking terminal" oracle buddy for Galaxy pages.

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
    const candidates = Array.from(document.querySelectorAll(".pill, .muted, .card, header, main"));
    for (const el of candidates) {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      const m = txt.match(/(\d+)\s*Systeme\s+gescannt/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  // ── Terminal lines typed out during "hack" sequence ──────────────────────
  const HACK_LINES = [
    "> INITIALIZING OGX-ORACLE v2.0...",
    "> CONNECTING TO SECTOR DATABASE...",
    "> AUTHENTICATING AGENT... OK",
    "> SCANNING GALAXY NODES............",
    "> DECRYPTING PLAYER SIGNATURES...",
    "> CROSS-REFERENCING COLONY DATA...",
    "> ANOMALY DETECTED: large dataset",
    "> BYPASSING RATE LIMITS... OK",
    "> INJECTING SCAN BUFFER...",
    "> DATA STREAM ESTABLISHED █",
    "> HINT READY. TRANSMITTING...",
  ];

  const FINAL_MSG =
    "Galaxy lädt gerade viele Daten. Bei vielen Systemen kann das kurz dauern — das ist normal. " +
    "Tipp: nutze den Galaxie-Filter (1–9) oder öffne erst Details, nachdem die Liste geladen hat.";

  // ── Typewriter helper ─────────────────────────────────────────────────────
  function typeWriter(el, text, speed, onDone) {
    let i = 0;
    el.textContent = "";
    function tick() {
      if (i < text.length) {
        el.textContent += text[i++];
        setTimeout(tick, speed + Math.random() * speed * 0.6);
      } else if (onDone) {
        onDone();
      }
    }
    tick();
  }

  // ── Build the buddy UI ────────────────────────────────────────────────────
  function buildBuddy() {
    const wrap = ce("div", "oracle-buddy");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Oracle Hinweis");

    const img = ce("img", "oracle-buddy__img");
    img.src = "/static/oracle.png";
    img.alt = "OGX Oracle";

    const box = ce("div", "oracle-buddy__box");

    // Title
    const title = ce("div", "oracle-buddy__title");
    title.textContent = "// OGX-ORACLE";

    // Terminal output area
    const terminal = ce("div", "oracle-buddy__terminal");

    // Progress bar
    const progressWrap = ce("div", "oracle-buddy__progress-wrap");
    const progressBar  = ce("div", "oracle-buddy__progress-bar");
    progressWrap.appendChild(progressBar);

    // Final message (hidden until hack complete)
    const msg = ce("div", "oracle-buddy__msg");
    msg.style.display = "none";
    msg.textContent = FINAL_MSG;

    // Actions (hidden until hack complete)
    const actions = ce("div", "oracle-buddy__actions");
    actions.style.display = "none";

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
    box.appendChild(terminal);
    box.appendChild(progressWrap);
    box.appendChild(msg);
    box.appendChild(actions);

    wrap.appendChild(img);
    wrap.appendChild(box);

    // ── Animate the hack sequence ────────────────────────────────────────
    function runHack(lineIndex) {
      if (lineIndex >= HACK_LINES.length) {
        // Done — show final message
        progressBar.style.width = "100%";
        progressBar.style.background = "var(--good, #34d399)";
        setTimeout(() => {
          terminal.style.display = "none";
          progressWrap.style.display = "none";
          msg.style.display = "block";
          actions.style.display = "flex";
        }, 400);
        return;
      }

      // Update progress bar
      const pct = Math.round((lineIndex / HACK_LINES.length) * 100);
      progressBar.style.width = pct + "%";

      // Add new line element
      const line = ce("div", "oracle-buddy__line");
      // Color some lines differently for effect
      if (HACK_LINES[lineIndex].includes("ANOMALY")) {
        line.style.color = "var(--warn, #f59e0b)";
      } else if (HACK_LINES[lineIndex].includes("OK") || HACK_LINES[lineIndex].includes("READY")) {
        line.style.color = "var(--good, #34d399)";
      }
      terminal.appendChild(line);
      terminal.scrollTop = terminal.scrollHeight;

      // Type the line, then move to next
      const speed = lineIndex < 3 ? 28 : lineIndex < 7 ? 22 : 18;
      typeWriter(line, HACK_LINES[lineIndex], speed, () => {
        // Small pause between lines
        const pause = 80 + Math.random() * 120;
        setTimeout(() => runHack(lineIndex + 1), pause);
      });
    }

    // Start after a tiny delay so DOM is ready
    setTimeout(() => runHack(0), 180);

    return wrap;
  }

  // ── CSS injected once ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("ogx-buddy-styles")) return;
    const s = document.createElement("style");
    s.id = "ogx-buddy-styles";
    s.textContent = `
      .oracle-buddy__terminal {
        font-family: "JetBrains Mono", "Fira Mono", Consolas, monospace;
        font-size: 11px;
        line-height: 1.7;
        color: rgba(100,200,255,.85);
        background: rgba(0,0,0,.35);
        border: 1px solid rgba(91,163,245,.18);
        border-radius: 8px;
        padding: 10px 12px;
        min-height: 48px;
        max-height: 160px;
        overflow-y: auto;
        margin-bottom: 10px;
        letter-spacing: .02em;
      }
      .oracle-buddy__line {
        white-space: pre;
      }
      .oracle-buddy__progress-wrap {
        height: 4px;
        background: rgba(91,163,245,.12);
        border-radius: 99px;
        overflow: hidden;
        margin-bottom: 10px;
      }
      .oracle-buddy__progress-bar {
        height: 100%;
        width: 0%;
        background: rgba(91,163,245,.7);
        border-radius: 99px;
        transition: width .25s ease, background .4s ease;
      }
      .oracle-buddy__actions {
        gap: 8px;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  function maybeShow() {
    if (dismissed()) return;
    if (!isGalaxyPage()) return;
    if (qs(".oracle-buddy")) return;

    const count = getScanCountFromDom();
    if (count !== null && count < 120) return;

    injectStyles();
    document.body.appendChild(buildBuddy());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShow);
  } else {
    maybeShow();
  }
})();
