CREATE TABLE drive_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  refresh_token_enc TEXT NOT NULL,
  root_folder_id TEXT,
  connected_by TEXT,
  connected_at TEXT NOT NULL
);
ALTER TABLE campaigns ADD COLUMN save_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE outputs ADD COLUMN raw_uploads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outputs ADD COLUMN framed_session_at TEXT;
ALTER TABLE outputs ADD COLUMN raw_drive_ids TEXT;
