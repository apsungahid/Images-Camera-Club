require('dotenv').config({ quiet: true });

function loadConfig(env = process.env) {
  const config = {
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3001),
    siteUrl: (env.SITE_URL || 'http://localhost:3001').replace(/\/$/, ''),
    sessionSecret: env.SESSION_SECRET,
    dbPath: env.DB_PATH || 'data/club.db',
    // Resized photos only (originals are never kept). On the server: /srv/photoclub/uploads.
    uploadsDir: env.UPLOADS_DIR || 'uploads',
    photoLimit: Number(env.PHOTO_LIMIT || 50),
    watermark: env.WATERMARK !== 'off',
    // Private files from member forms (contest entries). Never served publicly.
    formsDir: env.FORMS_DIR || 'data/forms',
    // Demo/staging copies (e.g. icc.dualcrest.com) ask search engines not to list them.
    noindex: env.NOINDEX === 'true',
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientID: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null,
  };
  if (!config.sessionSecret || config.sessionSecret === 'change-me' || config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a long random string (see .env.example).');
  }
  return config;
}

module.exports = { loadConfig };
