const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { startTestApp } = require('./helpers');
const { createAccessCode } = require('../src/lib/codes');

let t;
let admin;
let ana;
let ben;
let formId;

async function join(role, username, name) {
  const { code } = createAccessCode(t.db, { purpose: 'invite', role, days: 1 });
  const c = t.client();
  await c.get('/join');
  await c.post('/join', { code });
  await c.get('/join/account');
  await c.post('/join/account', { display_name: name, username, password: 'a-long-password', password_confirm: 'a-long-password' });
  await c.get('/members'); // picks up the page token
  return c;
}

const jpeg = () => sharp({ create: { width: 1200, height: 800, channels: 3, background: '#335577' } }).jpeg().toBuffer();

const CONTEST = {
  title: 'Streets of Cebu',
  description: 'Monthly contest.\nOne photo per member.',
  maxPerMember: 1,
  fields: [
    { label: 'Title of your photo', type: 'text', required: true },
    { label: 'Your photo', type: 'file', required: true, maxSizeMB: 5, accept: ['.jpg', '.jpeg', '.png'] },
    { label: 'Favourite theme for next month', type: 'poll', options: ['Night', 'Portraits', 'Food'], required: false },
  ],
};

test.before(async () => {
  t = await startTestApp();
  admin = await join('admin', 'boss', 'Club Admin');
  ana = await join('member', 'ana', 'Ana Reyes');
  ben = await join('member', 'ben', 'Ben Cruz');
});
test.after(async () => { await t.close(); });

test('only administrators can create forms', async () => {
  assert.equal((await ana.json('POST', '/admin/forms/api', CONTEST)).status, 403);
  assert.equal((await ana.get('/admin/forms')).status, 403);
  const r = await admin.json('POST', '/admin/forms/api', CONTEST);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  formId = r.body.id;
  assert.equal(r.body.state, 'draft');
  assert.deepEqual(r.body.fields.map((f) => f.name), ['q1', 'q2', 'q3']);
  assert.equal((await admin.json('POST', '/admin/forms/api', CONTEST)).status, 409, 'titles are unique');
});

test('requests without the page token are refused', async () => {
  const saved = admin.csrf;
  admin.csrf = 'nope';
  const r = await admin.json('POST', '/admin/forms/api', { ...CONTEST, title: 'Sneaky' });
  admin.csrf = saved;
  assert.equal(r.status, 403);
  assert.match(r.body.error, /session expired/i);
});

