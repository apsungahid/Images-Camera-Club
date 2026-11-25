const express = require('express');
const { nowLocal } = require('../lib/format');

// Guests see 'public' items; signed-in members also see 'members' items.
const visibleTo = (req) => (req.user ? ['public', 'members'] : ['public']);
const inList = (arr) => arr.map(() => '?').join(', ');

module.exports = function publicRoutes({ db }) {
  const router = express.Router();

  const upcomingEvents = (vis, limit) => db.prepare(
    `SELECT * FROM events WHERE visibility IN (${inList(vis)}) AND COALESCE(ends_at, starts_at) >= ?
     ORDER BY starts_at LIMIT ?`).all(...vis, nowLocal(), limit);

  const latestAnnouncements = (vis, limit) => db.prepare(
    `SELECT a.*, u.display_name AS author FROM announcements a LEFT JOIN users u ON u.id = a.author_id
     WHERE a.visibility IN (${inList(vis)}) ORDER BY a.pinned DESC, a.published_at DESC LIMIT ?`).all(...vis, limit);

  const photoQuery = (vis, where, limit) => db.prepare(
    `SELECT p.*, u.display_name AS photographer FROM photos p JOIN users u ON u.id = p.owner_id
     WHERE p.visibility IN (${inList(vis)}) AND u.status = 'active' ${where}
     ORDER BY p.created_at DESC LIMIT ?`).all(...vis, limit);

  router.get('/', (req, res) => {
    const vis = visibleTo(req);
    res.render('pages/home', {
      title: null,
      bodyClass: 'home',
      featured: photoQuery(vis, 'AND p.featured = 1', 9),
      events: upcomingEvents(vis, 3),
      announcements: latestAnnouncements(vis, 3),
      memberCount: db.prepare("SELECT COUNT(*) FROM users WHERE status = 'active'").pluck().get(),
    });
  });

  router.get('/gallery', (req, res) => {
    res.render('pages/gallery', { title: 'Gallery', photos: photoQuery(visibleTo(req), '', 200) });
  });

  router.get('/about', (req, res) => res.render('pages/about', { title: 'About the club' }));

  router.get('/events', (req, res) => {
    const vis = visibleTo(req);
    const past = db.prepare(
      `SELECT * FROM events WHERE visibility IN (${inList(vis)}) AND COALESCE(ends_at, starts_at) < ?
       ORDER BY starts_at DESC LIMIT 12`).all(...vis, nowLocal());
    res.render('pages/events', { title: 'Activities', upcoming: upcomingEvents(vis, 100), past });
  });

  router.get('/announcements', (req, res) => {
    res.render('pages/announcements', { title: 'Announcements', announcements: latestAnnouncements(visibleTo(req), 50) });
  });

  router.get('/announcements/:id', (req, res, next) => {
    const vis = visibleTo(req);
    const item = db.prepare(
      `SELECT a.*, u.display_name AS author FROM announcements a LEFT JOIN users u ON u.id = a.author_id
       WHERE a.id = ? AND a.visibility IN (${inList(vis)})`).get(Number(req.params.id), ...vis);
    if (!item) return next();
    return res.render('pages/announcement', { title: item.title, item });
  });

  return router;
};
