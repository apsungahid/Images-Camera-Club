const express = require('express');
const { z } = require('zod');
const { requireAdmin } = require('../lib/security');
const { createAccessCode } = require('../lib/codes');
const { uniqueSlug } = require('../lib/categories');
const { removeFiles } = require('../lib/images');

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Please enter a valid date and time.');

const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Please enter a title.').max(160),
  body: z.string().trim().min(1, 'Please write the announcement.').max(20000),
  visibility: z.enum(['public', 'members']),
  pinned: z.literal('1').optional(),
});

const eventSchema = z.object({
  title: z.string().trim().min(3, 'Please enter a title.').max(160),
  description: z.string().trim().max(5000).optional().default(''),
  location: z.string().trim().max(200).optional().default(''),
  kind: z.enum(['activity', 'photowalk', 'workshop', 'meeting', 'contest', 'exhibit']),
  starts_at: localDateTime,
  ends_at: z.union([localDateTime, z.literal('')]).optional().default(''),
  visibility: z.enum(['public', 'members']),
}).refine((d) => !d.ends_at || d.ends_at >= d.starts_at, { message: 'The end must be after the start.' });

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Category name: at least 2 characters.').max(60, 'Category name: at most 60 characters.'),
  description: z.string().trim().max(300, 'Description: at most 300 characters.').optional().default(''),
});

const inviteSchema = z.object({
  for_name: z.string().trim().max(80).optional().default(''),
  role: z.enum(['member', 'admin']),
  days: z.coerce.number().int().min(1).max(60),
});

