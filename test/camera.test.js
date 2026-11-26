const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { startTestApp } = require('./helpers');
const { createAccessCode } = require('../src/lib/codes');
const cam = require('../src/lib/exposure');

let t;
let member;
let categoryId;

test.before(async () => {
  t = await startTestApp();
  categoryId = t.db.prepare("INSERT INTO categories (name, slug) VALUES ('Street', 'street')").run().lastInsertRowid;
  const { code } = createAccessCode(t.db, { purpose: 'invite', role: 'member', days: 1 });
  member = t.client();
  await member.get('/join');
  await member.post('/join', { code });
  await member.get('/join/account');
  await member.post('/join/account', { display_name: 'Ana Reyes', username: 'ana', password: 'a-long-password', password_confirm: 'a-long-password' });
});
test.after(async () => { await t.close(); });

function jpeg(exif) {
  const img = sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#556677' } }).jpeg();
  return (exif ? img.withExif({ IFD0: { Make: 'Fujifilm', Model: 'X-T5' }, IFD2: exif }) : img).toBuffer();
}

const upload = async (title, buffer, extra = {}) => {
  await member.get('/account/photos');
  return member.upload('/account/photos', { title, main_category_id: categoryId, public_ack: '1', ...extra }, { buffer });
};

test('formats camera settings the way photographers write them', () => {
  assert.equal(cam.formatAperture(2.8), 'f/2.8');
  assert.equal(cam.formatAperture(8), 'f/8');
  assert.equal(cam.formatShutter(0.004), '1/250s');
  assert.equal(cam.formatShutter(1 / 8000), '1/8000s');
  assert.equal(cam.formatShutter(0.5), '0.5s');
  assert.equal(cam.formatShutter(30), '30s');
  assert.equal(cam.formatIso(400), 'ISO 400');
  assert.equal(cam.exposureLine({ show_exif: 1, aperture: 2.8, exposure_time: 0.004, iso: 400 }), 'f/2.8 · 1/250s · ISO 400');
  assert.equal(cam.exposureLine({ show_exif: 0, aperture: 2.8, exposure_time: 0.004, iso: 400 }), '');
  assert.equal(cam.exposureLine({ show_exif: 1, aperture: null, exposure_time: null, iso: 200 }), 'ISO 200');
});

test('reads what members type', () => {
  assert.deepEqual(cam.parseAperture('f/5.6'), { value: 5.6 });
  assert.deepEqual(cam.parseAperture('11'), { value: 11 });
  assert.deepEqual(cam.parseShutter('1/125'), { value: 1 / 125 });
  assert.deepEqual(cam.parseShutter('2s'), { value: 2 });
  assert.deepEqual(cam.parseIso('ISO 3200'), { value: 3200 });
  assert.deepEqual(cam.parseIso(''), { value: null });
  assert.ok(cam.parseAperture('wide').error);
  assert.ok(cam.parseShutter('fast').error);
  assert.ok(cam.parseIso('4.5').error);
});

test('upload reads aperture, shutter and ISO, and shows them when ticked', async () => {
  const r = await upload('Night market', await jpeg({ FNumber: '28/10', ExposureTime: '1/250', ISOSpeedRatings: '400' }), { show_exif: '1' });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const p = t.db.prepare("SELECT * FROM photos WHERE title = 'Night market'").get();
  assert.equal(p.aperture, 2.8);
  assert.equal(p.exposure_time, 0.004);
  assert.equal(p.iso, 400);
  assert.equal(p.show_exif, 1);

  const meta = await sharp(path.join(t.config.uploadsDir, p.display_key)).metadata();
  assert.equal(meta.exif, undefined, 'the served file still carries no metadata');
  assert.ok(fs.existsSync(path.join(t.config.uploadsDir, p.thumb_key)));

  const page = await t.client().get('/gallery/street');
  assert.match(page.text, /f\/2\.8 · 1\/250s · ISO 400/);
});

test('camera details stay hidden unless the member ticks the box', async () => {
  await upload('Quiet alley', await jpeg({ FNumber: '8/1', ExposureTime: '1/60', ISOSpeedRatings: '1600' }));
  const p = t.db.prepare("SELECT * FROM photos WHERE title = 'Quiet alley'").get();
  assert.equal(p.iso, 1600, 'still stored, so the member can show them later');
  assert.equal(p.show_exif, 0);
  const page = await t.client().get('/gallery/street');
  assert.doesNotMatch(page.text, /ISO 1600/);
});

test('a photo without EXIF gets a note, and the member can type the settings in', async () => {
  const r = await upload('Scanned film', await jpeg(null), { show_exif: '1' });
  assert.equal(r.status, 302);
  const page = await member.get('/account/photos');
  assert.match(page.text, /No camera details were found/);

  const p = t.db.prepare("SELECT * FROM photos WHERE title = 'Scanned film'").get();
  assert.equal(p.aperture, null);
  await member.get(`/account/photos?edit=${p.id}`);
  const saved = await member.post(`/account/photos/${p.id}`, {
    title: 'Scanned film', main_category_id: String(categoryId), aperture: 'f/11', exposure_time: '1/125', iso: '100', show_exif: '1',
  });
  assert.equal(saved.status, 302);
  const after = t.db.prepare('SELECT * FROM photos WHERE id = ?').get(p.id);
  assert.equal(after.aperture, 11);
  assert.equal(after.iso, 100);
  const gallery = await t.client().get('/gallery/street');
  assert.match(gallery.text, /f\/11 · 1\/125s · ISO 100/);

  await member.get(`/account/photos?edit=${p.id}`);
  const bad = await member.post(`/account/photos/${p.id}`, {
    title: 'Scanned film', main_category_id: String(categoryId), aperture: 'wide open', show_exif: '1',
  });
  assert.equal(bad.location, `/account/photos?edit=${p.id}`);
  assert.equal(t.db.prepare('SELECT aperture FROM photos WHERE id = ?').pluck().get(p.id), 11, 'bad input does not overwrite');
});
