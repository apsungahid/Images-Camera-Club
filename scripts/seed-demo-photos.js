// Local development only: creates gallery categories and a demo member with generated
// placeholder images (colour gradients, not real photographs), so the gallery layout can be
// reviewed before members upload. Refuses to run in production.
require('dotenv').config({ quiet: true });
if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo-photos is for local development only.');
  process.exit(1);
}
const sharp = require('sharp');
const { openDatabase } = require('../src/db');
const { uniqueSlug } = require('../src/lib/categories');
const { processUpload } = require('../src/lib/images');

const db = openDatabase(process.env.DB_PATH || 'data/club.db');
const uploadsDir = process.env.UPLOADS_DIR || 'uploads';

if (db.prepare('SELECT COUNT(*) FROM photos').pluck().get() > 0) {
  console.log('The gallery already has photos; nothing added.');
  process.exit(0);
}

const CATEGORIES = ['Landscape', 'Street', 'Portrait', 'Wildlife', 'Black and White', 'Seascape'];
for (const name of CATEGORIES) {
  if (!db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, uniqueSlug(db, name));
  }
}
const catId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').pluck().get(name);

let owner = db.prepare("SELECT id, display_name FROM users WHERE username = 'demo.member'").get();
if (!owner) {
  const r = db.prepare("INSERT INTO users (username, display_name, role, status) VALUES ('demo.member', 'Demo Member', 'member', 'active')").run();
  owner = { id: r.lastInsertRowid, display_name: 'Demo Member' };
}

// Soft "sky, sun and horizon" gradient so the placeholders read like landscapes.
function placeholder(w, h, [sky, sun, land], grey = false) {
  const buf = Buffer.alloc(w * h * 3);
  const sx = w * (0.25 + Math.random() * 0.5);
  const sy = h * (0.3 + Math.random() * 0.2);
  const horizon = h * (0.55 + Math.random() * 0.15);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot(x - sx, y - sy) / Math.max(w, h);
      const glow = Math.max(0, 1 - d * 2.4) ** 2;
      const base = y < horizon ? sky : land;
      const t = y < horizon ? y / horizon : (y - horizon) / (h - horizon);
      const shade = y < horizon ? 0.55 + 0.45 * t : 0.6 - 0.4 * t;
      const noise = (Math.random() - 0.5) * 10;
      let rgb = [0, 1, 2].map((i) => base[i] * shade + sun[i] * glow * (y < horizon ? 1 : 0.35) + noise);
      if (grey) { const g = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11; rgb = [g, g, g]; }
      const o = (y * w + x) * 3;
      buf[o] = Math.max(0, Math.min(255, rgb[0]));
      buf[o + 1] = Math.max(0, Math.min(255, rgb[1]));
      buf[o + 2] = Math.max(0, Math.min(255, rgb[2]));
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

const PALETTES = {
  dusk: [[70, 60, 110], [255, 170, 90], [30, 25, 35]],
  dawn: [[150, 170, 200], [255, 220, 170], [60, 70, 60]],
  sea: [[60, 120, 170], [250, 240, 210], [20, 60, 90]],
  forest: [[120, 150, 120], [240, 230, 180], [30, 50, 30]],
  city: [[40, 45, 70], [255, 140, 60], [25, 25, 30]],
  warm: [[170, 110, 80], [255, 210, 150], [60, 40, 30]],
};

const PHOTOS = [
  ['Last light over Osmeña Peak', 'Landscape', ['Seascape'], 'dusk', 2400, 1600],
  ['Morning mist, Busay', 'Landscape', [], 'dawn', 2400, 1600],
  ['Colon Street rain', 'Street', ['Black and White'], 'city', 1600, 2400, true],
  ['Carbon Market at six', 'Street', [], 'warm', 2400, 1600],
  ['Grandmother, Argao', 'Portrait', ['Black and White'], 'warm', 1600, 2400, true],
  ['The fisherman', 'Portrait', ['Seascape'], 'sea', 1600, 2000],
  ['Tarsier, Bohol', 'Wildlife', [], 'forest', 2000, 1600],
  ['Herons at Olango', 'Wildlife', ['Seascape'], 'dawn', 2400, 1500],
  ['Malapascua blue hour', 'Seascape', [], 'sea', 2400, 1600],
  ['Moalboal sardine run', 'Seascape', ['Wildlife'], 'sea', 1800, 2400],
  ['Magellan’s Cross', 'Black and White', ['Street'], 'city', 2400, 1600, true],
  ['Sinulog drummers', 'Street', [], 'dusk', 2400, 1600],
];

(async () => {
  for (const [title, main, extra, palette, w, h, grey] of PHOTOS) {
    const image = await processUpload(await placeholder(w / 2, h / 2, PALETTES[palette], grey).then((b) => sharp(b).resize(w, h).toBuffer()), {
      uploadsDir, credit: `© ${owner.display_name} · Images Camera Club`, watermark: process.env.WATERMARK !== 'off',
    });
    const r = db.prepare(`INSERT INTO photos (owner_id, title, main_category_id, display_key, thumb_key, width, height, bytes, public_ack_at, featured)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
      .run(owner.id, title, catId(main), image.displayKey, image.thumbKey, image.width, image.height, image.bytes, Math.random() < 0.5 ? 1 : 0);
    for (const c of new Set([main, ...extra])) db.prepare('INSERT INTO photo_categories (photo_id, category_id) VALUES (?, ?)').run(r.lastInsertRowid, catId(c));
    process.stdout.write('.');
  }
  console.log(`\nAdded ${PHOTOS.length} placeholder photos in ${CATEGORIES.length} categories (Seascape etc.).`);
  db.close();
})();
