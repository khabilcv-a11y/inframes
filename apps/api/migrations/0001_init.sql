-- InFrame v1 schema (spec section 11). Ids are ULIDs, times ISO-8601 UTC.

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  drive_folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',          -- active | inactive
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organisations(id),        -- NULL for super admin
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mobile TEXT,
  role TEXT NOT NULL,                              -- super_admin | manager | viewer
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'invited',          -- invited | active | suspended
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
  language TEXT NOT NULL DEFAULT 'en',             -- en | ml | hi
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  daily_window TEXT,                               -- JSON {"from":"09:00","to":"18:00"}
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | scheduled | live | paused | ended | archived
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
  kind TEXT NOT NULL,              -- photo_frame | photo_background | video_static | video_animated
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  asset_drive_id TEXT NOT NULL,
  asset_r2_key TEXT NOT NULL,
  overlay_kind TEXT,               -- png | lottie | png_sequence
  photo_window TEXT NOT NULL,      -- JSON {x,y,w,h}
  intro_drive_id TEXT,
  outro_drive_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE text_slots (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  label TEXT NOT NULL,
  input_type TEXT NOT NULL,        -- text | dropdown | fixed
  options TEXT,
  fixed_value TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  box TEXT NOT NULL,               -- JSON {x,y,w,h}
  style TEXT NOT NULL,             -- JSON {font,maxSize,minSize,lines,color,weight,tracking,align,valign,case}
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
  media_type TEXT NOT NULL,        -- photo | video
  slot_values TEXT,
  path TEXT,                       -- A | B | C | photo
  drive_file_id TEXT,
  bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- visit | pick | create | download | share | caption_copy | drive_saved | error
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_campaign_time ON events(campaign_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,            -- e.g. campaign.create, admin.suspend
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_user_time ON audit_log(user_id, created_at);

-- Hourly rollup so dashboards stay fast as events grows (spec section 11).
CREATE TABLE campaign_hourly (
  campaign_id TEXT NOT NULL,
  hour TEXT NOT NULL,              -- ISO hour, e.g. 2026-11-02T09:00:00Z
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, hour, type)
);
