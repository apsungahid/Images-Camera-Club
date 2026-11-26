// Page text that administrators edit in Admin › Page text. No HTML: plain text with a few
// simple marks (see FORMAT_HELP). Every field has built-in text that is used until an
// administrator changes it, and again if they clear the field.

const site = require('../site');
const { escapeHtml } = require('./format');

const FORMAT_HELP = [
  ['**bold**', 'bold'],
  ['*italic*', 'italic'],
  ['[link text](https://…)', 'a link (or a page such as /gallery)'],
  ['## Heading', 'a heading, on its own line'],
  ['- item', 'a list, one item per line'],
  ['blank line', 'starts a new paragraph'],
];

// type: 'line' (one line, *italic* allowed), 'text' (paragraphs), 'rich' (paragraphs, headings, lists, links)
const PAGES = {
  home: {
    name: 'Homepage',
    path: '/',
    fields: [
      { key: 'hero_eyebrow', label: 'Small heading above the title', type: 'line', default: site.fullName },
      { key: 'hero_title', label: 'Main title', type: 'line', hint: 'Words between *asterisks* show in gold italics.', default: 'The island, seen *through our lenses.*' },
      { key: 'hero_text', label: 'Text under the title', type: 'text', default: 'A community of Cebu photographers who walk, shoot, learn and exhibit together. From first cameras to seasoned professionals, we share one habit: looking closely.' },
      { key: 'intro_title', label: '“The club” heading', type: 'line', default: 'Made by photographers, for photographers.' },
      { key: 'intro_text', label: '“The club” text', type: 'text', default: 'We meet to make pictures and to talk about them honestly. Members join photo walks around the island, learn from workshops and critiques, and test themselves in our internal contests and exhibits.' },
      { key: 'pillar1_title', label: 'Column 1 heading', type: 'line', default: 'Photo walks' },
      { key: 'pillar1_text', label: 'Column 1 text', type: 'text', default: 'Early mornings in the old city, coastlines at golden hour, festivals in the streets: we go out and shoot together.' },
      { key: 'pillar2_title', label: 'Column 2 heading', type: 'line', default: 'Workshops & critique' },
      { key: 'pillar2_text', label: 'Column 2 text', type: 'text', default: 'Hands-on sessions on light, composition and editing, and friendly, honest reviews of each other’s work.' },
      { key: 'pillar3_title', label: 'Column 3 heading', type: 'line', default: 'Contests & exhibits' },
      { key: 'pillar3_text', label: 'Column 3 text', type: 'text', default: 'Themed internal contests through the year, and exhibits that bring our members’ best photographs to the public.' },
      { key: 'cta_title', label: 'Membership box heading', type: 'line', default: 'Shoot with us.' },
      { key: 'cta_text', label: 'Membership box text', type: 'text', default: 'Members get the full activity schedule, club announcements and a place to show their work. Already received an invite code from the club?' },
    ],
  },
  about: {
    name: 'About the club',
    path: '/about',
    fields: [
      { key: 'lede', label: 'Text under the title', type: 'text', default: site.tagline },
      {
        key: 'body',
        label: 'Page text',
        type: 'rich',
        hint: 'Keep a heading called “Membership”: the Join pages link to it.',
        default: `## Who we are

The ${site.fullName} brings together photographers from across Cebu: hobbyists, students and working professionals who share a love of making pictures. We learn from each other, shoot together and celebrate our members’ work.

## What we do

Through the year the club organises photo walks, workshops, critique sessions, internal contests and public exhibits. Members see the full schedule and club news on this website once they sign in.

## Membership

New members are welcomed through the club. Once accepted, a club administrator gives you a personal invite code that you use to [create your account](/join).

## Use of photographs

Every photograph on this site remains the property of the member who made it. Please do not download, copy or reuse any image without the photographer’s written permission.`,
      },
    ],
  },
  members: {
    name: 'Members portal',
    path: '/members',
    fields: [
      { key: 'title', label: 'Title', type: 'line', default: 'Members’ portal' },
      { key: 'intro', label: 'Welcome text', type: 'text', default: 'Everything for club members in one place: contest submissions, the members’ schedule and club news.' },
      { key: 'contests_text', label: 'Contests section text', type: 'rich', default: 'Internal contests open here during their submission window. Read each contest’s rules before you submit.' },
      { key: 'no_contests', label: 'Shown when no contest is open', type: 'text', default: 'There is no contest open for submissions right now. Watch the announcements for the next theme.' },
    ],
  },
};

function pageContent(db, page) {
  const def = PAGES[page];
  if (!def) throw new Error(`Unknown page: ${page}`);
  const saved = Object.fromEntries(db.prepare('SELECT key, value FROM page_content WHERE page = ?').all(page).map((r) => [r.key, r.value]));
  return Object.fromEntries(def.fields.map((f) => [f.key, saved[f.key]?.trim() ? saved[f.key] : f.default]));
}

function savePageContent(db, page, values, userId) {
  const def = PAGES[page];
  const upsert = db.prepare(`INSERT INTO page_content (page, key, value, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(page, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`);
  const remove = db.prepare('DELETE FROM page_content WHERE page = ? AND key = ?');
  db.transaction(() => {
    for (const f of def.fields) {
      const v = String(values[f.key] ?? '').replace(/\r\n/g, '\n').trim();
      // Empty, or the same as the built-in text: nothing stored, so it follows the default.
      if (!v || v === f.default) remove.run(page, f.key);
      else upsert.run(page, f.key, v.slice(0, 20000), userId);
    }
  })();
}

// ---- Simple text marks -> safe HTML. Everything is escaped first, so no HTML can get in.

function safeHref(url) {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u) || /^\/(?!\/)/.test(u) || /^#[\w-]+$/.test(u)) return u;
  return null;
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    const external = /^https?:/i.test(href) ? ' rel="noopener" target="_blank"' : '';
    return `<a href="${escapeHtml(href)}"${external}>${label}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

const headingId = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function blocks(text) {
  const out = [];
  for (const chunk of String(text ?? '').replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n');
    const h = chunk.match(/^(#{2,3})\s+(.+)$/);
    if (h && lines.length === 1) {
      const level = h[1].length;
      out.push(`<h${level} id="${headingId(h[2])}">${inline(h[2])}</h${level}>`);
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

module.exports = { PAGES, FORMAT_HELP, pageContent, savePageContent, inline, blocks };
