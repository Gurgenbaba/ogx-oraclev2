// app/static/prestige.js — CSP-safe: no eval, no inline styles
(function () {
  "use strict";

  var I18N = window.I18N || {};
  function t(key, fallback) { return I18N[key] || fallback || key; }

  var RANK_ICONS = {
    "Grand Oracle": "👑", "High Oracle": "🔮", "Strategist": "🧠",
    "Commander": "⚔️",  "Analyst": "📊",      "Cadet": "🪐",
  };
  var MEDALS = ["🥇","🥈","🥉"];

  function gel(id) { return document.getElementById(id); }

  function renderRankHero(s) {
    var rankIcon  = gel("psg-rank-icon");
    var rankName  = gel("psg-rank-name");
    var totalOp   = gel("psg-total-op");
    var scanner   = gel("psg-scanner-title");
    var progFill  = gel("psg-prog-fill");
    var progLabel = gel("psg-prog-label");
    if (rankIcon)  rankIcon.textContent  = RANK_ICONS[s.prestige_rank] || "🪐";
    if (rankName)  rankName.textContent  = s.prestige_rank || "Cadet";
    if (totalOp)   totalOp.textContent   = (s.total_op || 0).toLocaleString();
    if (scanner)   scanner.textContent   = s.scanner_title || "";
    var pct = Math.min(100, Math.max(0, s.progress_pct || 0));
    if (progFill)  progFill.style.setProperty("--prog-pct", pct + "%");
    if (progLabel) progLabel.textContent = s.next_rank
      ? (s.next_rank.op_needed + " OP " + t("prestige.until_next", "bis nächster Rang"))
      : t("prestige.max_rank", "Maximaler Rang");
  }

  function renderStats(s) {
    var expo     = gel("psg-expo-count");
    var scans    = gel("psg-scan-count");
    var smuggler = gel("psg-smuggler-count");
    var streak   = gel("psg-streak");
    if (expo)     expo.textContent     = (s.expo_count     || 0).toLocaleString();
    if (scans)    scans.textContent    = (s.scan_count     || 0).toLocaleString();
    if (smuggler) smuggler.textContent = (s.smuggler_count || 0).toLocaleString();
    if (streak)   streak.textContent   = s.current_streak  || 0;
  }

  function makeAchItem(a, unlocked) {
    var div  = document.createElement("div");
    div.className = "psg-ach-item" + (unlocked ? " unlocked" : "");
    var icon = document.createElement("div");
    icon.className = "psg-ach-icon";
    icon.textContent = a.icon || "★";
    var body = document.createElement("div");
    var name = document.createElement("div");
    name.className = "psg-ach-name";
    name.textContent = a.name || "";
    var desc = document.createElement("div");
    desc.className = "psg-ach-desc";
    desc.textContent = a.description || "";
    body.appendChild(name);
    body.appendChild(desc);
    div.appendChild(icon);
    div.appendChild(body);
    return div;
  }

  function renderAchievements(unlocked, locked) {
    var uGrid  = gel("psg-ach-unlocked");
    var lGrid  = gel("psg-ach-locked");
    var lTitle = gel("psg-ach-locked-title");
    if (uGrid) {
      uGrid.innerHTML = "";
      if (unlocked && unlocked.length) {
        unlocked.forEach(function(a) { uGrid.appendChild(makeAchItem(a, true)); });
      } else {
        var p = document.createElement("p");
        p.className = "muted psg-empty-msg";
        p.textContent = t("prestige.no_achievements", "Noch keine Achievements.");
        uGrid.appendChild(p);
      }
    }
    if (locked && locked.length) {
      if (lTitle) lTitle.textContent = t("prestige.next_achievements", "Nächste Achievements:");
      if (lGrid) { lGrid.innerHTML = ""; locked.forEach(function(a) { lGrid.appendChild(makeAchItem(a, false)); }); }
    } else {
      if (lTitle) lTitle.textContent = "";
    }
  }

  function renderLeaderboard(board) {
    var tbody = gel("psg-lb-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!board || !board.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 4; td.className = "muted";
      td.textContent = t("prestige.no_data", "Keine Daten.");
      tr.appendChild(td); tbody.appendChild(tr); return;
    }
    board.forEach(function(row) {
      var tr = document.createElement("tr");
      if (row.is_current_user) tr.className = "psg-lb-me";
      var tdRank = document.createElement("td");
      if (row.rank <= 3) { var sp = document.createElement("span"); sp.className = "psg-lb-medal"; sp.textContent = MEDALS[row.rank-1]; tdRank.appendChild(sp); }
      else tdRank.textContent = row.rank;
      var tdUser = document.createElement("td");
      tdUser.textContent = (row.is_current_user ? "→ " : "") + (row.username || "?");
      var tdP = document.createElement("td");
      tdP.textContent = (RANK_ICONS[row.prestige_rank] || "") + " " + (row.prestige_rank || "Cadet");
      var tdOp = document.createElement("td");
      tdOp.textContent = (row.total_op || 0).toLocaleString();
      tr.appendChild(tdRank); tr.appendChild(tdUser); tr.appendChild(tdP); tr.appendChild(tdOp);
      tbody.appendChild(tr);
    });
  }

  function load() {
    var token = localStorage.getItem("ogx_jwt");
    if (!token) return;  // not logged in — nothing to do, page is static
    fetch("/api/prestige", { headers: { "Authorization": "Bearer " + token } })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d || !d.ok) return;
      renderRankHero(d);
      renderStats(d);
      renderAchievements(d.achievements_unlocked, d.achievements_locked);
      renderLeaderboard(d.leaderboard);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else { load(); }
})();
