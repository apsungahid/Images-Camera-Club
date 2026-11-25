const express = require('express');
const passport = require('passport');
const { z } = require('zod');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../lib/passwords');
const { findUsableCode, markCodeUsed } = require('../lib/codes');
const { rateLimit } = require('../lib/security');

const usernameSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Username: 3–30 characters, letters, numbers, dot, dash or underscore.');
const passwordSchema = z.string().min(10, 'Password: at least 10 characters.').max(200);

const joinSchema = z.object({
  display_name: z.string().trim().min(2, 'Please enter your full name.').max(80),
  username: usernameSchema,
  password: passwordSchema,
  password_confirm: z.string(),
}).refine((d) => d.password === d.password_confirm, { message: 'The passwords do not match.' });

const resetSchema = z.object({
  code: z.string().trim().min(4, 'Please enter your reset code.'),
  password: passwordSchema,
  password_confirm: z.string(),
}).refine((d) => d.password === d.password_confirm, { message: 'The passwords do not match.' });

function firstError(result) {
  return result.error.issues[0]?.message || 'Please check the form.';
}

// Keep only same-site paths, so a crafted link cannot send members elsewhere after sign-in.
function safeReturn(to) {
  return typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/';
}

// Signing in starts a fresh session (against session fixation), so carry the destination and
// any message across.
function logIn(req, user, res, { fallback = '/', flash = null } = {}) {
  const returnTo = safeReturn(req.session.returnTo || fallback);
  return new Promise((resolve, reject) => {
    req.login(user, (err) => {
      if (err) return reject(err);
      if (flash) req.session.flash = flash;
      return resolve(res.redirect(returnTo));
    });
  });
}

module.exports = function authRoutes({ db, config }) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60000, max: 10 });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('pages/login', { title: 'Sign in', error: null, username: '' });
  });

  router.post('/login', limiter, async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const user = db.prepare('SELECT id, password_hash, status FROM users WHERE username = ?').get(username);
      const ok = verifyPassword(password, user?.password_hash || DUMMY_HASH) && user?.password_hash;
      if (!ok || user.status !== 'active') {
        res.status(401);
        return res.render('pages/login', {
          title: 'Sign in',
          username,
          error: ok ? 'This account is suspended. Please contact a club administrator.' : 'Wrong username or password.',
        });
      }
      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
      await logIn(req, { id: user.id }, res);
    } catch (e) { next(e); }
  });

  router.post('/logout', (req, res, next) => {
    req.logout((err) => (err ? next(err) : res.redirect('/')));
  });

  // Step 1 of joining: check the invite code.
  router.get('/join', (req, res) => {
    if (req.user) return res.redirect('/account');
    res.render('pages/join', { title: 'Join the club', error: null, code: String(req.query.code || '') });
  });

  router.post('/join', limiter, (req, res) => {
    const code = String(req.body.code || '').trim();
    const invite = findUsableCode(db, code, 'invite');
    if (!invite) {
      res.status(400);
      return res.render('pages/join', { title: 'Join the club', code, error: 'That invite code is not valid, already used or expired. Please ask a club administrator for a new one.' });
    }
    req.session.pendingInvite = code;
    return res.redirect('/join/account');
  });

  // Step 2: create the account with a username and password, or with Google.
  router.get('/join/account', (req, res) => {
    const invite = req.session.pendingInvite && findUsableCode(db, req.session.pendingInvite, 'invite');
    if (!invite) return res.redirect('/join');
    res.render('pages/join-account', { title: 'Create your account', error: null, values: { display_name: invite.for_name || '' } });
  });

  router.post('/join/account', limiter, async (req, res, next) => {
    try {
      const invite = req.session.pendingInvite && findUsableCode(db, req.session.pendingInvite, 'invite');
      if (!invite) return res.redirect('/join');
      const parsed = joinSchema.safeParse(req.body);
      const values = { display_name: req.body.display_name, username: req.body.username };
      const fail = (error) => res.status(400).render('pages/join-account', { title: 'Create your account', error, values });
      if (!parsed.success) return fail(firstError(parsed));
      const d = parsed.data;
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(d.username)) return fail('That username is taken. Please choose another.');

      const userId = db.transaction(() => {
        const r = db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
          .run(d.username, d.display_name, hashPassword(d.password), invite.role);
        markCodeUsed(db, invite.id, r.lastInsertRowid);
        return r.lastInsertRowid;
      })();
      delete req.session.pendingInvite;
      req.session.returnTo = '/account';
      await logIn(req, { id: userId }, res, { flash: { type: 'success', message: 'Welcome to the club! Your account is ready.' } });
    } catch (e) { next(e); }
  });

  // Password reset with a code an administrator gave the member (until the site sends email).
  router.get('/reset', (req, res) => {
    res.render('pages/reset', { title: 'Reset your password', error: null, code: String(req.query.code || '') });
  });

  router.post('/reset', limiter, async (req, res, next) => {
    try {
      const parsed = resetSchema.safeParse(req.body);
      const code = String(req.body.code || '');
      const fail = (error) => res.status(400).render('pages/reset', { title: 'Reset your password', error, code });
      if (!parsed.success) return fail(firstError(parsed));
      const reset = findUsableCode(db, parsed.data.code, 'reset');
      if (!reset) return fail('That reset code is not valid, already used or expired. Please ask a club administrator for a new one.');
      const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(reset.user_id);
      if (!user || user.status !== 'active') return fail('This account cannot be reset. Please contact a club administrator.');
      db.transaction(() => {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(parsed.data.password), user.id);
        markCodeUsed(db, reset.id, user.id);
        // Sign the member out everywhere else.
        db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.passport.user') = ?").run(user.id);
      })();
      await logIn(req, { id: user.id }, res, { fallback: '/account', flash: { type: 'success', message: 'Your password has been changed.' } });
    } catch (e) { next(e); }
  });

  if (config.google) {
    router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));
    router.get('/auth/google/link', (req, res, next) => {
      if (!req.user) return res.redirect('/login');
      req.session.linkGoogle = true;
      return passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
    });
    router.get('/auth/google/callback', (req, res, next) => {
      passport.authenticate('google', async (err, user, info) => {
        if (err) return next(err);
        if (!user) {
          res.status(403);
          return res.render('pages/login', { title: 'Sign in', username: '', error: info?.message || 'Google sign-in did not complete.' });
        }
        try {
          db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
          await logIn(req, user, res);
        } catch (e) { next(e); }
      })(req, res, next);
    });
  }

  return router;
};
