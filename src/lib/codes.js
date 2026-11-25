const crypto = require('node:crypto');

// No 0/O, 1/I/L: codes are read aloud and typed from phones.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(prefix = 'ICC') {
  const bytes = crypto.randomBytes(8);
  let body = '';
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4)}`;
}

function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Only the hash is stored, so a leaked database does not leak usable codes.
function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

function sqliteDate(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function createAccessCode(db, { purpose, role = 'member', forName = null, userId = null, createdBy = null, days }) {
  const code = generateCode(purpose === 'reset' ? 'RST' : 'ICC');
  const expires = new Date(Date.now() + days * 86400000);
  db.prepare(`INSERT INTO access_codes (code_hash, purpose, role, for_name, user_id, created_by, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(hashCode(code), purpose, role, forName, userId, createdBy, sqliteDate(expires));
  return { code, expiresAt: expires };
}

// Returns the row if the code exists, matches the purpose, and is unused, unrevoked and unexpired.
function findUsableCode(db, code, purpose) {
  return db.prepare(`SELECT * FROM access_codes
     WHERE code_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL
       AND expires_at > datetime('now')`).get(hashCode(code), purpose);
}

function markCodeUsed(db, id, userId) {
  const r = db.prepare(`UPDATE access_codes SET used_by = ?, used_at = datetime('now')
                         WHERE id = ? AND used_at IS NULL`).run(userId, id);
  if (r.changes !== 1) throw new Error('Code already used');
}

module.exports = { generateCode, normalizeCode, hashCode, createAccessCode, findUsableCode, markCodeUsed };
