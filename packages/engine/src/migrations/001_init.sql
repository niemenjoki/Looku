-- Sites that may send data. The signing key is kept as such because the
-- receiver must compute the same HMAC as the site.
CREATE TABLE sites (
  site_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Helsinki',
  signing_key TEXT NOT NULL,
  modules_json TEXT NOT NULL DEFAULT '["perus"]',
  retention_months INTEGER NOT NULL DEFAULT 25,
  created_at TEXT NOT NULL
);

-- Only the current local day's salt per site is kept.
CREATE TABLE daily_salt (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  salt BLOB NOT NULL,
  PRIMARY KEY (site_id, day)
);

-- ts is UTC ISO 8601, day is the site's local day (YYYY-MM-DD).
CREATE TABLE pageviews (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  referrer_path TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser_family TEXT NOT NULL DEFAULT '',
  os_family TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('server', 'client'))
);
CREATE INDEX pageviews_site_day ON pageviews (site_id, day);
CREATE INDEX pageviews_site_visitor_ts ON pageviews (site_id, visitor_hash, ts);

-- Named events from consented visitors. The visitor hash is set only when the
-- site forwards the IP address and user agent with the event.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor_hash TEXT,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  value REAL,
  props_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_site_day ON events (site_id, day);

CREATE TABLE event_items (
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL
);
CREATE INDEX event_items_event ON event_items (event_id);

-- Time on page and scroll from consented visitors, never linked to a visitor.
CREATE TABLE engagement (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  dwell_ms INTEGER NOT NULL,
  max_scroll_pct INTEGER NOT NULL
);
CREATE INDEX engagement_site_day ON engagement (site_id, day);

-- Orders from a shop adapter, without personal data.
CREATE TABLE orders_ext (
  site_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  total REAL NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  utm_campaign TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, external_id)
);

-- Daily rollups stay after the raw rows are deleted.
CREATE TABLE daily_totals (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visitors INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  PRIMARY KEY (site_id, day)
);

CREATE TABLE daily_rollup (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visitors INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  exits INTEGER NOT NULL,
  PRIMARY KEY (site_id, day, path)
);

CREATE TABLE daily_dim_rollup (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  visitors INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  PRIMARY KEY (site_id, day, dimension, value)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
