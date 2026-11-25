// Mobile menu and copy-to-clipboard buttons. No other script on the site.
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.nav-toggle');
  if (toggle) {
    const nav = document.getElementById('site-nav');
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy && navigator.clipboard) {
    navigator.clipboard.writeText(copy.dataset.copy).then(() => {
      const label = copy.textContent;
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = label; }, 1600);
    });
  }
});

// Ask before destructive admin actions.
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
