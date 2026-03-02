// ==UserScript==
// @name         OGX Oracle – Galaxy Collector
// @namespace    ogx-oracle
// @version      2.2.0
// @description  Collects Galaxy View data and sends to OGX Oracle. Supports DE/EN/FR OGame servers.
// @match        https://uni1.playogx.com/*
// @match        http://uni1.playogx.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @connect      localhost
// @connect      ogx-oraclev2-production.up.railway.app
// ==/UserScript==

(function () {
  "use strict";

  // -----------------------------------------------
  // Language detection (auto from OGame page)
  // -----------------------------------------------
  function detectLang() {
    // 1) <html lang="de"> / "en" / "fr"
    const htmlLang = (document.documentElement.lang || "").toLowerCase().slice(0, 2);
    if (["de", "en", "fr"].includes(htmlLang)) return htmlLang;

    // 2) URL path like /de/ /en/ /fr/
    const urlMatch = window.location.pathname.match(/\/(de|en|fr)\//i);
    if (urlMatch) return urlMatch[1].toLowerCase();

    // 3) OGame meta tag
    const meta = document.querySelector('meta[name="language"]');
    if (meta) {
      const l = (meta.content || "").toLowerCase().slice(0, 2);
      if (["de", "en", "fr"].includes(l)) return l;
    }

    // 4) Check for known DE-only strings in page
    if (document.body && /Galaxie|Sonnensystem|Planeten/i.test(document.body.innerHTML || "")) return "de";
    if (document.body && /Galaxy|Solar System|Planets/i.test(document.body.innerHTML || "")) return "en";

    return "de"; // OGX default
  }

  // Language-specific strings
  const LANG_STRINGS = {
    de: {
      moon_regex:      /Mond\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      colony_fallback: "Kolonie",
      setup_title:     "OGX Oracle Setup",
      prompt_url:      "OGX Oracle Base URL (z.B. http://127.0.0.1:8000):",
      prompt_auth:     "Auth wählen:\n1 = Bearer JWT\n2 = API Key\n(Enter = überspringen)",
      prompt_jwt:      "Bearer JWT (nur Token, ohne 'Bearer '):",
      prompt_apikey:   "API Key:",
      prompt_autosend: "Auto-Send aktiv?\n1 = Ja\n0 = Nein",
      badge_title:     "OGX Oracle – Klick: senden | Rechtsklick: Setup",
      setup_ok:        "SETUP OK",
      menu_label:      "⬡ OGX Oracle",
    },
    en: {
      moon_regex:      /Moon\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      colony_fallback: "Colony",
      setup_title:     "OGX Oracle Setup",
      prompt_url:      "OGX Oracle Base URL (e.g. http://127.0.0.1:8000):",
      prompt_auth:     "Choose auth:\n1 = Bearer JWT\n2 = API Key\n(Enter = skip)",
      prompt_jwt:      "Bearer JWT (token only, without 'Bearer '):",
      prompt_apikey:   "API Key:",
      prompt_autosend: "Enable Auto-Send?\n1 = Yes\n0 = No",
      badge_title:     "OGX Oracle – Click: send | Right-click: Setup",
      setup_ok:        "SETUP OK",
      menu_label:      "⬡ OGX Oracle",
    },
    fr: {
      moon_regex:      /Lune\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      colony_fallback: "Colonie",
      setup_title:     "OGX Oracle Setup",
      prompt_url:      "URL de base OGX Oracle (ex. http://127.0.0.1:8000) :",
      prompt_auth:     "Choisir l'auth :\n1 = Bearer JWT\n2 = Clé API\n(Entrée = ignorer)",
      prompt_jwt:      "Bearer JWT (token uniquement, sans 'Bearer ') :",
      prompt_apikey:   "Clé API :",
      prompt_autosend: "Activer l'envoi automatique ?\n1 = Oui\n0 = Non",
      badge_title:     "OGX Oracle – Clic : envoyer | Clic droit : Setup",
      setup_ok:        "CONFIG OK",
      menu_label:      "⬡ OGX Oracle",
    },
  };

  // Detect once at startup (DOM may not be ready yet for body check, refine later)
  let LANG = "de";
  function initLang() {
    LANG = detectLang();
    log("Detected language:", LANG);
  }
  function L() { return LANG_STRINGS[LANG] || LANG_STRINGS.de; }

  // -----------------------------------------------
  // Config
  // -----------------------------------------------
  const STORAGE = {
    ORACLE_BASE: "ogx_oracle_base_url",
    API_KEY:     "ogx_oracle_api_key",
    JWT:         "ogx_oracle_jwt",
    AUTO_SEND:   "ogx_oracle_auto_send",
  };
  const DEFAULTS = {
    ORACLE_BASE: "http://127.0.0.1:8000",
    AUTO_SEND:   true,
  };
  const DEBUG = false;
  const SEND_DEBOUNCE_MS = 200;
  const MIN_RESEND_SAME_GS_MS = 4_000;

  function log(...a) { if (DEBUG) console.log("[OGX-Oracle]", ...a); }

  function getOracleBase() { return (GM_getValue(STORAGE.ORACLE_BASE, DEFAULTS.ORACLE_BASE) || "").trim().replace(/\/+$/, "") || DEFAULTS.ORACLE_BASE; }
  function setOracleBase(v) { const n = String(v||"").trim().replace(/\/+$/,""); if (n) GM_setValue(STORAGE.ORACLE_BASE, n); }
  function getAutoSend() { const v = GM_getValue(STORAGE.AUTO_SEND, DEFAULTS.AUTO_SEND); return v===true||v==="true"||v===1||v==="1"; }
  function setAutoSend(v) { GM_setValue(STORAGE.AUTO_SEND, !!v); }
  function getApiKey() { return String(GM_getValue(STORAGE.API_KEY, "") || "").trim(); }
  function setApiKey(k) { GM_setValue(STORAGE.API_KEY, String(k||"").trim()); }
  function getJwt() { return String(GM_getValue(STORAGE.JWT, "") || "").trim(); }
  function setJwt(t) { GM_setValue(STORAGE.JWT, String(t||"").trim()); }
  function oracleUrl(path) { return getOracleBase() + path; }

  // -----------------------------------------------
  // Galaxy/System detection
  // -----------------------------------------------
  function getGalaxySystem() {
    const gEl = document.querySelector('input[name="galaxy"]');
    const sEl = document.querySelector('input[name="system"]');
    let galaxy = gEl ? parseInt(gEl.value, 10) : 0;
    let system = sEl ? parseInt(sEl.value, 10) : 0;
    if (!galaxy || !system) {
      const p = new URLSearchParams(window.location.search);
      galaxy = galaxy || parseInt(p.get("galaxy") || "0", 10);
      system = system || parseInt(p.get("system") || "0", 10);
    }
    return { galaxy: galaxy || 0, system: system || 0 };
  }

  // -----------------------------------------------
  // Moon name extraction (multi-language)
  // -----------------------------------------------
  function extractMoonName(cell) {
    const a = cell.querySelector('a[onmouseover]');
    if (!a) return null;
    const ov = (a.getAttribute("onmouseover") || "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&#39;/g, "'");

    // Try current server language first, then all others as fallback
    const regexes = [
      L().moon_regex,
      /Mond\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      /Moon\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      /Lune\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
    ];
    for (const re of regexes) {
      const m = ov.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  // -----------------------------------------------
  // Parse galaxy rows
  // -----------------------------------------------
  function parseGalaxyRows() {
    const tbody = document.querySelector("#galaxy-rows");
    if (!tbody) { log("❌ #galaxy-rows not found"); return []; }

    const rows = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th, td")];
      if (cells.length < 7) return;

      const posRaw = (cells[0]?.textContent || "").trim();
      const position = parseInt(posRaw, 10);
      if (!position || position < 1 || position > 30) return;

      const playerRaw = (cells[5]?.textContent || "").trim();
      if (!playerRaw) return;

      const playerName = playerRaw.replace(/\s*\(\s*[a-zA-Z](?:\s+[a-zA-Z])*\s*\)\s*$/, "").trim() || playerRaw;

      let planetName = (cells[2]?.textContent || "")
        .trim()
        .replace(/\(\d+\s*min\)/i, "")
        .replace(/\*+$/, "")
        .trim();
      if (!planetName) planetName = L().colony_fallback;

      const allyName = (cells[6]?.textContent || "").trim().replace(/\s+/g, " ") || "";

      const moonCell = cells[3];
      const hasMoon = !!(moonCell?.querySelector('img[src*="s_mond"]'));
      const moonName = hasMoon ? extractMoonName(moonCell) : null;

      rows.push({ position, planet_name: planetName, player: playerName, ally: allyName, has_moon: hasMoon, moon_name: moonName || null });
    });

    log("Rows:", rows.length);
    return rows;
  }

  // -----------------------------------------------
  // Badge UI
  // -----------------------------------------------
  let badge = null;

  function createBadge() {
    const old = document.getElementById("ogx-oracle-badge");
    if (old) old.remove();
    badge = document.createElement("div");
    badge.id = "ogx-oracle-badge";
    Object.assign(badge.style, {
      position: "fixed", bottom: "16px", right: "16px", zIndex: "2147483647",
      padding: "6px 14px", borderRadius: "999px", fontSize: "12px",
      fontWeight: "600", fontFamily: "monospace", cursor: "pointer",
      userSelect: "none", boxShadow: "0 4px 14px rgba(0,0,0,.6)",
      border: "1px solid rgba(255,255,255,.2)", letterSpacing: ".3px",
      transition: "transform .2s", background: "rgba(10,20,40,.9)",
      color: "rgba(180,210,255,.85)",
    });
    badge.textContent = "◉ Oracle";
    badge.title = L().badge_title;
    badge.addEventListener("click", () => scheduleSend("manual"));
    badge.addEventListener("contextmenu", (e) => { e.preventDefault(); openSetup(); });
    document.body.appendChild(badge);
  }

  function showBadge(state, text) {
    if (!badge || !document.body.contains(badge)) createBadge();
    const cfg = {
      idle:  ["rgba(10,20,40,.9)",  "rgba(180,210,255,.85)", "rgba(100,160,255,.25)", "◉ Oracle"],
      ok:    ["rgba(5,30,20,.9)",   "rgba(52,211,153,.95)",  "rgba(52,211,153,.4)",   `✓ ${text}`],
      warn:  ["rgba(30,20,5,.9)",   "rgba(251,191,36,.95)",  "rgba(251,191,36,.4)",   `⚠ ${text}`],
      error: ["rgba(30,5,10,.9)",   "rgba(251,113,133,.95)", "rgba(244,63,94,.4)",    `✗ ${text}`],
    };
    const [bg, color, border, label] = cfg[state] || cfg.idle;
    Object.assign(badge.style, { background: bg, color, borderColor: border });
    badge.textContent = label;
    badge.style.transform = "scale(1.06)";
    setTimeout(() => { if (badge) badge.style.transform = "scale(1)"; }, 180);
    if (state !== "idle") setTimeout(() => showBadge("idle", ""), 5000);
  }

  function openSetup() {
    const s = L();
    const base = prompt(s.prompt_url, getOracleBase());
    if (base !== null && String(base).trim()) setOracleBase(base);

    const mode = prompt(s.prompt_auth, "");
    if (mode === "1") {
      const jwt = prompt(s.prompt_jwt, getJwt());
      if (jwt !== null) { setJwt(jwt); if (String(jwt).trim()) setApiKey(""); }
    } else if (mode === "2") {
      const key = prompt(s.prompt_apikey, getApiKey());
      if (key !== null) { setApiKey(key); if (String(key).trim()) setJwt(""); }
    }

    const as = prompt(s.prompt_autosend, getAutoSend() ? "1" : "0");
    if (as === "1") setAutoSend(true);
    if (as === "0") setAutoSend(false);

    showBadge("ok", s.setup_ok);
  }

  // -----------------------------------------------
  // Menu injection
  // -----------------------------------------------
  function injectMenuButton() {
    if (document.getElementById("ogx-oracle-menu-btn")) return;
    const anchor = [...document.querySelectorAll("tr")].find(
      (tr) => /Ankuendigungen|Ankündigung|Announcements|Annonces/i.test(tr.textContent || "") && tr.querySelector("th")
    );
    if (!anchor) return;

    const tr = document.createElement("tr");
    tr.id = "ogx-oracle-menu-btn";
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <th colspan="1" width="20px">&#8801;</th>
      <th id="ogx-oracle-th">OGX Oracle</th>`;

    const th = tr.querySelector("#ogx-oracle-th");
    th.addEventListener("mouseover", () => { tr.style.opacity = "0.75"; });
    th.addEventListener("mouseout",  () => { tr.style.opacity = "1"; });
    tr.addEventListener("click", () => window.open(oracleUrl("/"), "_blank"));
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSetup();
      const orig = th.textContent;
      th.textContent = "✓ Setup OK";
      setTimeout(() => { th.textContent = orig; }, 2000);
    });
    anchor.insertAdjacentElement("afterend", tr);
  }

  // -----------------------------------------------
  // Send logic
  // -----------------------------------------------
  let sendTimer = null, lastSendAt = 0, lastGSKey = "";

  function scheduleSend(reason) {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { sendTimer = null; doSend(reason); }, SEND_DEBOUNCE_MS);
  }

  function buildHeaders() {
    const headers = { "content-type": "application/json" };
    const jwt = getJwt();
    if (jwt) { headers["Authorization"] = "Bearer " + jwt; return headers; }
    const key = getApiKey();
    if (key) { headers["x-ogx-api-key"] = key; return headers; }
    return headers;
  }

  function doSend(reason) {
    const { galaxy, system } = getGalaxySystem();
    const rows = parseGalaxyRows();

    if (!galaxy || !system) { showBadge("error", "? G/S"); return; }
    if (!rows.length)        { showBadge("warn",  "0 Rows"); return; }

    const now = Date.now();
    const gsKey = `${galaxy}:${system}`;
    if (gsKey === lastGSKey && now - lastSendAt < MIN_RESEND_SAME_GS_MS) { showBadge("idle", ""); return; }

    lastGSKey = gsKey;
    lastSendAt = now;

    const url = oracleUrl("/ingest/galaxy");
    const headers = buildHeaders();
    if (!headers.Authorization && !headers["x-ogx-api-key"]) showBadge("warn", "NO AUTH");

    log(`📡 Send ${rows.length} rows for ${gsKey} (${reason}) -> ${url} [lang:${LANG}]`);

    GM_xmlhttpRequest({
      method: "POST", url, headers,
      data: JSON.stringify({ galaxy, system, rows }),
      timeout: 12_000,
      onload: (res) => {
        log("Response:", res.status, res.responseText);
        if (res.status === 401) { showBadge("error", "401 AUTH"); return; }
        if (res.status === 403) { showBadge("error", "403"); return; }
        if (res.status === 429) { showBadge("warn",  "429 RL"); return; }
        if (res.status >= 500)  { showBadge("error", "5xx"); return; }
        try {
          const d = JSON.parse(res.responseText || "{}");
          if (d && d.ok) showBadge("ok", `+${d.imported} ~${d.updated}`);
          else showBadge("error", (d && d.error) ? String(d.error) : "ERR");
        } catch { showBadge("error", "JSON"); }
      },
      onerror:   () => showBadge("error", "Offline?"),
      ontimeout: () => showBadge("error", "Timeout"),
    });
  }

  // -----------------------------------------------
  // Boot
  // -----------------------------------------------
  function isGalaxyPage() {
    const page = new URLSearchParams(window.location.search).get("page") || "";
    return page === "galaxy" || !!document.querySelector("#galaxy-rows");
  }

  function init() {
    initLang();
    injectMenuButton();
    [800, 2000, 4000].forEach((t) => setTimeout(injectMenuButton, t));

    if (!isGalaxyPage()) return;

    createBadge();
    showBadge("idle", "");

    if (getAutoSend()) setTimeout(() => scheduleSend("auto"), 250);

    // Watch galaxy-rows for DOM changes
    const target = document.querySelector("#galaxy-rows");
    if (target) {
      const obs = new MutationObserver(() => scheduleSend("mutation"));
      obs.observe(target, { childList: true, subtree: true, characterData: true });
    }

    // Intercept galaxy navigation form (prev/next system buttons)
    document.querySelectorAll("form[name='galaxyform'], form[action*='galaxy']").forEach(form => {
      form.addEventListener("submit", () => {
        lastGSKey = "";  // reset so next system sends immediately
        setTimeout(() => scheduleSend("navform"), 350);
      });
    });

    // Arrow key navigation (some OGX versions support it)
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        lastGSKey = "";
        setTimeout(() => scheduleSend("keyNav"), 350);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
