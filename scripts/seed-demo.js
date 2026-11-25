// Local development only: fills an empty database with sample activities and announcements
// so the design can be reviewed. Refuses to run in production.
require('dotenv').config({ quiet: true });
if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo is for local development only.');
  process.exit(1);
}
const { openDatabase } = require('../src/db');
const { nowLocal } = require('../src/lib/format');

const db = openDatabase(process.env.DB_PATH || 'data/club.db');
if (db.prepare('SELECT COUNT(*) FROM events').pluck().get() > 0) {
  console.log('The database already has activities; nothing added.');
  process.exit(0);
}

const day = (offset, time) => {
  const d = new Date(`${nowLocal().slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return `${d.toISOString().slice(0, 10)}T${time}`;
};

const ev = db.prepare('INSERT INTO events (title, description, location, kind, starts_at, ends_at, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)');
ev.run('Sunrise photo walk: Fort San Pedro', 'Meet at the fort entrance. Bring a wide lens and water.\n\nWe walk to Plaza Independencia after sunrise.', 'Fort San Pedro, Cebu City', 'photowalk', day(5, '05:15'), day(5, '08:00'), 'public');
ev.run('Monthly meeting and critique night', 'Bring up to three prints or files for friendly critique.', 'Club venue', 'meeting', day(11, '18:30'), day(11, '21:00'), 'members');
ev.run('Workshop: Off-camera flash basics', 'Hands-on session with one and two speedlights.', 'Studio, Mandaue City', 'workshop', day(19, '13:00'), day(19, '17:00'), 'public');
ev.run('Internal contest: "Streets of Cebu"', 'Submission window opens for members.', 'Online', 'contest', day(26, '09:00'), null, 'members');

const an = db.prepare("INSERT INTO announcements (title, body, visibility, pinned, published_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
an.run('Our new website is live', 'Welcome to the new home of the club online. Members can now sign in to see the full schedule and club news.\n\nThe gallery opens soon.', 'public', 1, '-1 day');
an.run('Dues for the coming year', 'Annual dues are now being collected at monthly meetings. Please see the treasurer.', 'members', 0, '-3 days');
an.run('Call for exhibit entries', 'We are selecting photographs for the year-end exhibit. Details at the next meeting.', 'public', 0, '-6 days');

console.log('Sample activities and announcements added.');
db.close();
