// Display helpers available in every view. The club is in Cebu (Asia/Manila, UTC+8, no DST).
const TZ = 'Asia/Manila';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Plain text with blank-line paragraphs and single-line breaks -> safe HTML.
function paragraphs(text) {
  return String(text ?? '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

// Event times are stored as Manila local time 'YYYY-MM-DDTHH:MM'.
function localToDate(local) {
  return new Date(`${local}:00+08:00`);
}

// SQLite datetime('now') values are UTC 'YYYY-MM-DD HH:MM:SS'.
function utcToDate(utc) {
  return new Date(`${String(utc).replace(' ', 'T')}Z`);
}

function nowLocal() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
}

const fmt = (opts) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, ...opts });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const monthFmt = fmt({ month: 'short' });
const dateNumFmt = fmt({ day: 'numeric' });
const longDateFmt = fmt({ day: 'numeric', month: 'long', year: 'numeric' });

module.exports = {
  escapeHtml,
  paragraphs,
  nowLocal,
  eventDay: (local) => dayFmt.format(localToDate(local)),
  eventTime: (local) => timeFmt.format(localToDate(local)),
  eventMonth: (local) => monthFmt.format(localToDate(local)),
  eventDate: (local) => dateNumFmt.format(localToDate(local)),
  postedOn: (utc) => longDateFmt.format(utcToDate(utc)),
};
