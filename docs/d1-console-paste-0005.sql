CREATE TABLE drive_script (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL,
  email TEXT,
  connected_at TEXT NOT NULL
);
