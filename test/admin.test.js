const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');
const { createAccessCode } = require('../src/lib/codes');
const { blocks, inline } = require('../src/lib/content');

let t;
let admin;
let member;

async function join(code, username, name = 'Some Body') {
  const c = t.client();
  await c.get('/join');
  await c.post('/join', { code });
  await c.get('/join/account');
  const r = await c.post('/join/account', { display_name: name, username, password: 'a-long-password', password_confirm: 'a-long-password' });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  return c;
}

test.before(async () => {
  t = await startTestApp();
  admin = await join(createAccessCode(t.db, { purpose: 'invite', role: 'admin', days: 1 }).code, 'boss', 'Club Admin');
  member = await join(createAccessCode(t.db, { purpose: 'invite', role: 'member', days: 1 }).code, 'mem', 'Maria Member');
});
test.after(async () => { await t.close(); });

const userId = (name) => t.db.prepare('SELECT id FROM users WHERE display_name = ?').pluck().get(name);
const yearsOf = (id) => t.db.prepare('SELECT year FROM membership_years WHERE user_id = ? ORDER BY year').pluck().all(id);

test('admin adds a past member to the roster with their years', async () => {
  await admin.get('/admin/members');
  const r = await admin.post('/admin/members', { display_name: 'Pedro Past', years: '2015, 2016 2019', phone: '0917 000 0000' });
  assert.equal(r.status, 302);
  const id = userId('Pedro Past');
  assert.deepEqual(yearsOf(id), [2015, 2016, 2019]);

  const in2016 = await admin.get('/admin/members?year=2016');
  assert.match(in2016.text, /Pedro Past/);
  assert.doesNotMatch(in2016.text, /Maria Member/);
  assert.match((await admin.get(`/admin/members/${id}`)).text, /No website account|no website account/);
});

test('years can be added and removed one at a time, with bad years refused', async () => {
  const id = userId('Pedro Past');
  await admin.get(`/admin/members/${id}`);
  await admin.post(`/admin/members/${id}/years`, { year: '2024' });
  await admin.post(`/admin/members/${id}/years`, { year: '1890' });
  await admin.post(`/admin/members/${id}/years/2015/delete`, {});
  assert.deepEqual(yearsOf(id), [2016, 2019, 2024]);
});

test('“mark all active accounts” adds the year only to people with a website account', async () => {
  await admin.get('/admin/members');
  await admin.post('/admin/members/years/bulk', { year: '2026' });
  assert.ok(yearsOf(userId('Maria Member')).includes(2026));
  assert.ok(yearsOf(userId('Club Admin')).includes(2026));
  assert.ok(!yearsOf(userId('Pedro Past')).includes(2026));
});

test('an invite made from a roster entry attaches the new account to it', async () => {
  const id = userId('Pedro Past');
  const { code } = createAccessCode(t.db, { purpose: 'invite', role: 'member', forName: 'Pedro Past', userId: id, days: 1 });
  const pedro = await join(code, 'pedro', 'Pedro Past');
  assert.equal(t.db.prepare("SELECT id FROM users WHERE username = 'pedro'").pluck().get(), id, 'same person, no duplicate');
  assert.deepEqual(yearsOf(id), [2016, 2019, 2024], 'years kept');
  assert.equal((await pedro.get('/members')).status, 200);
});

test('members with an account cannot be deleted; roster-only entries can', async () => {
  await admin.get('/admin/members');
  await admin.post(`/admin/members/${userId('Maria Member')}/delete`, {});
  assert.ok(userId('Maria Member'));
  await admin.post('/admin/members', { display_name: 'Typo Person' });
  await admin.post(`/admin/members/${userId('Typo Person')}/delete`, {});
  assert.equal(userId('Typo Person'), undefined);
});

test('admin details: notes saved; an admin cannot change their own role', async () => {
  const id = userId('Maria Member');
  await admin.get(`/admin/members/${id}`);
  await admin.post(`/admin/members/${id}`, { display_name: 'Maria Member', email: 'maria@example.com', phone: '', admin_notes: 'Treasurer 2025', role: 'member', status: 'active' });
  assert.equal(t.db.prepare('SELECT admin_notes FROM users WHERE id = ?').pluck().get(id), 'Treasurer 2025');

  const self = userId('Club Admin');
  await admin.post(`/admin/members/${self}`, { display_name: 'Club Admin', role: 'member', status: 'active' });
  assert.equal(t.db.prepare('SELECT role FROM users WHERE id = ?').pluck().get(self), 'admin');
});

test('members cannot open the roster', async () => {
  assert.equal((await member.get('/admin/members')).status, 403);
  assert.equal((await member.get('/admin/pages')).status, 403);
});

test('simple text marks become safe HTML', () => {
  assert.equal(inline('The island, *through our lenses.*'), 'The island, <em>through our lenses.</em>');
  assert.equal(inline('**Bold** and [the gallery](/gallery)'), '<strong>Bold</strong> and <a href="/gallery">the gallery</a>');
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.doesNotMatch(inline('[bad](javascript:alert(1))'), /href/);
  assert.equal(blocks('## Membership\n\nFirst line\nsecond line\n\n- one\n- two'),
    '<h2 id="membership">Membership</h2>\n<p>First line<br>second line</p>\n<ul><li>one</li><li>two</li></ul>');
});

test('admin edits page text; it shows on the site, safely; clearing restores the original', async () => {
  await admin.get('/admin/pages/home');
  const r = await admin.post('/admin/pages/home', { hero_title: 'Cebu, *one frame at a time*', hero_text: 'Hello <b>there</b>' });
  assert.equal(r.status, 302);
  const home = await t.client().get('/');
  assert.match(home.text, /Cebu, <em>one frame at a time<\/em>/);
  assert.match(home.text, /Hello &lt;b&gt;there&lt;\/b&gt;/);
  assert.match(home.text, /Photo walks/, 'untouched fields keep their original text');

  await admin.get('/admin/pages/home');
  await admin.post('/admin/pages/home', { hero_title: '', hero_text: '' });
  assert.match((await t.client().get('/')).text, /The island, seen <em>through our lenses\.<\/em>/);
  assert.equal(t.db.prepare("SELECT COUNT(*) FROM page_content WHERE page = 'home'").pluck().get(), 0);

  assert.equal((await admin.get('/admin/pages/nope')).status, 404);
  assert.equal((await admin.get('/admin/pages/constructor')).status, 404);
});

test('about page keeps the Membership heading the Join pages link to', async () => {
  const about = await t.client().get('/about');
  assert.match(about.text, /<h2 id="membership">Membership<\/h2>/);
});

test('members portal: members only, with the no-contest message', async () => {
  const guest = await t.client().get('/members');
  assert.equal(guest.location, '/login');
  const page = await member.get('/members');
  assert.equal(page.status, 200);
  assert.match(page.text, /no contest open/);
  assert.match(page.text, /href="\/members"/, 'Members link in the menu');
});
