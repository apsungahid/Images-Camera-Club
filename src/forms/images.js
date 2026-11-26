// Ported from StickyForms (src/images.js). Image types that are safe to show inside the page (thumbnails / previews).
// SVG is deliberately missing: it can carry scripts, so it is always downloaded instead.
const path = require('path');

const INLINE_IMAGES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

const inlineImageType = (fileName) => INLINE_IMAGES[path.extname(String(fileName || '')).toLowerCase()] || null;

module.exports = { INLINE_IMAGES, inlineImageType };
