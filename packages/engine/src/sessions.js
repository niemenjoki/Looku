export const SESSION_GAP_MS = 30 * 60 * 1000;

// Page views with session entry and exit flags. A session is the same daily
// visitor hash with at most a 30 minute gap; it is derived here and never
// stored. Sessions never cross a local day, so raw reports and the daily
// rollup always agree. `where` filters the pageviews table and uses
// positional parameters.
export function sessionedPageviews(where) {
  return `
    SELECT p.*,
      CASE WHEN LAG(p.ts) OVER w IS NULL
        OR (julianday(p.ts) - julianday(LAG(p.ts) OVER w)) * 86400000 > ${SESSION_GAP_MS}
        THEN 1 ELSE 0 END AS is_entry,
      CASE WHEN LEAD(p.ts) OVER w IS NULL
        OR (julianday(LEAD(p.ts) OVER w) - julianday(p.ts)) * 86400000 > ${SESSION_GAP_MS}
        THEN 1 ELSE 0 END AS is_exit
    FROM pageviews p
    WHERE ${where}
    WINDOW w AS (PARTITION BY p.site_id, p.day, p.visitor_hash ORDER BY p.ts, p.id)`;
}

// Breakdown dimensions stored in daily_dim_rollup and their source columns.
export const DIMENSION_COLUMNS = {
  referrer: "referrer_host",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  device: "device",
  browser: "browser_family",
  os: "os_family",
  country: "country",
};
