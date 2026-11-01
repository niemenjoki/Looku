-- daily-hash: visitors and sessions from the daily visitor hash (default).
-- off: no visitor hash; only page views, referrers and campaigns are counted.
ALTER TABLE sites ADD COLUMN visitors TEXT NOT NULL DEFAULT 'daily-hash'
  CHECK (visitors IN ('daily-hash', 'off'));
