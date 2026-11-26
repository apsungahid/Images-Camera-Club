const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { findUsableCode, markCodeUsed, accountFromInvite } = require('./lib/codes');

const PUBLIC_FIELDS = 'id, username, display_name, email, role, status, google_id, bio, password_hash IS NOT NULL AS has_password';

function findUserById(db, id) {
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(id);
}

function setupPassport({ db, config }) {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      const user = findUserById(db, id);
      // A suspended member is signed out on their next page load.
      done(null, user && user.status === 'active' ? user : false);
    } catch (e) { done(e); }
  });

  if (!config.google) return;

  passport.use(new GoogleStrategy({
    clientID: config.google.clientID,
    clientSecret: config.google.clientSecret,
    callbackURL: `${config.siteUrl}/auth/google/callback`,
    passReqToCallback: true,
  }, (req, accessToken, refreshToken, profile, done) => {
    try {
      const googleId = profile.id;
      const email = profile.emails?.find((e) => e.verified)?.value || null;
      const name = profile.displayName || email || 'Member';

      // 1. Linking Google to an account that is already signed in.
      if (req.user && req.session.linkGoogle) {
        delete req.session.linkGoogle;
        const taken = db.prepare('SELECT id FROM users WHERE google_id = ? AND id != ?').get(googleId, req.user.id);
        if (taken) return done(null, false, { message: 'That Google account is already linked to another member.' });
        db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(googleId, req.user.id);
        return done(null, findUserById(db, req.user.id));
      }

      // 2. Returning member.
      const existing = db.prepare('SELECT id, status FROM users WHERE google_id = ?').get(googleId);
      if (existing) {
        if (existing.status !== 'active') return done(null, false, { message: 'This account is suspended. Please contact a club administrator.' });
        return done(null, findUserById(db, existing.id));
      }

      // 3. New member joining with an invite code they entered on /join.
      const inviteCode = req.session.pendingInvite;
      const invite = inviteCode && findUsableCode(db, inviteCode, 'invite');
      if (!invite) {
        return done(null, false, { message: 'No club account uses this Google account yet. Ask a club administrator for an invite code, then join with it.' });
      }
      if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, invite.user_id || 0)) {
        return done(null, false, { message: 'A member with this email already exists. Sign in with your username and link Google from your account page.' });
      }
      const userId = db.transaction(() => {
        const newId = accountFromInvite(db, invite, { displayName: invite.user_id ? null : name, email, googleId });
        markCodeUsed(db, invite.id, newId);
        return newId;
      })();
      delete req.session.pendingInvite;
      return done(null, findUserById(db, userId));
    } catch (e) { return done(e); }
  }));
}

module.exports = { setupPassport, findUserById };
