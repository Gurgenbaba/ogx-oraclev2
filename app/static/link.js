// link.js — account linking flow
(function() {
  var I18N = window.I18N || {};


  function qs(s) { return document.querySelector(s); }
  function token() { return localStorage.getItem("ogx_jwt") || ""; }
  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute("content") : "";
  }

  function showStatus(msg, cls) {
    var el = qs("#link-status");
    el.innerHTML = msg;
    el.className = "link-status " + cls;
    el.hidden = false;
  }

  function showLinked(username, serverId) {
    qs("#link-flow").hidden = true;
    qs("#link-already").hidden = false;
    qs("#link-linked-name").textContent = username;
    var serverLabel = {"uni1": "OGX Uni 1", "beta": "OGX Beta (PTU)"}[serverId] || serverId || "OGX";
    var el = qs("#link-server-name");
    if (el) el.textContent = serverLabel;
  }

  var pollTimer = null;
  var pollCount = 0;
  var MAX_POLLS = 60; // 4 minutes at 4s interval

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollCount = 0;
  }

  async function doPoll() {
    if (pollCount++ >= MAX_POLLS) {
      stopPolling();
      showStatus("(I18N['link.timeout'] || 'timeout')", "error");
      qs("#btn-generate").disabled = false;
      qs("#btn-generate").textContent = "(I18N['link.regenerate'] || 'regenerate')";
      return;
    }
    try {
      var r = await fetch("/api/link/poll", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token(),
          "x-csrf-token": csrfToken(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      var d = await r.json();
      if (!d.ok) {
        stopPolling();
        showStatus(d.error || "Error", "error");
        qs("#btn-generate").disabled = false;
        return;
      }
      if (d.linked) {
        stopPolling();
        showLinked(d.game_username, d.server_id || "uni1");
      }
      // d.pending === true → keep polling
    } catch(e) { /* keep trying */ }
  }

  // Generate code — calls /api/link/start, then starts polling verify
  qs("#btn-generate").addEventListener("click", async function() {
    stopPolling();
    this.disabled = true;
    this.textContent = "...";
    try {
      var r = await fetch("/api/link/start", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token(),
          "x-csrf-token": csrfToken()
        }
      });
      var d = await r.json();
      if (!d.ok) {
        showStatus(d.error || "Error", "error");
        this.disabled = false;
        this.textContent = "(I18N['link.generate'] || 'generate')";
        return;
      }

      // Show code + copy button
      qs("#link-code").textContent = d.code;
      qs("#link-code-box").hidden = false;
      qs("#btn-copy-code").hidden = false;
      this.textContent = "(I18N['link.regenerate'] || 'regenerate')";
      this.disabled = false;

      // Instruct user + start polling
      showStatus(
        "<span class='link-spinner'></span>(I18N['link.paste_in_ogx'] || 'paste in ogx')",
        "pending"
      );
      pollTimer = setInterval(doPoll, 4000);

    } catch(e) {
      showStatus("Network error", "error");
      this.disabled = false;
      this.textContent = "(I18N['link.generate'] || 'generate')";
    }
  });

  // Copy code button
  qs("#btn-copy-code") && qs("#btn-copy-code").addEventListener("click", function() {
    var code = qs("#link-code").textContent;
    navigator.clipboard.writeText(code).then(function() {
      var btn = qs("#btn-copy-code");
      var orig = btn.textContent;
      btn.textContent = "✓ (I18N['link.copied'] || 'copied')";
      setTimeout(function() { btn.textContent = orig; }, 2000);
    });
  });

  // Check status on page load (maybe already linked)
  async function checkStatus() {
    try {
      var r = await fetch("/api/bridge/status", {
        headers: { "Authorization": "Bearer " + token() }
      });
      var d = await r.json();
      if (d.linked) {
        showLinked(d.game_username, d.server_id);
      }
    } catch(e) {}
  }

  checkStatus();

  // Unlink
  var btnUnlink = qs("#btn-unlink");
  if (btnUnlink) {
    btnUnlink.addEventListener("click", async function() {
      if (!confirm("(I18N['link.unlink_confirm'] || 'unlink confirm')")) return;
      this.disabled = true;
      try {
        var r = await fetch("/api/link/unlink", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token(),
            "x-csrf-token": csrfToken()
          }
        });
        var d = await r.json();
        if (d.ok) { location.reload(); }
        else { showStatus(d.error || "Error", "error"); this.disabled = false; }
      } catch(e) {
        showStatus("Network error", "error");
        this.disabled = false;
      }
    });
  }

})();