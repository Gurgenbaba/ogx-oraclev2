// settings.js — account settings & deletion
(function() {
  var I18N = window.I18N || {};

  function token() { return localStorage.getItem("ogx_jwt") || ""; }
  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute("content") : "";
  }

  function showStatus(msg, cls) {
    var el = document.getElementById("settings-status");
    el.textContent = msg;
    el.className = "settings-status " + cls;
    el.hidden = false;
  }

  // Show confirm box
  var btnDelete = document.getElementById("btn-delete-account");
  var confirmBox = document.getElementById("settings-delete-confirm");
  var btnConfirm = document.getElementById("btn-delete-confirm");
  var btnCancel = document.getElementById("btn-delete-cancel");

  if (btnDelete) {
    btnDelete.addEventListener("click", function() {
      confirmBox.hidden = false;
      btnDelete.hidden = true;
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", function() {
      confirmBox.hidden = true;
      btnDelete.hidden = false;
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener("click", async function() {
      btnConfirm.disabled = true;
      btnConfirm.textContent = "...";
      try {
        var r = await fetch("/api/account/delete", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token(),
            "X-CSRF-Token": csrfToken(),
            "Content-Type": "application/json"
          }
        });
        var d = await r.json();
        if (d.ok) {
          localStorage.removeItem("ogx_jwt");
          showStatus(I18N["settings.delete_success"] || "Account gelöscht. Du wirst weitergeleitet...", "success");
          setTimeout(function() { window.location.href = "/"; }, 2500);
        } else {
          showStatus(I18N["settings.delete_error"] || "Fehler beim Löschen.", "error");
          btnConfirm.disabled = false;
          btnConfirm.textContent = I18N["settings.delete_yes"] || "Ja, löschen";
        }
      } catch(e) {
        showStatus("Network error", "error");
        btnConfirm.disabled = false;
      }
    });
  }
})();
