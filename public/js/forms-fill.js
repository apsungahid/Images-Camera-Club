// Members' form page. Ported from StickyForms (public/fill.js): the personal-link token is
// replaced by the signed-in member, and the look follows the club site.
(() => {
  const root = document.getElementById('sf-root');
  if (!root) return;
  const formId = root.dataset.formId;
  const API = `/members/forms/api/${formId}`;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const DRAFT_KEY = `icc:form-draft:${formId}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}${String(s).length > 16 ? 'Z' : '+08:00'}`) : null);
  const fmtDate = (s) => toDate(s)?.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '';

  // Answers survive a refresh or a closed tab until they are sent ("sticky" drafts).
  const draft = {
    load() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; } },
    save(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } },
  };

  // ---------- Inputs ----------
  function inputFor(f, value) {
    const id = `f_${f.name}`;
    const req = f.required ? 'required' : '';
    const reqCls = f.required ? 'sf-req-label' : '';
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
    if (f.type === 'checkbox') {
      return `<label class="check sf-check ${reqCls}"><input type="checkbox" id="${id}" name="${f.name}" ${value ? 'checked' : ''} ${req}> <span>${esc(f.label)}</span></label>`;
    }
    if (f.type === 'poll') {
      const max = f.maxChoices || 1;
      const multi = max > 1;
      const picked = Array.isArray(value) ? value : [];
      return `<span class="label ${reqCls}">${esc(f.label)}</span>
        <div class="sf-choices" data-poll="${f.name}" data-max="${max}" role="${multi ? 'group' : 'radiogroup'}" aria-label="${esc(f.label)}">
          ${f.options.map((o) => `<label class="sf-choice"><input type="${multi ? 'checkbox' : 'radio'}" name="${f.name}" value="${esc(o)}" ${picked.includes(o) ? 'checked' : ''}> <span>${esc(o)}</span></label>`).join('')}
        </div>
        <span class="hint">${multi ? `Choose up to ${max}.` : 'Choose one.'}</span>`;
    }
    if (f.type === 'ranking') {
      const n = f.options.length;
      const ranks = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return `<span class="label ${reqCls}">${esc(f.label)}</span>
        <div class="sf-ranking" data-rank="${f.name}">
          ${f.options.map((o) => `<div class="sf-rank-item">
            <select data-item="${esc(o)}" aria-label="Rank for ${esc(o)}">
              <option value="">–</option>${f.options.map((_, i) => `<option value="${i + 1}" ${String(ranks[o]) === String(i + 1) ? 'selected' : ''}>${i + 1}</option>`).join('')}
            </select><span>${esc(o)}</span></div>`).join('')}
        </div>
        <span class="hint">Number the items from 1 (your top choice) to ${n}. Each number can be used once.</span>`;
    }
    let control;
    if (f.type === 'file') {
      const accept = (f.accept || []).join(',');
      const formats = f.accept?.length ? f.accept.map((e) => e.slice(1).toUpperCase()).join(', ') : 'Any file type';
      control = `<input id="${id}" name="${f.name}" type="file" ${accept ? `accept="${esc(accept)}"` : ''} ${req}>
        <span class="hint">${esc(formats)} · up to ${f.maxSizeMB} MB</span>`;
    } else if (f.type === 'textarea') control = `<textarea id="${id}" name="${f.name}" rows="5" ${req} ${ph}>${esc(value)}</textarea>`;
    else if (f.type === 'select') {
      control = `<select id="${id}" name="${f.name}" ${req}><option value="">Choose…</option>${f.options
        .map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else control = `<input id="${id}" name="${f.name}" type="${f.type}" value="${esc(value)}" ${req} ${ph}>`;
    return `<label for="${id}" class="${reqCls}">${esc(f.label)}</label>${control}`;
  }

  const BLOCKED = ['.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.jar', '.sh', '.dll', '.hta', '.lnk', '.reg', '.cpl'];
  function checkFile(f, file) {
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!ext || BLOCKED.includes(ext)) return 'This type of file is not allowed';
    if (f.accept?.length && !f.accept.includes(ext)) return `Allowed formats: ${f.accept.map((e) => e.slice(1).toUpperCase()).join(', ')}`;
    if (file.size > f.maxSizeMB * 1024 * 1024) return `File is too large (max ${f.maxSizeMB} MB)`;
    if (file.size === 0) return 'The file is empty';
    return null;
  }

  function collect(form, fields) {
    const data = {};
    for (const f of fields) {
      if (f.type === 'file') continue;
      if (f.type === 'poll') { data[f.name] = [...form.querySelectorAll(`[data-poll="${f.name}"] input:checked`)].map((i) => i.value); continue; }
      if (f.type === 'ranking') {
        const ranks = {};
        form.querySelectorAll(`[data-rank="${f.name}"] select`).forEach((s) => { ranks[s.dataset.item] = s.value; });
        data[f.name] = ranks;
        continue;
      }
      const el = form.elements[f.name];
      data[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    }
    return data;
  }

  function enforcePollLimits(form) {
    form.querySelectorAll('[data-poll]').forEach((group) => {
      const max = Number(group.dataset.max) || 1;
      if (max <= 1) return;
      const boxes = [...group.querySelectorAll('input')];
      const full = boxes.filter((b) => b.checked).length >= max;
      boxes.forEach((b) => { b.disabled = full && !b.checked; b.closest('.sf-choice').classList.toggle('disabled', b.disabled); });
    });
  }

  // Rankings: picking a number another item already has swaps the two.
  function wireRankings(form, onChange) {
    form.querySelectorAll('[data-rank]').forEach((group) => {
      const selects = [...group.querySelectorAll('select')];
      selects.forEach((sel) => {
        sel.addEventListener('focus', () => { sel.dataset.prev = sel.value; });
        sel.addEventListener('change', () => {
          const other = selects.find((o) => o !== sel && o.value && o.value === sel.value);
          if (other) other.value = sel.dataset.prev || '';
          sel.dataset.prev = sel.value;
          onChange();
        });
      });
    });
  }

  // ---------- After sending: what the member sent, with live poll results ----------
  function pollResultsHtml(a) {
    const picked = Array.isArray(a.value) ? a.value : [];
    const r = a.results;
    return `${r.options.map((o) => {
      const isMine = picked.includes(o.option);
      return `<div class="sf-bar-row ${isMine ? 'mine' : ''}">
        <div class="sf-bar-label"><span>${esc(o.option)}${isMine ? ' <span class="sf-mine-tag">Your choice</span>' : ''}</span>
          <span class="muted">${o.count} vote${o.count === 1 ? '' : 's'} · ${o.percent}%</span></div>
        <div class="sf-bar"><span style="width:${o.percent}%"></span></div></div>`;
    }).join('')}
    <span class="hint">${r.responses} response${r.responses === 1 ? '' : 's'} so far</span>`;
  }

  function rankingHtml(a) {
    if (!Array.isArray(a.value) || !a.value.length) return '<span class="muted">Not answered</span>';
    const overall = a.results?.options?.filter((o) => o.averageRank != null) || [];
    return `<ol class="sf-rank-results">${a.value.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
      ${overall.length ? `<span class="hint">Everyone so far: ${overall.map((o, i) => `${i + 1}. ${esc(o.option)}`).join(' · ')}</span>` : ''}`;
  }

  const imagePreviewHtml = (url, name) => `<a class="sf-file-preview" href="${esc(url)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`;
  const PREVIEWABLE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'];

  function answerHtml(a) {
    if (a.type === 'poll') return pollResultsHtml(a);
    if (a.type === 'ranking') return rankingHtml(a);
    if (a.type === 'checkbox') return a.value ? 'Yes' : 'No';
    if (a.value === null || a.value === '' || (Array.isArray(a.value) && !a.value.length)) return '<span class="muted">Not answered</span>';
    if (a.type === 'file') return a.previewUrl ? `${imagePreviewHtml(a.previewUrl, a.value)}<div class="muted small">${esc(a.value)}</div>` : esc(a.value);
    if (a.type === 'date') {
      const d = new Date(`${a.value}T00:00:00`);
      return Number.isNaN(d.getTime()) ? esc(a.value) : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return `<span class="sf-pre">${esc(a.value)}</span>`;
  }

  const headerHtml = (info) => `
    ${info.posterUrl ? `<a class="sf-poster" href="${esc(info.posterUrl)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(info.posterUrl)}" alt="${esc(info.title)} poster"></a>` : ''}
    <h1 class="sf-fill-title">${esc(info.title)}</h1>
    ${info.closesAt ? `<p class="sf-deadline">Closes ${esc(fmtDate(info.closesAt))}</p>` : ''}
    ${info.description ? `<div class="sf-desc">${esc(info.description)}</div>` : ''}`;

  function renderView(info, { justSent = false, justEdited = false } = {}) {
    const many = info.submissions.length > 1;
    root.innerHTML = `
      ${justEdited ? '<div class="alert alert-success">Your answer was updated.</div>' : justSent ? '<div class="alert alert-success">Thank you! Your answer was recorded.</div>' : ''}
      ${headerHtml(info)}
      <p class="muted">${many ? `You have sent ${info.submissions.length} answers. Here they are, newest first.` : 'Here is what you sent.'}</p>
      ${info.submissions.map((s, i) => `
        <div class="sf-answer-set">
          <span class="muted small">${many ? `Answer ${info.submissions.length - i} · ` : ''}Sent ${esc(fmtDate(s.submittedAt))}${s.editedAt ? ` · last edited ${esc(fmtDate(s.editedAt))}` : ''}</span>
          ${s.answers.map((a) => `<div class="sf-answer"><div class="sf-q">${esc(a.label)}</div>${answerHtml(a)}</div>`).join('')}
        </div>`).join('')}
      <div class="inline-form">
        ${info.canEdit ? `<button type="button" class="btn" id="edit">Edit my ${many ? 'latest ' : ''}answer</button>` : ''}
        ${info.canSubmitAgain ? `<button type="button" class="btn ${info.canEdit ? 'btn-ghost' : ''}" id="again">Send another answer</button>` : ''}
        <a class="btn btn-ghost" href="/members">Back to the portal</a>
      </div>`;
    document.getElementById('again')?.addEventListener('click', () => init({ forceForm: true }));
    document.getElementById('edit')?.addEventListener('click', startEdit);
  }

  // ---------- Editing (forms that allow it) ----------
  function toInputValues(fields, data) {
    const out = {};
    for (const f of fields) {
      const v = data[f.name];
      out[f.name] = f.type === 'ranking' && Array.isArray(v) ? Object.fromEntries(v.map((o, i) => [o, i + 1])) : v ?? '';
    }
    return out;
  }

  async function startEdit() {
    const res = await fetch(`${API}/edit`, { credentials: 'same-origin' });
    const info = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(info.error || 'This answer can no longer be changed.'); init(); return; }
    renderForm(info, { edit: true });
    window.scrollTo(0, 0);
  }

  // ---------- The form ----------
  function renderForm(info, { edit = false } = {}) {
    const existing = edit ? info.files || {} : {};
    const saved = edit ? toInputValues(info.fields, info.data || {}) : draft.load();
    const fieldHtml = (f) => {
      const cur = existing[f.name];
      const f2 = cur ? { ...f, required: false } : f; // keeping the current file is fine
      return `${inputFor(f2, saved[f.name])}${cur ? `<div class="sf-current-file" data-current="${f.name}">${cur.previewUrl ? imagePreviewHtml(cur.previewUrl, cur.name) : ''}<div>Current file: <b>${esc(cur.name)}</b>. Choose a new file only to replace it.</div></div>` : ''}${f.type === 'file' ? `<div class="sf-new-preview" data-preview="${f.name}" hidden></div>` : ''}`;
    };
    root.innerHTML = `
      ${headerHtml(info)}
      ${edit ? `<div class="notice"><div>You are editing the answer you sent on ${esc(fmtDate(info.submittedAt))}. When you send it again, these answers replace it.</div></div>` : ''}
      <form id="f" class="form sf-form" novalidate>
        ${info.fields.map((f) => `<div class="field">${fieldHtml(f)}${f.notes ? `<div class="sf-note">${esc(f.notes)}</div>` : ''}<div class="sf-error" data-err="${f.name}"></div></div>`).join('')}
        <div id="form-err" class="sf-error"></div>
        <div class="inline-form">
          <button class="btn" type="submit" ${info.preview ? 'disabled title="Publish the form first"' : ''}>${edit ? 'Send changes' : 'Send'}</button>
          ${edit ? '<button type="button" class="btn btn-ghost" id="cancel-edit">Cancel</button>' : ''}
        </div>
      </form>`;
    if (edit) document.getElementById('cancel-edit').onclick = () => init();

    const form = document.getElementById('f');
    for (const f of info.fields.filter((x) => x.type === 'file')) {
      const input = form.elements[f.name];
      const box = form.querySelector(`[data-preview="${f.name}"]`);
      let url = null;
      input.addEventListener('change', () => {
        if (url) URL.revokeObjectURL(url);
        url = null;
        const file = input.files[0];
        if (file && PREVIEWABLE.includes(file.type)) {
          url = URL.createObjectURL(file);
          box.innerHTML = `<img src="${url}" alt="Preview of ${esc(file.name)}"><span class="hint">${existing[f.name] ? 'New image (replaces the current one when you send)' : 'Preview'}</span>`;
          box.hidden = false;
        } else { box.innerHTML = ''; box.hidden = true; }
        form.querySelector(`[data-current="${f.name}"]`)?.classList.toggle('replacing', Boolean(file));
      });
    }
    const saveDraft = () => { if (!edit) draft.save(collect(form, info.fields)); };
    enforcePollLimits(form);
    wireRankings(form, saveDraft);
    form.addEventListener('change', () => enforcePollLimits(form));
    form.addEventListener('input', saveDraft);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('[data-err]').forEach((el) => { el.textContent = ''; });
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      const fileFields = info.fields.filter((f) => f.type === 'file');
      let clientErr = false;
      for (const f of fileFields) {
        const file = form.elements[f.name].files[0];
        const msg = file ? checkFile(f, file) : (f.required && !existing[f.name] ? 'Please attach a file' : null);
        if (msg) { form.querySelector(`[data-err="${f.name}"]`).textContent = msg; clientErr = true; }
      }
      if (clientErr) {
        document.getElementById('form-err').textContent = 'Please fix the highlighted questions.';
        btn.disabled = false;
        return;
      }
      if (edit) {
        const replacing = fileFields.filter((f) => existing[f.name] && form.elements[f.name].files[0]).map((f) => existing[f.name].name);
        const ok = window.confirm(`Send your changes?\n\nYour earlier answers will be replaced and cannot be recovered.${replacing.length ? `\n\nThese earlier files will be deleted: ${replacing.join(', ')}` : ''}`);
        if (!ok) { btn.disabled = false; return; }
      }
      try {
        let body;
        const headers = { 'X-CSRF-Token': CSRF };
        if (fileFields.length) {
          body = new FormData();
          body.append('data', JSON.stringify(collect(form, info.fields)));
          for (const f of fileFields) {
            const file = form.elements[f.name].files[0];
            if (file) body.append(f.name, file, file.name);
          }
          btn.textContent = 'Uploading…';
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({ data: collect(form, info.fields) });
        }
        const r = await fetch(API, { method: edit ? 'PUT' : 'POST', headers, body, credentials: 'same-origin' });
        const out = await r.json().catch(() => ({}));
        if (r.ok) {
          draft.clear();
          const v = await fetch(`${API}/submission`, { credentials: 'same-origin' });
          if (v.ok) { renderView(await v.json(), { justSent: true, justEdited: edit }); window.scrollTo(0, 0); return; }
          root.innerHTML = `<h2>Sent</h2><p>${esc(out.message)}</p>`;
          return;
        }
        for (const [name, msg] of Object.entries(out.fields || {})) {
          const el = form.querySelector(`[data-err="${name}"]`);
          if (el) el.textContent = msg;
        }
        document.getElementById('form-err').textContent = out.error || 'Something went wrong.';
      } catch {
        document.getElementById('form-err').textContent = 'Network problem, please try again. Your answers are saved on this device.';
      }
      btn.disabled = false;
      btn.textContent = edit ? 'Send changes' : 'Send';
    });
  }

  async function init({ forceForm = false } = {}) {
    const res = await fetch(API, { credentials: 'same-origin' });
    const info = await res.json().catch(() => ({}));
    if (!res.ok) {
      const heading = info.locked ? 'Temporarily closed' : 'Not available';
      root.innerHTML = `<h1 class="sf-fill-title">${heading}</h1><p class="muted">${esc(info.error || 'This form is not available.')}</p><p><a class="btn btn-ghost" href="/members">Back to the portal</a></p>`;
      return;
    }
    if (info.mode === 'view' && !forceForm) { renderView(info); return; }
    renderForm(info);
  }

  init();
})();
