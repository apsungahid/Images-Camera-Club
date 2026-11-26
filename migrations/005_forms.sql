-- Member forms (contest entries, sign-ups, polls), ported from StickyForms.
-- Only administrators build forms; signed-in members fill them in. Each answer belongs to a member.

CREATE TABLE forms (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  fields          TEXT NOT NULL,              -- JSON array of field definitions (see src/forms/validation.js)
  poster_path     TEXT,                       -- relative to the private forms folder
  poster_type     TEXT,
  poster_updated_at TEXT,
  published       INTEGER NOT NULL DEFAULT 0, -- 0 = draft (admins only), 1 = shown in the members' portal
  locked_at       TEXT,                       -- set = temporarily closed to new answers
  closes_at       TEXT,                       -- optional deadline, Manila local 'YYYY-MM-DDTHH:MM'
  allow_resubmit  INTEGER NOT NULL DEFAULT 0, -- members may edit their answer
  max_per_member  INTEGER NOT NULL DEFAULT 1, -- answers per member; 0 = no limit
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE form_submissions (
  id           INTEGER PRIMARY KEY,
  form_id      INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data         TEXT NOT NULL,                 -- JSON answers keyed by field name
  ip           TEXT,
  user_agent   TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at    TEXT,
  edit_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX form_submissions_form ON form_submissions(form_id);
CREATE INDEX form_submissions_user ON form_submissions(user_id, form_id);

CREATE TABLE form_files (
  id            TEXT PRIMARY KEY,             -- random id, also used in download URLs
  form_id       INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  submission_id INTEGER NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_name    TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path   TEXT NOT NULL,                -- relative to the private forms folder
  mime_type     TEXT,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX form_files_submission ON form_files(submission_id);
