// Admin › Contests & forms. Ported from StickyForms (public/admin.js): the form builder, entries,
// poll results and exports. Personal links, emailing and sign-in are left out: members answer
// from their portal while signed in to the club site.
(() => {
  const root = document.getElementById('sf-admin');
  if (!root) return;

  const TYPES = [
    ['text', 'Short text'], ['textarea', 'Long text (paragraph)'], ['email', 'Email'], ['number', 'Number'],
    ['date', 'Date'], ['select', 'Dropdown'], ['checkbox', 'Checkbox'], ['file', 'File upload'],
    ['poll', 'Poll'], ['ranking', 'Ranking'],
  ];
  const FORMAT_GROUPS = [
    ['Images', ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']],
    ['Documents', ['.pdf', '.doc', '.docx', '.txt']],
    ['Spreadsheets', ['.xls', '.xlsx', '.csv']],
    ['Archives', ['.zip']],
  ];
  const MAX_UPLOAD_MB = Number(root.dataset.maxUploadMb) || 25;
  const POSTER_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const POSTER_MAX_MB = 5;
  const API = '/admin/forms/api';
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const STATE_LABEL = { draft: 'Draft', open: 'Open', locked: 'Locked', closed: 'Closed' };

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = (s) => (s ? new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}${s.length > 16 ? 'Z' : '+08:00'}`) : null);
  const fmtDateTime = (s) => toDate(s)?.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '';
  const fmtDay = (s) => toDate(s)?.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) || '';
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const humanize = (n) => { const t = String(n).replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  const stateBadge = (f) => `<span class="sf-badge sf-${f.state}">${STATE_LABEL[f.state]}</span>`;

  let formsCache = [];
  let currentId = null;
  let builderDirty = false;

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { details: data.details });
    return data;
  }

  root.innerHTML = `
    <div class="sf-layout">
      <aside class="sf-side">
        <div class="sf-side-head"><strong>Forms</strong><button class="btn btn-sm" type="button" id="sf-new">+ New form</button></div>
        <input type="search" id="sf-search" placeholder="Search forms…" aria-label="Search forms" autocomplete="off">
        <ul class="sf-list" id="sf-list"><li class="muted">Loading…</li></ul>
      </aside>
      <section id="sf-detail" class="sf-detail"></section>
    </div>`;
  const detail = $('#sf-detail');
  detail.addEventListener('input', () => { if ($('#b-save')) builderDirty = true; });
  window.addEventListener('beforeunload', (e) => { if (builderDirty) { e.preventDefault(); e.returnValue = ''; } });
  let search = '';
  $('#sf-search').addEventListener('input', (e) => { search = e.target.value; renderList(); });
  $('#sf-new').onclick = () => { if (confirmLeave()) { currentId = null; renderList(); showBuilder(null); } };

  const confirmLeave = () => !builderDirty || window.confirm('You have unsaved changes in this form. Leave without saving?');

  async function loadList() {
    formsCache = await api('/');
    renderList();
  }

  function renderList() {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = words.length ? formsCache.filter((f) => words.every((w) => `${f.title} ${f.description || ''}`.toLowerCase().includes(w))) : formsCache;
    const ul = $('#sf-list');
    if (!formsCache.length) { ul.innerHTML = '<li class="muted">No forms yet.</li>'; return; }
    if (!shown.length) { ul.innerHTML = `<li class="muted">No forms match “${esc(search.trim())}”.</li>`; return; }
    ul.innerHTML = shown.map((f) => `
      <li><button type="button" data-id="${f.id}" class="${f.id === currentId ? 'active' : ''}">
        <span class="sf-li-title">${esc(f.title)}</span>
        <small>${stateBadge(f)} ${f.submissionCount} entr${f.submissionCount === 1 ? 'y' : 'ies'} · ${esc(fmtDay(f.createdAt))}</small>
      </button></li>`).join('');
    ul.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { if (confirmLeave()) showForm(Number(b.dataset.id)); }; });
  }

  function showEmpty(note) {
    detail.innerHTML = `<div class="empty-state">
      <h3>${note ? esc(note) : 'Contests & forms'}</h3>
      <p>Build a form for a contest, a sign-up or a poll. Members answer it from the Members’ portal once you publish it. Only administrators can create forms.</p>
      <p><button class="btn" type="button" id="sf-empty-new">+ New form</button></p></div>`;
    $('#sf-empty-new').onclick = () => showBuilder(null);
  }

  // ---------- Builder ----------
  function fileSettingsHtml(f) {
    const accept = new Set(f.accept || []);
    const groupChecked = (exts) => exts.every((e) => accept.has(e));
    const inGroups = new Set(FORMAT_GROUPS.filter(([, exts]) => groupChecked(exts)).flatMap(([, exts]) => exts));
    const other = [...accept].filter((e) => !inGroups.has(e)).join(', ');
    return `
      <div class="sf-sub-label">File upload settings</div>
      <div class="sf-inline-row">
        <label class="sf-inline">Max file size (MB)
          <input type="number" class="f-size" min="0.1" step="0.1" max="${MAX_UPLOAD_MB}" value="${esc(f.maxSizeMB ?? Math.min(10, MAX_UPLOAD_MB))}">
          <small class="muted">Up to ${MAX_UPLOAD_MB} MB</small>
        </label>
        <div class="sf-grow">
          <div class="sf-sub-label">Allowed formats</div>
          <div class="sf-formats">
            ${FORMAT_GROUPS.map(([name, exts]) => `<label class="sf-fmt"><input type="checkbox" class="f-fmt" data-exts="${exts.join(',')}" ${groupChecked(exts) ? 'checked' : ''}>
              <span><b>${name}</b> <small class="muted">${exts.map((e) => e.slice(1).toUpperCase()).join(', ')}</small></span></label>`).join('')}
          </div>
          <div class="sf-sub-label">Other extensions</div>
          <input class="f-other" placeholder="e.g. .dng, .cr3" value="${esc(other)}">
          <small class="muted">Nothing selected = any file type. Programs (.exe, .bat, .js…) are always blocked.</small>
        </div>
      </div>`;
  }

  function fieldRow(f = { name: '', label: '', type: 'text', required: false }) {
    const div = document.createElement('div');
    div.className = 'sf-field-row';
    if (f.name) div.dataset.name = f.name; // internal id (q1, q2…), kept so earlier answers stay linked
    div.innerHTML = `
      <select class="f-order" aria-label="Order" title="Position of this question"></select>
      <input placeholder="e.g. Title of your photo" class="f-label" value="${esc(f.label)}" aria-label="Question">
      <select class="f-type" aria-label="Type">${TYPES.map(([v, t]) => `<option value="${v}" ${v === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input placeholder="Optional short guide" class="f-notes" value="${esc(f.notes)}" maxlength="500" aria-label="Notes">
      <label class="sf-req"><input type="checkbox" class="f-req" ${f.required ? 'checked' : ''} aria-label="Required"><span class="sf-mobile">Required</span></label>
      <button type="button" class="sf-del f-del" title="Remove question" aria-label="Remove question">&times;</button>
      <div class="sf-extra f-opts-wrap"><div class="sf-sub-label">Dropdown choices</div><input placeholder="Separate choices with commas, e.g. Colour, Monochrome" class="f-opts" value="${esc((f.type === 'select' ? f.options || [] : []).join(', '))}"></div>
      <div class="sf-extra f-file">${fileSettingsHtml(f)}</div>
      <div class="sf-extra f-choices">
        <div class="sf-inline-row">
          <div class="sf-grow">
            <div class="sf-sub-label f-choices-title">Choices</div>
            <textarea class="f-items" rows="4" placeholder="One per line">${esc((['poll', 'ranking'].includes(f.type) ? f.options || [] : []).join('\n'))}</textarea>
            <small class="muted f-items-hint"></small>
          </div>
          <label class="sf-inline f-max-wrap">How many can they choose?
            <input type="number" class="f-max" min="1" value="${esc(f.maxChoices || 1)}">
            <small class="muted f-max-hint"></small>
          </label>
        </div>
      </div>`;
    const sync = () => {
      const t = $('.f-type', div).value;
      $('.f-opts-wrap', div).hidden = t !== 'select';
      $('.f-file', div).hidden = t !== 'file';
      $('.f-choices', div).hidden = !(t === 'poll' || t === 'ranking');
      $('.f-max-wrap', div).hidden = t !== 'poll';
      $('.f-choices-title', div).textContent = t === 'ranking' ? 'Items to rank (one per line)' : 'Poll choices (one per line)';
      const n = $('.f-items', div).value.split('\n').map((x) => x.trim()).filter(Boolean).length;
      $('.f-items-hint', div).textContent = t === 'ranking' ? `Members number these from 1 to ${n || 'n'} (1 = top choice).` : `${n} choice${n === 1 ? '' : 's'}`;
      const max = Number($('.f-max', div).value) || 1;
      $('.f-max-hint', div).textContent = max <= 1 ? 'Single choice' : `Up to ${max}`;
    };
    $('.f-items', div).oninput = sync;
    $('.f-max', div).oninput = sync;
    $('.f-type', div).onchange = sync;
    sync();
    $('.f-del', div).onclick = () => { const wrap = div.parentElement; div.remove(); renumber(wrap); builderDirty = true; };
    $('.f-order', div).onchange = (e) => {
      const wrap = div.parentElement;
      const others = [...wrap.children].filter((r) => r !== div);
      wrap.insertBefore(div, others[Number(e.target.value) - 1] || null);
      renumber(wrap);
      div.classList.remove('sf-moved'); void div.offsetWidth; div.classList.add('sf-moved');
      $('.f-order', div).focus();
    };
    return div;
  }

  function renumber(wrap) {
    const rows = [...wrap.children];
    rows.forEach((r, i) => {
      $('.f-order', r).innerHTML = rows.map((_, j) => `<option value="${j + 1}" ${j === i ? 'selected' : ''}>${j + 1}</option>`).join('');
    });
  }

  function readField(r) {
    const field = { name: r.dataset.name || '', label: $('.f-label', r).value, type: $('.f-type', r).value, required: $('.f-req', r).checked, notes: $('.f-notes', r).value };
    if (field.type === 'select') field.options = $('.f-opts', r).value.split(',').map((x) => x.trim()).filter(Boolean);
    if (field.type === 'poll' || field.type === 'ranking') field.options = $('.f-items', r).value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (field.type === 'poll') field.maxChoices = Number($('.f-max', r).value) || 1;
    if (field.type === 'file') {
      field.maxSizeMB = $('.f-size', r).value;
      field.accept = [
        ...[...r.querySelectorAll('.f-fmt:checked')].flatMap((c) => c.dataset.exts.split(',')),
        ...$('.f-other', r).value.split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean),
      ];
    }
    return field;
  }

  async function uploadPoster(formId, file) {
    const res = await fetch(`${API}/${formId}/poster`, { method: 'PUT', headers: { 'Content-Type': file.type, 'X-CSRF-Token': CSRF }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // A new form starts with the questions a photo contest usually needs.
  const CONTEST_START = [
    { label: 'Title of your photo', type: 'text', required: true },
    { label: 'Your photo', type: 'file', required: true, maxSizeMB: Math.min(20, MAX_UPLOAD_MB), accept: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff'], notes: 'Full-resolution file. Only the judges and administrators can see it.' },
    { label: 'Short description (optional)', type: 'textarea', required: false },
    { label: 'I confirm this is my own work and follows the contest rules', type: 'checkbox', required: true },
  ];

  function showBuilder(form) {
    const editing = Boolean(form);
    builderDirty = false;
    detail.innerHTML = `
      <div class="panel sf-card">
        <h2>${editing ? 'Edit form' : 'New form'}</h2>
        <div class="form">
          <div class="field"><label for="b-title">Title</label><input id="b-title" maxlength="200" value="${esc(form?.title)}" placeholder="e.g. Monthly contest: Streets of Cebu"></div>
          <div class="field"><label for="b-desc">Description and rules</label><textarea id="b-desc" rows="5" placeholder="Theme, rules, deadline, prizes…">${esc(form?.description)}</textarea><span class="hint">Line breaks are kept as you type them.</span></div>
          <div class="field">
            <span class="label">Poster image <span class="muted">(optional, shown at the top of the form)</span></span>
            <div class="sf-poster-edit">
              <div class="sf-poster-box" id="b-poster-box"></div>
              <div>
                <label class="btn btn-ghost btn-sm"><span id="b-poster-pick">Choose image…</span><input type="file" id="b-poster" accept="${POSTER_TYPES.join(',')}" hidden></label>
                <button type="button" class="btn btn-ghost btn-sm" id="b-poster-remove" hidden>Remove</button>
                <div class="hint">JPG, PNG, GIF or WebP · up to ${POSTER_MAX_MB} MB</div>
                <div class="sf-error" id="b-poster-err"></div>
              </div>
            </div>
          </div>
          <div class="row-3 sf-settings">
            <div class="field"><label for="b-closes">Closes on <span class="muted">(optional)</span></label><input id="b-closes" type="datetime-local" value="${esc(form?.closesAt || '')}"><span class="hint">Cebu time. Empty = open until you lock it.</span></div>
            <div class="field"><label for="b-max">Answers per member</label><input id="b-max" type="number" min="0" max="100" value="${esc(form?.maxPerMember ?? 1)}"><span class="hint">1 for most contests; 0 = no limit.</span></div>
            <label class="sf-switch"><input type="checkbox" id="b-resubmit" role="switch" ${form?.allowResubmit ? 'checked' : ''}>
              <span><b>Members can edit their answer</b><br><small class="muted">Until the form closes or is locked. Files they replace are deleted.</small></span></label>
          </div>
          <h3 class="sf-h3">Questions</h3>
          <div class="sf-field-head"><span>#</span><span>Question</span><span>Type</span><span>Notes</span><span>Required</span><span></span></div>
          <div id="b-fields"></div>
          <div><button type="button" class="btn btn-ghost btn-sm" id="b-add">+ Add question</button></div>
          <div id="b-err" class="sf-error"></div>
          <div class="inline-form">
            <button type="button" class="btn" id="b-save">${editing ? 'Save changes' : 'Create form'}</button>
            <button type="button" class="btn btn-ghost" id="b-cancel">Cancel</button>
            ${editing ? '' : '<span class="muted small">New forms start as drafts. Members see a form only after you publish it.</span>'}
          </div>
        </div>
      </div>`;

    let posterFile = null;
    let posterRemoved = false;
    let posterPreview = null;
    const drawPoster = () => {
      const src = posterFile ? posterPreview : (!posterRemoved && form?.posterUrl) || null;
      $('#b-poster-box').innerHTML = src ? `<img src="${esc(src)}" alt="Poster preview">` : '<span class="muted">No poster</span>';
      $('#b-poster-box').classList.toggle('empty', !src);
      $('#b-poster-remove').hidden = !src;
      $('#b-poster-pick').textContent = src ? 'Change image…' : 'Choose image…';
    };
    $('#b-poster').onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      $('#b-poster-err').textContent = '';
      if (!file) return;
      if (!POSTER_TYPES.includes(file.type)) { $('#b-poster-err').textContent = 'Please choose a JPG, PNG, GIF or WebP image.'; return; }
      if (file.size > POSTER_MAX_MB * 1048576) { $('#b-poster-err').textContent = `That image is too large (max ${POSTER_MAX_MB} MB).`; return; }
      if (posterPreview) URL.revokeObjectURL(posterPreview);
      posterFile = file;
      posterPreview = URL.createObjectURL(file);
      builderDirty = true;
      drawPoster();
    };
    $('#b-poster-remove').onclick = () => {
      if (posterFile) { posterFile = null; URL.revokeObjectURL(posterPreview); posterPreview = null; } else posterRemoved = true;
      builderDirty = true;
      drawPoster();
    };
    drawPoster();

    const wrap = $('#b-fields');
    (form?.fields?.length ? form.fields : CONTEST_START).forEach((f) => wrap.appendChild(fieldRow(f)));
    renumber(wrap);
    $('#b-add').onclick = () => { wrap.appendChild(fieldRow()); renumber(wrap); wrap.lastElementChild.querySelector('.f-label').focus(); };
    $('#b-cancel').onclick = () => {
      if (!confirmLeave()) return;
      builderDirty = false;
      if (editing) showForm(form.id); else showEmpty();
    };
    $('#b-save').onclick = async () => {
      const body = {
        title: $('#b-title').value,
        description: $('#b-desc').value,
        allowResubmit: $('#b-resubmit').checked,
        maxPerMember: $('#b-max').value,
        closesAt: $('#b-closes').value,
        fields: [...wrap.children].map(readField),
      };
      const btn = $('#b-save');
      btn.disabled = true;
      try {
        const saved = editing ? await api(`/${form.id}`, { method: 'PUT', body }) : await api('/', { method: 'POST', body });
        builderDirty = false;
        try {
          if (posterFile) await uploadPoster(saved.id, posterFile);
          else if (posterRemoved && form?.posterUrl) await api(`/${saved.id}/poster`, { method: 'DELETE' });
        } catch (e) {
          window.alert(`The form was saved, but the poster image could not be saved: ${e.message}`);
        }
        await showForm(saved.id);
      } catch (e) {
        $('#b-err').innerHTML = esc(e.message) + (e.details ? `<br>${e.details.map(esc).join('<br>')}` : '');
        btn.disabled = false;
      }
    };
    $('#b-title').focus();
  }

  // ---------- One form: status, actions, entries, results ----------
  function fmtAnswer(field, v, formId) {
    if (field.type === 'checkbox') return v ? 'Yes' : 'No';
    if (field.type === 'poll') return Array.isArray(v) && v.length ? v.map(esc).join('<br>') : '<span class="muted">—</span>';
    if (field.type === 'ranking') return Array.isArray(v) && v.length ? `<ol class="sf-rank-ol">${v.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : '<span class="muted">—</span>';
    if (field.type === 'file') {
      if (!v?.fileId) return '<span class="muted">—</span>';
      const url = `${API}/${formId}/files/${v.fileId}`;
      if (IMAGE_RE.test(v.name)) {
        return `<a class="sf-thumb" href="${url}?view=1" target="_blank" rel="noopener" title="Open ${esc(v.name)}"><img src="${url}?view=1" alt="${esc(v.name)}" loading="lazy"></a>
          <div class="sf-thumb-meta"><span title="${esc(v.name)}">${esc(v.name)}</span> · ${fmtSize(v.size)} · <a href="${url}" download>Download</a></div>`;
      }
      return `<a href="${url}" download>${esc(v.name)}</a><br><small class="muted">${fmtSize(v.size)}</small>`;
    }
    if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
    if (field.type === 'date') {
      const d = new Date(`${v}T00:00:00`);
      return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return esc(v);
  }

  function resultBlock(r) {
    if (r.type === 'poll') {
      return `<div class="sf-result"><div class="sf-result-q">${esc(r.label)}</div>
        ${r.options.map((o) => `<div class="sf-bar-row"><div class="sf-bar-label"><span>${esc(o.option)}</span><span class="muted">${o.count} · ${o.percent}%</span></div>
          <div class="sf-bar"><span style="width:${o.percent}%"></span></div></div>`).join('')}
        <small class="muted">${r.responses} response${r.responses === 1 ? '' : 's'}${r.maxChoices > 1 ? ` · up to ${r.maxChoices} choices each` : ''}</small></div>`;
    }
    return `<div class="sf-result"><div class="sf-result-q">${esc(r.label)} <span class="muted">(ranking)</span></div>
      <ol class="sf-rank-results">${r.options.map((o) => `<li><span>${esc(o.option)}</span><span class="muted">${o.averageRank == null ? '—' : `avg. ${o.averageRank}`}${o.firstPlace ? ` · ${o.firstPlace}× #1` : ''}</span></li>`).join('')}</ol>
      <small class="muted">${r.responses} response${r.responses === 1 ? '' : 's'} · ordered by average position (1 = best)</small></div>`;
  }

  function stateNote(form) {
    if (form.state === 'draft') return '<div class="notice"><div><strong>Draft.</strong> Members cannot see this form yet. Check it with Preview, then publish it.</div></div>';
    if (form.state === 'locked') return `<div class="notice"><div><strong>Locked</strong> since ${esc(fmtDateTime(form.lockedAt))}. Members see that it is temporarily closed and cannot send answers.</div></div>`;
    if (form.state === 'closed') return `<div class="notice"><div><strong>Closed</strong> on ${esc(fmtDateTime(form.closesAt))}. Change the closing date in Edit to reopen it.</div></div>`;
    return `<div class="notice sf-open"><div><strong>Open</strong> in the Members’ portal${form.closesAt ? ` until ${esc(fmtDateTime(form.closesAt))}` : ''}.</div></div>`;
  }

  async function showForm(id) {
    currentId = id;
    builderDirty = false;
    renderList();
    detail.innerHTML = '<p class="muted">Loading…</p>';
    let form; let subs; let results;
    try {
      [form, subs, results] = await Promise.all([api(`/${id}`), api(`/${id}/submissions`), api(`/${id}/results`)]);
    } catch (e) {
      detail.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
      return;
    }
    if (currentId !== id) return;
    const resultList = Object.values(results);
    const hasFiles = form.fields.some((f) => f.type === 'file');
    detail.innerHTML = `
      <div class="panel sf-card">
        <div class="sf-title-row">
          <h2>${esc(form.title)} ${stateBadge(form)}</h2>
          <div class="inline-form">
            <a class="btn btn-ghost btn-sm" href="/members/forms/${form.id}" target="_blank" rel="noopener">Preview</a>
            <button type="button" class="btn btn-ghost btn-sm" id="d-edit">Edit</button>
            <button type="button" class="btn btn-sm" id="d-publish">${form.published ? 'Unpublish' : 'Publish'}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="d-more" aria-haspopup="menu" aria-label="More actions">More ▾</button>
          </div>
        </div>
        ${form.description ? `<p class="sf-desc">${esc(form.description)}</p>` : ''}
        <p class="muted small">${form.fields.length} question${form.fields.length === 1 ? '' : 's'} · ${form.maxPerMember ? `${form.maxPerMember} answer${form.maxPerMember === 1 ? '' : 's'} per member` : 'no limit per member'}${form.allowResubmit ? ' · members can edit their answer' : ''}</p>
        ${form.posterUrl ? `<a class="sf-poster-thumb" href="${esc(form.posterUrl)}" target="_blank" rel="noopener"><img src="${esc(form.posterUrl)}" alt="Poster"></a>` : ''}
        ${stateNote(form)}
      </div>
      <div class="panel sf-card">
        <div class="sf-tabs" role="tablist">
          <button role="tab" class="sf-tab" data-tab="entries">Entries <span class="sf-count">${subs.length}</span></button>
          ${resultList.length ? '<button role="tab" class="sf-tab" data-tab="results">Poll results</button>' : ''}
        </div>
        <div class="sf-panel" data-panel="entries">
          ${subs.length ? `<div class="inline-form sf-exports">
            ${hasFiles ? `<a class="btn btn-ghost btn-sm" href="${API}/${id}/submissions.xlsx" download>Excel only</a>
              <a class="btn btn-sm" href="${API}/${id}/submissions.zip" download title="Excel plus every uploaded file, one folder per upload question, named after the member">Download all entries (Excel + files)</a>`
    : `<a class="btn btn-sm" href="${API}/${id}/submissions.xlsx" download>Download all entries (Excel)</a>`}
          </div>` : ''}
          <div class="table-wrap"><table class="sf-subs">
            <thead><tr><th>Submitted</th><th>Member</th>${form.fields.map((f) => `<th>${esc(f.label || humanize(f.name))}</th>`).join('')}<th></th></tr></thead>
            <tbody>
            ${subs.map((s) => `<tr>
              <td class="sf-nowrap">${esc(fmtDateTime(s.submittedAt))}${s.editedAt ? `<br><small class="muted">Edited ${esc(fmtDateTime(s.editedAt))}</small>` : ''}</td>
              <td>${esc(s.memberName || '(removed member)')}${s.memberLogin ? `<br><small class="muted">${esc(s.memberLogin)}</small>` : ''}</td>
              ${form.fields.map((f) => `<td>${fmtAnswer(f, s.data[f.name], id)}</td>`).join('')}
              <td><button type="button" class="btn btn-danger btn-sm" data-remove="${s.id}" data-who="${esc(s.memberName || 'this member')}">Remove</button></td>
            </tr>`).join('') || `<tr><td colspan="${form.fields.length + 3}" class="muted">No entries yet.</td></tr>`}
            </tbody>
          </table></div>
        </div>
        ${resultList.length ? `<div class="sf-panel" data-panel="results" hidden>
          <p class="muted">Live totals from ${subs.length} entr${subs.length === 1 ? 'y' : 'ies'}.</p>
          <div class="sf-results">${resultList.map(resultBlock).join('')}</div></div>` : ''}
      </div>`;

    $('#d-edit').onclick = () => showBuilder(form);
    $('#d-publish').onclick = () => act(form, form.published ? 'unpublish' : 'publish',
      form.published ? `Unpublish “${form.title}”? Members will no longer see it in their portal. Entries are kept.` : null);
    $('#d-more').onclick = (e) => { e.stopPropagation(); openMenu(e.currentTarget, form); };
    detail.querySelectorAll('.sf-tab').forEach((t) => {
      t.onclick = () => {
        detail.querySelectorAll('.sf-tab').forEach((x) => x.classList.toggle('active', x === t));
        detail.querySelectorAll('.sf-panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
      };
    });
    detail.querySelector('.sf-tab')?.classList.add('active');
    detail.querySelectorAll('[data-remove]').forEach((b) => {
      b.onclick = async () => {
        if (!window.confirm(`Remove the entry from ${b.dataset.who}, with any files they uploaded? This cannot be undone.`)) return;
        try { await api(`/${id}/submissions/${b.dataset.remove}`, { method: 'DELETE' }); await showForm(id); loadList(); } catch (e) { window.alert(e.message); }
      };
    });
  }

  async function act(form, action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(`/${form.id}/${action}`, { method: 'POST' });
      await loadList();
      await showForm(form.id);
    } catch (e) { window.alert(e.message); }
  }

  // ---------- More actions ----------
  const closeMenu = () => document.querySelector('.sf-menu')?.remove();
  document.addEventListener('click', (e) => { if (!e.target.closest('.sf-menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function openMenu(anchor, form) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'sf-menu';
    m.setAttribute('role', 'menu');
    const items = [
      ['duplicate', 'Duplicate…'],
      form.locked ? ['unlock', 'Unlock form'] : ['lock', 'Lock form (pause answers)'],
      ['delete', 'Delete…', 'danger'],
    ];
    m.innerHTML = items.map(([a, t, cls]) => `<button type="button" role="menuitem" data-act="${a}" class="${cls || ''}">${t}</button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + window.scrollY + 4}px`;
    m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8) + window.scrollX)}px`;
    m.querySelector('button').focus();
    m.onclick = async (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (!a) return;
      closeMenu();
      if (a === 'duplicate') duplicateDialog(form);
      if (a === 'lock') act(form, 'lock', `Lock “${form.title}”? Members see that it is temporarily closed until you unlock it. Entries are kept.`);
      if (a === 'unlock') act(form, 'unlock');
      if (a === 'delete') {
        if (!window.confirm(`Delete “${form.title}” with all its entries and uploaded files? This cannot be undone.`)) return;
        try { await api(`/${form.id}`, { method: 'DELETE' }); currentId = null; await loadList(); showEmpty('Form deleted.'); } catch (err) { window.alert(err.message); }
      }
    };
  }

  function duplicateDialog(form) {
    const taken = new Set(formsCache.map((f) => f.title.toLowerCase()));
    let suggestion = `${form.title} (copy)`;
    for (let n = 2; taken.has(suggestion.toLowerCase()); n += 1) suggestion = `${form.title} (copy ${n})`;
    const d = document.createElement('dialog');
    d.className = 'sf-modal';
    d.innerHTML = `<form method="dialog" class="form">
      <h2>Duplicate form</h2>
      <p class="muted">Copies the questions and settings of <b>${esc(form.title)}</b> as a new draft. Entries are not copied.</p>
      <div class="field"><label for="dup-title">New title</label><input id="dup-title" maxlength="200" required value="${esc(suggestion)}"></div>
      <div class="field"><label for="dup-desc">Description</label><textarea id="dup-desc" rows="3">${esc(form.description)}</textarea></div>
      <div id="dup-err" class="sf-error"></div>
      <div class="inline-form"><button type="submit" class="btn" id="dup-go">Create copy</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div>
    </form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.querySelector('[data-close]').onclick = () => d.close();
    d.showModal();
    d.querySelector('#dup-title').select();
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const copy = await api(`/${form.id}/duplicate`, { method: 'POST', body: { title: d.querySelector('#dup-title').value, description: d.querySelector('#dup-desc').value } });
        d.close();
        await loadList();
        await showForm(copy.id);
      } catch (err) { d.querySelector('#dup-err').textContent = err.details?.[0] || err.message; }
    };
  }

  loadList().then(() => {
    const wanted = Number(new URLSearchParams(location.search).get('form'));
    if (wanted && formsCache.some((f) => f.id === wanted)) showForm(wanted);
    else showEmpty();
  }).catch((e) => { detail.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; });
})();
