// login-consent.js — enable register button on consent
(function() {
  var cb = document.getElementById("reg-consent");
  var btn = document.getElementById("btn-register");
  if (cb && btn) {
    cb.addEventListener("change", function() {
      btn.disabled = !cb.checked;
    });
  }
})();
