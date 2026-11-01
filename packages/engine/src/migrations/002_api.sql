-- Read API keys. Only the SHA-256 of the key is stored. A key with a site_id
-- can read that site only; admin keys can also change settings and keys.
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'admin')),
  site_id TEXT REFERENCES sites (site_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_used_day TEXT
);

-- Dashboard settings per site: page groups, module order, language.
ALTER TABLE sites ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
