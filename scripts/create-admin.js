// Prints a one-time administrator invite code. Use it to create the first admin account:
//   npm run create-admin -- "Your Name"
// then open /join and enter the code.
require('dotenv').config({ quiet: true });
const { openDatabase } = require('../src/db');
const { createAccessCode } = require('../src/lib/codes');

const db = openDatabase(process.env.DB_PATH || 'data/club.db');
const forName = process.argv[2] || null;
const { code, expiresAt } = createAccessCode(db, { purpose: 'invite', role: 'admin', forName, days: 3 });
db.close();

const site = (process.env.SITE_URL || 'http://localhost:3001').replace(/\/$/, '');
console.log(`\nAdministrator invite code: ${code}`);
console.log(`Valid once, until ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
console.log(`Open ${site}/join?code=${code}\n`);
