// Site behaviour: mobile menu, copy buttons, confirmations, gallery slider and photo viewer.
// The only script on the site.

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

// Filters that apply as soon as a choice is made.
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit]')) e.target.form.requestSubmit();
});

// Formatting buttons for page text: wrap or prefix the selected text with the simple marks.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.md-toolbar [data-md]');
  if (!btn) return;
  const area = document.getElementById(btn.closest('.md-toolbar').dataset.for);
  const { selectionStart: a, selectionEnd: b, value } = area;
  const selected = value.slice(a, b);
  const lineStart = value.lastIndexOf('\n', a - 1) + 1;
  let insert;
  let from = a;
  let to = b;
  switch (btn.dataset.md) {
    case 'bold': insert = `**${selected || 'bold text'}**`; break;
    case 'italic': insert = `*${selected || 'italic text'}*`; break;
    case 'link': {
      const url = window.prompt('Link to (a web address, or a page such as /gallery):', 'https://');
      if (!url) return;
      insert = `[${selected || 'link text'}](${url.trim()})`;
      break;
    }
    case 'heading': from = lineStart; insert = `## ${value.slice(lineStart, b).replace(/^#+\s*/, '') || 'Heading'}`; break;
    case 'list': from = lineStart; insert = (value.slice(lineStart, b) || 'item').split('\n').map((l) => `- ${l.replace(/^[-*]\s+/, '')}`).join('\n'); break;
    default: return;
  }
  area.focus();
  area.setRangeText(insert, from, to, 'select');
  area.dispatchEvent(new Event('input', { bubbles: true }));
});

// Ask before destructive actions.
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Discourage saving photos with right-click or dragging. (Only resized, credited copies are
// ever served, which is the real protection.)
['contextmenu', 'dragstart'].forEach((type) => {
  document.addEventListener(type, (e) => {
    if (e.target.closest('.protect, .lightbox')) e.preventDefault();
  });
});

// Gallery catalogue slider: arrow buttons and keyboard move one panel at a time.
document.querySelectorAll('[data-slider]').forEach((track) => {
  const root = track.closest('.catalogues');
  const buttons = root.querySelectorAll('[data-slide]');
  const panelWidth = () => track.firstElementChild?.getBoundingClientRect().width || track.clientWidth;
  const update = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    buttons.forEach((b) => { b.disabled = Number(b.dataset.slide) < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= max; });
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    track.scrollBy({ left: Number(b.dataset.slide) * panelWidth(), behavior: 'smooth' });
  }));
  // A vertical mouse wheel scrolls the panels sideways, like the sliders it is modelled on.
  track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = track.scrollWidth - track.clientWidth;
    if ((e.deltaY < 0 && track.scrollLeft <= 0) || (e.deltaY > 0 && track.scrollLeft >= max - 1)) return;
    e.preventDefault();
    track.scrollBy({ left: e.deltaY });
  }, { passive: false });
  track.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
});

// Photo viewer for a category page.
(() => {
  const grid = document.querySelector('[data-lightbox]');
  const box = document.querySelector('.lightbox');
  if (!grid || !box) return;
  const tiles = [...grid.querySelectorAll('.photo-tile')];
  const img = box.querySelector('img');
  const title = box.querySelector('.title');
  const by = box.querySelector('.by');
  const caption = box.querySelector('.caption');
  const exposure = box.querySelector('.exposure');
  let index = 0;
  let lastFocus = null;

  const show = (i) => {
    index = (i + tiles.length) % tiles.length;
    const t = tiles[index];
    img.src = t.getAttribute('href');
    img.alt = `${t.dataset.title}, by ${t.dataset.by}`;
    title.textContent = t.dataset.title;
    by.textContent = t.dataset.by;
    caption.textContent = t.dataset.caption || '';
    exposure.textContent = t.dataset.exposure || '';
    exposure.hidden = !t.dataset.exposure;
    // Load the neighbours so moving through the set feels instant.
    [index + 1, index - 1].forEach((n) => { new Image().src = tiles[(n + tiles.length) % tiles.length].getAttribute('href'); });
  };
  const open = (i) => {
    lastFocus = document.activeElement;
    show(i);
    box.hidden = false;
    document.body.classList.add('lightbox-open');
    box.querySelector('.lightbox-close').focus();
  };
  const close = () => {
    box.hidden = true;
    img.removeAttribute('src');
    document.body.classList.remove('lightbox-open');
    lastFocus?.focus();
  };

  grid.addEventListener('click', (e) => {
    const t = e.target.closest('.photo-tile');
    if (!t) return;
    e.preventDefault();
    open(Number(t.dataset.index));
  });
  box.querySelector('.lightbox-close').addEventListener('click', close);
  box.querySelector('.prev').addEventListener('click', () => show(index - 1));
  box.querySelector('.next').addEventListener('click', () => show(index + 1));
  box.addEventListener('click', (e) => { if (e.target === box || e.target.classList.contains('lightbox-figure')) close(); });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
  // Swipe on phones.
  let startX = null;
  box.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
})();
