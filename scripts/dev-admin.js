// Local development only: creates (or resets) a demo administrator for reviewing the admin
// screens on your own computer. Refuses to run in production. Sign-in details are in README.md.
require('dotenv').config({ quiet: true });
if (process.env.NODE_ENV === 'production') {
  console.error('dev-admin is for local development only.');
  process.exit(1);
}
const { openDatabase } = require('../src/db');
const { hashPassword } = require('../src/lib/passwords');

const USERNAME = 'demo.admin';
const PASSWORD = 'local-demo-admin';

const db = openDatabase(process.env.DB_PATH || 'data/club.db');
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', status = 'active' WHERE id = ?").run(hashPassword(PASSWORD), existing.id);
} else {
  db.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES (?, 'Demo Admin', ?, 'admin')").run(USERNAME, hashPassword(PASSWORD));
}
db.close();
console.log(`Local demo administrator ready: sign in as ${USERNAME} (password in README.md).`);
