const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = createApp({ db, config });

// Localhost only: the Cloudflare Tunnel is the only way in.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Images Camera Club website on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
