const crypto = require('node:crypto');

// scrypt from Node's standard library: no native build needed on the server.
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}

// Used when a username does not exist, so a failed login takes the same time either way.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
