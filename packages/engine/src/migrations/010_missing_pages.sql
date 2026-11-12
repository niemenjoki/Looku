-- Pages that the site answered with "not found" (trackNotFound in the Next.js
-- connector, or `looku pages:missing`). Their page views are not kept with the
-- others: only the number per day is counted here, without visitors.
CREATE TABLE missing_pages (
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day, path)
);
