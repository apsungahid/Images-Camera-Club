const session = require('express-session');

// Sessions kept in the club's SQLite file so sign-ins survive restarts and deploys.
class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStmt = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?');
    this.setStmt = db.prepare(`INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`);
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.pruneStmt = db.prepare('DELETE FROM sessions WHERE expires <= ?');
    this.timer = setInterval(() => this.pruneStmt.run(Date.now()), 3600000);
    this.timer.unref();
  }

  expiry(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try { this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess)); cb?.(null); } catch (e) { cb?.(e); }
  }

  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }

  touch(sid, sess, cb) {
    try { this.touchStmt.run(this.expiry(sess), sid); cb?.(null); } catch (e) { cb?.(e); }
  }

  close() { clearInterval(this.timer); }
}

module.exports = { SqliteStore };
