const path = require('node:path');
const express = require('express');
const session = require('express-session');
const layouts = require('express-ejs-layouts');
const helmet = require('helmet');
const passport = require('passport');

const { SqliteStore } = require('./lib/session-store');
const { csrf } = require('./lib/security');
const format = require('./lib/format');
const camera = require('./lib/exposure');
const { inline, blocks } = require('./lib/content');
const site = require('./site');
const { setupPassport } = require('./auth');

function createApp({ db, config }) {
  const app = express();
  const production = config.env === 'production';

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('layout', 'layout');
  app.use(layouts);
  // Visits arrive through the Cloudflare Tunnel on localhost.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        // style="" attributes only (e.g. a photo as a background); no inline <style> or scripts.
        'style-src-attr': ["'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'script-src': ["'self'"],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'upgrade-insecure-requests': production ? [] : null,
      },
    },
  }));

  if (config.noindex) {
    app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
    app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  }
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: production ? '7d' : 0 }));
  // Resized member photos. File names are random and never reused, so they can be cached for good.
  app.use('/media', express.static(path.resolve(config.uploadsDir), {
    immutable: true, maxAge: '365d', index: false, dotfiles: 'deny', fallthrough: false,
  }));
  // A missing photo gets a plain "not found" (the page layout is not set up this early).
  // eslint-disable-next-line no-unused-vars
  app.use('/media', (err, req, res, next) => res.status(err.status || 404).type('text').send('Not found'));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '1mb' }));

  require('./forms/storage').setRoot(config.formsDir || 'data/forms');

  const store = new SqliteStore(db);
  app.locals.sessionStore = store;
  app.use(session({
    name: 'icc.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 30 * 86400000 },
  }));

  setupPassport({ db, config });
  app.use(passport.session());

  app.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.isMember = Boolean(req.user);
    res.locals.isAdmin = req.user?.role === 'admin';
    res.locals.path = req.path;
    res.locals.site = site;
    res.locals.fmt = format;
    res.locals.camera = camera;
    res.locals.md = { inline, blocks };
    res.locals.googleEnabled = Boolean(config.google);
    res.locals.flash = req.session.flash || null;
    res.locals.title = null;
    res.locals.bodyClass = '';
    delete req.session.flash;
    req.flash = (type, message) => { req.session.flash = { type, message }; };
    next();
  });
  app.use(csrf);

  app.use(require('./routes/public')({ db }));
  app.use(require('./routes/auth')({ db, config }));
  app.use(require('./routes/account')({ db, config }));
  app.use(require('./routes/photos')({ db, config }));
  app.use(require('./routes/members')({ db, config }));
  app.use(require('./routes/member-forms')({ db }));
  app.use('/admin', require('./routes/admin-members')({ db }));
  app.use('/admin', require('./routes/admin-forms')({ db }));
  app.use('/admin', require('./routes/admin')({ db, config }));

  app.use((req, res) => {
    res.status(404).render('pages/error', { title: 'Page not found', message: 'The page you were looking for is not here.' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status === 404 || err.statusCode === 404) {
      return res.status(404).render('pages/error', { title: 'Page not found', message: 'The page you were looking for is not here.' });
    }
    console.error(err);
    return res.status(500).render('pages/error', { title: 'Something went wrong', message: 'Please try again in a moment.' });
  });

  return app;
}

module.exports = { createApp };
