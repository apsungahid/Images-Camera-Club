// Backs up the club database and its private/member files into one folder per run.
// Used by scripts/deploy.sh before each update and by the daily cron job on the server.
//   node scripts/backup.js [backup-folder] [days-to-keep]
// Needs no sqlite3 program: uses the database library's own online backup.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const dest = path.resolve(process.argv[2] || '/srv/photoclub-backups');
const keepDays = Number(process.argv[3] || 14);
const dbPath = path.resolve(process.env.DB_PATH || 'data/club.db');
const stamp = new Date(Date.now() + 8 * 3600000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dir = path.join(dest, `club-${stamp}`);

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    await db.backup(path.join(dir, 'club.db'));
    db.close();
  }
  // Member photos (resized copies) and contest entries.
  for (const [name, folder] of [['uploads', process.env.UPLOADS_DIR || 'uploads'], ['forms', process.env.FORMS_DIR || 'data/forms']]) {
    const abs = path.resolve(folder);
    if (fs.existsSync(abs)) execFileSync('tar', ['--force-local', '-czf', path.join(dir, `${name}.tar.gz`), '-C', path.dirname(abs), path.basename(abs)]);
  }
  // Remove backups older than keepDays.
  const cutoff = Date.now() - keepDays * 86400000;
  for (const entry of fs.readdirSync(dest)) {
    const p = path.join(dest, entry);
    if (entry.startsWith('club-') && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
  }
  console.log(`Backup written to ${dir}`);
})().catch((e) => { console.error(e); process.exit(1); });
