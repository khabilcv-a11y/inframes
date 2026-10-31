-- Google Drive saving through a small Apps Script in the owner's own Google account (no Cloud console needed).
-- Needs 0004 as well (per-campaign save mode and upload tracking). Run whichever of 0004 / 0005 you have not run yet.
CREATE TABLE drive_script (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL,
  email TEXT,
  connected_at TEXT NOT NULL
);
