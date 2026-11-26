-- Gallery categories (managed by administrators) and photos in them.
-- The photos table is rebuilt: it had no data yet, and the site no longer keeps original files
-- (only resized copies), so storage_key is gone and a main category is required.

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TABLE photos;

CREATE TABLE photos (
  id               INTEGER PRIMARY KEY,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  caption          TEXT,
  main_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  display_key      TEXT NOT NULL,     -- web-size copy shown in the lightbox (long edge 1600px)
  thumb_key        TEXT NOT NULL,     -- grid copy (long edge 800px)
  width            INTEGER NOT NULL,  -- of the display copy
  height           INTEGER NOT NULL,
  bytes            INTEGER NOT NULL,  -- both copies together, to watch disk use
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'private')),
  featured         INTEGER NOT NULL DEFAULT 0,
  allow_inquiries  INTEGER NOT NULL DEFAULT 0, -- owner agrees guests may ask about rights/prints/purchase
  public_ack_at    TEXT NOT NULL,     -- when the member confirmed the photo is publicly viewable
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_owner ON photos(owner_id);
CREATE INDEX photos_main_category ON photos(main_category_id);

-- Every category a photo is in, including its main category.
CREATE TABLE photo_categories (
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, category_id)
);
CREATE INDEX photo_categories_category ON photo_categories(category_id);
