// app/static/prestige.js — CSP-safe: no eval, no inline styles
(function () {
  "use strict";

  var I18N = window.I18N || {};
  function t(key, fallback) { return I18N[key] || fallback || key; }

  var RANK_ICONS = {
    "Grand Oracle":  "👑",
    "High Oracle":   "🔮",
    "Strategist":    "🧠",
    "Commander":     "⚔️",
    "Analyst":       "📊",
    "Cadet":         "🪐",
  };

  var MEDALS = ["🥇","🥈","🥉"];

  function gel(id) { return document.getElementById(id); }

  function showState(state) {
    var loading = gel("psg-loading");
    var unauth  = gel("psg-unauth");
    var content = gel("psg-content");
    if (loading) { if (state === "loading") loading.removeAttribute("hidden"); else loading.setAttribute("hidden", ""); }
    if (unauth)  { if (state === "unauth")  unauth.removeAttribute("hidden");  else unauth.setAttribute("hidden", ""); }
    if (content) { if (state === "content") content.removeAttribute("hidden"); else content.setAttribute("hidden", ""); }
  }

  function renderRankHero(s) {
    var icon = RANK_ICONS[s.prestige_rank] || "🪐";
    var rankIcon = gel("psg-rank-icon");
    var rankName = gel("psg-rank-name");
    var totalOp  = gel("psg-total-op");
    var scanner  = gel("psg-scanner-title");
    var progFill = gel("psg-prog-fill");
    var progLabel = gel("psg-prog-label");

    if (rankIcon)  rankIcon.textContent = icon;
    if (rankName)  rankName.textContent = s.prestige_rank || "Cadet";
    if (totalOp)   totalOp.textContent  = (s.total_op || 0).toLocaleString();
    if (scanner)   scanner.textContent  = s.scanner_title || "";

    var pct = Math.min(100, Math.max(0, s.progress_pct || 0));
    if (progFill)  progFill.style.setProperty("--prog-pct", pct + "%");
    if (progLabel) {
      if (s.next_rank) {
        progLabel.textContent = s.next_rank.op_needed + " OP " + t("prestige.until_next", "bis nächster Rang");
      } else {
        progLabel.textContent = t("prestige.max_rank", "Maximaler Rang");
      }
    }
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
    name.textContent = a.name;

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
    var uGrid = gel("psg-ach-unlocked");
    var lGrid = gel("psg-ach-locked");
    var lTitle = gel("psg-ach-locked-title");

    if (uGrid) {
      uGrid.innerHTML = "";
      if (unlocked && unlocked.length) {
        unlocked.forEach(function(a) { uGrid.appendChild(makeAchItem(a, true)); });
      } else {
        uGrid.innerHTML = '<p class="muted" style="font-size:.8rem">' + t("prestige.no_achievements", "Noch keine Achievements.") + '</p>';
      }
    }

    if (locked && locked.length) {
      if (lTitle) lTitle.textContent = t("prestige.next_achievements", "Nächste Achievements:");
      if (lGrid) {
        lGrid.innerHTML = "";
        locked.forEach(function(a) { lGrid.appendChild(makeAchItem(a, false)); });
      }
    }
  }

  function renderLeaderboard(board) {
    var tbody = gel("psg-lb-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!board || !board.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 4;
      td.className = "muted";
      td.textContent = t("prestige.no_data", "Keine Daten.");
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    board.forEach(function(row) {
      var tr = document.createElement("tr");
      if (row.is_current_user) tr.className = "psg-lb-me";

      var tdRank = document.createElement("td");
      tdRank.innerHTML = row.rank <= 3
        ? '<span class="psg-lb-medal">' + MEDALS[row.rank - 1] + "</span>"
        : row.rank;

      var tdUser = document.createElement("td");
      tdUser.textContent = (row.is_current_user ? "→ " : "") + (row.username || "?");

      var tdPrestige = document.createElement("td");
      tdPrestige.textContent = (RANK_ICONS[row.prestige_rank] || "") + " " + (row.prestige_rank || "Cadet");

      var tdOp = document.createElement("td");
      tdOp.textContent = (row.total_op || 0).toLocaleString();

      tr.appendChild(tdRank);
      tr.appendChild(tdUser);
      tr.appendChild(tdPrestige);
      tr.appendChild(tdOp);
      tbody.appendChild(tr);
    });
  }

  function load() {
    showState("loading");
    var token = localStorage.getItem("ogx_jwt");
    if (!token) { showState("unauth"); return; }

    fetch("/api/prestige", {
      headers: { "Authorization": "Bearer " + token }
    })
    .then(function(r) {
      if (r.status === 401) { showState("unauth"); throw new Error("unauth"); }
      if (!r.ok) throw new Error("server_error_" + r.status);
      return r.json();
    })
    .then(function(d) {
      if (!d.ok) { showState("unauth"); return; }
      renderRankHero(d);
      renderStats(d);
      renderAchievements(d.achievements_unlocked, d.achievements_locked);
      renderLeaderboard(d.leaderboard);
      showState("content");
    })
    .catch(function(err) {
      if (err.message !== "unauth") {
        showState("loading");
        var el = gel("psg-loading");
        if (el) el.innerHTML = "⚠ " + t("prestige.loading", "Laden") + " — Fehler.";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
