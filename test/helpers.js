const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

// Starts the app on a random port with an in-memory database.
async function startTestApp(overrides = {}) {
  const db = openDatabase(':memory:');
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icc-uploads-'));
  const formsDir = path.join(uploadsDir, 'forms');
  const config = {
    env: 'test', port: 0, siteUrl: 'http://localhost', sessionSecret: 'x'.repeat(48), dbPath: ':memory:', google: null,
    uploadsDir, formsDir, photoLimit: 50, watermark: true, ...overrides,
  };
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    config,
    client: () => new Client(base),
    close: () => new Promise((resolve) => { app.locals.sessionStore.close(); server.close(() => { db.close(); fs.rmSync(uploadsDir, { recursive: true, force: true }); resolve(); }); }),
  };
}

// A tiny browser: keeps the session cookie and the CSRF token between requests.
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }

  async request(method, path, form) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.csrf, ...form }).toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/) || text.match(/name="csrf-token" content="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }

  get(path) { return this.request('GET', path); }

  // Multipart form with one file, like a browser upload.
  async upload(path, fields, file) {
    const form = new FormData();
    form.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => form.append(k, String(x)));
    if (file) form.append(file.field || 'photo', new Blob([file.buffer], { type: file.type || 'image/jpeg' }), file.name || 'photo.jpg');
    const res = await fetch(this.base + path, { method: 'POST', headers: { cookie: this.cookie }, body: form, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/) || text.match(/name="csrf-token" content="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }

  // JSON request with the token in a header, like the site's own scripts.
  async json(method, path, body) {
    const headers = { 'x-csrf-token': this.csrf, cookie: this.cookie };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const type = res.headers.get('content-type') || '';
    const raw = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, raw, body: type.includes('json') ? JSON.parse(raw.toString() || 'null') : raw.toString() };
  }

  // Multipart answer with files, sent like forms-fill.js does (token in a header).
  async sendForm(method, path, data, files = {}) {
    const form = new FormData();
    form.append('data', JSON.stringify(data));
    for (const [field, f] of Object.entries(files)) form.append(field, new Blob([f.buffer], { type: f.type || 'image/jpeg' }), f.name || 'photo.jpg');
    const res = await fetch(this.base + path, { method, headers: { cookie: this.cookie, 'x-csrf-token': this.csrf }, body: form, redirect: 'manual' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async post(path, form) {
    if (!this.csrf) await this.get('/login');
    return this.request('POST', path, form);
  }
}

module.exports = { startTestApp };
