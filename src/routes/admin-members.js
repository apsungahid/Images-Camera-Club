const express = require('express');
const { z } = require('zod');
const { requireAdmin } = require('../lib/security');
const { createAccessCode } = require('../lib/codes');
const { nowLocal } = require('../lib/format');

const FIRST_YEAR = 1950;
const thisYear = () => Number(nowLocal().slice(0, 4));

const optional = (max, label) => z.string().trim().max(max, `${label}: at most ${max} characters.`).optional().default('');

const personSchema = z.object({
  display_name: z.string().trim().min(2, 'Please enter the member’s full name.').max(80),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Please enter a valid email address, or leave it empty.')]).optional().default(''),
  phone: optional(40, 'Phone'),
  admin_notes: optional(2000, 'Notes'),
});

function parseYear(input) {
  const y = Number(String(input ?? '').trim());
  return Number.isInteger(y) && y >= FIRST_YEAR && y <= thisYear() + 1 ? y : null;
}

// Members (people on the club roster, with or without a website account) and the years they
// were members. Admin only.
module.exports = function adminMemberRoutes({ db }) {
  const router = express.Router();
  router.use(requireAdmin);

  const id = (req) => Number(req.params.id);
  const findMember = (memberId) => db.prepare(`
    SELECT id, username, display_name, email, phone, admin_notes, role, status, created_at, last_login_at,
      google_id IS NOT NULL AS has_google, password_hash IS NOT NULL AS has_password,
      (username IS NOT NULL AND password_hash IS NOT NULL) OR google_id IS NOT NULL AS has_login
    FROM users WHERE id = ?`).get(memberId);
  const yearsOf = (memberId) => db.prepare('SELECT year FROM membership_years WHERE user_id = ? ORDER BY year DESC').pluck().all(memberId);
  const emailTaken = (email, exceptId = 0) => email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, exceptId);
  const toMember = (res, memberId) => res.redirect(`/admin/members/${memberId}`);

  // ---- Roster
  router.get('/members', (req, res) => {
    const year = parseYear(req.query.year);
    const members = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.email, u.role, u.status, u.last_login_at,
        u.google_id IS NOT NULL AS has_google, u.password_hash IS NOT NULL AS has_password,
        (u.username IS NOT NULL AND u.password_hash IS NOT NULL) OR u.google_id IS NOT NULL AS has_login,
        (SELECT GROUP_CONCAT(year, ' ') FROM (SELECT year FROM membership_years y WHERE y.user_id = u.id ORDER BY year DESC)) AS years
      FROM users u
      ${year ? 'WHERE EXISTS (SELECT 1 FROM membership_years y WHERE y.user_id = u.id AND y.year = ?)' : ''}
      ORDER BY u.display_name COLLATE NOCASE`).all(...(year ? [year] : []));
    const knownYears = db.prepare('SELECT year, COUNT(*) AS n FROM membership_years GROUP BY year ORDER BY year DESC').all();
    const resetCode = req.session.resetCode || null;
    delete req.session.resetCode;
    res.render('admin/members', { title: 'Members', members, resetCode, year, knownYears, currentYear: thisYear() });
  });

  // Someone on the roster without a website account (for example a past member).
  router.post('/members', (req, res) => {
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) { req.flash('error', parsed.error.issues[0].message); return res.redirect('/admin/members'); }
    const d = parsed.data;
    if (emailTaken(d.email)) { req.flash('error', 'Another member already uses that email address.'); return res.redirect('/admin/members'); }
    const memberId = db.transaction(() => {
      const r = db.prepare('INSERT INTO users (display_name, email, phone, admin_notes) VALUES (?, ?, ?, ?)')
        .run(d.display_name, d.email || null, d.phone || null, d.admin_notes || null);
      const years = [].concat(req.body.years ?? []).join(' ').split(/[\s,]+/).map(parseYear).filter(Boolean);
      for (const y of new Set(years)) db.prepare('INSERT INTO membership_years (user_id, year) VALUES (?, ?)').run(r.lastInsertRowid, y);
      return r.lastInsertRowid;
    })();
    req.flash('success', `${d.display_name} has been added to the roster.`);
    return toMember(res, memberId);
  });

  // Add a year to everyone who currently has an active website account.
  router.post('/members/years/bulk', (req, res) => {
    const year = parseYear(req.body.year);
    if (!year) { req.flash('error', 'Please choose a valid year.'); return res.redirect('/admin/members'); }
    const r = db.prepare(`INSERT OR IGNORE INTO membership_years (user_id, year)
      SELECT id, ? FROM users WHERE status = 'active' AND ((username IS NOT NULL AND password_hash IS NOT NULL) OR google_id IS NOT NULL)`).run(year);
    req.flash('success', `${r.changes} member${r.changes === 1 ? '' : 's'} marked as members in ${year}.`);
    return res.redirect(`/admin/members?year=${year}`);
  });

  // ---- One member
  router.get('/members/:id', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    const codes = req.session.memberCode?.memberId === member.id ? req.session.memberCode : null;
    delete req.session.memberCode;
    const photoCount = db.prepare('SELECT COUNT(*) FROM photos WHERE owner_id = ?').pluck().get(member.id);
    return res.render('admin/member', {
      title: member.display_name, member, years: yearsOf(member.id), currentYear: thisYear(), firstYear: FIRST_YEAR, code: codes, photoCount,
    });
  });

  router.post('/members/:id', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) { req.flash('error', parsed.error.issues[0].message); return toMember(res, member.id); }
    const d = parsed.data;
    if (emailTaken(d.email, member.id)) { req.flash('error', 'Another member already uses that email address.'); return toMember(res, member.id); }

    let { role, status } = member;
    if (member.id !== req.user.id) {
      if (['member', 'admin'].includes(req.body.role)) role = req.body.role;
      if (['active', 'suspended'].includes(req.body.status)) status = req.body.status;
    } else if (req.body.role && (req.body.role !== member.role || req.body.status !== member.status)) {
      req.flash('error', 'You cannot change your own role or status. Ask another administrator. Your other changes were saved.');
    }
    db.prepare('UPDATE users SET display_name = ?, email = ?, phone = ?, admin_notes = ?, role = ?, status = ? WHERE id = ?')
      .run(d.display_name, d.email || null, d.phone || null, d.admin_notes || null, role, status, member.id);
    if (status === 'suspended') db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.passport.user') = ?").run(member.id);
    if (!req.session.flash) req.flash('success', 'The member’s details have been saved.');
    return toMember(res, member.id);
  });

  router.post('/members/:id/years', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    const years = String(req.body.year ?? '').split(/[\s,]+/).filter(Boolean);
    const valid = years.map(parseYear);
    if (!years.length || valid.some((y) => !y)) {
      req.flash('error', `Please enter years between ${FIRST_YEAR} and ${thisYear() + 1}, e.g. 2019 or 2019, 2021.`);
      return toMember(res, member.id);
    }
    const add = db.prepare('INSERT OR IGNORE INTO membership_years (user_id, year) VALUES (?, ?)');
    db.transaction(() => valid.forEach((y) => add.run(member.id, y)))();
    return toMember(res, member.id);
  });

  router.post('/members/:id/years/:year/delete', (req, res) => {
    db.prepare('DELETE FROM membership_years WHERE user_id = ? AND year = ?').run(id(req), Number(req.params.year));
    return toMember(res, id(req));
  });

  // Invite code that attaches a website account to this roster entry.
  router.post('/members/:id/invite', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    if (member.has_login) { req.flash('error', 'This member already has a website account.'); return toMember(res, member.id); }
    const { code, expiresAt } = createAccessCode(db, {
      purpose: 'invite', role: member.role, forName: member.display_name, userId: member.id, createdBy: req.user.id, days: 14,
    });
    req.session.memberCode = { memberId: member.id, kind: 'invite', code, expiresAt: expiresAt.toISOString() };
    return toMember(res, member.id);
  });

  router.post('/members/:id/reset-code', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    if (!member.has_login) { req.flash('error', 'This member has no website account yet. Create an invite code instead.'); return toMember(res, member.id); }
    const { code, expiresAt } = createAccessCode(db, { purpose: 'reset', userId: member.id, createdBy: req.user.id, days: 2 });
    req.session.memberCode = { memberId: member.id, kind: 'reset', code, expiresAt: expiresAt.toISOString() };
    return toMember(res, member.id);
  });

  router.post('/members/:id/delete', (req, res, next) => {
    const member = findMember(id(req));
    if (!member) return next();
    if (member.has_login) {
      req.flash('error', 'Members with a website account cannot be deleted here; suspend them instead.');
      return toMember(res, member.id);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(member.id);
    req.flash('success', `${member.display_name} has been removed from the roster.`);
    return res.redirect('/admin/members');
  });

  return router;
};