module.exports = function adminRoutes({ db, config }) {
  const router = express.Router();
  router.use(requireAdmin);

  const id = (req) => Number(req.params.id);
  const back = (res, to) => res.redirect(`/admin${to}`);
  const fail = (req, res, to, result) => { req.flash('error', result.error.issues[0].message); back(res, to); };

  router.get('/', (req, res) => {
    const count = (sql) => db.prepare(sql).pluck().get();
    res.render('admin/dashboard', {
      title: 'Administration',
      counts: {
        members: count("SELECT COUNT(*) FROM users WHERE status = 'active'"),
        invites: count("SELECT COUNT(*) FROM access_codes WHERE purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')"),
        announcements: count('SELECT COUNT(*) FROM announcements'),
        events: count("SELECT COUNT(*) FROM events WHERE starts_at >= strftime('%Y-%m-%dT%H:%M', 'now', '+8 hours')"),
        photos: count('SELECT COUNT(*) FROM photos'),
        categories: count('SELECT COUNT(*) FROM categories'),
      },
    });
  });

  // ---- Invite codes
  router.get('/invites', (req, res) => {
    const invites = db.prepare(`
      SELECT c.*, u.display_name AS used_by_name, a.display_name AS created_by_name,
        CASE WHEN c.used_at IS NOT NULL THEN 'used' WHEN c.revoked_at IS NOT NULL THEN 'revoked'
             WHEN c.expires_at <= datetime('now') THEN 'expired' ELSE 'open' END AS state
      FROM access_codes c LEFT JOIN users u ON u.id = c.used_by LEFT JOIN users a ON a.id = c.created_by
      WHERE c.purpose = 'invite' ORDER BY c.created_at DESC, c.id DESC LIMIT 200`).all();
    const newCode = req.session.newCode || null;
    delete req.session.newCode;
    res.render('admin/invites', { title: 'Invite codes', invites, newCode });
  });

  router.post('/invites', (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return fail(req, res, '/invites', parsed);
    const { code, expiresAt } = createAccessCode(db, {
      purpose: 'invite', role: parsed.data.role, forName: parsed.data.for_name || null, createdBy: req.user.id, days: parsed.data.days,
    });
    // Shown once: only the hash is stored.
    req.session.newCode = { code, forName: parsed.data.for_name, role: parsed.data.role, expiresAt: expiresAt.toISOString() };
    return back(res, '/invites');
  });

  router.post('/invites/:id/revoke', (req, res) => {
    db.prepare("UPDATE access_codes SET revoked_at = datetime('now') WHERE id = ? AND purpose = 'invite' AND used_at IS NULL").run(id(req));
    req.flash('success', 'The invite code has been revoked.');
    back(res, '/invites');
  });

  // ---- Members
  router.get('/members', (req, res) => {
    const members = db.prepare(`SELECT id, username, display_name, email, role, status, google_id IS NOT NULL AS has_google,
      password_hash IS NOT NULL AS has_password, created_at, last_login_at FROM users ORDER BY display_name COLLATE NOCASE`).all();
    const resetCode = req.session.resetCode || null;
    delete req.session.resetCode;
    res.render('admin/members', { title: 'Members', members, resetCode });
  });

  router.post('/members/:id', (req, res) => {
    const memberId = id(req);
    if (memberId === req.user.id) {
      req.flash('error', 'You cannot change your own role or status. Ask another administrator.');
      return back(res, '/members');
    }
    const role = ['member', 'admin'].includes(req.body.role) ? req.body.role : null;
    const status = ['active', 'suspended'].includes(req.body.status) ? req.body.status : null;
    if (!role || !status) return back(res, '/members');
    db.prepare('UPDATE users SET role = ?, status = ? WHERE id = ?').run(role, status, memberId);
    if (status === 'suspended') {
      db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.passport.user') = ?").run(memberId);
    }
    req.flash('success', 'The member has been updated.');
    return back(res, '/members');
  });

  router.post('/members/:id/reset-code', (req, res) => {
    const member = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(id(req));
    if (!member) return back(res, '/members');
    const { code, expiresAt } = createAccessCode(db, { purpose: 'reset', userId: member.id, createdBy: req.user.id, days: 2 });
    req.session.resetCode = { code, name: member.display_name, expiresAt: expiresAt.toISOString() };
    return back(res, '/members');
  });

  // ---- Announcements
  router.get('/announcements', (req, res) => {
    const items = db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, published_at DESC').all();
    res.render('admin/announcements', { title: 'Announcements', items });
  });

  router.post('/announcements', (req, res) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return fail(req, res, '/announcements', parsed);
    const d = parsed.data;
    db.prepare('INSERT INTO announcements (title, body, visibility, pinned, author_id) VALUES (?, ?, ?, ?, ?)')
      .run(d.title, d.body, d.visibility, d.pinned ? 1 : 0, req.user.id);
    req.flash('success', 'The announcement has been published.');
    return back(res, '/announcements');
  });

  router.post('/announcements/:id/delete', (req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id(req));
    req.flash('success', 'The announcement has been deleted.');
    back(res, '/announcements');
  });

  // ---- Gallery categories
  router.get('/categories', (req, res) => {
    const items = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM photo_categories pc WHERE pc.category_id = c.id) AS photo_count,
        (SELECT COUNT(*) FROM photos p WHERE p.main_category_id = c.id) AS main_count
      FROM categories c ORDER BY c.name COLLATE NOCASE`).all();
    res.render('admin/categories', { title: 'Gallery categories', items, editId: Number(req.query.edit) || null });
  });

  router.post('/categories', (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return fail(req, res, '/categories', parsed);
    const { name, description } = parsed.data;
    if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) {
      req.flash('error', `There is already a category named “${name}”.`);
      return back(res, '/categories');
    }
    db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(name, uniqueSlug(db, name), description || null);
    req.flash('success', `Category “${name}” added. Its gallery appears once it has a photo.`);
    return back(res, '/categories');
  });

  router.post('/categories/:id', (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return fail(req, res, `/categories?edit=${id(req)}`, parsed);
    const { name, description } = parsed.data;
    if (db.prepare('SELECT 1 FROM categories WHERE name = ? AND id != ?').get(name, id(req))) {
      req.flash('error', `There is already a category named “${name}”.`);
      return back(res, `/categories?edit=${id(req)}`);
    }
    db.prepare('UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?')
      .run(name, uniqueSlug(db, name, id(req)), description || null, id(req));
    req.flash('success', 'The category has been saved.');
    return back(res, '/categories');
  });

  router.post('/categories/:id/delete', (req, res) => {
    const used = db.prepare('SELECT COUNT(*) FROM photos WHERE main_category_id = ?').pluck().get(id(req));
    if (used) {
      req.flash('error', `This category is the main category of ${used} photo${used === 1 ? '' : 's'}. Those photos need another main category before it can be deleted.`);
      return back(res, '/categories');
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id(req));
    req.flash('success', 'The category has been deleted.');
    return back(res, '/categories');
  });

  // ---- Photos (moderation)
  router.get('/photos', (req, res) => {
    const items = db.prepare(`
      SELECT p.id, p.title, p.thumb_key, p.featured, p.bytes, p.created_at, u.display_name AS photographer, c.name AS main_category
      FROM photos p JOIN users u ON u.id = p.owner_id JOIN categories c ON c.id = p.main_category_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT 500`).all();
    const totals = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM photos').get();
    res.render('admin/photos', { title: 'Photos', items, totals });
  });

  router.post('/photos/:id/feature', (req, res) => {
    db.prepare('UPDATE photos SET featured = 1 - featured WHERE id = ?').run(id(req));
    back(res, '/photos');
  });

  router.post('/photos/:id/delete', (req, res) => {
    const photo = db.prepare('SELECT display_key, thumb_key FROM photos WHERE id = ?').get(id(req));
    if (photo) {
      db.prepare('DELETE FROM photos WHERE id = ?').run(id(req));
      removeFiles(config.uploadsDir, [photo.display_key, photo.thumb_key]);
      req.flash('success', 'The photo has been removed from the gallery.');
    }
    back(res, '/photos');
  });

  // ---- Activities / events
  router.get('/events', (req, res) => {
    const items = db.prepare('SELECT * FROM events ORDER BY starts_at DESC').all();
    res.render('admin/events', { title: 'Activities', items });
  });

  router.post('/events', (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return fail(req, res, '/events', parsed);
    const d = parsed.data;
    db.prepare(`INSERT INTO events (title, description, location, kind, starts_at, ends_at, visibility, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d.title, d.description || null, d.location || null, d.kind, d.starts_at, d.ends_at || null, d.visibility, req.user.id);
    req.flash('success', 'The activity has been added to the schedule.');
    return back(res, '/events');
  });

  router.post('/events/:id/delete', (req, res) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(id(req));
    req.flash('success', 'The activity has been deleted.');
    back(res, '/events');
  });

  return router;
};
