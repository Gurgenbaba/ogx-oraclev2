(function () {
  const tabLogin    = document.getElementById('tab-login');
  const tabReg      = document.getElementById('tab-register');
  const paneLogin   = document.getElementById('pane-login');
  const paneReg     = document.getElementById('pane-register');
  const errBox      = document.getElementById('auth-error');
  const btnLogin    = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');

  function showErr(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.style.display = msg ? 'block' : 'none';
  }

  function switchTab(toLogin) {
    tabLogin.classList.toggle('active', toLogin);
    tabReg.classList.toggle('active', !toLogin);
    paneLogin.hidden = !toLogin;
    paneReg.hidden   = toLogin;
    showErr('');
  }

  tabLogin.addEventListener('click', function () { switchTab(true); });
  tabReg.addEventListener('click', function () { switchTab(false); });

  function getCsrf() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function onSuccess(token, username) {
    // Save to localStorage so app knows user is logged in
    localStorage.setItem('ogx_jwt', token);
    // Go to success page to show token, then user clicks continue
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    window.location.href = '/login/success?t=' + encodeURIComponent(token)
      + '&u=' + encodeURIComponent(username)
      + '&next=' + encodeURIComponent(next);
  }

  function doLogin() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    if (!username || !password) { showErr('Bitte alle Felder ausfüllen.'); return; }
    btnLogin.disabled = true;
    btnLogin.textContent = '…';
    fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
      body: JSON.stringify({ username, password })
    })
    .then(r => r.json())
    .then(d => {
      if (d.ok && d.token) {
        onSuccess(d.token, username);
      } else {
        showErr(d.detail || d.error || d.message || 'Login fehlgeschlagen.');
        btnLogin.disabled = false;
        btnLogin.textContent = window.I18N && window.I18N['auth.login'] || 'Login';
      }
    })
    .catch(() => {
      showErr('Netzwerkfehler.');
      btnLogin.disabled = false;
      btnLogin.textContent = window.I18N && window.I18N['auth.login'] || 'Login';
    });
  }

  function doRegister() {
    const username = document.getElementById('reg-user').value.trim();
    const password = document.getElementById('reg-pass').value;
    if (!username || !password) { showErr('Bitte alle Felder ausfüllen.'); return; }
    btnRegister.disabled = true;
    btnRegister.textContent = '…';
    fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
      body: JSON.stringify({ username, password })
    })
    .then(r => r.json())
    .then(d => {
      if (d.ok && d.token) {
        onSuccess(d.token, username);
      } else {
        showErr(d.detail || d.error || d.message || 'Registrierung fehlgeschlagen.');
        btnRegister.disabled = false;
        btnRegister.textContent = window.I18N && window.I18N['auth.create_account'] || 'Account erstellen';
      }
    })
    .catch(() => {
      showErr('Netzwerkfehler.');
      btnRegister.disabled = false;
      btnRegister.textContent = window.I18N && window.I18N['auth.create_account'] || 'Account erstellen';
    });
  }

  btnLogin.addEventListener('click', doLogin);
  btnRegister.addEventListener('click', doRegister);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!paneLogin.hidden) doLogin();
    else if (!paneReg.hidden) doRegister();
  });
})();
