-- Frames are stored in D1 for now (re-encoded in the browser to under 1.5 MB), so no R2/Drive setup is needed.
-- Move to R2/Drive later without changing the API. No template rows exist yet, so the table is rebuilt.
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);

DROP TABLE templates;
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo_frame',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  photo_window TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_templates_campaign ON templates(campaign_id);
CREATE INDEX idx_slots_template ON text_slots(template_id);
CREATE INDEX idx_outputs_campaign ON outputs(campaign_id, created_at);
