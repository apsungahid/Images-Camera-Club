const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

// Starts the app on a random port with an in-memory database.
async function startTestApp() {
  const db = openDatabase(':memory:');
  const config = {
    env: 'test', port: 0, siteUrl: 'http://localhost', sessionSecret: 'x'.repeat(48), dbPath: ':memory:', google: null,
  };
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    client: () => new Client(base),
    close: () => new Promise((resolve) => { app.locals.sessionStore.close(); server.close(() => { db.close(); resolve(); }); }),
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
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }

  get(path) { return this.request('GET', path); }

  async post(path, form) {
    if (!this.csrf) await this.get('/login');
    return this.request('POST', path, form);
  }
}

module.exports = { startTestApp };
