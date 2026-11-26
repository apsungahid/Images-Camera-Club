const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

// The server is small (shared, 1 GB): one image at a time, no libvips cache.
sharp.concurrency(1);
sharp.cache(false);

const DISPLAY_MAX = 1600; // long edge of the copy guests can see largest
const THUMB_MAX = 800;    // long edge of the grid copy
const MIN_LONG_EDGE = 1000;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'tiff']);

class ImageError extends Error {}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// A small, quiet credit in the corner of the large copy.
function watermarkSvg(width, height, text) {
  const size = Math.max(12, Math.round(width / 85));
  const pad = Math.round(size * 1.2);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <style>text { font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif; font-size: ${size}px; letter-spacing: .04em; }</style>
    <text x="${width - pad + 1}" y="${height - pad + 1}" text-anchor="end" fill="rgba(0,0,0,.35)">${escapeXml(text)}</text>
    <text x="${width - pad}" y="${height - pad}" text-anchor="end" fill="rgba(255,255,255,.62)">${escapeXml(text)}</text>
  </svg>`);
}

// Uploads are processed one after another so two members uploading at once cannot run the
// server out of memory.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/**
 * Turns an uploaded file into the two copies the site serves, and keeps nothing else:
 * - the original never touches the disk;
 * - all metadata (camera serial, GPS location) is removed;
 * - the large copy is limited to 1600px and carries a small credit line.
 */
function processUpload(buffer, { uploadsDir, credit, watermark = true }) {
  return enqueue(async () => {
    let meta;
    try {
      meta = await sharp(buffer, { limitInputPixels: 120e6 }).metadata();
    } catch {
      throw new ImageError('That file is not an image we can read. Please upload a JPEG, PNG or WebP file.');
    }
    if (!ACCEPTED.has(meta.format)) {
      throw new ImageError('Please upload a JPEG, PNG or WebP file. (HEIC photos from iPhones: export or share them as JPEG first.)');
    }
    const rotated = (meta.orientation || 1) >= 5;
    const w = rotated ? meta.height : meta.width;
    const h = rotated ? meta.width : meta.height;
    if (Math.max(w, h) < MIN_LONG_EDGE) {
      throw new ImageError(`The photo is too small (${w}×${h}). Please upload one at least ${MIN_LONG_EDGE}px on its longest side.`);
    }

    const dir = path.join(uploadsDir, 'photos');
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    const displayKey = `photos/${id}.webp`;
    const thumbKey = `photos/${id}-t.webp`;

    const base = () => sharp(buffer, { limitInputPixels: 120e6 }).rotate();

    const display = await base()
      .resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    let displayPipeline = sharp(display.data);
    if (watermark && credit) {
      displayPipeline = displayPipeline.composite([{ input: watermarkSvg(display.info.width, display.info.height, credit) }]);
    }
    const displayInfo = await displayPipeline.webp({ quality: 82 }).toFile(path.join(uploadsDir, displayKey));

    const thumbInfo = await base()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(path.join(uploadsDir, thumbKey));

    return {
      displayKey,
      thumbKey,
      width: displayInfo.width,
      height: displayInfo.height,
      bytes: displayInfo.size + thumbInfo.size,
    };
  });
}

function removeFiles(uploadsDir, keys) {
  for (const key of keys) {
    if (!key || key.includes('..')) continue;
    fs.rm(path.join(uploadsDir, key), { force: true }, () => {});
  }
}

module.exports = { processUpload, removeFiles, ImageError, DISPLAY_MAX, THUMB_MAX, MIN_LONG_EDGE };
