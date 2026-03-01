// auth.js — OGX Oracle  (with Profile Panel)
// - Stores token in localStorage
// - "Logged in: X" → opens profile+token panel
// - Shows login/register modal when needed
(function () {
  "use strict";

  const LS_KEY = "ogx_oracle_token";

  function qs(sel) { return document.querySelector(sel); }

  // ── Token helpers ──────────────────────────────────────
  function getToken() { return localStorage.getItem(LS_KEY) || ""; }
  function setToken(t) { localStorage.setItem(LS_KEY, t); }
  function clearToken() { localStorage.removeItem(LS_KEY); }

  // ── CSRF ───────────────────────────────────────────────
  function getCSRF() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : "";
  }

  // ── i18n helper ────────────────────────────────────────
  function i18n(key) {
    return (window.I18N && window.I18N[key]) ? window.I18N[key] : key;
  }

  // Rank icon map
  const RANK_ICONS = {
    "Grand Oracle": "👑",
    "High Oracle": "🔮",
    "Strategist": "🧠",
    "Commander": "⚔️",
    "Analyst": "📊",
    "Cadet": "🪐",
  };

  function rankIcon(rank) { return RANK_ICONS[rank] || "🪐"; }

  function fmt(n) { return Number(n || 0).toLocaleString(); }

  // ── Token panel helpers ────────────────────────────────
  function tokenEls() {
    return {
      panel:     qs("#auth-token-panel"),
      badge:     qs("#auth-token-badge"),
      title:     qs("#auth-token-title"),
      wrap:      qs("#auth-token-wrap"),
      ta:        qs("#auth-token"),
      copied:    qs("#auth-token-copied"),
      btnToggle: qs("#auth-token-toggle"),
      btnCopy:   qs("#auth-token-copy"),
      btnHide:   qs("#auth-token-hide"),
    };
  }

  function collapseTokenPanel() {
    const el = tokenEls();
    if (el.wrap)      el.wrap.style.display = "none";
    if (el.btnToggle) el.btnToggle.textContent = i18n("auth.show");
    if (el.btnCopy)   el.btnCopy.disabled = true;
    if (el.copied)    el.copied.style.display = "none";
    if (el.ta)        el.ta.scrollTop = 0;
  }

  function hideTokenPanel() {
    const el = tokenEls();
    if (el.ta)    el.ta.value = "";
    if (el.copied) el.copied.style.display = "none";
    if (el.panel) el.panel.style.display = "none";
    collapseTokenPanel();
  }

  function showTokenPanel(token, title, mode) {
    const el = tokenEls();
    if (el.title) el.title.textContent = title || "Token";
    if (el.badge) {
      if (mode === "register") el.badge.textContent = "🎉 Registered";
      else if (mode === "login") el.badge.textContent = "✅ Logged in";
      else el.badge.textContent = "Bearer JWT";
    }
    if (el.ta) { el.ta.value = String(token || ""); el.ta.scrollTop = 0; }
    // Show token-not-logged → hide; show panel
    const notLogged = qs("#token-not-logged");
    if (notLogged) notLogged.style.display = "none";
    if (el.panel) el.panel.style.display = "";
    collapseTokenPanel();
  }

  function toggleTokenPanel() {
    const el = tokenEls();
    if (!el.wrap || !el.btnToggle) return;
    const isOpen = el.wrap.style.display !== "none";
    if (isOpen) { collapseTokenPanel(); return; }
    el.wrap.style.display = "";
    el.btnToggle.textContent = i18n("auth.show").replace("Show", "Hide");
    if (el.btnCopy) el.btnCopy.disabled = false;
    if (el.ta) el.ta.focus();
  }

  async function copyTokenToClipboard() {
    const el = tokenEls();
    if (!el.ta) return;
    const val = String(el.ta.value || "").trim();
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
    } catch {
      el.ta.focus(); el.ta.select();
      document.execCommand("copy");
      el.ta.setSelectionRange(0, 0);
    }
    if (el.copied) {
      el.copied.style.display = "";
      setTimeout(() => { el.copied.style.display = "none"; }, 1200);
    }
  }

  // ── Profile panel ──────────────────────────────────────
  function openProfilePanel() {
    const overlay = qs("#profile-overlay");
    if (!overlay) return;
    overlay.style.display = "";
    overlay.setAttribute("aria-hidden", "false");
    // Load prestige data
    loadProfileData();
    // Ensure token tab shows token if logged in
    const token = getToken();
    if (token) showTokenPanel(token, "Token", "info");
  }

  function closeProfilePanel() {
    const overlay = qs("#profile-overlay");
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
  }

  async function loadProfileData() {
    const loading = qs("#profile-loading");
    const content = qs("#profile-content");
    if (!loading || !content) return;

    loading.style.display = "";
    content.style.display = "none";

    try {
      const resp = await ogxFetch("/api/prestige");
      if (!resp.ok) throw new Error("not_ok");
      const data = await resp.json();
      if (!data || !data.ok) throw new Error("bad");

      const s = data.summary;
      renderProfile(s, data.leaderboard || []);
      loading.style.display = "none";
      content.style.display = "";
    } catch (e) {
      if (loading) loading.textContent = "—";
    }
  }

  function renderProfile(s, lb) {
    // Rank icon + name
    const rankName = s.prestige_rank || "Cadet";
    const el_icon   = qs("#pc-rank-icon");
    const el_rname  = qs("#pc-rank-name");
    const el_op     = qs("#pc-op");
    const el_scanner= qs("#pc-scanner");

    if (el_icon)  el_icon.textContent  = rankIcon(rankName);
    if (el_rname) el_rname.textContent = i18n("rank." + rankName) || rankName;
    if (el_op)    el_op.textContent    = fmt(s.total_op) + " " + i18n("prestige.oracle_points");

    if (s.scanner_title) {
      if (el_scanner) {
        el_scanner.textContent = i18n("scanner." + s.scanner_title) || s.scanner_title;
        el_scanner.style.display = "inline-block";
      }
    }

    // Progress bar
    const el_progWrap = qs("#pc-prog-wrap");
    const el_nextRank = qs("#pc-next-rank");
    const el_opNeeded = qs("#pc-op-needed");
    const el_progFill = qs("#pc-prog-fill");

    if (s.next_rank) {
      if (el_nextRank) el_nextRank.textContent = "→ " + (i18n("rank." + s.next_rank.name) || s.next_rank.name);
      if (el_opNeeded) el_opNeeded.textContent = fmt(s.next_rank.op_needed) + " " + i18n("prestige.op_needed");
      if (el_progFill) el_progFill.style.width = (s.progress_pct || 0) + "%";
      if (el_progWrap) el_progWrap.style.display = "";
    } else {
      if (el_progWrap) el_progWrap.style.display = "none";
    }

    // Stats
    const el_expo   = qs("#pc-expo");
    const el_scan   = qs("#pc-scan");
    const el_streak = qs("#pc-streak");
    if (el_expo)   el_expo.textContent   = fmt(s.expo_count);
    if (el_scan)   el_scan.textContent   = fmt(s.scan_count);
    if (el_streak) el_streak.textContent = s.current_streak || 0;

    // Apply data-i18n labels
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = i18n(el.dataset.i18n) || el.textContent;
    });

    // Achievements (top 3)
    const achSection = qs("#pc-ach-section");
    const achList    = qs("#pc-ach-list");
    const unlocked   = s.achievements_unlocked || [];
    if (unlocked.length > 0 && achSection && achList) {
      achList.innerHTML = "";
      unlocked.slice(0, 3).forEach(a => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex;align-items:center;gap:10px;padding:7px 10px;background:#0f2a1a;border:1px solid #166534;border-radius:7px;font-size:11px;";
        div.innerHTML = `<span style="font-size:16px;flex-shrink:0;">${a.icon}</span><span style="color:#e2e8f0;font-weight:600;">${a.name}</span><span style="margin-left:auto;color:#22c55e;font-size:10px;">✓</span>`;
        achList.appendChild(div);
      });
      if (unlocked.length > 3) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:10px;color:#64748b;text-align:right;padding:2px 4px;";
        more.textContent = "+" + (unlocked.length - 3) + " more";
        achList.appendChild(more);
      }
      achSection.style.display = "";
    }

    // Leaderboard top 5
    const lbList = qs("#pc-lb-list");
    if (lbList && lb.length > 0) {
      lbList.innerHTML = "";
      lb.slice(0, 5).forEach(entry => {
        const medal = entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : String(entry.rank);
        const isYou = entry.is_current_user;
        const div = document.createElement("div");
        div.style.cssText = `display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;font-size:11px;${isYou ? "background:#0f1f3d;border:1px solid #1e3256;" : ""}`;
        div.innerHTML = `
          <span style="width:22px;text-align:center;flex-shrink:0;">${medal}</span>
          <span style="flex:1;color:${isYou ? "#60a5fa" : "#e2e8f0"};">${entry.username}${isYou ? ' <span style="font-size:9px;color:#60a5fa;">('+i18n("prestige.you")+')</span>' : ""}</span>
          <span style="color:#64748b;font-size:10px;">${i18n("rank." + entry.prestige_rank) || entry.prestige_rank}</span>
          <span style="color:#60a5fa;font-weight:600;min-width:40px;text-align:right;">${fmt(entry.total_op)}</span>
        `;
        lbList.appendChild(div);
      });
    }
  }

  // ── Profile tab switching ──────────────────────────────
  function switchProfileTab(tabName) {
    document.querySelectorAll(".profile-tab").forEach(t => {
      const isActive = t.dataset.ptab === tabName;
      t.style.color       = isActive ? "#e2e8f0" : "#64748b";
      t.style.borderBottom = isActive ? "2px solid #3b82f6" : "2px solid transparent";
    });
    const panes = ["profile", "token"];
    panes.forEach(p => {
      const pane = qs("#profile-pane-" + p);
      if (pane) pane.style.display = p === tabName ? "" : "none";
    });
  }

  // ── STATUS ─────────────────────────────────────────────
  async function refreshStatus() {
    const status  = qs("#auth-status");
    const openBtn = qs("#auth-open");
    const logoutBtn = qs("#auth-logout");

    const token = getToken();
    if (!token) {
      if (status)    { status.textContent = i18n("auth.not_logged_in"); status.style.cursor = "default"; }
      if (openBtn)   openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
      return;
    }

    try {
      const resp = await fetch("/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) throw new Error("not_ok");
      const data = await resp.json();
      if (!data || !data.ok) throw new Error("bad");

      const label = data.is_admin ? `${data.username} (Admin)` : data.username;
      if (status) {
        status.textContent = "Logged in: " + label;
        status.style.cursor = "pointer";
        status.title = i18n("auth.account") || "View profile";
      }
      if (openBtn)   openBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "";
    } catch (e) {
      clearToken();
      if (status) { status.textContent = i18n("auth.not_logged_in"); status.style.cursor = "default"; }
      if (openBtn)   openBtn.style.display = "";
      if (logoutBtn) logoutBtn.style.display = "none";
    }
  }

  // ── AUTH CALLS ─────────────────────────────────────────
  function setError(msg) {
    const e = qs("#auth-error");
    if (e) { e.textContent = msg; e.style.display = msg ? "" : "none"; }
  }

  async function login(username, password) {
    setError("");
    const resp = await fetch("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !data.ok || !data.token) {
      throw new Error(data && data.detail ? data.detail : "Login failed");
    }
    setToken(data.token);
    await refreshStatus();
    // Open profile panel on token tab to show the JWT
    openProfilePanel();
    switchProfileTab("token");
    showTokenPanel(data.token, "Token", "login");
  }

  async function register(username, password) {
    setError("");
    const resp = await fetch("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !data.ok || !data.token) {
      throw new Error(data && data.detail ? data.detail : "Registration failed");
    }
    setToken(data.token);
    await refreshStatus();
    openProfilePanel();
    switchProfileTab("token");
    showTokenPanel(data.token, "Token", "register");
  }

  // ── ogxFetch ───────────────────────────────────────────
  function ogxFetch(url, opts = {}) {
    if (!opts.headers) opts.headers = {};
    const csrf = getCSRF();
    if (csrf && !opts.headers["x-csrf-token"]) opts.headers["x-csrf-token"] = csrf;
    const token = getToken();
    if (token && !opts.headers["Authorization"]) opts.headers["Authorization"] = "Bearer " + token;
    return fetch(url, opts);
  }

  // ── UI BINDINGS ────────────────────────────────────────
  function openModal() {
    const m = qs("#auth-modal");
    if (!m) return;
    setError("");
    hideTokenPanel();
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    const u = m.querySelector('#auth-login-form input[name="username"]');
    if (u) u.focus();
  }

  function closeModal() {
    const m = qs("#auth-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
  }

  function bindUi() {
    // "Logged in: X" → open profile panel
    const status = qs("#auth-status");
    if (status) {
      status.addEventListener("click", () => {
        if (getToken()) openProfilePanel();
      });
    }

    // Logout
    const logoutBtn = qs("#auth-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        clearToken();
        closeProfilePanel();
        await refreshStatus();
      });
    }

    // Profile panel close
    const profileClose = qs("#profile-close");
    if (profileClose) profileClose.addEventListener("click", closeProfilePanel);

    // Profile overlay backdrop click
    const overlay = qs("#profile-overlay");
    if (overlay) {
      overlay.addEventListener("click", e => {
        if (e.target === overlay) closeProfilePanel();
      });
    }

    // Profile tab switching
    document.querySelectorAll(".profile-tab").forEach(tab => {
      tab.addEventListener("click", () => switchProfileTab(tab.dataset.ptab));
    });

    // Token panel buttons
    const el = tokenEls();
    if (el.btnToggle) el.btnToggle.addEventListener("click", toggleTokenPanel);
    if (el.btnCopy)   el.btnCopy.addEventListener("click", copyTokenToClipboard);
    if (el.btnHide)   el.btnHide.addEventListener("click", () => {
      switchProfileTab("profile"); // switch back to profile when hiding token
    });

    // Login/register forms (on /login page)
    const lf = qs("#auth-login-form");
    if (lf) {
      lf.addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(lf);
        try {
          await login(String(fd.get("username") || ""), String(fd.get("password") || ""));
        } catch (err) {
          setError("Login failed: " + (err && err.message ? err.message : "unknown"));
        }
      });
    }

    const rf = qs("#auth-register-form");
    if (rf) {
      rf.addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(rf);
        try {
          await register(String(fd.get("username") || ""), String(fd.get("password") || ""));
        } catch (err) {
          setError("Registration failed: " + (err && err.message ? err.message : "unknown"));
        }
      });
    }

    // Escape key closes profile panel
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeProfilePanel();
    });
  }

  // ── Expose ─────────────────────────────────────────────
  window.ogxAuth = {
    openModal, closeModal,
    getToken, setToken, clearToken,
    refreshStatus,
    openProfilePanel, closeProfilePanel,
  };
  window.ogxFetch = ogxFetch;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { bindUi(); refreshStatus(); });
  } else {
    bindUi();
    refreshStatus();
  }
})();
