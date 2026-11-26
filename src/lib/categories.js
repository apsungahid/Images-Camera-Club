// Gallery category queries shared by the public gallery, member uploads and admin pages.

function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'category';
}

function uniqueSlug(db, name, exceptId = 0) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM categories WHERE slug = ? AND id != ?').get(slug, exceptId); i += 1) slug = `${base}-${i}`;
  return slug;
}

function allCategories(db) {
  return db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE').all();
}

const visibleWhere = (vis) => `p.visibility IN (${vis.map(() => '?').join(', ')}) AND u.status = 'active'`;

/**
 * Catalogues for the gallery: only categories that have at least one photo the viewer may see,
 * alphabetical, each with a random cover photo (a new pick on every page load).
 */
function catalogues(db, vis) {
  return db.prepare(`
    SELECT c.id, c.name, c.slug, c.description, COUNT(*) AS photo_count,
      (SELECT p2.display_key FROM photo_categories pc2
         JOIN photos p2 ON p2.id = pc2.photo_id JOIN users u2 ON u2.id = p2.owner_id
        WHERE pc2.category_id = c.id AND p2.visibility IN (${vis.map(() => '?').join(', ')}) AND u2.status = 'active'
        ORDER BY RANDOM() LIMIT 1) AS cover_key
    FROM categories c
    JOIN photo_categories pc ON pc.category_id = c.id
    JOIN photos p ON p.id = pc.photo_id
    JOIN users u ON u.id = p.owner_id
    WHERE ${visibleWhere(vis)}
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE`).all(...vis, ...vis);
}

function photosInCategory(db, categoryId, vis) {
  return db.prepare(`
    SELECT p.id, p.title, p.caption, p.display_key, p.thumb_key, p.width, p.height, u.display_name AS photographer
    FROM photo_categories pc
    JOIN photos p ON p.id = pc.photo_id
    JOIN users u ON u.id = p.owner_id
    WHERE pc.category_id = ? AND ${visibleWhere(vis)}
    ORDER BY p.created_at DESC, p.id DESC`).all(categoryId, ...vis);
}

module.exports = { slugify, uniqueSlug, allCategories, catalogues, photosInCategory };
