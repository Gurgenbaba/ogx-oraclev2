(function() {
  function token() { return localStorage.getItem("ogx_jwt") || ""; }
  var listEl  = document.getElementById("psg-smuggler-list");
  var emptyEl = document.getElementById("psg-smuggler-empty");
  var counter = document.getElementById("psg-smuggler-count");

  var LEVEL_LABEL = { 1: "Lvl 1", 2: "Lvl 2", 3: "Lvl 3" };

  async function loadCodes() {
    try {
      var res = await fetch("/api/smuggler/codes", {
        headers: { "Authorization": "Bearer " + token() }
      });
      var d = await res.json();
      if (!d.ok || !d.codes) return;

      if (counter) counter.textContent = d.total;

      if (d.codes.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;

      listEl.innerHTML = "";
      d.codes.forEach(function(c) {
        var div = document.createElement("div");
        div.className = "psg-smuggler-history-item";
        var dateStr = c.expo_date ? new Date(c.expo_date).toLocaleDateString() : "";
        var xpStr = c.prestige_xp > 0 ? "+" + c.prestige_xp + " OP" : "";
        div.innerHTML =
          '<span class="code">' + c.code + '</span>' +
          '<span class="level">' + (LEVEL_LABEL[c.level] || "Lvl " + c.level) + '</span>' +
          (dateStr ? '<span class="date">' + dateStr + '</span>' : '') +
          (xpStr   ? '<span class="reward">' + xpStr + '</span>' : '');
        listEl.appendChild(div);
      });
    } catch(e) {}
  }

  if (listEl) loadCodes();
})();
