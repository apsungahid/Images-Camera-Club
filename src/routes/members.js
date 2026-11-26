const express = require('express');
const { requireMember } = require('../lib/security');
const { pageContent } = require('../lib/content');
const { nowLocal } = require('../lib/format');
const { formState } = require('../forms/service');

// The members-only portal: open contests and forms, members' schedule and news.
module.exports = function memberPortalRoutes({ db, config }) {
  const router = express.Router();

  router.get('/members', requireMember, (req, res) => {
    const events = db.prepare(`SELECT * FROM events WHERE COALESCE(ends_at, starts_at) >= ?
      ORDER BY starts_at LIMIT 4`).all(nowLocal());
    const announcements = db.prepare(`SELECT id, title, body, visibility, published_at FROM announcements
      ORDER BY pinned DESC, published_at DESC LIMIT 4`).all();
    const photoCount = db.prepare('SELECT COUNT(*) FROM photos WHERE owner_id = ?').pluck().get(req.user.id);
    res.render('pages/members', {
      title: 'Members’ portal',
      c: pageContent(db, 'members'),
      contests: db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id AND s.user_id = ?) AS my_count
        FROM forms f WHERE f.published = 1 ORDER BY (f.closes_at IS NULL), f.closes_at, f.created_at DESC`).all(req.user.id)
        .map((f) => ({ ...f, state: formState(f) }))
        // Closed or locked forms stay listed only for members who took part, so they can see what they sent.
        .filter((f) => f.state === 'open' || f.my_count > 0),
      events,
      announcements,
      photoCount,
      photoLimit: config.photoLimit,
    });
  });

  return router;
};
