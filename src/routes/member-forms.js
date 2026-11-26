// Members fill in forms from their portal. Ported from StickyForms (src/routes/public.js): the
// personal-link token is replaced by the signed-in member, so every answer belongs to a member.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { requireMember } = require('../lib/security');
const { validateSubmission, config: formConfig } = require('../forms/validation');
const { tally, parseJson } = require('../forms/results');
const storage = require('../forms/storage');
const { sendPoster } = require('../forms/poster');
const { inlineImageType } = require('../forms/images');
const { formState, STATE_MESSAGES } = require('../forms/service');

module.exports = function memberFormRoutes({ db }) {
  const router = express.Router();
  router.use('/members/forms', requireMember);

  const getForm = (id) => db.prepare('SELECT * FROM forms WHERE id = ?').get(Number(id));
  // Drafts are only visible to administrators (as a preview).
  const visible = (form, user) => form && (form.published || user.role === 'admin');
  const mine = (form, user) => db.prepare('SELECT * FROM form_submissions WHERE form_id = ? AND user_id = ? ORDER BY submitted_at DESC, id DESC').all(form.id, user.id);
  const usedUp = (form, count) => form.max_per_member > 0 && count >= form.max_per_member;
  const canEdit = (form) => Boolean(form.allow_resubmit) && formState(form) === 'open';

  const base = (form) => `/members/forms/api/${form.id}`;
  const posterUrl = (form) => (form.poster_path ? `${base(form)}/poster?v=${encodeURIComponent(form.poster_updated_at || '')}` : null);
  const filePreviewUrl = (form, meta) => (meta?.fileId && inlineImageType(meta.name) ? `${base(form)}/files/${meta.fileId}` : null);

  function refusal(form, count) {
    const state = formState(form);
    if (state !== 'open') return { code: state === 'locked' ? 423 : 403, error: STATE_MESSAGES[state], locked: state === 'locked' };
    if (usedUp(form, count)) return { code: 409, error: form.max_per_member === 1 ? 'You have already sent your answer to this form.' : `You have already sent the most answers allowed (${form.max_per_member}).` };
    return null;
  }

  // Read-only view of what this member sent, plus live poll results.
  function viewPayload(form, user) {
    const subs = mine(form, user);
    if (!subs.length) return null;
    const fields = parseJson(form.fields, []);
    const results = tally(fields, db.prepare('SELECT data FROM form_submissions WHERE form_id = ?').all(form.id));
    return {
      mode: 'view',
      title: form.title,
      description: form.description,
      posterUrl: posterUrl(form),
      memberName: user.display_name,
      canSubmitAgain: !refusal(form, subs.length),
      canEdit: canEdit(form),
      closesAt: form.closes_at,
      submissions: subs.map((s) => {
        const data = parseJson(s.data, {});
        return {
          submittedAt: s.submitted_at,
          editedAt: s.edited_at,
          answers: fields.map((f) => {
            const v = data[f.name];
            const a = { name: f.name, label: f.label, type: f.type, value: f.type === 'file' ? (v?.name || null) : v ?? null };
            if (f.type === 'file') a.previewUrl = filePreviewUrl(form, v);
            if (f.type === 'poll' || f.type === 'ranking') a.results = results[f.name];
            return a;
          }),
        };
      }),
    };
  }

  // The page itself: the form runs in the browser (public/js/forms-fill.js).
  router.get('/members/forms/:id', (req, res, next) => {
    const form = getForm(req.params.id);
    if (!visible(form, req.user)) return next();
    return res.render('pages/form-fill', { title: form.title, form, state: formState(form) });
  });

  const api = express.Router();
  router.use('/members/forms/api', api);
  api.use('/:id', (req, res, next) => {
    const form = getForm(req.params.id);
    if (!visible(form, req.user)) return res.status(404).json({ error: 'This form is not available.' });
    req.form = form;
    return next();
  });

  api.get('/:id', (req, res) => {
    const { form } = req;
    const count = mine(form, req.user).length;
    const blocked = refusal(form, count);
    if (blocked && count > 0) return res.json(viewPayload(form, req.user));
    if (blocked && !(form.published === 0 && req.user.role === 'admin')) return res.status(blocked.code).json(blocked);
    return res.json({
      mode: 'form',
      title: form.title,
      description: form.description,
      posterUrl: posterUrl(form),
      fields: parseJson(form.fields, []),
      memberName: req.user.display_name,
      closesAt: form.closes_at,
      preview: !form.published,
    });
  });

  api.get('/:id/submission', (req, res) => {
    const view = viewPayload(req.form, req.user);
    if (!view) return res.status(404).json({ error: 'You have not sent an answer yet.' });
    return res.json(view);
  });

  api.get('/:id/edit', (req, res) => {
    const { form } = req;
    const sub = mine(form, req.user)[0];
    if (!sub) return res.status(404).json({ error: 'You have not sent an answer yet.' });
    if (!canEdit(form)) return res.status(403).json({ error: form.allow_resubmit ? STATE_MESSAGES[formState(form)] : 'This form does not allow answers to be changed.' });
    const fields = parseJson(form.fields, []);
    const data = parseJson(sub.data, {});
    const files = {};
    for (const f of fields.filter((x) => x.type === 'file')) {
      if (data[f.name]?.fileId) files[f.name] = { name: data[f.name].name, size: data[f.name].size, previewUrl: filePreviewUrl(form, data[f.name]) };
      delete data[f.name];
    }
    return res.json({ mode: 'edit', title: form.title, description: form.description, posterUrl: posterUrl(form), fields, memberName: req.user.display_name, data, files, submittedAt: sub.submitted_at, editedAt: sub.edited_at });
  });

  // The member's own uploaded image, shown as a preview. Images only.
  api.get('/:id/files/:fileId', (req, res) => {
    const file = db.prepare(`SELECT f.* FROM form_files f JOIN form_submissions s ON s.id = f.submission_id
      WHERE f.id = ? AND f.form_id = ? AND s.user_id = ?`).get(String(req.params.fileId), req.form.id, req.user.id);
    const type = file && inlineImageType(file.original_name);
    if (!type) return res.status(404).json({ error: 'Not found' });
    res.set('Content-Type', type);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'private, max-age=3600');
    return res.sendFile(storage.absolutePath(file.stored_path), { dotfiles: 'allow', headers: { 'Content-Type': type } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File is missing from storage' });
    });
  });

  api.get('/:id/poster', (req, res) => sendPoster(res, req.form));

  // Accepts JSON ({ data }) or multipart/form-data (a "data" JSON part + one file part per file question).
  function receiveFiles(req, res) {
    if (!req.is('multipart/form-data')) return Promise.resolve();
    const upload = multer({
      storage: multer.diskStorage({ destination: storage.tempDir() }),
      defParamCharset: 'utf8',
      limits: { fileSize: formConfig.maxUploadMb * 1024 * 1024, files: 20, fields: 20, fieldSize: 1024 * 1024 },
    }).any();
    return new Promise((resolve, reject) => { upload(req, res, (err) => (err ? reject(err) : resolve())); });
  }

  async function readBody(req, res) {
    await storage.ensureRoot();
    try {
      await receiveFiles(req, res);
    } catch (err) {
      await storage.removeTemp((req.files || []).map((f) => f.path));
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `A file is larger than the ${formConfig.maxUploadMb} MB limit.` : `Upload problem: ${err.message}`;
        return { fail: { code: err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, body: { error: msg } } };
      }
      throw err;
    }
    let data = req.body?.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = null; }
    }
    const filesByField = {};
    for (const f of req.files || []) if (!filesByField[f.fieldname]) filesByField[f.fieldname] = f;
    return { data, filesByField, tempPaths: (req.files || []).map((f) => f.path) };
  }

  const fileRecord = async (form, submissionId, field, file) => {
    const fileId = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    const storedPath = await storage.save(file.path, { formId: form.id, submissionId, fileId, ext });
    const meta = { fileId, name: file.originalname.slice(0, 255), size: file.size, type: file.mimetype };
    return { meta, row: [fileId, form.id, submissionId, field.name, meta.name, storedPath, (file.mimetype || '').slice(0, 200), file.size] };
  };
  const insertFile = (row) => db.prepare(`INSERT INTO form_files (id, form_id, submission_id, field_name, original_name, stored_path, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...row);

  api.post('/:id', async (req, res, next) => {
    const { form } = req;
    // Checked before any upload bytes are accepted (and again before saving).
    const pre = refusal(form, mine(form, req.user).length);
    if (pre) return res.status(pre.code).json(pre);
    let body;
    try { body = await readBody(req, res); } catch (e) { return next(e); }
    if (body.fail) return res.status(body.fail.code).json(body.fail.body);
    const { data, filesByField, tempPaths } = body;
    const fields = parseJson(form.fields, []);
    let submissionId = null;
    try {
      const check = validateSubmission(fields, data, filesByField);
      if (!check.ok) return res.status(400).json({ error: 'Please fix the highlighted questions.', fields: check.errors });

      // Reserve the entry first (re-checking the limit and state), then move the files into place.
      const reserved = db.transaction(() => {
        const current = getForm(form.id);
        const again = refusal(current, mine(current, req.user).length);
        if (again) return { again };
        const r = db.prepare('INSERT INTO form_submissions (form_id, user_id, data, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
          .run(form.id, req.user.id, '{}', (req.ip || '').slice(0, 64), (req.get('user-agent') || '').slice(0, 500));
        return { id: r.lastInsertRowid };
      })();
      if (reserved.again) return res.status(reserved.again.code).json(reserved.again);
      submissionId = reserved.id;

      const rows = [];
      for (const field of fields.filter((f) => f.type === 'file')) {
        const file = filesByField[field.name];
        if (!file) continue;
        const { meta, row } = await fileRecord(form, submissionId, field, file);
        check.value[field.name] = meta;
        rows.push(row);
      }
      db.transaction(() => {
        db.prepare('UPDATE form_submissions SET data = ? WHERE id = ?').run(JSON.stringify(check.value), submissionId);
        rows.forEach(insertFile);
      })();
      submissionId = null; // committed: keep the files
      return res.status(201).json({ message: 'Thank you! Your answer was recorded.' });
    } catch (err) {
      return next(err);
    } finally {
      if (submissionId) {
        db.prepare('DELETE FROM form_submissions WHERE id = ?').run(submissionId);
        await storage.removeSubmissionDir(form.id, submissionId);
      }
      await storage.removeTemp(tempPaths);
    }
  });

  // Edit: replaces the member's latest answer. A new file replaces the old one; otherwise it is kept.
  api.put('/:id', async (req, res, next) => {
    const { form } = req;
    const sub = mine(form, req.user)[0];
    if (!sub) return res.status(404).json({ error: 'You have not sent an answer yet.' });
    if (!canEdit(form)) return res.status(formState(form) === 'locked' ? 423 : 403).json({ error: form.allow_resubmit ? STATE_MESSAGES[formState(form)] : 'This form does not allow answers to be changed.' });
    let body;
    try { body = await readBody(req, res); } catch (e) { return next(e); }
    if (body.fail) return res.status(body.fail.code).json(body.fail.body);
    const { data, filesByField, tempPaths } = body;
    const fields = parseJson(form.fields, []);
    const newPaths = [];
    try {
      const before = parseJson(sub.data, {});
      const keep = {};
      for (const f of fields.filter((x) => x.type === 'file')) if (before[f.name]?.fileId) keep[f.name] = before[f.name];
      const check = validateSubmission(fields, data, filesByField, keep);
      if (!check.ok) return res.status(400).json({ error: 'Please fix the highlighted questions.', fields: check.errors });

      const rows = [];
      const replaced = [];
      for (const field of fields.filter((f) => f.type === 'file')) {
        const file = filesByField[field.name];
        if (!file) continue;
        const { meta, row } = await fileRecord(form, sub.id, field, file);
        newPaths.push(row[5]);
        check.value[field.name] = meta;
        replaced.push(field.name);
        rows.push(row);
      }
      let oldPaths = [];
      const ok = db.transaction(() => {
        if (!canEdit(getForm(form.id))) return false;
        if (replaced.length) {
          const old = db.prepare(`SELECT * FROM form_files WHERE submission_id = ? AND field_name IN (${replaced.map(() => '?').join(',')})`).all(sub.id, ...replaced);
          oldPaths = old.map((f) => f.stored_path);
          for (const f of old) db.prepare('DELETE FROM form_files WHERE id = ?').run(f.id);
        }
        rows.forEach(insertFile);
        db.prepare("UPDATE form_submissions SET data = ?, edited_at = datetime('now'), edit_count = edit_count + 1, ip = ?, user_agent = ? WHERE id = ?")
          .run(JSON.stringify(check.value), (req.ip || '').slice(0, 64), (req.get('user-agent') || '').slice(0, 500), sub.id);
        return true;
      })();
      if (!ok) return res.status(423).json({ error: STATE_MESSAGES.locked });
      newPaths.length = 0;
      await Promise.all(oldPaths.map((p) => storage.removeFile(p)));
      return res.json({ message: 'Your answer was updated.' });
    } catch (err) {
      return next(err);
    } finally {
      await Promise.all(newPaths.map((p) => storage.removeFile(p)));
      await storage.removeTemp(tempPaths);
    }
  });

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again; your answers are saved on this device.' });
  });

  return router;
};
