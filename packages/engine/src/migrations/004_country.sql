-- 0 = the country is not stored for the site (e.g. when its privacy notice says so).
ALTER TABLE sites ADD COLUMN store_country INTEGER NOT NULL DEFAULT 1;
