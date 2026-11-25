const crypto = require('node:crypto');

// CSRF: one random token per session, required on every non-GET request.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = Buffer.from(String(req.body?._csrf || req.get('x-csrf-token') || ''));
  const expected = Buffer.from(req.session.csrf);
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  res.status(403);
  return res.render('pages/error', { title: 'Session expired', message: 'Your form expired. Please go back, refresh the page and try again.' });
}

function requireMember(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.role === 'admin') return next();
  res.status(403);
  return res.render('pages/error', { title: 'Not allowed', message: 'This page is for club administrators.' });
}

// Small in-memory limiter for sign-in and code entry (one server process, so this is enough).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const key = `${req.ip}|${req.path}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) entry = { count: 0, reset: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count <= max) return next();
    res.status(429);
    return res.render('pages/error', { title: 'Too many attempts', message: 'Please wait a few minutes before trying again.' });
  };
}

module.exports = { csrf, requireMember, requireAdmin, rateLimit };
