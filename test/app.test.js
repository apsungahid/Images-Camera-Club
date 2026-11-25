const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');
const { createAccessCode, normalizeCode } = require('../src/lib/codes');
const { hashPassword, verifyPassword } = require('../src/lib/passwords');

let t;
test.before(async () => { t = await startTestApp(); });
test.after(async () => { await t.close(); });

async function joinWithInvite(role = 'member', username = `user${Math.random().toString(36).slice(2, 8)}`) {
  const { code } = createAccessCode(t.db, { purpose: 'invite', role, days: 1 });
  const c = t.client();
  await c.get('/join');
  const step1 = await c.post('/join', { code });
  assert.equal(step1.location, '/join/account');
  await c.get('/join/account');
  const step2 = await c.post('/join/account', {
    display_name: 'Test Member', username, password: 'a-long-password', password_confirm: 'a-long-password',
  });
  assert.equal(step2.status, 302, step2.text.slice(0, 300));
  return { c, code, username };
}

test('passwords hash and verify', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('codes ignore case and dashes', () => {
  assert.equal(normalizeCode('icc-ab12-cd34'), 'ICCAB12CD34');
});

test('public pages load for guests', async () => {
  const c = t.client();
  for (const path of ['/', '/gallery', '/events', '/announcements', '/about', '/login', '/join', '/reset']) {
    const r = await c.get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.text, /class="site-header"/, `${path} uses the layout`);
  }
  assert.equal((await c.get('/nope')).status, 404);
});

test('members-only content is hidden from guests', async () => {
  t.db.prepare("INSERT INTO announcements (title, body, visibility) VALUES ('Secret meeting', 'x', 'members'), ('Open exhibit', 'y', 'public')").run();
  const guest = await t.client().get('/announcements');
  assert.match(guest.text, /Open exhibit/);
  assert.doesNotMatch(guest.text, /Secret meeting/);

  const { c } = await joinWithInvite();
  const member = await c.get('/announcements');
  assert.match(member.text, /Secret meeting/);
});

test('an invite code works once', async () => {
  const { code } = await joinWithInvite();
  const c = t.client();
  await c.get('/join');
  const again = await c.post('/join', { code });
  assert.equal(again.status, 400);
});

test('sign in with username and password', async () => {
  const { username } = await joinWithInvite();
  const c = t.client();
  await c.get('/login');
  assert.equal((await c.post('/login', { username, password: 'wrong-password' })).status, 401);
  const ok = await c.post('/login', { username: username.toUpperCase(), password: 'a-long-password' });
  assert.equal(ok.status, 302);
  assert.equal((await c.get('/account')).status, 200);
});

test('forms without the CSRF token are refused', async () => {
  const c = t.client();
  await c.get('/login');
  c.csrf = 'forged';
  assert.equal((await c.post('/login', { username: 'a', password: 'b' })).status, 403);
});

test('admin pages: members are refused, admins allowed', async () => {
  const guest = await t.client().get('/admin');
  assert.equal(guest.location, '/login');

  const { c: member } = await joinWithInvite('member');
  assert.equal((await member.get('/admin')).status, 403);

  const { c: admin } = await joinWithInvite('admin');
  assert.equal((await admin.get('/admin')).status, 200);
  const created = await admin.post('/admin/invites', { for_name: 'New Person', role: 'member', days: '7' });
  assert.equal(created.status, 302);
  const page = await admin.get('/admin/invites');
  assert.match(page.text, /ICC-[A-Z0-9]{4}-[A-Z0-9]{4}/);
});

test('reset code changes the password', async () => {
  const { username } = await joinWithInvite();
  const user = t.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const { code } = createAccessCode(t.db, { purpose: 'reset', userId: user.id, days: 1 });
  const c = t.client();
  await c.get('/reset');
  const r = await c.post('/reset', { code, password: 'brand-new-password', password_confirm: 'brand-new-password' });
  assert.equal(r.status, 302);
  const again = t.client();
  await again.get('/login');
  assert.equal((await again.post('/login', { username, password: 'brand-new-password' })).status, 302);
});
