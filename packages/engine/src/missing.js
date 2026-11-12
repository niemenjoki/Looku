import { rollupDay } from "./maintenance.js";

// Missing pages: paths that the site answered with "not found". A page view of
// such a path on the same day is not stored but counted in missing_pages, so
// bots trying addresses and old links do not show up as pages.

export const COUNT_MISSING_SQL = `INSERT INTO missing_pages (site_id, day, path, views) VALUES (?, ?, ?, ?)
  ON CONFLICT (site_id, day, path) DO UPDATE SET views = views + excluded.views`;

// Marks paths as missing on every day in the range on which they were viewed:
// their page views are moved to the missing pages list, and days that were
// already rolled up are rolled up again. The paths are compared as stored,
// that is, as the dashboard shows them. Days whose page views were already
// deleted after the retention period keep their totals.
export function markMissing(db, siteId, paths, { from = "0000-01-01", to = "9999-12-31" } = {}) {
  if (!db.prepare("SELECT 1 FROM sites WHERE site_id = ?").get(siteId)) {
    throw new Error(`Unknown site: ${siteId}`);
  }
  const perDay = db.prepare(
    "SELECT day, COUNT(*) AS n FROM pageviews WHERE site_id = ? AND path = ? AND day BETWEEN ? AND ? GROUP BY day",
  );
  const remove = db.prepare("DELETE FROM pageviews WHERE site_id = ? AND path = ? AND day BETWEEN ? AND ?");
  const count = db.prepare(COUNT_MISSING_SQL);
  const rolled = db.prepare("SELECT 1 FROM daily_totals WHERE site_id = ? AND day = ?");

  return db.transaction(() => {
    const days = new Set();
    const result = { pageviews: 0, paths: [] };
    for (const path of new Set(paths)) {
      const rows = perDay.all(siteId, path, from, to);
      let views = 0;
      for (const { day, n } of rows) {
        count.run(siteId, day, path, n);
        days.add(day);
        views += n;
      }
      remove.run(siteId, path, from, to);
      result.pageviews += views;
      result.paths.push({ path, pageviews: views });
    }
    for (const day of days) {
      if (rolled.get(siteId, day)) {
        rollupDay(db, siteId, day);
      }
    }
    result.days = days.size;
    return result;
  })();
}
