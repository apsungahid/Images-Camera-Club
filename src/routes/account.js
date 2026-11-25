const express = require('express');
const { z } = require('zod');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { requireMember } = require('../lib/security');

const profileSchema = z.object({
  display_name: z.string().trim().min(2, 'Please enter your full name.').max(80),
  bio: z.string().trim().max(1000, 'Bio: at most 1000 characters.').optional().default(''),
});

const passwordSchema = z.object({
  current: z.string().optional().default(''),
  password: z.string().min(10, 'New password: at least 10 characters.').max(200),
  password_confirm: z.string(),
}).refine((d) => d.password === d.password_confirm, { message: 'The new passwords do not match.' });

module.exports = function accountRoutes({ db }) {
  const router = express.Router();
  router.use('/account', requireMember);

  router.get('/account', (req, res) => {
    res.render('pages/account', { title: 'Your account' });
  });

  router.post('/account/profile', (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues[0].message);
    } else {
      db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?')
        .run(parsed.data.display_name, parsed.data.bio || null, req.user.id);
      req.flash('success', 'Your profile has been saved.');
    }
    res.redirect('/account');
  });

  router.post('/account/password', (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues[0].message);
      return res.redirect('/account');
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    // Members who joined with Google may set a first password without a current one.
    if (row.password_hash && !verifyPassword(parsed.data.current, row.password_hash)) {
      req.flash('error', 'Your current password is not correct.');
      return res.redirect('/account');
    }
    if (!req.user.username) {
      // Google-only members need a username to sign in with a password.
      const base = (req.user.display_name || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 24) || 'member';
      let username = base;
      for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(username); i += 1) username = `${base}${i}`;
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(parsed.data.password), req.user.id);
    req.flash('success', 'Your password has been changed.');
    return res.redirect('/account');
  });

  router.post('/account/unlink-google', (req, res) => {
    if (!req.user.has_password) {
      req.flash('error', 'Set a password first, so you can still sign in without Google.');
    } else {
      db.prepare('UPDATE users SET google_id = NULL WHERE id = ?').run(req.user.id);
      req.flash('success', 'Google sign-in has been removed from your account.');
    }
    res.redirect('/account');
  });

  return router;
};
