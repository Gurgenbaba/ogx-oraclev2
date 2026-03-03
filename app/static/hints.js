// app/static/hints.js
(function () {
  "use strict";
  var KEY_DISMISSED = "ogx_hint_dismissed_v1";
  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function dismissed() { try { return localStorage.getItem(KEY_DISMISSED) === "1"; } catch(e) { return false; } }
  function setDismissed() { try { localStorage.setItem(KEY_DISMISSED, "1"); } catch(e) {} }
  function isGalaxyPage() { var p = location.pathname || ""; return p === "/galaxy" || p.indexOf("/galaxy/") === 0; }
  function getUILang() { var l = (document.documentElement.lang || "").toLowerCase().slice(0,2); return ["de","en","fr"].indexOf(l) >= 0 ? l : "en"; }

  // Alle 3 Sprachen abgedeckt
  var SCAN_COUNT_PATTERNS = [
    /(\d+)\s*Systeme?\s+gescannt/i,
    /(\d+)\s*systems?\s+scanned/i,
    /(\d+)\s*syst[e\u00e8]mes?\s+scann[e\u00e9]s?/i
  ];
  function getScanCount() {
    var els = document.querySelectorAll(".pill,.muted,.card,header,main");
    for (var i = 0; i < els.length; i++) {
      var txt = (els[i].textContent || "").replace(/\s+/g," ").trim();
      for (var j = 0; j < SCAN_COUNT_PATTERNS.length; j++) {
        var m = txt.match(SCAN_COUNT_PATTERNS[j]); if (m) return parseInt(m[1], 10);
      }
    }
    return null;
  }

  var CONTENT = {
    en: { lines: ["> INITIALIZING OGX-ORACLE v2.0...","> CONNECTING TO SECTOR DATABASE...","> AUTHENTICATING AGENT... OK","> SCANNING GALAXY NODES............","> DECRYPTING PLAYER SIGNATURES...","> CROSS-REFERENCING COLONY DATA...","> ANOMALY DETECTED: large dataset","> BYPASSING RATE LIMITS... OK","> INJECTING SCAN BUFFER...","> DATA STREAM ESTABLISHED \u2588","> HINT READY. TRANSMITTING..."], msg: "Galaxy is loading a large dataset. With many systems this can take a moment â€” that's normal. Tip: use the galaxy filter (1â€“9) or open player details after the list has fully loaded.", gotIt: "Got it", dontShow: "Don't show again" },
    de: { lines: ["> OGX-ORACLE v2.0 WIRD GESTARTET...","> VERBINDUNG ZUR SEKTOR-DATENBANK...","> AGENT AUTHENTIFIZIERT... OK","> GALAXIE-KNOTEN WERDEN GESCANNT......","> SPIELER-SIGNATUREN ENTSCHL\u00dcSSELT...","> KOLONIE-DATEN WERDEN ABGEGLICHEN...","> ANOMALIE ERKANNT: gro\u00dfer Datensatz","> RATE-LIMITS WERDEN UMGANGEN... OK","> SCAN-PUFFER WIRD GELADEN...","> DATENSTREAM HERGESTELLT \u2588","> HINWEIS BEREIT. WIRD \u00dcBERTRAGEN..."], msg: "Die Galaxie l\u00e4dt einen gro\u00dfen Datensatz. Bei vielen Systemen kann das einen Moment dauern â€” das ist normal. Tipp: Galaxie-Filter (1\u20139) nutzen oder Spieler-Details erst nach vollst\u00e4ndigem Laden \u00f6ffnen.", gotIt: "Verstanden", dontShow: "Nicht mehr anzeigen" },
    fr: { lines: ["> INITIALISATION OGX-ORACLE v2.0...","> CONNEXION \u00c0 LA BASE DE DONN\u00c9ES...","> AUTHENTIFICATION DE L'AGENT... OK","> SCAN DES N\u0152UDS DE GALAXIE............","> D\u00c9CHIFFREMENT DES SIGNATURES...","> RECOUPEMENT DES DONN\u00c9ES DE COLONIES...","> ANOMALIE D\u00c9TECT\u00c9E : grand jeu de donn\u00e9es","> CONTOURNEMENT DES LIMITES... OK","> INJECTION DU TAMPON DE SCAN...","> FLUX DE DONN\u00c9ES \u00c9TABLI \u2588","> CONSEIL PR\u00caT. TRANSMISSION..."], msg: "La galaxie charge un grand jeu de donn\u00e9es. Avec de nombreux syst\u00e8mes, cela peut prendre un moment â€” c'est normal. Conseil : utilisez le filtre de galaxie (1\u20139) ou ouvrez les d\u00e9tails des joueurs apr\u00e8s le chargement complet.", gotIt: "Compris", dontShow: "Ne plus afficher" }
  };

  function typeWriter(el, text, speed, onDone) {
    var i = 0; el.textContent = "";
    function tick() { if (i < text.length) { el.textContent += text[i++]; setTimeout(tick, speed + Math.random() * speed * 0.6); } else if (onDone) { onDone(); } }
    tick();
  }

  function buildBuddy(lang) {
    var c = CONTENT[lang] || CONTENT.en;
    var wrap = ce("div","oracle-buddy"); wrap.setAttribute("role","dialog"); wrap.setAttribute("aria-label","Oracle Hint");
    var img = ce("img","oracle-buddy__img"); img.src = "/static/oracle.png"; img.alt = "OGX Oracle";
    var box = ce("div","oracle-buddy__box");
    var title = ce("div","oracle-buddy__title"); title.textContent = "// OGX-ORACLE";
    var terminal = ce("div","oracle-buddy__terminal");
    var pw = ce("div","oracle-buddy__progress-wrap"), pb = ce("div","oracle-buddy__progress-bar"); pw.appendChild(pb);
    var msg = ce("div","oracle-buddy__msg"); msg.style.display = "none"; msg.textContent = c.msg;
    var actions = ce("div","oracle-buddy__actions"); actions.style.display = "none";
    var btnOk = ce("button","btn btn-sm"); btnOk.type = "button"; btnOk.textContent = c.gotIt; btnOk.addEventListener("click", function() { wrap.remove(); });
    var btnHide = ce("button","btn btn-sm ghost"); btnHide.type = "button"; btnHide.textContent = c.dontShow; btnHide.addEventListener("click", function() { setDismissed(); wrap.remove(); });
    actions.appendChild(btnOk); actions.appendChild(btnHide);
    box.appendChild(title); box.appendChild(terminal); box.appendChild(pw); box.appendChild(msg); box.appendChild(actions);
    wrap.appendChild(img); wrap.appendChild(box);
    function runHack(idx) {
      if (idx >= c.lines.length) { pb.style.width = "100%"; pb.style.background = "var(--good,#34d399)"; setTimeout(function() { terminal.style.display="none"; pw.style.display="none"; msg.style.display="block"; actions.style.display="flex"; }, 400); return; }
      pb.style.width = Math.round((idx / c.lines.length) * 100) + "%";
      var line = ce("div","oracle-buddy__line");
      if (/ANOMALIE|ANOMALY/i.test(c.lines[idx])) line.style.color = "var(--warn,#f59e0b)";
      else if (/OK|BEREIT|PR.T|READY/i.test(c.lines[idx])) line.style.color = "var(--good,#34d399)";
      terminal.appendChild(line); terminal.scrollTop = terminal.scrollHeight;
      typeWriter(line, c.lines[idx], idx < 3 ? 28 : idx < 7 ? 22 : 18, function() { setTimeout(function() { runHack(idx+1); }, 80 + Math.random()*120); });
    }
    setTimeout(function() { runHack(0); }, 180);
    return wrap;
  }

  function injectStyles() {
    if (document.getElementById("ogx-buddy-styles")) return;
    var s = document.createElement("style"); s.id = "ogx-buddy-styles";
    s.textContent = ".oracle-buddy__terminal{font-family:'JetBrains Mono','Fira Mono',Consolas,monospace;font-size:11px;line-height:1.7;color:rgba(100,200,255,.85);background:rgba(0,0,0,.35);border:1px solid rgba(91,163,245,.18);border-radius:8px;padding:10px 12px;min-height:48px;max-height:160px;overflow-y:auto;margin-bottom:10px;letter-spacing:.02em}.oracle-buddy__line{white-space:pre}.oracle-buddy__progress-wrap{height:4px;background:rgba(91,163,245,.12);border-radius:99px;overflow:hidden;margin-bottom:10px}.oracle-buddy__progress-bar{height:100%;width:0%;background:rgba(91,163,245,.7);border-radius:99px;transition:width .25s ease,background .4s ease}.oracle-buddy__actions{gap:8px}";
    document.head.appendChild(s);
  }

  function maybeShow() {
    if (dismissed()) return; if (!isGalaxyPage()) return; if (qs(".oracle-buddy")) return;
    var count = getScanCount(); if (count !== null && count < 120) return;
    injectStyles(); document.body.appendChild(buildBuddy(getUILang()));
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", maybeShow); } else { maybeShow(); }
})();
