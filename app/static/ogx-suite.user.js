// ==UserScript==
// @name         OGX Oracle – Collector Suite (Galaxy + Expedition)
// @namespace    ogx-suite
// @version      1.1.0
// @description  Galaxy + Fleet/Expo collector for OGX Oracle & OGX Expedition. DE/EN/FR. Consent-gated (RGPD / anti-phishing).
// @match        https://uni1.playogx.com/*
// @match        http://uni1.playogx.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      ogx-oraclev2-production.up.railway.app
// @connect      ogx-expedition-production.up.railway.app
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // Language detection + i18n
  // ============================================================
  function detectLang() {
    const htmlLang = (document.documentElement.lang || "").toLowerCase().slice(0, 2);
    if (["de", "en", "fr"].includes(htmlLang)) return htmlLang;

    const urlMatch = window.location.pathname.match(/\/(de|en|fr)\//i);
    if (urlMatch) return urlMatch[1].toLowerCase();

    const meta = document.querySelector('meta[name="language"]');
    if (meta) {
      const l = (meta.content || "").toLowerCase().slice(0, 2);
      if (["de", "en", "fr"].includes(l)) return l;
    }

    const body = (document.body && (document.body.innerHTML || "")) || "";
    if (/Galaxie|Sonnensystem|Planeten/i.test(body)) return "de";
    if (/Galaxy|Solar System|Planets/i.test(body)) return "en";
    if (/Galaxie|Système solaire|Planètes/i.test(body)) return "fr";

    return "de";
  }

  const I18N = {
    de: {
      badge_title: "OGX Suite – Klick: senden | Rechtsklick: Setup",
      badge_need_consent: "ZUSTIMMUNG",
      badge_hint_consent: "Klicken für Zustimmung",
      badge_only_fleet: "Nur auf Fleet-Seite",
      badge_only_galaxy: "Nur auf Galaxy-Seite",
      setup_ok: "SETUP OK",

      consent_title: "OGX Suite – Zustimmung",
      consent_intro:
        "Damit OGX Suite Daten auslesen und übertragen darf, brauche ich deine Zustimmung.",
      consent_what: "Was wird gelesen?",
      consent_what_v:
        "Nur Inhalte der aktuellen OGX-Seite (DOM):\n• Galaxy: Planet/Spieler/Allianz/Mond\n• Fleet: Schiffszahlen + Expo-Slots/Max pro Slot (falls sichtbar)",
      consent_send: "Wohin wird gesendet?",
      consent_send_v:
        "Nur an deine konfigurierten OGX-Endpunkte (OGX Oracle / OGX Expedition).",
      consent_not: "Was wird NICHT gelesen?",
      consent_not_v:
        "Keine Passwörter, keine Cookies/Session-Tokens, kein LocalStorage, keine privaten Browser-Daten.",
      consent_control: "Kontrolle",
      consent_control_v:
        "Ohne Zustimmung passiert nichts automatisch. Du kannst jederzeit abbrechen.",
      consent_cancel: "Abbrechen",
      consent_accept: "Ich stimme zu",

      setup_title: "OGX Suite Setup",
      prompt_oracle_base: "OGX Oracle Base URL (z.B. https://ogx-oraclev2-production.up.railway.app):",
      prompt_oracle_auth:
        "OGX Oracle Auth wählen:\n1 = Bearer JWT\n2 = API Key\n(Enter = überspringen)",
      prompt_oracle_jwt: "OGX Oracle Bearer JWT (nur Token, ohne 'Bearer '):",
      prompt_oracle_apikey: "OGX Oracle API Key:",
      prompt_oracle_autosend: "OGX Oracle Auto-Send (Galaxy)?\n1 = Ja\n0 = Nein",

      prompt_exp_base:
        "OGX Expedition Base URL (z.B. https://ogx-expedition-production.up.railway.app):",
      prompt_exp_jwt: "OGX Expedition JWT (token only):",
      prompt_exp_autosend: "OGX Expedition Auto-Send (Fleet)?\n1 = Ja\n0 = Nein",
    },

    en: {
      badge_title: "OGX Suite – Click: send | Right-click: Setup",
      badge_need_consent: "CONSENT",
      badge_hint_consent: "Click to consent",
      badge_only_fleet: "Fleet page only",
      badge_only_galaxy: "Galaxy page only",
      setup_ok: "SETUP OK",

      consent_title: "OGX Suite – Consent",
      consent_intro:
        "To let OGX Suite read and upload data, I need your explicit consent.",
      consent_what: "What is read?",
      consent_what_v:
        "Only content from the current OGX page (DOM):\n• Galaxy: planet/player/alliance/moon\n• Fleet: ship counts + expo slots/max per slot (if visible)",
      consent_send: "Where is it sent?",
      consent_send_v:
        "Only to your configured OGX endpoints (OGX Oracle / OGX Expedition).",
      consent_not: "What is NOT read?",
      consent_not_v:
        "No passwords, no cookies/session tokens, no localStorage, no private browser data.",
      consent_control: "Control",
      consent_control_v:
        "Nothing happens automatically without consent. You can cancel anytime.",
      consent_cancel: "Cancel",
      consent_accept: "I agree",

      setup_title: "OGX Suite Setup",
      prompt_oracle_base: "OGX Oracle Base URL (e.g. https://ogx-oraclev2-production.up.railway.app):",
      prompt_oracle_auth:
        "OGX Oracle auth:\n1 = Bearer JWT\n2 = API Key\n(Enter = skip)",
      prompt_oracle_jwt: "OGX Oracle Bearer JWT (token only, no 'Bearer '):",
      prompt_oracle_apikey: "OGX Oracle API Key:",
      prompt_oracle_autosend: "OGX Oracle Auto-Send (Galaxy)?\n1 = Yes\n0 = No",

      prompt_exp_base:
        "OGX Expedition Base URL (e.g. https://ogx-expedition-production.up.railway.app):",
      prompt_exp_jwt: "OGX Expedition JWT (token only):",
      prompt_exp_autosend: "OGX Expedition Auto-Send (Fleet)?\n1 = Yes\n0 = No",
    },

    fr: {
      badge_title: "OGX Suite – Clic : envoyer | Clic droit : Setup",
      badge_need_consent: "CONSENT",
      badge_hint_consent: "Cliquer pour consentir",
      badge_only_fleet: "Page flotte uniquement",
      badge_only_galaxy: "Page galaxie uniquement",
      setup_ok: "CONFIG OK",

      consent_title: "OGX Suite – Consentement",
      consent_intro:
        "Pour autoriser OGX Suite à lire et envoyer des données, j'ai besoin de ton consentement explicite.",
      consent_what: "Qu'est-ce qui est lu ?",
      consent_what_v:
        "Uniquement le contenu de la page OGX actuelle (DOM) :\n• Galaxie : planète/joueur/alliance/lune\n• Flotte : quantités de vaisseaux + slots expé/max par slot (si visible)",
      consent_send: "Où est-ce envoyé ?",
      consent_send_v:
        "Uniquement vers tes endpoints configurés (OGX Oracle / OGX Expedition).",
      consent_not: "Qu'est-ce qui n'est PAS lu ?",
      consent_not_v:
        "Pas de mots de passe, pas de cookies/tokens de session, pas de localStorage, pas de données privées du navigateur.",
      consent_control: "Contrôle",
      consent_control_v:
        "Rien ne se fait automatiquement sans consentement. Tu peux annuler à tout moment.",
      consent_cancel: "Annuler",
      consent_accept: "J'accepte",

      setup_title: "OGX Suite Setup",
      prompt_oracle_base: "URL OGX Oracle (ex. https://ogx-oraclev2-production.up.railway.app) :",
      prompt_oracle_auth:
        "Auth OGX Oracle :\n1 = Bearer JWT\n2 = Clé API\n(Entrée = ignorer)",
      prompt_oracle_jwt: "OGX Oracle Bearer JWT (token uniquement) :",
      prompt_oracle_apikey: "Clé API OGX Oracle :",
      prompt_oracle_autosend: "Auto-envoi OGX Oracle (Galaxie) ?\n1 = Oui\n0 = Non",

      prompt_exp_base:
        "URL OGX Expedition (ex. https://ogx-expedition-production.up.railway.app) :",
      prompt_exp_jwt: "JWT OGX Expedition (token uniquement) :",
      prompt_exp_autosend: "Auto-envoi OGX Expedition (Flotte) ?\n1 = Oui\n0 = Non",
    },
  };

  let LANG = "de";
  function S() {
    return I18N[LANG] || I18N.de;
  }

  // ============================================================
  // Shared config
  // ============================================================
  const DEBUG = false;
  function log(...a) {
    if (DEBUG) console.log("[OGX-Suite]", ...a);
  }

  const STORAGE = {
    ORACLE_BASE: "ogx_suite_oracle_base_url",
    ORACLE_JWT: "ogx_suite_oracle_jwt",
    ORACLE_API_KEY: "ogx_suite_oracle_api_key",
    ORACLE_AUTO: "ogx_suite_oracle_auto_send",

    EXP_BASE: "ogx_suite_exp_base_url",
    EXP_JWT: "ogx_suite_exp_jwt",
    EXP_AUTO: "ogx_suite_exp_auto_send",
  };

  const DEFAULTS = {
    ORACLE_BASE: "https://ogx-oraclev2-production.up.railway.app",
    ORACLE_AUTO: true,

    EXP_BASE: "https://ogx-expedition-production.up.railway.app",
    EXP_AUTO: true,
  };

  function getVal(key, def) { return GM_getValue(key, def); }
  function setVal(key, v) { GM_setValue(key, v); }

  function normBaseUrl(v, fallback) {
    const n = String(v || "").trim().replace(/\/+$/, "");
    return n || fallback;
  }

  function oracleBase() {
    return normBaseUrl(getVal(STORAGE.ORACLE_BASE, DEFAULTS.ORACLE_BASE), DEFAULTS.ORACLE_BASE);
  }
  function expBase() {
    return normBaseUrl(getVal(STORAGE.EXP_BASE, DEFAULTS.EXP_BASE), DEFAULTS.EXP_BASE);
  }

  function getOracleJwt() { return String(getVal(STORAGE.ORACLE_JWT, "") || "").trim(); }
  function setOracleJwt(v) { setVal(STORAGE.ORACLE_JWT, String(v || "").trim()); }
  function getOracleApiKey() { return String(getVal(STORAGE.ORACLE_API_KEY, "") || "").trim(); }
  function setOracleApiKey(v) { setVal(STORAGE.ORACLE_API_KEY, String(v || "").trim()); }
  function getOracleAuto() {
    const v = getVal(STORAGE.ORACLE_AUTO, DEFAULTS.ORACLE_AUTO);
    return v === true || v === "true" || v === 1 || v === "1";
  }
  function setOracleAuto(v) { setVal(STORAGE.ORACLE_AUTO, !!v); }

  function getExpJwt() { return String(getVal(STORAGE.EXP_JWT, "") || "").trim(); }
  function setExpJwt(v) { setVal(STORAGE.EXP_JWT, String(v || "").trim()); }
  function getExpAuto() {
    const v = getVal(STORAGE.EXP_AUTO, DEFAULTS.EXP_AUTO);
    return v === true || v === "true" || v === 1 || v === "1";
  }
  function setExpAuto(v) { setVal(STORAGE.EXP_AUTO, !!v); }

  function oracleUrl(path) { return oracleBase() + path; }
  function expUrl(path) { return expBase() + path; }

  // ============================================================
  // Consent gate (session scoped)
  // ============================================================
  const CONSENT_KEY = "ogx_suite_consent_v1";
  function hasConsent() {
    try { return sessionStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; }
  }
  function setConsent() {
    try { sessionStorage.setItem(CONSENT_KEY, "1"); } catch {}
  }

  let consentModalOpen = false;

  function closeConsentModal() {
    const el = document.getElementById("ogx-suite-consent-overlay");
    if (el) el.remove();
    consentModalOpen = false;
  }

  function showConsentModal(onAccept) {
    if (consentModalOpen) return;
    consentModalOpen = true;

    const s = S();

    const overlay = document.createElement("div");
    overlay.id = "ogx-suite-consent-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "2147483647",
      background: "rgba(0,0,0,.62)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "16px",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "min(620px, 100%)",
      background: "rgba(12,18,32,.96)",
      border: "1px solid rgba(255,255,255,.15)",
      boxShadow: "0 18px 60px rgba(0,0,0,.65)",
      borderRadius: "14px",
      color: "rgba(235,245,255,.95)",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      overflow: "hidden",
    });

    const head = document.createElement("div");
    Object.assign(head.style, {
      padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.12)",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
    });

    const title = document.createElement("div");
    title.textContent = s.consent_title;
    Object.assign(title.style, { fontWeight: "800", fontSize: "14px", letterSpacing: ".2px" });

    const x = document.createElement("button");
    x.type = "button"; x.textContent = "x";
    Object.assign(x.style, {
      background: "transparent", border: "0", color: "rgba(235,245,255,.75)",
      cursor: "pointer", fontSize: "16px", lineHeight: "16px",
      padding: "6px 8px", borderRadius: "8px",
    });
    x.addEventListener("click", closeConsentModal);

    head.appendChild(title); head.appendChild(x);

    const body = document.createElement("div");
    Object.assign(body.style, { padding: "14px 16px", fontSize: "13px", lineHeight: "1.45" });

    const intro = document.createElement("div");
    intro.textContent = s.consent_intro;
    Object.assign(intro.style, { marginBottom: "12px", color: "rgba(235,245,255,.88)" });

    function section(label, value) {
      const wrap = document.createElement("div");
      Object.assign(wrap.style, { marginTop: "10px" });
      const h = document.createElement("div");
      h.textContent = label;
      Object.assign(h.style, { fontWeight: "800", fontSize: "12px", color: "rgba(200,225,255,.95)" });
      const v = document.createElement("div");
      v.textContent = value;
      Object.assign(v.style, { whiteSpace: "pre-wrap", marginTop: "4px", color: "rgba(235,245,255,.80)" });
      wrap.appendChild(h); wrap.appendChild(v);
      return wrap;
    }

    body.appendChild(intro);
    body.appendChild(section(s.consent_what, s.consent_what_v));
    body.appendChild(section(s.consent_send, s.consent_send_v));
    body.appendChild(section(s.consent_not, s.consent_not_v));
    body.appendChild(section(s.consent_control, s.consent_control_v));

    const foot = document.createElement("div");
    Object.assign(foot.style, {
      padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,.12)",
      display: "flex", justifyContent: "flex-end", gap: "10px",
    });

    const btnCancel = document.createElement("button");
    btnCancel.type = "button"; btnCancel.textContent = s.consent_cancel;
    Object.assign(btnCancel.style, {
      background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)",
      color: "rgba(235,245,255,.85)", padding: "8px 12px", borderRadius: "10px",
      cursor: "pointer", fontWeight: "800", fontSize: "12px",
    });
    btnCancel.addEventListener("click", () => { closeConsentModal(); showBadge("warn", s.badge_need_consent); });

    const btnAccept = document.createElement("button");
    btnAccept.type = "button"; btnAccept.textContent = s.consent_accept;
    Object.assign(btnAccept.style, {
      background: "rgba(70,140,255,.22)", border: "1px solid rgba(110,170,255,.45)",
      color: "rgba(235,245,255,.95)", padding: "8px 12px", borderRadius: "10px",
      cursor: "pointer", fontWeight: "900", fontSize: "12px",
    });
    btnAccept.addEventListener("click", () => {
      setConsent(); closeConsentModal(); showBadge("ok", "OK");
      try { onAccept && onAccept(); } catch {}
    });

    foot.appendChild(btnCancel); foot.appendChild(btnAccept);
    card.appendChild(head); card.appendChild(body); card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeConsentModal(); });
    document.body.appendChild(overlay);
  }

  function ensureConsent(next) {
    if (hasConsent()) return next();
    showConsentModal(next);
  }

  // ============================================================
  // Shared UI (Badge + Setup)
  // ============================================================
  let badge = null;

  function createBadge() {
    const old = document.getElementById("ogx-suite-badge");
    if (old) old.remove();

    badge = document.createElement("div");
    badge.id = "ogx-suite-badge";
    Object.assign(badge.style, {
      position: "fixed", bottom: "16px", right: "16px", zIndex: "2147483647",
      padding: "6px 14px", borderRadius: "999px", fontSize: "12px",
      fontWeight: "700", fontFamily: "monospace", cursor: "pointer",
      userSelect: "none", boxShadow: "0 4px 14px rgba(0,0,0,.6)",
      border: "1px solid rgba(255,255,255,.18)", letterSpacing: ".3px",
      transition: "transform .15s,background .3s,color .3s",
      background: "rgba(10,20,40,.92)", color: "rgba(180,210,255,.88)",
    });

    badge.textContent = "OGX Suite";
    badge.title = S().badge_title;

    badge.addEventListener("click", () => { ensureConsent(() => manualSend()); });
    badge.addEventListener("contextmenu", (e) => { e.preventDefault(); openSetup(); });

    document.body.appendChild(badge);
  }

  function showBadge(state, text) {
    if (!badge || !document.body.contains(badge)) createBadge();

    const cfg = {
      idle:  ["rgba(10,20,40,.92)",  "rgba(180,210,255,.88)", "OGX Suite"],
      ok:    ["rgba(5,30,20,.92)",   "rgba(52,211,153,.95)",  `OK ${text}`],
      warn:  ["rgba(30,20,5,.92)",   "rgba(251,191,36,.95)",  `! ${text}`],
      error: ["rgba(30,5,10,.92)",   "rgba(251,113,133,.95)", `ERR ${text}`],
      send:  ["rgba(10,30,60,.92)",  "rgba(100,180,255,.95)", `>> ${text}`],
    };

    const [bg, color, label] = cfg[state] || cfg.idle;
    Object.assign(badge.style, { background: bg, color });
    badge.textContent = label;

    badge.style.transform = "scale(1.07)";
    setTimeout(() => { if (badge) badge.style.transform = "scale(1)"; }, 160);

    if (state !== "idle") setTimeout(() => showBadge("idle", ""), 6000);
  }

  function openSetup() {
    const s = S();

    const ob = prompt(s.prompt_oracle_base, oracleBase());
    if (ob !== null && String(ob).trim()) setVal(STORAGE.ORACLE_BASE, normBaseUrl(ob, DEFAULTS.ORACLE_BASE));

    const mode = prompt(s.prompt_oracle_auth, "");
    if (mode === "1") {
      const jwt = prompt(s.prompt_oracle_jwt, getOracleJwt());
      if (jwt !== null) { setOracleJwt(jwt); if (String(jwt).trim()) setOracleApiKey(""); }
    } else if (mode === "2") {
      const key = prompt(s.prompt_oracle_apikey, getOracleApiKey());
      if (key !== null) { setOracleApiKey(key); if (String(key).trim()) setOracleJwt(""); }
    }

    const oas = prompt(s.prompt_oracle_autosend, getOracleAuto() ? "1" : "0");
    if (oas === "1") setOracleAuto(true);
    if (oas === "0") setOracleAuto(false);

    const eb = prompt(s.prompt_exp_base, expBase());
    if (eb !== null && String(eb).trim()) setVal(STORAGE.EXP_BASE, normBaseUrl(eb, DEFAULTS.EXP_BASE));

    const ej = prompt(s.prompt_exp_jwt, getExpJwt() ? getExpJwt().slice(0, 20) + "..." : "");
    if (ej !== null && String(ej).trim()) setExpJwt(ej.trim());

    const eas = prompt(s.prompt_exp_autosend, getExpAuto() ? "1" : "0");
    if (eas === "1") setExpAuto(true);
    if (eas === "0") setExpAuto(false);

    showBadge("ok", s.setup_ok);
  }

  // ============================================================
  // Page detection
  // ============================================================
  function getPage() {
    const sp = new URLSearchParams(window.location.search);
    const page = (sp.get("page") || "").toLowerCase();

    if (page === "galaxy" || document.querySelector("#galaxy-rows")) return "galaxy";
    if (page === "fleet1" || document.querySelector('input[name="ship202"],input[name="ship207"],input[name="maxship202"],input[name="maxship207"]')) return "fleet1";

    return "other";
  }

  // ============================================================
  // Module: Galaxy (OGX Oracle)
  // ============================================================
  const GAL_SEND_DEBOUNCE_MS = 200;
  const GAL_MIN_RESEND_SAME_GS_MS = 4_000;
  let galSendTimer = null;
  let galLastSendAt = 0;
  let galLastGSKey = "";

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

  function moonRegexForLang(lang) {
    if (lang === "en") return /Moon\s+(.+?)\s+\[\d+:\d+:\d+\]/i;
    if (lang === "fr") return /Lune\s+(.+?)\s+\[\d+:\d+:\d+\]/i;
    return /Mond\s+(.+?)\s+\[\d+:\d+:\d+\]/i;
  }

  function extractMoonName(cell) {
    const a = cell.querySelector('a[onmouseover]');
    if (!a) return null;

    const ov = (a.getAttribute("onmouseover") || "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&#39;/g, "'");

    const reList = [
      moonRegexForLang(LANG),
      /Mond\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      /Moon\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
      /Lune\s+(.+?)\s+\[\d+:\d+:\d+\]/i,
    ];

    for (const re of reList) {
      const m = ov.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  function parseGalaxyRows() {
    const tbody = document.querySelector("#galaxy-rows");
    if (!tbody) return [];

    const fallbackColony = LANG === "fr" ? "Colonie" : LANG === "en" ? "Colony" : "Kolonie";

    const rows = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th, td")];
      if (cells.length < 7) return;

      const posRaw = (cells[0]?.textContent || "").trim();
      const position = parseInt(posRaw, 10);
      if (!position || position < 1 || position > 30) return;

      const playerRaw = (cells[5]?.textContent || "").trim();
      if (!playerRaw) return;

      const playerName =
        playerRaw.replace(/\s*\(\s*[a-zA-Z](?:\s+[a-zA-Z])*\s*\)\s*$/, "").trim() || playerRaw;

      let planetName = (cells[2]?.textContent || "")
        .trim().replace(/\(\d+\s*min\)/i, "").replace(/\*+$/, "").trim();
      if (!planetName) planetName = fallbackColony;

      const allyName = (cells[6]?.textContent || "").trim().replace(/\s+/g, " ") || "";

      const moonCell = cells[3];
      const hasMoon = !!moonCell?.querySelector('img[src*="s_mond"]');
      const moonName = hasMoon ? extractMoonName(moonCell) : null;

      const tfCell = cells[4];
      const { debris_metal, debris_crystal } = extractDebris(tfCell);

      rows.push({
        position,
        planet_name: planetName,
        player: playerName,
        ally: allyName,
        has_moon: hasMoon,
        moon_name: moonName || null,
        debris_metal,
        debris_crystal,
      });
    });

    return rows;
  }

  function extractDebris(tfCell) {
    // TF data is encoded in the onmouseover attribute of the link inside the cell
    if (!tfCell) return { debris_metal: 0, debris_crystal: 0 };
    const link = tfCell.querySelector('a[onmouseover]');
    if (!link) return { debris_metal: 0, debris_crystal: 0 };
    const raw = link.getAttribute('onmouseover') || '';
    // Decode HTML entities
    const txt = raw.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
    const metal   = txt.match(/Metall:\s*<\/th>\s*<th>([\d.,\s]+)/);
    const crystal = txt.match(/Kristall:\s*<\/th>\s*<th>([\d.,\s]+)/);
    const parseNum = s => parseInt((s||'0').replace(/[.,\s]/g,''), 10) || 0;
    return {
      debris_metal:   parseNum(metal   ? metal[1]   : '0'),
      debris_crystal: parseNum(crystal ? crystal[1] : '0'),
    };
  }

  function oracleHeaders() {
    const headers = { "content-type": "application/json" };
    const jwt = getOracleJwt();
    const key = getOracleApiKey();
    if (jwt) headers["Authorization"] = "Bearer " + jwt;
    else if (key) headers["x-ogx-api-key"] = key;
    return headers;
  }

  function scheduleGalaxySend(reason) {
    if (galSendTimer) clearTimeout(galSendTimer);
    galSendTimer = setTimeout(() => { galSendTimer = null; doGalaxySend(reason); }, GAL_SEND_DEBOUNCE_MS);
  }

  function doGalaxySend(reason) {
    if (!hasConsent()) {
      const s = S();
      showBadge("warn", s.badge_need_consent);
      if (badge) badge.title = s.badge_hint_consent;
      return;
    }

    const { galaxy, system } = getGalaxySystem();
    const rows = parseGalaxyRows();

    if (!galaxy || !system) { showBadge("error", "? G/S"); return; }
    if (!rows.length) { showBadge("warn", "0 Rows"); return; }

    const now = Date.now();
    const gsKey = `${galaxy}:${system}`;
    if (gsKey === galLastGSKey && now - galLastSendAt < GAL_MIN_RESEND_SAME_GS_MS) return;

    galLastGSKey = gsKey;
    galLastSendAt = now;

    const url = oracleUrl("/ingest/galaxy");
    const headers = oracleHeaders();
    if (!headers.Authorization && !headers["x-ogx-api-key"]) showBadge("warn", "NO AUTH");

    showBadge("send", `G${galaxy}:S${system}`);

    GM_xmlhttpRequest({
      method: "POST", url, headers,
      data: JSON.stringify({ galaxy, system, rows }),
      timeout: 12_000,
      onload: (res) => {
        if (res.status === 401) return showBadge("error", "401 AUTH");
        if (res.status === 403) return showBadge("error", "403");
        if (res.status === 429) return showBadge("warn", "429 RL");
        if (res.status >= 500) return showBadge("error", "5xx");
        try {
          const d = JSON.parse(res.responseText || "{}");
          if (d && d.ok) showBadge("ok", `+${d.imported} ~${d.updated}`);
          else showBadge("error", (d && d.error) ? String(d.error) : "ERR");
        } catch { showBadge("error", "JSON"); }
      },
      onerror: () => showBadge("error", "Offline?"),
      ontimeout: () => showBadge("error", "Timeout"),
    });
  }

  // ============================================================
  // Module: Fleet1 (OGX Expedition)
  // ============================================================
  const FLEET_DEBOUNCE_MS = 1000;
  const FLEET_MIN_RESEND_MS = 60_000;

  const SHIP_ID_MAP = {
    202: "Kleiner Transporter", 203: "Grosser Transporter",
    204: "Leichter Jaeger", 205: "Schwerer Jaeger",
    206: "Kreuzer", 207: "Schlachtschiff",
    208: "Kolonieschiff", 209: "Recycler",
    210: "Spionagesonde", 211: "Bomber",
    212: "Solarsatellit", 213: "Zerstoerer",
    214: "Todesstern", 215: "Schlachtkreuzer",
    216: "Pathfinder", 217: "Reaper", 218: "Crawler",
  };
  const SKIP_SHIPS = new Set([212, 218]);

  function expHeaders() {
    const h = { "Content-Type": "application/json" };
    const jwt = getExpJwt();
    if (jwt) h["Authorization"] = "Bearer " + jwt;
    return h;
  }

  function parseFleetPage() {
    const result = { ships: {}, slots_total: null, slots_active: null, max_per_slot: null };

    for (const [id, name] of Object.entries(SHIP_ID_MAP)) {
      if (SKIP_SHIPS.has(parseInt(id, 10))) continue;
      const input = document.querySelector(`input[name="maxship${id}"]`);
      if (!input) continue;
      const count = parseInt(input.value, 10) || 0;
      if (count > 0) result.ships[name] = count;
    }

    const headerText =
      document.querySelector(".table_up")?.textContent || document.body.innerText || "";

    const slotsMatch = headerText.match(
      /(?:Expeditionen|Expeditions|Exp[ee]ditions)\s*:\s*(\d+)\s*\/\s*(\d+)/i
    );
    if (slotsMatch) {
      result.slots_active = parseInt(slotsMatch[1], 10);
      result.slots_total = parseInt(slotsMatch[2], 10);
    }

    const maxMatch = headerText.match(
      /(?:Maximale Schiffe pro Expedition|Maximum ships per expedition|Maximum de vaisseaux[^:]*)\s*:\s*([\d.,]+)/i
    );
    if (maxMatch) {
      result.max_per_slot = parseInt(String(maxMatch[1]).replace(/[.,]/g, ""), 10) || null;
    }

    return result;
  }

  function hashObj(o) {
    const s = JSON.stringify(o);
    let h = 0;
    for (let i = 0; i < Math.min(s.length, 800); i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h.toString(16);
  }

  let fleetLastSend = 0;
  let fleetLastHash = "";
  let fleetTimer = null;

  function scheduleFleetSend(reason) {
    if (fleetTimer) clearTimeout(fleetTimer);
    fleetTimer = setTimeout(() => { fleetTimer = null; doFleetSend(reason); }, FLEET_DEBOUNCE_MS);
  }

  function doFleetSend(reason) {
    if (!hasConsent()) {
      const s = S();
      showBadge("warn", s.badge_need_consent);
      if (badge) badge.title = s.badge_hint_consent;
      return;
    }

    const now = Date.now();
    const data = parseFleetPage();
    const shipTypes = Object.keys(data.ships).length;

    if (shipTypes === 0 && !data.slots_total && !data.max_per_slot) {
      if (reason === "manual") showBadge("warn", "No fleet data");
      return;
    }

    const hash = hashObj(data);
    if (hash === fleetLastHash && now - fleetLastSend < FLEET_MIN_RESEND_MS) {
      if (reason === "manual") showBadge("warn", "Already sent");
      return;
    }
    fleetLastHash = hash;
    fleetLastSend = now;

    if (!getExpJwt()) {
      showBadge("error", "No EXP JWT");
      setTimeout(openSetup, 500);
      return;
    }

    const parts = [];
    if (shipTypes > 0) parts.push(`${shipTypes} types`);
    if (data.slots_total) parts.push(`${data.slots_active}/${data.slots_total} slots`);
    if (data.max_per_slot) parts.push(`Max ${(data.max_per_slot / 1e6).toFixed(2)}M`);

    showBadge("send", parts.join(" | ") || "Fleet");

    GM_xmlhttpRequest({
      method: "POST",
      url: expUrl("/api/fleet"),
      headers: expHeaders(),
      data: JSON.stringify({
        ships: data.ships,
        slots: data.slots_total,
        slots_active: data.slots_active,
        max_per_slot: data.max_per_slot,
      }),
      timeout: 15_000,
      onload: (res) => {
        if (res.status === 401) return showBadge("error", "401 JWT");
        if (res.status === 403) return showBadge("error", "403");
        if (res.status >= 500) return showBadge("error", "5xx");
        try {
          const d = JSON.parse(res.responseText || "{}");
          if (d.ok) {
            if (d.fleet_data) {
              try {
                sessionStorage.setItem(
                  "ogx_suite_fleet_cache",
                  JSON.stringify({ data: d.fleet_data, ts: Date.now() })
                );
              } catch {}
            }
            showBadge("ok", parts.join(" | ") || "Fleet OK");
          } else {
            showBadge("error", d.error || "ERR");
          }
        } catch { showBadge("error", "JSON"); }
      },
      onerror: () => showBadge("error", "Offline?"),
      ontimeout: () => showBadge("error", "Timeout"),
    });
  }

  // ============================================================
  // Manual send routing
  // ============================================================
  function manualSend() {
    const page = getPage();
    const s = S();

    if (page === "galaxy") { scheduleGalaxySend("manual"); return; }
    if (page === "fleet1") { scheduleFleetSend("manual"); return; }

    showBadge("warn", "Galaxy/Fleet only");
    if (badge) badge.title = s.badge_title;
  }

  // ============================================================
  // Sidebar menu injection
  // ============================================================
  function injectMenuButton() {
    if (document.getElementById("ogx-suite-menu-btn")) return;

    const anchorTr = [...document.querySelectorAll("tr")].find(
      (tr) =>
        /Ankuendigungen|Ankündigung|Announcements|Annonces/i.test(tr.textContent || "") &&
        tr.querySelectorAll("th").length >= 2
    );
    if (!anchorTr) return;

    const anchorBurger = anchorTr.querySelectorAll("th")[0];
    const anchorCell = anchorTr.querySelectorAll("th")[1];

    const tr = document.createElement("tr");
    tr.id = "ogx-suite-menu-btn";
    tr.style.cursor = "pointer";

    const thBurger = document.createElement("th");
    thBurger.setAttribute("colspan", "1");
    thBurger.setAttribute("width", "20px");
    thBurger.textContent = (anchorBurger?.textContent || "=").trim() || "=";

    const th = document.createElement("th");
    if (anchorCell?.getAttribute("style")) th.setAttribute("style", anchorCell.getAttribute("style"));
    if (anchorCell?.getAttribute("onmouseover")) th.setAttribute("onmouseover", anchorCell.getAttribute("onmouseover"));
    if (anchorCell?.getAttribute("onmouseout")) th.setAttribute("onmouseout", anchorCell.getAttribute("onmouseout"));

    th.style.textAlign = "left";

    const inner = document.createElement("div");
    inner.style.cssText = "width:100%;height:100%;display:flex;align-items:center;";

    const span = document.createElement("span");
    span.style.color = "#FFF";
    span.textContent = "OGX Suite";
    inner.appendChild(span);
    th.appendChild(inner);

    tr.appendChild(thBurger);
    tr.appendChild(th);

    tr.addEventListener("click", () => window.open(oracleUrl("/"), "_blank"));
    tr.addEventListener("contextmenu", (e) => { e.preventDefault(); openSetup(); });

    anchorTr.insertAdjacentElement("afterend", tr);
  }

  // ============================================================
  // Boot
  // ============================================================
  function init() {
    LANG = detectLang();
    log("Init lang:", LANG, "| page:", getPage());

    injectMenuButton();
    [800, 2000, 4000].forEach((t) => setTimeout(injectMenuButton, t));

    createBadge();
    showBadge("idle", "");

    const page = getPage();

    if (!hasConsent()) {
      if ((page === "galaxy" && getOracleAuto()) || (page === "fleet1" && getExpAuto())) {
        const s = S();
        showBadge("warn", s.badge_need_consent);
        if (badge) badge.title = s.badge_hint_consent;
      }
    }

    if (page === "galaxy") {
      if (getOracleAuto() && hasConsent()) setTimeout(() => scheduleGalaxySend("auto"), 250);

      const target = document.querySelector("#galaxy-rows");
      if (target) {
        const obs = new MutationObserver(() => scheduleGalaxySend("mutation"));
        obs.observe(target, { childList: true, subtree: true, characterData: true });
      }

      document.querySelectorAll("form[name='galaxyform'], form[action*='galaxy']").forEach((form) => {
        form.addEventListener("submit", () => {
          galLastGSKey = "";
          setTimeout(() => scheduleGalaxySend("navform"), 350);
        });
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          galLastGSKey = "";
          setTimeout(() => scheduleGalaxySend("keyNav"), 350);
        }
      });
    }

    if (page === "fleet1") {
      if (getExpAuto() && hasConsent()) setTimeout(() => scheduleFleetSend("auto"), 800);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
