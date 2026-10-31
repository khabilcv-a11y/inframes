CREATE TABLE images (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE organisations ADD COLUMN logo_image_id TEXT;
ALTER TABLE campaigns ADD COLUMN logo_image_id TEXT;
