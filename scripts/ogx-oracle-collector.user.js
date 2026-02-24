// ==UserScript==
// @name         OGX Oracle – Galaxy Collector
// @namespace    ogx-oracle
// @version      1.9.0
// @description  Sammelt Galaxy-View-Daten und sendet sie an OGX Oracle (/ingest/galaxy). Auth: Bearer JWT preferred, API key fallback.
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

  // -------------------------------
  // Config (can be changed via UI)
  // -------------------------------
  const STORAGE = {
    ORACLE_BASE: "ogx_oracle_base_url",
    API_KEY: "ogx_oracle_api_key",
    JWT: "ogx_oracle_jwt",
    AUTO_SEND: "ogx_oracle_auto_send",
  };

  const DEFAULTS = {
    // Base URL only; endpoints derived
    ORACLE_BASE: "http://127.0.0.1:8000",
    AUTO_SEND: true,
  };

  const DEBUG = false;

  const SEND_DEBOUNCE_MS = 900;
  const MIN_RESEND_SAME_GS_MS = 10_000;

  function log(...a) {
    if (DEBUG) console.log("[OGX-Oracle]", ...a);
  }

  function getOracleBase() {
    const v = (GM_getValue(STORAGE.ORACLE_BASE, DEFAULTS.ORACLE_BASE) || "").trim();
    return v.replace(/\/+$/, "") || DEFAULTS.ORACLE_BASE;
  }
  function setOracleBase(v) {
    const next = String(v || "").trim().replace(/\/+$/, "");
    if (next) GM_setValue(STORAGE.ORACLE_BASE, next);
  }

  function getAutoSend() {
    const v = GM_getValue(STORAGE.AUTO_SEND, DEFAULTS.AUTO_SEND);
    return v === true || v === "true" || v === 1 || v === "1";
  }
  function setAutoSend(v) {
    GM_setValue(STORAGE.AUTO_SEND, !!v);
  }

  function getApiKey() {
    return String(GM_getValue(STORAGE.API_KEY, "") || "").trim();
  }
  function setApiKey(k) {
    GM_setValue(STORAGE.API_KEY, String(k || "").trim());
  }

  function getJwt() {
    return String(GM_getValue(STORAGE.JWT, "") || "").trim();
  }
  function setJwt(t) {
    GM_setValue(STORAGE.JWT, String(t || "").trim());
  }

  function oracleUrl(path) {
    return getOracleBase() + path;
  }

  // -------------------------------
  // Galaxy/System detection
  // -------------------------------
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

  // -------------------------------
  // Moon name (best effort)
  // -------------------------------
  function extractMoonName(cell) {
    const a = cell.querySelector('a[onmouseover]');
    if (!a) return null;
    const ov = (a.getAttribute("onmouseover") || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'");
    const m = ov.match(/Mond\s+(.+?)\s+\[\d+:\d+:\d+\]/i);
    return m ? m[1].trim() : null;
  }

  // -------------------------------
  // Parse galaxy rows
  // -------------------------------
  function parseGalaxyRows() {
    const tbody = document.querySelector("#galaxy-rows");
    if (!tbody) {
      log("❌ #galaxy-rows not found");
      return [];
    }

    const rows = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th, td")];
      if (cells.length < 7) return;

      const posRaw = (cells[0]?.textContent || "").trim();
      const position = parseInt(posRaw, 10);

      // IMPORTANT: positions are 1..30 in OGX-like galaxies
      if (!position || position < 1 || position > 30) return;

      const playerRaw = (cells[5]?.textContent || "").trim();
      if (!playerRaw) return;

      const playerName =
        playerRaw.replace(/\s*\(\s*[a-zA-Z](?:\s+[a-zA-Z])*\s*\)\s*$/, "").trim() ||
        playerRaw;

      let planetName = (cells[2]?.textContent || "")
        .trim()
        .replace(/\(\d+\s*min\)/i, "")
        .replace(/\*+$/, "")
        .trim();
      if (!planetName) planetName = "Colonie";

      const allyName = (cells[6]?.textContent || "").trim().replace(/\s+/g, " ") || "";

      const moonCell = cells[3];
      const hasMoon = !!(moonCell?.querySelector('img[src*="s_mond"]'));
      const moonName = hasMoon ? extractMoonName(moonCell) : null;

      rows.push({
        position,
        planet_name: planetName,
        player: playerName,
        ally: allyName,
        has_moon: hasMoon,
        moon_name: moonName || null,
      });
    });

    log("Rows:", rows.length);
    return rows;
  }

  // -------------------------------
  // Badge UI
  // -------------------------------
  let badge = null;

  function createBadge() {
    const old = document.getElementById("ogx-oracle-badge");
    if (old) old.remove();

    badge = document.createElement("div");
    badge.id = "ogx-oracle-badge";
    Object.assign(badge.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483647",
      padding: "6px 14px",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: "600",
      fontFamily: "monospace",
      cursor: "pointer",
      userSelect: "none",
      boxShadow: "0 4px 14px rgba(0,0,0,.6)",
      border: "1px solid rgba(255,255,255,.2)",
      letterSpacing: ".3px",
      transition: "transform .2s",
      background: "rgba(10,20,40,.9)",
      color: "rgba(180,210,255,.85)",
    });

    badge.textContent = "◉ Oracle";
    badge.title =
      "OGX Oracle – Klick: senden | Rechtsklick: Setup (URL/Auth/AutoSend)";

    badge.addEventListener("click", () => scheduleSend("manual"));

    badge.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSetup();
    });

    document.body.appendChild(badge);
  }

  function showBadge(state, text) {
    if (!badge || !document.body.contains(badge)) createBadge();

    const cfg = {
      idle: ["rgba(10,20,40,.9)", "rgba(180,210,255,.85)", "rgba(100,160,255,.25)", "◉ Oracle"],
      ok: ["rgba(5,30,20,.9)", "rgba(52,211,153,.95)", "rgba(52,211,153,.4)", `✓ ${text}`],
      warn: ["rgba(30,20,5,.9)", "rgba(251,191,36,.95)", "rgba(251,191,36,.4)", `⚠ ${text}`],
      error: ["rgba(30,5,10,.9)", "rgba(251,113,133,.95)", "rgba(244,63,94,.4)", `✗ ${text}`],
    };

    const [bg, color, border, label] = cfg[state] || cfg.idle;
    Object.assign(badge.style, { background: bg, color, borderColor: border });
    badge.textContent = label;

    badge.style.transform = "scale(1.06)";
    setTimeout(() => { if (badge) badge.style.transform = "scale(1)"; }, 180);

    if (state !== "idle") setTimeout(() => showBadge("idle", ""), 5000);
  }

  function openSetup() {
    const base = prompt("OGX Oracle Base URL (z.B. http://127.0.0.1:8000):", getOracleBase());
    if (base !== null && String(base).trim()) setOracleBase(base);

    const mode = prompt(
      "Auth wählen:\n1 = Bearer JWT (preferred)\n2 = API Key (fallback)\n(Enter = überspringen)",
      ""
    );

    if (mode === "1") {
      const jwt = prompt("Bearer JWT (nur Token, ohne 'Bearer '):", getJwt());
      if (jwt !== null) {
        setJwt(jwt);
        // Optional: clear API key if JWT is set
        if (String(jwt).trim()) setApiKey("");
      }
    } else if (mode === "2") {
      const key = prompt("API Key:", getApiKey());
      if (key !== null) {
        setApiKey(key);
        // Optional: clear JWT if API key is set
        if (String(key).trim()) setJwt("");
      }
    }

    const as = prompt("Auto-Send aktiv?\n1 = Ja\n0 = Nein", getAutoSend() ? "1" : "0");
    if (as === "1") setAutoSend(true);
    if (as === "0") setAutoSend(false);

    showBadge("ok", "SETUP OK");
  }

  // -------------------------------
  // Menu injection (optional)
  // -------------------------------
  function injectMenuButton() {
    if (document.getElementById("ogx-oracle-menu-btn")) return;

    const anchor = [...document.querySelectorAll("tr")].find(
      (tr) =>
        /Ankuendigungen|Ankündigung/i.test(tr.textContent || "") &&
        tr.querySelector("th")
    );
    if (!anchor) return;

    const tr = document.createElement("tr");
    tr.id = "ogx-oracle-menu-btn";
    tr.style.cursor = "pointer";

    tr.innerHTML = `
      <th colspan="1" width="20px"> ≡ </th>
      <th id="ogx-oracle-th"
          style="background:rgb(53,69,102);box-shadow:rgba(0,0,0,0.1) 0px 4px 30px;">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:space-between;">
          <span id="ogx-oracle-label" style="color:#5bc8ff;">⬡ OGX Oracle</span>
          <span style="color:#5bc8ff;font-size:10px;opacity:.7;">↗</span>
        </div>
      </th>`;

    const th = tr.querySelector("#ogx-oracle-th");
    const label = tr.querySelector("#ogx-oracle-label");

    th.addEventListener("mouseover", () => {
      th.style.background = "#5b7bc0";
      th.style.boxShadow = "0 6px 40px rgba(0,0,0,0.3)";
    });
    th.addEventListener("mouseout", () => {
      th.style.background = "rgb(53,69,102)";
      th.style.boxShadow = "rgba(0,0,0,0.1) 0px 4px 30px";
    });

    tr.addEventListener("click", () => window.open(oracleUrl("/"), "_blank"));
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSetup();
      const orig = label.textContent;
      label.textContent = "✓ Setup";
      label.style.color = "#00ff9d";
      setTimeout(() => { label.textContent = orig; label.style.color = "#5bc8ff"; }, 2000);
    });

    anchor.insertAdjacentElement("afterend", tr);
  }

  // -------------------------------
  // Sending logic
  // -------------------------------
  let sendTimer = null;
  let lastSendAt = 0;
  let lastGSKey = "";

  function scheduleSend(reason) {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { sendTimer = null; doSend(reason); }, SEND_DEBOUNCE_MS);
  }

  function buildHeaders() {
    const headers = { "content-type": "application/json" };

    const jwt = getJwt();
    if (jwt) {
      headers["Authorization"] = "Bearer " + jwt;
      return headers;
    }

    const key = getApiKey();
    if (key) {
      headers["x-ogx-api-key"] = key;
      return headers;
    }

    return headers; // no auth set -> backend likely 401 in prod
  }

  function doSend(reason) {
    const { galaxy, system } = getGalaxySystem();
    const rows = parseGalaxyRows();

    if (!galaxy || !system) { showBadge("error", "? G/S"); return; }
    if (!rows.length) { showBadge("warn", "0 Rows"); return; }

    const now = Date.now();
    const gsKey = `${galaxy}:${system}`;

    if (gsKey === lastGSKey && now - lastSendAt < MIN_RESEND_SAME_GS_MS) {
      showBadge("idle", "");
      return;
    }

    lastGSKey = gsKey;
    lastSendAt = now;

    const url = oracleUrl("/ingest/galaxy");
    const headers = buildHeaders();

    // If no auth configured, warn early (still attempts)
    if (!headers.Authorization && !headers["x-ogx-api-key"]) {
      showBadge("warn", "NO AUTH");
    }

    log(`📡 Send ${rows.length} rows for ${gsKey} (${reason}) -> ${url}`);

    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers,
      data: JSON.stringify({ galaxy, system, rows }),
      timeout: 12_000,
      onload: (res) => {
        log("Response:", res.status, res.responseText);

        if (res.status === 401) { showBadge("error", "401 AUTH"); return; }
        if (res.status === 403) { showBadge("error", "403"); return; }
        if (res.status === 429) { showBadge("warn", "429 RL"); return; }
        if (res.status >= 500) { showBadge("error", "5xx"); return; }

        try {
          const d = JSON.parse(res.responseText || "{}");
          if (d && d.ok) showBadge("ok", `+${d.imported} ~${d.updated}`);
          else showBadge("error", (d && d.error) ? String(d.error) : "ERR");
        } catch {
          showBadge("error", "JSON");
        }
      },
      onerror: () => showBadge("error", "Offline?"),
      ontimeout: () => showBadge("error", "Timeout"),
    });
  }

  // -------------------------------
  // Boot
  // -------------------------------
  function isGalaxyPage() {
    const page = new URLSearchParams(window.location.search).get("page") || "";
    return page === "galaxy" || !!document.querySelector("#galaxy-rows");
  }

  function init() {
    injectMenuButton();
    [800, 2000, 4000].forEach((t) => setTimeout(injectMenuButton, t));

    if (!isGalaxyPage()) return;

    createBadge();
    showBadge("idle", "");

    if (getAutoSend()) setTimeout(() => scheduleSend("auto"), 800);

    const target = document.querySelector("#galaxy-rows");
    if (target) {
      new MutationObserver(() => scheduleSend("mutation")).observe(target, {
        childList: true,
        subtree: true,
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();