-- Event photos: organisers add an event's pictures; people find theirs with a selfie.
-- Face signatures (128 numbers per face) stay on the server; a selfie itself is never uploaded.
CREATE TABLE event_photos (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  faces INTEGER NOT NULL DEFAULT 0,
  embs BLOB,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, name)
);
CREATE INDEX idx_event_photos_campaign ON event_photos(campaign_id);
CREATE TABLE event_photo_files (
  photo_id TEXT NOT NULL REFERENCES event_photos(id),
  kind TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (photo_id, kind)
);
