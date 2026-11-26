const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { requireMember, acceptUpload } = require('../lib/security');
const { allCategories } = require('../lib/categories');
const { processUpload, removeFiles, ImageError } = require('../lib/images');
const site = require('../site');
const { parseAperture, parseShutter, parseIso, exposureLine } = require('../lib/exposure');

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const toIds = (v) => [].concat(v ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

const detailsSchema = z.object({
  title: z.string().trim().min(2, 'Please give the photo a title.').max(120, 'Title: at most 120 characters.'),
  caption: z.string().trim().max(1000, 'Caption: at most 1000 characters.').optional().default(''),
  main_category_id: z.coerce.number({ message: 'Please choose a main category.' }).int().positive('Please choose a main category.'),
});

// A member's own photos: upload (with resizing), edit details and categories, delete.
// This becomes part of the member portfolio later.
module.exports = function photoRoutes({ db, config }) {
  const router = express.Router();
  router.use('/account/photos', requireMember);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 40 } });
  const countFor = (userId) => db.prepare('SELECT COUNT(*) FROM photos WHERE owner_id = ?').pluck().get(userId);

  // Checks the categories exist, and always includes the main one.
  function resolveCategories(mainId, extra) {
    const valid = new Set(db.prepare('SELECT id FROM categories').pluck().all());
    if (!valid.has(mainId)) return null;
    return [...new Set([mainId, ...extra.filter((id) => valid.has(id))])];
  }

  function setCategories(photoId, ids) {
    db.prepare('DELETE FROM photo_categories WHERE photo_id = ?').run(photoId);
    const add = db.prepare('INSERT INTO photo_categories (photo_id, category_id) VALUES (?, ?)');
    for (const id of ids) add.run(photoId, id);
  }

  function renderPage(req, res, { status = 200, error = null, values = {} } = {}) {
    const photos = db.prepare(`
      SELECT p.*, c.name AS main_category,
        (SELECT GROUP_CONCAT(pc.category_id) FROM photo_categories pc WHERE pc.photo_id = p.id) AS category_ids
      FROM photos p JOIN categories c ON c.id = p.main_category_id
      WHERE p.owner_id = ? ORDER BY p.created_at DESC, p.id DESC`).all(req.user.id)
      .map((p) => ({ ...p, categoryIds: String(p.category_ids || '').split(',').map(Number), exposure: exposureLine({ ...p, show_exif: 1 }) }));
    res.status(status).render('pages/my-photos', {
      title: 'Your photos',
      photos,
      categories: allCategories(db),
      limit: config.photoLimit,
      watermark: config.watermark,
      error,
      values,
      editId: Number(req.query.edit) || null,
    });
  }

  router.get('/account/photos', (req, res) => renderPage(req, res));

  router.post('/account/photos',
    acceptUpload(upload, 'photo', (req, res, message) => {
      // The form was not read, so only the message can be shown.
      req.flash('error', message);
      res.redirect('/account/photos');
    }),
    async (req, res, next) => {
      const values = { ...req.body, categories: toIds(req.body.categories) };
      const fail = (error) => renderPage(req, res, { status: 400, error, values });
      try {
        if (countFor(req.user.id) >= config.photoLimit) {
          return fail(`You have reached the limit of ${config.photoLimit} photos. Delete one to upload another.`);
        }
        if (!req.file) return fail('Please choose a photo to upload.');
        if (req.body.public_ack !== '1') {
          return fail('Please confirm that you understand the photo will be publicly viewable.');
        }
        const parsed = detailsSchema.safeParse(req.body);
        if (!parsed.success) return fail(parsed.error.issues[0].message);
        const categoryIds = resolveCategories(parsed.data.main_category_id, values.categories);
        if (!categoryIds) return fail('Please choose a main category.');

        const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);
        let image;
        try {
          image = await processUpload(req.file.buffer, {
            uploadsDir: config.uploadsDir,
            credit: `© ${owner.display_name} · ${site.name}`,
            watermark: config.watermark,
          });
        } catch (e) {
          if (e instanceof ImageError) return fail(e.message);
          throw e;
        } finally {
          req.file.buffer = null; // let the original go as soon as possible
        }

        try {
          db.transaction(() => {
            // Checked again here in case two uploads finished at the same time.
            if (countFor(req.user.id) >= config.photoLimit) throw new ImageError(`You have reached the limit of ${config.photoLimit} photos.`);
            const r = db.prepare(`INSERT INTO photos (owner_id, title, caption, main_category_id, display_key, thumb_key, width, height, bytes,
                                    aperture, exposure_time, iso, show_exif, public_ack_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
              .run(req.user.id, parsed.data.title, parsed.data.caption || null, parsed.data.main_category_id,
                image.displayKey, image.thumbKey, image.width, image.height, image.bytes,
                image.aperture, image.exposureTime, image.iso, req.body.show_exif === '1' ? 1 : 0);
            setCategories(r.lastInsertRowid, categoryIds);
          })();
        } catch (e) {
          removeFiles(config.uploadsDir, [image.displayKey, image.thumbKey]);
          if (e instanceof ImageError) return fail(e.message);
          throw e;
        }

        const found = image.aperture || image.exposureTime || image.iso;
        const cameraNote = req.body.show_exif === '1' && !found
          ? ' No camera details were found in the file; you can add them with Edit.'
          : '';
        req.flash('success', `“${parsed.data.title}” is now in the gallery. Remember: it is publicly viewable by anyone visiting the site.${cameraNote}`);
        return res.redirect('/account/photos');
      } catch (e) { return next(e); }
    });

  router.post('/account/photos/:id', (req, res) => {
    const photo = db.prepare('SELECT id FROM photos WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
    if (!photo) return res.redirect('/account/photos');
    const parsed = detailsSchema.safeParse(req.body);
    const ids = parsed.success && resolveCategories(parsed.data.main_category_id, toIds(req.body.categories));
    const aperture = parseAperture(req.body.aperture);
    const shutter = parseShutter(req.body.exposure_time);
    const iso = parseIso(req.body.iso);
    const error = (!parsed.success && parsed.error.issues[0].message) || (!ids && 'Please choose a main category.')
      || aperture.error || shutter.error || iso.error;
    if (error) {
      req.flash('error', error);
      return res.redirect(`/account/photos?edit=${photo.id}`);
    }
    db.transaction(() => {
      db.prepare(`UPDATE photos SET title = ?, caption = ?, main_category_id = ?, aperture = ?, exposure_time = ?, iso = ?, show_exif = ?
                  WHERE id = ?`)
        .run(parsed.data.title, parsed.data.caption || null, parsed.data.main_category_id,
          aperture.value, shutter.value, iso.value, req.body.show_exif === '1' ? 1 : 0, photo.id);
      setCategories(photo.id, ids);
    })();
    req.flash('success', 'The photo has been updated.');
    return res.redirect('/account/photos');
  });

  router.post('/account/photos/:id/delete', (req, res) => {
    const photo = db.prepare('SELECT id, title, display_key, thumb_key FROM photos WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.user.id);
    if (photo) {
      db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
      removeFiles(config.uploadsDir, [photo.display_key, photo.thumb_key]);
      req.flash('success', `“${photo.title}” has been deleted.`);
    }
    res.redirect('/account/photos');
  });

  return router;
};
