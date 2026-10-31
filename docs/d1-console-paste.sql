CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  drive_folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organisations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mobile TEXT,
  role TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'invited',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  short_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  daily_window TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  caption TEXT,
  hashtags TEXT,
  thank_you TEXT,
  cta_url TEXT,
  save_videos_to_drive INTEGER NOT NULL DEFAULT 1,
  drive_folder_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  asset_drive_id TEXT NOT NULL,
  asset_r2_key TEXT NOT NULL,
  overlay_kind TEXT,
  photo_window TEXT NOT NULL,
  intro_drive_id TEXT,
  outro_drive_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE text_slots (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  label TEXT NOT NULL,
  input_type TEXT NOT NULL,
  options TEXT,
  fixed_value TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  box TEXT NOT NULL,
  style TEXT NOT NULL,
  max_chars INTEGER NOT NULL DEFAULT 40,
  video_effect TEXT DEFAULT 'none',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE outputs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  template_id TEXT NOT NULL REFERENCES templates(id),
  serial INTEGER NOT NULL,
  visitor_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  slot_values TEXT,
  path TEXT,
  drive_file_id TEXT,
  bytes INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_campaign_time ON events(campaign_id, created_at);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user_time ON audit_log(user_id, created_at);
CREATE TABLE campaign_hourly (
  campaign_id TEXT NOT NULL,
  hour TEXT NOT NULL,
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, hour, type)
);
