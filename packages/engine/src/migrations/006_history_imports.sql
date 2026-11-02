-- Files imported with `looku history:import`, so the same file is not imported twice.
CREATE TABLE history_imports (
  site_id TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  PRIMARY KEY (site_id, file_sha256)
);
