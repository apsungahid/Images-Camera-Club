// Shared form logic for the admin builder and the members' fill page.
const { parseJson } = require('./results');
const { nowLocal } = require('../lib/format');

// draft | open | locked | closed (deadline passed)
function formState(row) {
  if (!row.published) return 'draft';
  if (row.locked_at) return 'locked';
  if (row.closes_at && row.closes_at <= nowLocal()) return 'closed';
  return 'open';
}

const STATE_MESSAGES = {
  draft: 'This form is not available.',
  locked: 'This form is temporarily closed and is not accepting answers right now. Please try again later.',
  closed: 'This form has closed and no longer accepts answers.',
};

function serializeForm(row, extra = {}) {
  const v = encodeURIComponent(row.poster_updated_at || '');
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    fields: parseJson(row.fields, []),
    published: Boolean(row.published),
    locked: Boolean(row.locked_at),
    lockedAt: row.locked_at,
    closesAt: row.closes_at,
    state: formState(row),
    allowResubmit: Boolean(row.allow_resubmit),
    maxPerMember: row.max_per_member,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    posterUrl: row.poster_path ? `/admin/forms/api/${row.id}/poster?v=${v}` : null,
    ...extra,
  };
}

function loadSubmissions(db, formId, order = 'DESC') {
  return db.prepare(`
    SELECT s.*, u.display_name AS member_name, COALESCE(u.username, u.email) AS member_login
    FROM form_submissions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.form_id = ? ORDER BY s.submitted_at ${order === 'ASC' ? 'ASC' : 'DESC'}, s.id ${order === 'ASC' ? 'ASC' : 'DESC'}`).all(formId)
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      memberName: r.member_name,
      memberLogin: r.member_login,
      data: parseJson(r.data, {}),
      submittedAt: r.submitted_at,
      editedAt: r.edited_at,
      editCount: r.edit_count || 0,
    }));
}

module.exports = { formState, STATE_MESSAGES, serializeForm, loadSubmissions };
