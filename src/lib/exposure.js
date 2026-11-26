// Camera settings: reading them from EXIF, showing them, and reading what a member types.
const exifReader = require('exif-reader');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Aperture, shutter speed and ISO from a raw EXIF block (as sharp's metadata().exif gives it). */
function readExposure(exifBuffer) {
  const empty = { aperture: null, exposureTime: null, iso: null };
  if (!exifBuffer) return empty;
  let data;
  try { data = exifReader(exifBuffer); } catch { return empty; }
  const photo = data.Photo || data.exif || {};
  let iso = photo.ISOSpeedRatings ?? photo.PhotographicSensitivity ?? photo.ISO;
  if (Array.isArray(iso)) [iso] = iso;
  let aperture = num(photo.FNumber);
  // Some cameras only record the APEX value: f-number = 2^(Av/2).
  if (!aperture && num(photo.ApertureValue)) aperture = Math.round(2 ** (photo.ApertureValue / 2) * 10) / 10;
  return {
    aperture: aperture ? Math.round(aperture * 10) / 10 : null,
    exposureTime: num(photo.ExposureTime),
    iso: num(iso) ? Math.round(iso) : null,
  };
}

function formatAperture(f) {
  return f ? `f/${Number.isInteger(f) ? f : f.toFixed(1)}` : null;
}

// 0.004 -> "1/250s", 0.5 -> "1/2s", 2 -> "2s", 1.3 -> "1.3s"
function formatShutter(t) {
  if (!t) return null;
  if (t >= 0.3) return `${Math.round(t * 10) / 10}s`;
  return `1/${Math.round(1 / t)}s`;
}

function formatIso(iso) {
  return iso ? `ISO ${iso}` : null;
}

/** "f/2.8 · 1/250s · ISO 400", or '' if the member hid them or none are known. */
function exposureLine(photo) {
  if (!photo.show_exif) return '';
  return [formatAperture(photo.aperture), formatShutter(photo.exposure_time), formatIso(photo.iso)].filter(Boolean).join(' · ');
}

// What members type in the edit form. Blank means unknown; nonsense is refused.
function parseAperture(input) {
  const s = String(input ?? '').trim().replace(/^f\s*\/?\s*/i, '');
  if (!s) return { value: null };
  const v = Number(s);
  return v >= 0.5 && v <= 128 ? { value: Math.round(v * 10) / 10 } : { error: 'Aperture: a number such as 2.8 or f/8.' };
}

function parseShutter(input) {
  const s = String(input ?? '').trim().replace(/\s*(s|sec|seconds?)$/i, '').replace(/"$/, '');
  if (!s) return { value: null };
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const v = frac ? Number(frac[1]) / Number(frac[2]) : Number(s);
  return v > 0 && v <= 3600 ? { value: v } : { error: 'Shutter speed: a value such as 1/250 or 2 (seconds).' };
}

function parseIso(input) {
  const s = String(input ?? '').trim().replace(/^iso\s*/i, '');
  if (!s) return { value: null };
  const v = Number(s);
  return Number.isInteger(v) && v >= 1 && v <= 10000000 ? { value: v } : { error: 'ISO: a whole number such as 400.' };
}

module.exports = {
  readExposure, exposureLine, formatAperture, formatShutter, formatIso, parseAperture, parseShutter, parseIso,
};