test('drafts are hidden from members; admins can preview but not send', async () => {
  assert.equal((await ana.json('GET', `/members/forms/api/${formId}`)).status, 404);
  assert.equal((await ana.get(`/members/forms/${formId}`)).status, 404);
  assert.doesNotMatch((await ana.get('/members')).text, /Streets of Cebu/);
  const preview = await admin.json('GET', `/members/forms/api/${formId}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview, true);
  assert.equal((await admin.sendForm('POST', `/members/forms/api/${formId}`, { q1: 'x' }, { q2: { buffer: await jpeg() } })).status, 403);
});

test('published forms appear in the portal and members can answer with a file', async () => {
  assert.equal((await admin.json('POST', `/admin/forms/api/${formId}/publish`)).body.state, 'open');
  assert.match((await ana.get('/members')).text, /Streets of Cebu/);

  const missing = await ana.sendForm('POST', `/members/forms/api/${formId}`, { q1: '' });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.fields.q1 && missing.body.fields.q2);

  const wrongType = await ana.sendForm('POST', `/members/forms/api/${formId}`, { q1: 'Rain' }, { q2: { buffer: Buffer.from('MZ'), name: 'virus.exe', type: 'application/octet-stream' } });
  assert.equal(wrongType.status, 400);

  const ok = await ana.sendForm('POST', `/members/forms/api/${formId}`, { q1: 'Colon Street rain', q3: ['Night'] }, { q2: { buffer: await jpeg(), name: 'IMG_0042.jpg' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const view = await ana.json('GET', `/members/forms/api/${formId}`);
  assert.equal(view.body.mode, 'view', 'one answer per member: she now sees what she sent');
  assert.equal(view.body.canSubmitAgain, false);
  const again = await ana.sendForm('POST', `/members/forms/api/${formId}`, { q1: 'Second' }, { q2: { buffer: await jpeg() } });
  assert.equal(again.status, 409);
  assert.match((await ana.get('/members')).text, /Sent ✓/);
});

test('admins see entries with the member’s name, and files stay private', async () => {
  const subs = (await admin.json('GET', `/admin/forms/api/${formId}/submissions`)).body;
  assert.equal(subs.length, 1);
  assert.equal(subs[0].memberName, 'Ana Reyes');
  assert.equal(subs[0].data.q1, 'Colon Street rain');
  const fileId = subs[0].data.q2.fileId;

  const download = await admin.json('GET', `/admin/forms/api/${formId}/files/${fileId}`);
  assert.equal(download.status, 200);
  assert.ok(download.raw.length > 1000);

  assert.equal((await ana.json('GET', `/members/forms/api/${formId}/files/${fileId}`)).status, 200, 'her own image preview');
  assert.equal((await ben.json('GET', `/members/forms/api/${formId}/files/${fileId}`)).status, 404, 'not another member');
  assert.equal((await ben.json('GET', `/admin/forms/api/${formId}/files/${fileId}`)).status, 403);
  assert.equal((await fetch(`${t.base}/media/${fileId}.jpg`)).status, 404, 'not in the public media folder');
  assert.ok(fs.existsSync(path.join(t.config.formsDir, String(formId))), 'stored in the private forms folder');

  const results = (await admin.json('GET', `/admin/forms/api/${formId}/results`)).body;
  assert.equal(results.q3.options.find((o) => o.option === 'Night').count, 1);
});

test('Excel and ZIP downloads', async () => {
  const xlsx = await admin.json('GET', `/admin/forms/api/${formId}/submissions.xlsx`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.type, /spreadsheetml/);
  assert.equal(xlsx.raw.subarray(0, 2).toString(), 'PK');
  const zip = await admin.json('GET', `/admin/forms/api/${formId}/submissions.zip`);
  assert.equal(zip.status, 200);
  assert.match(zip.type, /zip/);
  assert.ok(zip.raw.includes(Buffer.from('Ana Reyes - IMG_0042.jpg')), 'files are named after the member');
});

test('locking and closing dates stop new answers', async () => {
  await admin.json('POST', `/admin/forms/api/${formId}/lock`);
  const locked = await ben.sendForm('POST', `/members/forms/api/${formId}`, { q1: 'x' }, { q2: { buffer: await jpeg() } });
  assert.equal(locked.status, 423);
  assert.doesNotMatch((await ben.get('/members')).text, /Streets of Cebu/, 'hidden from members who did not take part');
  await admin.json('POST', `/admin/forms/api/${formId}/unlock`);

  const form = (await admin.json('GET', `/admin/forms/api/${formId}`)).body;
  await admin.json('PUT', `/admin/forms/api/${formId}`, { ...CONTEST, fields: form.fields, closesAt: '2020-01-01T08:00' });
  const closed = await ben.json('GET', `/members/forms/api/${formId}`);
  assert.equal(closed.status, 403);
  assert.match(closed.body.error, /closed/);
  await admin.json('PUT', `/admin/forms/api/${formId}`, { ...CONTEST, fields: form.fields, closesAt: '' });
});

test('with editing allowed, a member replaces their answer and the old file is deleted', async () => {
  const form = (await admin.json('GET', `/admin/forms/api/${formId}`)).body;
  await admin.json('PUT', `/admin/forms/api/${formId}`, { ...CONTEST, fields: form.fields, allowResubmit: true });
  const before = (await admin.json('GET', `/admin/forms/api/${formId}/submissions`)).body[0];
  const oldFile = t.db.prepare('SELECT stored_path FROM form_files WHERE id = ?').pluck().get(before.data.q2.fileId);

  const edit = await ana.json('GET', `/members/forms/api/${formId}/edit`);
  assert.equal(edit.status, 200);
  assert.equal(edit.body.data.q1, 'Colon Street rain');
  const keepFile = await ana.sendForm('PUT', `/members/forms/api/${formId}`, { q1: 'Colon Street, after the rain' });
  assert.equal(keepFile.status, 200, JSON.stringify(keepFile.body));
  const replaced = await ana.sendForm('PUT', `/members/forms/api/${formId}`, { q1: 'Final title' }, { q2: { buffer: await jpeg(), name: 'better.jpg' } });
  assert.equal(replaced.status, 200);

  const after = (await admin.json('GET', `/admin/forms/api/${formId}/submissions`)).body;
  assert.equal(after.length, 1, 'still one entry');
  assert.equal(after[0].data.q1, 'Final title');
  assert.equal(after[0].data.q2.name, 'better.jpg');
  assert.ok(after[0].editedAt);
  await new Promise((r) => { setTimeout(r, 50); });
  assert.ok(!fs.existsSync(path.join(t.config.formsDir, oldFile)), 'the replaced file is gone');
});

test('admin removes an entry; duplicate copies questions as a draft; delete removes files', async () => {
  const sub = (await admin.json('GET', `/admin/forms/api/${formId}/submissions`)).body[0];
  assert.equal((await admin.json('DELETE', `/admin/forms/api/${formId}/submissions/${sub.id}`)).status, 200);
  assert.equal((await admin.json('GET', `/admin/forms/api/${formId}/submissions`)).body.length, 0);

  const copy = await admin.json('POST', `/admin/forms/api/${formId}/duplicate`, { title: 'Streets of Cebu II' });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.state, 'draft');
  assert.equal(copy.body.fields.length, 3);

  assert.equal((await admin.json('DELETE', `/admin/forms/api/${formId}`)).status, 204);
  assert.equal((await ana.json('GET', `/members/forms/api/${formId}`)).status, 404);
  await new Promise((r) => { setTimeout(r, 50); });
  assert.ok(!fs.existsSync(path.join(t.config.formsDir, String(formId))));
});
