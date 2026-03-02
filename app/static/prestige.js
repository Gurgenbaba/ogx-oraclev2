/**
 * OGX Oracle — Prestige Page
 * CSP-safe: external file, no eval, no inline handlers
 * Reads JWT from localStorage, fetches /api/prestige
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
    var loading = gel("psg-loading");
    var unauth  = gel("psg-unauth");
    var content = gel("psg-content");
    if (loading) loading.style.display = state === "loading" ? "" : "none";
    if (unauth)  unauth.style.display  = state === "unauth"  ? "" : "none";
    if (content) content.style.display = state === "content" ? "" : "none";
  }

  function setLoadingText(msg) {
    var el = gel("psg-loading");
    if (el) el.textContent = msg;
  }

  function getToken() {
    // Support multiple keys (because login_success might store under another name)
    var keys = ["ogx_jwt", "ogx_token", "jwt", "token", "access_token"];
    for (var i = 0; i < keys.length; i++) {
      var v = localStorage.getItem(keys[i]);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function clearTokens() {
    var keys = ["ogx_jwt", "ogx_token", "jwt", "token", "access_token"];
    for (var i = 0; i < keys.length; i++) {
      try { localStorage.removeItem(keys[i]); } catch (e) {}
    }
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render(s, lb) {
    // defensive defaults
    s = s || {};
    lb = lb || [];

    // Reset toggles each render (important for re-renders / partial states)
    var scannerEl = gel("psg-scanner");
    var progEl    = gel("psg-prog");
    var maxrankEl = gel("psg-maxrank");

    if (scannerEl) scannerEl.classList.add("psg-hidden");
    if (progEl)    progEl.classList.add("psg-hidden");
    if (maxrankEl) maxrankEl.classList.add("psg-hidden");

    var rank = s.prestige_rank || "Cadet";

    // Hero
    gel("psg-icon").textContent      = ICONS[rank] || "🪐";
    gel("psg-rank-name").textContent = (t("rank." + rank) || rank);
    gel("psg-op").textContent        = fmt(s.total_op) + " " + t("prestige.oracle_points");

    if (s.scanner_title && scannerEl) {
      scannerEl.textContent = (t("scanner." + s.scanner_title) || s.scanner_title);
      scannerEl.classList.remove("psg-hidden");
    }

    if (s.next_rank && progEl) {
      gel("psg-next-name").textContent = "→ " + (t("rank." + s.next_rank.name) || s.next_rank.name);
      gel("psg-next-op").textContent   = fmt(s.next_rank.op_needed) + " " + t("prestige.op_needed");

      // Make progress bar actually work even if CSS var isn't wired
      var pct = Number(s.progress_pct || 0);
      if (isNaN(pct)) pct = 0;
      pct = Math.max(0, Math.min(100, pct));

      var fill = gel("psg-prog-fill");
      if (fill) {
        fill.style.width = pct + "%";
        // keep CSS-var too, if your CSS uses it
        fill.style.setProperty("--prog-pct", pct + "%");
      }

      progEl.classList.remove("psg-hidden");
    } else if (maxrankEl) {
      maxrankEl.classList.remove("psg-hidden");
    }

    // Stats
    gel("psg-expo").textContent   = fmt(s.expo_count);
    gel("psg-scan").textContent   = fmt(s.scan_count);
    gel("psg-smug").textContent   = fmt(s.smuggler_count);
    gel("psg-streak").textContent = String(s.current_streak || 0);

    var best = gel("psg-best");
    if (best) best.textContent = t("prestige.streak_best").replace("{n}", s.longest_streak || 0);

    // Achievements unlocked
    var ul = s.achievements_unlocked || [];
    var ulWrap = gel("psg-ach-unlocked");
    var ulLabel = gel("psg-ach-unlocked-label");
    if (ulWrap) ulWrap.innerHTML = "";
    if (ulLabel) ulLabel.classList.add("psg-hidden");

    if (ulWrap && ul.length) {
      ulLabel.textContent = ul.length + " " + t("prestige.unlocked");
      ulLabel.classList.remove("psg-hidden");
      ulWrap.innerHTML = ul.map(function (a) {
        return [
          '<div class="psg-ach-item unlocked">',
            '<div class="psg-ach-icon">' + esc(a.icon) + '</div>',
            '<div>',
              '<div class="psg-ach-name">' + esc(a.name) + '</div>',
              '<div class="psg-ach-desc">' + esc(a.description) + '</div>',
            '</div>',
            '<div class="psg-ach-tag">' + esc(t("prestige.achievement_unlocked")) + '</div>',
          '</div>'
        ].join("");
      }).join("");
    }

    // Achievements locked
    var lo = s.achievements_locked || [];
    var loWrap = gel("psg-ach-locked");
    var loLabel = gel("psg-ach-locked-label");
    if (loWrap) loWrap.innerHTML = "";
    if (loLabel) loLabel.classList.add("psg-hidden");

    if (loWrap && lo.length) {
      loLabel.classList.remove("psg-hidden");
      loWrap.innerHTML = lo.map(function (a) {
        var op = Number(a.op_reward || 0);
        return [
          '<div class="psg-ach-item locked">',
            '<div class="psg-ach-icon">' + esc(a.icon) + '</div>',
            '<div>',
              '<div class="psg-ach-name">' + esc(a.name) + '</div>',
              '<div class="psg-ach-desc">' + esc(a.description) + '</div>',
            '</div>',
            op > 0 ? '<div class="psg-ach-op">+' + esc(op) + ' OP</div>' : "",
          '</div>'
        ].join("");
      }).join("");
    }

    // Leaderboard
    var tbody = gel("psg-lb-body");
    if (tbody) {
      if (!lb.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="psg-no-data">' + esc(t("prestige.no_data")) + "</td></tr>";
      } else {
        tbody.innerHTML = lb.map(function (e) {
          var medalCls = e.rank === 1 ? "psg-medal-1" : e.rank === 2 ? "psg-medal-2" : e.rank === 3 ? "psg-medal-3" : "";
          var medal    = e.rank <= 3 ? MEDALS[e.rank - 1] : String(e.rank);
          var rankTxt  = (t("rank." + e.prestige_rank) || e.prestige_rank);
          var youSpan  = e.is_current_user ? '<span class="psg-lb-you">' + esc(t("prestige.you")) + "</span>" : "";
          return [
            "<tr>",
              '<td class="psg-lb-rank ' + medalCls + '">' + esc(medal) + "</td>",
              "<td>" + esc(e.username) + youSpan + "</td>",
              '<td><span class="psg-lb-badge">' + esc(rankTxt) + "</span></td>",
              '<td class="psg-lb-op">' + esc(fmt(e.total_op)) + "</td>",
              '<td class="psg-lb-num">' + esc(fmt(e.expo_count)) + "</td>",
              '<td class="psg-lb-num">' + esc(fmt(e.scan_count)) + "</td>",
            "</tr>"
          ].join("");
        }).join("");
      }
    }

    showState("content");
  }

  function load() {
    showState("loading");
    setLoadingText(t("prestige.loading"));

    var token = getToken();
    if (!token) {
      showState("unauth");
      return;
    }

    fetch("/api/prestige", {
      headers: { "Authorization": "Bearer " + token }
    })
    .then(function (r) {
      if (r.status === 401) {
        // Token invalid/expired or wrong key -> clear and show login
        clearTokens();
        showState("unauth");
        return null;
      }
      if (!r.ok) {
        // Show real error
        return r.text().then(function (txt) {
          throw new Error("HTTP " + r.status + " — " + (txt || "").slice(0, 400));
        });
      }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      if (!data.ok) {
        // API responded but not ok
        throw new Error((data.error || "unknown_error"));
      }
      render(data, data.leaderboard || []);
    })
    .catch(function (err) {
      setLoadingText("⚠ " + t("prestige.loading") + " — " + (err && err.message ? err.message : "Fehler"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
