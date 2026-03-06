// Already logged in? Skip landing, go straight to app
(function () {
  var token = localStorage.getItem("ogx_jwt");
  if (!token) return;
  fetch("/auth/me", { headers: { "Authorization": "Bearer " + token } })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { if (d && d.ok) window.location.replace("/?app=1"); })
    .catch(function() {});
})();
