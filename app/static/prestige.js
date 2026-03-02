/**
 * OGX Oracle — Prestige Page
 * CSP-safe: external file, no eval, no inline handlers
 * Reads JWT from localStorage('ogx_jwt'), fetches /api/prestige
 */
(function () {
  "use strict";

  var I = window.I18N || {};
  function t(k) { return I[k] || k; }
  function fmt(n) { return Number(n || 0).toLocaleString(); }

  var MEDALS = ["🥇", "🥈", "🥉"];
  var ICONS = {
    "Grand Oracle": "👑",
    "High Oracle":  "🔮",
    "Strategist":   "🧠",
    "Commander":    "⚔️",
    "Analyst":      "📊",
    "Cadet":        "🪐"
  };

  function gel(id) { return document.getElementById(id); }

  function showState(state) {
    gel("psg-loading").style.display  = state === "loading" ? "" : "none";
    gel("psg-unauth").style.display   = state === "unauth"  ? "" : "none";
    gel("psg-content").style.display  = state === "content" ? "" : "none";
  }

  function render(s, lb) {
    var rank = s.prestige_rank || "Cadet";

    // Hero
    gel("psg-icon").textContent      = ICONS[rank] || "🪐";
    gel("psg-rank-name").textContent = t("rank." + rank) || rank;
    gel("psg-op").textContent        = fmt(s.total_op) + " " + t("prestige.oracle_points");

    var scannerEl = gel("psg-scanner");
    if (s.scanner_title) {
      scannerEl.textContent = t("scanner." + s.scanner_title) || s.scanner_title;
      scannerEl.classList.remove("psg-hidden");
    }

    var progEl    = gel("psg-prog");
    var maxrankEl = gel("psg-maxrank");
    if (s.next_rank) {
      gel("psg-next-name").textContent     = "→ " + (t("rank." + s.next_rank.name) || s.next_rank.name);
      gel("psg-next-op").textContent       = fmt(s.next_rank.op_needed) + " " + t("prestige.op_needed");
      gel("psg-prog-fill").style.setProperty("--prog-pct", (s.progress_pct || 0) + "%");
      progEl.classList.remove("psg-hidden");
    } else {
      maxrankEl.classList.remove("psg-hidden");
    }

    // Stats
    gel("psg-expo").textContent   = fmt(s.expo_count);
    gel("psg-scan").textContent   = fmt(s.scan_count);
    gel("psg-smug").textContent   = fmt(s.smuggler_count);
    gel("psg-streak").textContent = String(s.current_streak || 0);
    gel("psg-best").textContent   = t("prestige.streak_best").replace("{n}", s.longest_streak || 0);

    // Achievements unlocked
    var ul = s.achievements_unlocked || [];
    var ulWrap = gel("psg-ach-unlocked");
    var ulLabel = gel("psg-ach-unlocked-label");
    if (ul.length) {
      ulLabel.textContent = ul.length + " " + t("prestige.unlocked");
      ulLabel.classList.remove("psg-hidden");
      ulWrap.innerHTML = ul.map(function (a) {
        return [
          '<div class="psg-ach-item unlocked">',
          '<div class="psg-ach-icon">' + a.icon + '</div>',
          '<div><div class="psg-ach-name">' + a.name + '</div>',
          '<div class="psg-ach-desc">' + a.description + '</div></div>',
          '<div class="psg-ach-tag">' + t("prestige.achievement_unlocked") + '</div>',
          '</div>'
        ].join("");
      }).join("");
    }

    // Achievements locked
    var lo = s.achievements_locked || [];
    var loWrap = gel("psg-ach-locked");
    var loLabel = gel("psg-ach-locked-label");
    if (lo.length) {
      loLabel.classList.remove("psg-hidden");
      loWrap.innerHTML = lo.map(function (a) {
        return [
          '<div class="psg-ach-item locked">',
          '<div class="psg-ach-icon">' + a.icon + '</div>',
          '<div><div class="psg-ach-name">' + a.name + '</div>',
          '<div class="psg-ach-desc">' + a.description + '</div></div>',
          a.op_reward > 0 ? '<div class="psg-ach-op">+' + a.op_reward + ' OP</div>' : "",
          '</div>'
        ].join("");
      }).join("");
    }

    // Leaderboard
    var tbody = gel("psg-lb-body");
    if (lb.length) {
      tbody.innerHTML = lb.map(function (e) {
        var medalCls = e.rank === 1 ? "psg-medal-1" : e.rank === 2 ? "psg-medal-2" : e.rank === 3 ? "psg-medal-3" : "";
        var medal    = e.rank <= 3 ? MEDALS[e.rank - 1] : String(e.rank);
        var rankTxt  = t("rank." + e.prestige_rank) || e.prestige_rank;
        var youSpan  = e.is_current_user ? '<span class="psg-lb-you">' + t("prestige.you") + '</span>' : "";
        return [
          "<tr>",
          '<td class="psg-lb-rank ' + medalCls + '">' + medal + "</td>",
          "<td>" + e.username + youSpan + "</td>",
          '<td><span class="psg-lb-badge">' + rankTxt + "</span></td>",
          '<td class="psg-lb-op">' + fmt(e.total_op) + "</td>",
          '<td class="psg-lb-num">' + fmt(e.expo_count) + "</td>",
          '<td class="psg-lb-num">' + fmt(e.scan_count) + "</td>",
          "</tr>"
        ].join("");
      }).join("");
    }

    showState("content");
  }

  function load() {
    showState("loading");
    var token = localStorage.getItem("ogx_jwt");
    if (!token) {
      showState("unauth");
      return;
    }

    fetch("/api/prestige", {
      headers: { "Authorization": "Bearer " + token }
    })
    .then(function (r) {
      if (r.status === 401) { showState("unauth"); return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      if (!data.ok) { showState("unauth"); return; }
      var lb = data.leaderboard || [];
      var summary = data;
      render(summary, lb);
    })
    .catch(function () {
      var el = gel("psg-loading");
      if (el) el.textContent = "⚠ " + t("prestige.loading") + " — Fehler.";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
