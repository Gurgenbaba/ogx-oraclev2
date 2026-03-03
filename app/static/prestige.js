// app/static/prestige.js
(function () {
  "use strict";
  var I18N = window.I18N || {};
  function t(key, fallback) { return I18N[key] || fallback || key; }
  var RANK_ICONS = { "Grand Oracle": "\uD83D\uDC51", "High Oracle": "\uD83D\uDD2E", "Strategist": "\uD83E\uDDE0", "Commander": "\u2694\uFE0F", "Analyst": "\uD83D\uDCCA", "Cadet": "\uD83E\uDE90" };
  var MEDALS = ["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
  function gel(id) { return document.getElementById(id); }
  function renderRankHero(s) {
    var ri = gel("psg-rank-icon"), rn = gel("psg-rank-name"), to = gel("psg-total-op"), sc = gel("psg-scanner-title"), pf = gel("psg-prog-fill"), pl = gel("psg-prog-label");
    if (ri) ri.textContent = RANK_ICONS[s.prestige_rank] || "\uD83E\uDE90";
    if (rn) rn.textContent = s.prestige_rank || "Cadet";
    if (to) to.textContent = (s.total_op || 0).toLocaleString();
    if (sc) sc.textContent = s.scanner_title || "";
    var pct = Math.min(100, Math.max(0, s.progress_pct || 0));
    if (pf) pf.style.setProperty("--prog-pct", pct + "%");
    if (pl) pl.textContent = s.next_rank ? (s.next_rank.op_needed + " OP " + t("prestige.until_next", "until next rank")) : t("prestige.max_rank", "Maximum rank reached!");
  }
  function renderStats(s) {
    var e = gel("psg-expo-count"), sc = gel("psg-scan-count"), sm = gel("psg-smuggler-count"), st = gel("psg-streak");
    if (e) e.textContent = (s.expo_count || 0).toLocaleString();
    if (sc) sc.textContent = (s.scan_count || 0).toLocaleString();
    if (sm) sm.textContent = (s.smuggler_count || 0).toLocaleString();
    if (st) st.textContent = s.current_streak || 0;
  }
  function makeAchItem(a, unlocked) {
    var div = document.createElement("div"); div.className = "psg-ach-item" + (unlocked ? " unlocked" : "");
    var icon = document.createElement("div"); icon.className = "psg-ach-icon"; icon.textContent = a.icon || "\u2605";
    var body = document.createElement("div");
    var name = document.createElement("div"); name.className = "psg-ach-name"; name.textContent = a.name || "";
    var desc = document.createElement("div"); desc.className = "psg-ach-desc"; desc.textContent = a.description || "";
    body.appendChild(name); body.appendChild(desc); div.appendChild(icon); div.appendChild(body); return div;
  }
  function renderAchievements(unlocked, locked) {
    var ug = gel("psg-ach-unlocked"), lg = gel("psg-ach-locked"), lt = gel("psg-ach-locked-title");
    if (ug) { ug.innerHTML = ""; if (unlocked && unlocked.length) { unlocked.forEach(function(a) { ug.appendChild(makeAchItem(a, true)); }); } else { var p = document.createElement("p"); p.className = "muted psg-empty-msg"; p.textContent = t("prestige.no_achievements", "No achievements yet."); ug.appendChild(p); } }
    if (locked && locked.length) { if (lt) lt.textContent = t("prestige.next_achievements", "Next achievements:"); if (lg) { lg.innerHTML = ""; locked.forEach(function(a) { lg.appendChild(makeAchItem(a, false)); }); } } else { if (lt) lt.textContent = ""; }
  }
  function renderLeaderboard(board) {
    var tbody = gel("psg-lb-body"); if (!tbody) return; tbody.innerHTML = "";
    if (!board || !board.length) { var tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 4; td.className = "muted"; td.textContent = t("prestige.no_data", "No data."); tr.appendChild(td); tbody.appendChild(tr); return; }
    board.forEach(function(row) {
      var tr = document.createElement("tr"); if (row.is_current_user) tr.className = "psg-lb-me";
      var tdR = document.createElement("td"); if (row.rank <= 3) { var sp = document.createElement("span"); sp.className = "psg-lb-medal"; sp.textContent = MEDALS[row.rank-1]; tdR.appendChild(sp); } else tdR.textContent = row.rank;
      var tdU = document.createElement("td"); tdU.textContent = (row.is_current_user ? "\u2192 " : "") + (row.username || "?");
      var tdP = document.createElement("td"); tdP.textContent = (RANK_ICONS[row.prestige_rank] || "") + " " + (row.prestige_rank || "Cadet");
      var tdO = document.createElement("td"); tdO.textContent = (row.total_op || 0).toLocaleString();
      tr.appendChild(tdR); tr.appendChild(tdU); tr.appendChild(tdP); tr.appendChild(tdO); tbody.appendChild(tr);
    });
  }
  function load() {
    var token = localStorage.getItem("ogx_jwt"); if (!token) return;
    fetch("/api/prestige", { headers: { "Authorization": "Bearer " + token } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (!d || !d.ok) return; renderRankHero(d); renderStats(d); renderAchievements(d.achievements_unlocked, d.achievements_locked); renderLeaderboard(d.leaderboard); });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", load); } else { load(); }
})();
