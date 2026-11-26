-- Which years each person was a club member (people leave and come back).
CREATE TABLE membership_years (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year    INTEGER NOT NULL CHECK (year BETWEEN 1950 AND 2100),
  PRIMARY KEY (user_id, year)
);
CREATE INDEX membership_years_year ON membership_years(year);

-- Extra member details kept by administrators. A person can be on the roster without a
-- website account (no username, password or Google): they simply cannot sign in.
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN admin_notes TEXT;

-- Page text edited by administrators. Missing rows fall back to the built-in text.
CREATE TABLE page_content (
  page       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (page, key)
);
