(function () {
  // Read token from URL param ?t=...
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t') || '';
  const username = params.get('u') || '';
  const next = params.get('next') || '/';
  const COUNTDOWN = 10;

  const ta = document.getElementById('token-ta');
  const copyBtn = document.getElementById('btn-copy');
  const contBtn = document.getElementById('btn-continue');
  const copiedMsg = document.getElementById('copied-msg');
  const titleEl = document.getElementById('success-title');
  const contLink = document.getElementById('btn-continue');

  // Fill in token
  if (ta) ta.value = token;
  if (username && titleEl) titleEl.textContent = 'Willkommen, ' + username;

  // Update continue link
  if (contLink) contLink.href = next;

  // Copy
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!token) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(token).then(showCopied).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    });
  }

  function fallbackCopy() {
    if (!ta) return;
    ta.select();
    try { document.execCommand('copy'); showCopied(); } catch (e) {}
  }

  function showCopied() {
    copyBtn.textContent = '✓ Kopiert!';
    if (copiedMsg) copiedMsg.classList.add('visible');
    setTimeout(function () {
      copyBtn.textContent = 'Token kopieren';
      if (copiedMsg) copiedMsg.classList.remove('visible');
    }, 2000);
  }

  // Countdown
  let count = COUNTDOWN;
  const label = document.createElement('div');
  label.className = 'success-countdown';
  label.textContent = 'Weiterleitung in ' + count + 's…';
  document.querySelector('.success-actions').after(label);

  const timer = setInterval(function () {
    count--;
    if (count <= 0) {
      clearInterval(timer);
      window.location.href = next;
    } else {
      label.textContent = 'Weiterleitung in ' + count + 's…';
    }
  }, 1000);

  // Manual continue cancels timer
  if (contBtn) {
    contBtn.addEventListener('click', function () {
      clearInterval(timer);
    });
  }
})();
