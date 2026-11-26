const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { startTestApp } = require('./helpers');
const { createAccessCode } = require('../src/lib/codes');

let t;
test.before(async () => { t = await startTestApp({ photoLimit: 2 }); });
test.after(async () => { await t.close(); });

// A camera-sized JPEG with GPS and camera details in its metadata.
async function cameraJpeg(width = 4000, height = 3000) {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Model: 'X100', Copyright: 'someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 18/1 0/1' } })
    .toBuffer();
}

async function signedIn(role) {
  const { code } = createAccessCode(t.db, { purpose: 'invite', role, days: 1 });
  const c = t.client();
  await c.get('/join');
  await c.post('/join', { code });
  await c.get('/join/account');
  const username = `u${Math.random().toString(36).slice(2, 9)}`;
  await c.post('/join/account', { display_name: `${role} person`, username, password: 'a-long-password', password_confirm: 'a-long-password' });
  return c;
}

let admin;
let member;
const cat = {};

test('admin creates categories; members cannot', async () => {
  admin = await signedIn('admin');
  member = await signedIn('member');
  await admin.get('/admin/categories');
  for (const name of ['Wildlife', 'Street', 'Aerial']) {
    assert.equal((await admin.post('/admin/categories', { name })).status, 302);
  }
  assert.equal((await admin.post('/admin/categories', { name: 'street' })).status, 302);
  assert.equal(t.db.prepare('SELECT COUNT(*) FROM categories').pluck().get(), 3, 'duplicate names are refused');
  for (const c of t.db.prepare('SELECT id, name, slug FROM categories').all()) cat[c.name] = c;
  assert.equal(cat.Street.slug, 'street');

  await member.get('/account');
  assert.equal((await member.post('/admin/categories', { name: 'Nope' })).status, 403);
});

test('gallery hides categories without photos', async () => {
  const page = await t.client().get('/gallery');
  assert.doesNotMatch(page.text, /class="catalogue /);
  assert.equal((await t.client().get('/gallery/street')).status, 404);
});

test('upload needs the public-viewing confirmation', async () => {
  await member.get('/account/photos');
  const r = await member.upload('/account/photos', { title: 'No ack', main_category_id: cat.Street.id }, { buffer: await cameraJpeg() });
  assert.equal(r.status, 400);
  assert.match(r.text, /publicly viewable/);
  assert.equal(t.db.prepare('SELECT COUNT(*) FROM photos').pluck().get(), 0);
});

test('upload is resized, stripped of metadata, and stored without the original', async () => {
  await member.get('/account/photos');
  const r = await member.upload('/account/photos', {
    title: 'Colon Street at dawn', main_category_id: cat.Street.id, categories: [cat.Aerial.id], public_ack: '1',
  }, { buffer: await cameraJpeg() });
  assert.equal(r.status, 302, r.text.slice(0, 400));

  const photo = t.db.prepare('SELECT * FROM photos').get();
  assert.ok(photo.public_ack_at);
  const cats = t.db.prepare('SELECT category_id FROM photo_categories WHERE photo_id = ? ORDER BY category_id').pluck().all(photo.id);
  assert.deepEqual(cats.sort(), [cat.Street.id, cat.Aerial.id].sort());

  const files = fs.readdirSync(path.join(t.config.uploadsDir, 'photos'));
  assert.equal(files.length, 2, 'only the display and thumbnail copies are kept');

  const display = await sharp(path.join(t.config.uploadsDir, photo.display_key)).metadata();
  assert.equal(display.width, 1600);
  assert.equal(display.height, 1200);
  assert.equal(display.exif, undefined, 'camera and GPS data removed');
  const thumb = await sharp(path.join(t.config.uploadsDir, photo.thumb_key)).metadata();
  assert.equal(Math.max(thumb.width, thumb.height), 800);

  const media = await fetch(`${t.base}/media/${photo.display_key}`);
  assert.equal(media.status, 200);
  assert.match(media.headers.get('cache-control'), /immutable/);
});

test('small images and non-images are refused', async () => {
  await member.get('/account/photos');
  const small = await member.upload('/account/photos', { title: 'Tiny', main_category_id: cat.Street.id, public_ack: '1' }, { buffer: await cameraJpeg(800, 600) });
  assert.equal(small.status, 400);
  assert.match(small.text, /too small/);
  const notImage = await member.upload('/account/photos', { title: 'Text', main_category_id: cat.Street.id, public_ack: '1' }, { buffer: Buffer.from('hello'), type: 'text/plain', name: 'a.txt' });
  assert.equal(notImage.status, 400);
});

test('gallery shows catalogues alphabetically, only those with photos', async () => {
  const page = await t.client().get('/gallery');
  const names = [...page.text.matchAll(/class="catalogue-name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(names, ['Aerial', 'Street'], 'Wildlife has no photos, so it is hidden');
  const category = await t.client().get('/gallery/aerial');
  assert.equal(category.status, 200);
  assert.match(category.text, /Colon Street at dawn/);
});

test('members are limited to the photo limit', async () => {
  await member.get('/account/photos');
  const second = await member.upload('/account/photos', { title: 'Second', main_category_id: cat.Wildlife.id, public_ack: '1' }, { buffer: await cameraJpeg(1200, 1800) });
  assert.equal(second.status, 302);
  const third = await member.upload('/account/photos', { title: 'Third', main_category_id: cat.Wildlife.id, public_ack: '1' }, { buffer: await cameraJpeg() });
  assert.equal(third.status, 400);
  assert.match(third.text, /limit of 2 photos/);
});

test('a category used as a main category cannot be deleted', async () => {
  await admin.get('/admin/categories');
  await admin.post(`/admin/categories/${cat.Street.id}/delete`, {});
  assert.ok(t.db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat.Street.id));
  await admin.post(`/admin/categories/${cat.Aerial.id}/delete`, {});
  assert.equal(t.db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat.Aerial.id), undefined, 'only an extra category: deletable');
});

test('members can only change their own photos; deleting removes the files', async () => {
  const photo = t.db.prepare("SELECT * FROM photos WHERE title = 'Second'").get();
  const other = await signedIn('member');
  await other.get('/account/photos');
  await other.post(`/account/photos/${photo.id}/delete`, {});
  assert.ok(t.db.prepare('SELECT 1 FROM photos WHERE id = ?').get(photo.id), 'someone else cannot delete it');

  await member.get('/account/photos');
  await member.post(`/account/photos/${photo.id}/delete`, {});
  assert.equal(t.db.prepare('SELECT 1 FROM photos WHERE id = ?').get(photo.id), undefined);
  await new Promise((r) => { setTimeout(r, 50); });
  assert.ok(!fs.existsSync(path.join(t.config.uploadsDir, photo.display_key)));
});

test('file uploads without the form token are refused', async () => {
  await member.get('/account/photos');
  member.csrf = 'forged';
  const r = await member.upload('/account/photos', { title: 'x', main_category_id: cat.Street.id, public_ack: '1' }, { buffer: await cameraJpeg() });
  assert.equal(r.status, 403);
});
