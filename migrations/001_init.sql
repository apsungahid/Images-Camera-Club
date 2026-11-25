-- Members, admins. Guests have no account.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  email         TEXT UNIQUE COLLATE NOCASE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  google_id     TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  bio           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Admin-generated join codes (and, with purpose='reset', password reset codes).
CREATE TABLE access_codes (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  for_name    TEXT,                      -- who the invite is meant for (shown to admins)
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE, -- reset codes: whose password
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at     TEXT,
  revoked_at  TEXT
);

CREATE TABLE announcements (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('public', 'members')),
  pinned       INTEGER NOT NULL DEFAULT 0,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  kind        TEXT NOT NULL DEFAULT 'activity', -- photowalk, workshop, meeting, contest, exhibit, activity
  starts_at   TEXT NOT NULL,                    -- local time, 'YYYY-MM-DDTHH:MM'
  ends_at     TEXT,
  visibility  TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('public', 'members')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Members' photographs. Files live in object storage; only keys are stored here.
-- Rights fields are here now so licensing / prints / sales can be added later without rework.
CREATE TABLE photos (
  id             INTEGER PRIMARY KEY,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  caption        TEXT,
  storage_key    TEXT NOT NULL,       -- original (private)
  display_key    TEXT,                -- web-size, watermarked (public)
  thumb_key      TEXT,
  width          INTEGER,
  height         INTEGER,
  taken_at       TEXT,
  camera         TEXT,
  visibility     TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'private')),
  featured       INTEGER NOT NULL DEFAULT 0,
  allow_inquiries INTEGER NOT NULL DEFAULT 0, -- owner agrees guests may ask about rights/prints/purchase
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX photos_owner ON photos(owner_id);
CREATE INDEX events_starts ON events(starts_at);
CREATE INDEX announcements_published ON announcements(published_at);

CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires);
