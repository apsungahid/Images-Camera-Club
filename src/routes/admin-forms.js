// Admin: build member forms and read their answers. Ported from StickyForms (src/routes/forms.js)
// without personal links, emailing or Google sign-in: the club's own admin sign-in protects it,
// and members answer from their portal while signed in.
const express = require('express');
const path = require('node:path');
const { requireAdmin } = require('../lib/security');
const { validateFormInput } = require('../forms/validation');
const { parseJson, tally } = require('../forms/results');
const storage = require('../forms/storage');
const { detectPosterType, POSTER_MAX_MB, sendPoster } = require('../forms/poster');
const { INLINE_IMAGES } = require('../forms/images');
const { serializeForm, loadSubmissions } = require('../forms/service');
const { sendWorkbook, sendZip } = require('../forms/exports');

module.exports = function adminFormRoutes({ db }) {
  const router = express.Router();
  router.use(requireAdmin);

  const titleTaken = (title, exceptId = 0) => Boolean(db.prepare('SELECT 1 FROM forms WHERE lower(title) = lower(?) AND id != ?').get(title.trim(), exceptId));
  const titleTakenError = (title) => ({ error: 'Title already in use', details: [`A form called "${title}" already exists. Please choose a different title.`] });
  // Changes whenever a poster is replaced, so browsers do not show a stale cached image.
  const touch = () => new Date().toISOString();

  function loadForm(req, res, next) {
    const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Form not found' });
    req.formRow = row;
    return next();
  }
  const fresh = (id) => db.prepare('SELECT * FROM forms WHERE id = ?').get(id);

  // The builder page (the form tools run in the browser and use the JSON API below).
  router.get('/forms', (req, res) => {
    res.render('admin/forms', { title: 'Contests & forms', maxUploadMb: require('../forms/validation').config.maxUploadMb });
  });

  const api = express.Router();
  router.use('/forms/api', api);

  api.get('/', (req, res) => {
    const rows = db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id) AS submission_count
      FROM forms f ORDER BY f.created_at DESC, f.id DESC`).all();
    res.json(rows.map((r) => serializeForm(r, { submissionCount: r.submission_count })));
  });

  api.post('/', (req, res) => {
    const { errors, value } = validateFormInput(req.body);
    if (errors.length) return res.status(400).json({ error: 'Invalid form', details: errors });
    if (titleTaken(value.title)) return res.status(409).json(titleTakenError(value.title));
    const r = db.prepare(`INSERT INTO forms (title, description, fields, allow_resubmit, max_per_member, closes_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(value.title, value.description || null, JSON.stringify(value.fields),
      value.allowResubmit ? 1 : 0, value.maxPerMember, value.closesAt, req.user.id);
    return res.status(201).json(serializeForm(fresh(r.lastInsertRowid)));
  });

  api.get('/:id', loadForm, (req, res) => res.json(serializeForm(req.formRow)));

  api.put('/:id', loadForm, (req, res) => {
    // Names already used by this form (current questions and stored answers) are never reused.
    const reserved = new Set(parseJson(req.formRow.fields, []).map((f) => f.name));
    for (const s of db.prepare('SELECT data FROM form_submissions WHERE form_id = ?').all(req.formRow.id)) {
      for (const k of Object.keys(parseJson(s.data, {}))) reserved.add(k);
    }
    const { errors, value } = validateFormInput(req.body, { reserved: [...reserved] });
    if (errors.length) return res.status(400).json({ error: 'Invalid form', details: errors });
    if (titleTaken(value.title, req.formRow.id)) return res.status(409).json(titleTakenError(value.title));
    db.prepare(`UPDATE forms SET title = ?, description = ?, fields = ?, allow_resubmit = ?, max_per_member = ?, closes_at = ?, updated_at = datetime('now')
      WHERE id = ?`).run(value.title, value.description || null, JSON.stringify(value.fields), value.allowResubmit ? 1 : 0,
      value.maxPerMember, value.closesAt, req.formRow.id);
    return res.json(serializeForm(fresh(req.formRow.id)));
  });

  // Copies the questions and settings (as a draft), but no answers.
  api.post('/:id/duplicate', loadForm, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!title || title.length > 200) return res.status(400).json({ error: 'Invalid copy', details: ['A new title (up to 200 characters) is required'] });
    if (titleTaken(title)) return res.status(409).json(titleTakenError(title));
    const src = req.formRow;
    const r = db.prepare(`INSERT INTO forms (title, description, fields, allow_resubmit, max_per_member, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run(title, description || null, src.fields, src.allow_resubmit, src.max_per_member, req.user.id);
    if (src.poster_path) {
      try {
        const rel = await storage.copyPoster(src.poster_path, r.lastInsertRowid);
        db.prepare('UPDATE forms SET poster_path = ?, poster_type = ?, poster_updated_at = ? WHERE id = ?').run(rel, src.poster_type, touch(), r.lastInsertRowid);
      } catch { /* original poster missing: copy without one */ }
    }
    return res.status(201).json(serializeForm(fresh(r.lastInsertRowid)));
  });

  // Poster: raw image body. JPG, PNG, GIF or WebP, checked by the file's contents.
  api.put('/:id/poster', express.raw({ type: () => true, limit: `${POSTER_MAX_MB + 1}mb` }), loadForm, async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'No image received' });
    if (buf.length > POSTER_MAX_MB * 1024 * 1024) return res.status(413).json({ error: `The poster image is too large (max ${POSTER_MAX_MB} MB).` });
    const type = detectPosterType(buf);
    if (!type) return res.status(400).json({ error: 'The poster must be a JPG, PNG, GIF or WebP image.' });
    const rel = await storage.writePoster(req.formRow.id, buf, type.ext);
    db.prepare('UPDATE forms SET poster_path = ?, poster_type = ?, poster_updated_at = ? WHERE id = ?').run(rel, type.mime, touch(), req.formRow.id);
    if (req.formRow.poster_path) await storage.removeFile(req.formRow.poster_path);
    return res.json(serializeForm(fresh(req.formRow.id)));
  });
  api.delete('/:id/poster', loadForm, async (req, res) => {
    db.prepare('UPDATE forms SET poster_path = NULL, poster_type = NULL, poster_updated_at = NULL WHERE id = ?').run(req.formRow.id);
    await storage.removeFile(req.formRow.poster_path);
    res.json(serializeForm(fresh(req.formRow.id)));
  });
  api.get('/:id/poster', loadForm, (req, res) => sendPoster(res, req.formRow));

  // Publish = shown in the members' portal. Lock = temporarily refuse new answers.
  const setFlag = (sql) => (req, res) => {
    db.prepare(sql).run(req.formRow.id);
    res.json(serializeForm(fresh(req.formRow.id)));
  };
  api.post('/:id/publish', loadForm, setFlag('UPDATE forms SET published = 1 WHERE id = ?'));
  api.post('/:id/unpublish', loadForm, setFlag('UPDATE forms SET published = 0 WHERE id = ?'));
  api.post('/:id/lock', loadForm, setFlag("UPDATE forms SET locked_at = COALESCE(locked_at, datetime('now')) WHERE id = ?"));
  api.post('/:id/unlock', loadForm, setFlag('UPDATE forms SET locked_at = NULL WHERE id = ?'));

  api.delete('/:id', loadForm, async (req, res) => {
    db.prepare('DELETE FROM forms WHERE id = ?').run(req.formRow.id);
    await storage.removeForm(req.formRow.id);
    res.status(204).end();
  });

  api.get('/:id/submissions', loadForm, (req, res) => res.json(loadSubmissions(db, req.formRow.id)));

  api.delete('/:id/submissions/:subId', loadForm, async (req, res) => {
    const r = db.prepare('DELETE FROM form_submissions WHERE id = ? AND form_id = ?').run(Number(req.params.subId), req.formRow.id);
    if (!r.changes) return res.status(404).json({ error: 'Entry not found' });
    await storage.removeSubmissionDir(req.formRow.id, Number(req.params.subId));
    return res.json({ removed: 1 });
  });

  api.get('/:id/results', loadForm, (req, res) => {
    const rows = db.prepare('SELECT data FROM form_submissions WHERE form_id = ?').all(req.formRow.id);
    res.json(tally(parseJson(req.formRow.fields, []), rows));
  });

  api.get('/:id/submissions.xlsx', loadForm, (req, res, next) => {
    const base = `${req.protocol}://${req.get('host')}`;
    sendWorkbook(res, req.formRow, loadSubmissions(db, req.formRow.id, 'ASC'),
      (fileId) => `${base}/admin/forms/api/${req.formRow.id}/files/${fileId}`).catch(next);
  });

  api.get('/:id/submissions.zip', loadForm, (req, res, next) => {
    const files = db.prepare('SELECT * FROM form_files WHERE form_id = ?').all(req.formRow.id);
    sendZip(res, req.formRow, loadSubmissions(db, req.formRow.id, 'ASC'), files).catch(next);
  });

  // A file a member attached. Images can be viewed in the browser (?view=1); never SVG.
  api.get('/:id/files/:fileId', loadForm, (req, res) => {
    const file = db.prepare('SELECT * FROM form_files WHERE id = ? AND form_id = ?').get(String(req.params.fileId), req.formRow.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const type = INLINE_IMAGES[path.extname(file.original_name).toLowerCase()];
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.query.view === '1' && type) {
      res.set('Content-Type', type);
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
      res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
      res.set('Cache-Control', 'private, max-age=3600');
      return res.sendFile(storage.absolutePath(file.stored_path), { dotfiles: 'allow', headers: { 'Content-Type': type } }, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'File is missing from storage' });
      });
    }
    return res.download(storage.absolutePath(file.stored_path), file.original_name, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File is missing from storage' });
    });
  });

  // JSON errors for the API (the page routes use the normal error pages).
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return router;
};
