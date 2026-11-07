import { FAST_BURST_MS, FAST_BURST_PAGES } from "../ingest.js";
import { rollupDay } from "../maintenance.js";

// The receiver got a second burst rule (ingest.js): a visitor who loads more
// than FAST_BURST_PAGES pages within FAST_BURST_MS is a crawler. This applies
// it once to the page views already stored, as 008 did with the first rule:
// the visitor's page views and events are removed, and days that were already
// rolled up are rolled up again. Days that exist only as rollups stay as they are.
export default function removeFastBursts(db) {
  const bots = db
    .prepare(
      `SELECT DISTINCT site_id, visitor_hash FROM (
         SELECT site_id, visitor_hash, ts, LAG(ts, ${FAST_BURST_PAGES}) OVER w AS earlier
         FROM pageviews
         WINDOW w AS (PARTITION BY site_id, visitor_hash ORDER BY ts, id))
       WHERE earlier IS NOT NULL AND (julianday(ts) - julianday(earlier)) * 86400000 < ?`,
    )
    .all(FAST_BURST_MS);

  const days = new Map();
  const removePageviews = db.prepare("DELETE FROM pageviews WHERE site_id = ? AND visitor_hash = ? RETURNING day");
  const removeEvents = db.prepare("DELETE FROM events WHERE site_id = ? AND visitor_hash = ?");
  for (const { site_id: siteId, visitor_hash: hash } of bots) {
    for (const { day } of removePageviews.all(siteId, hash)) {
      days.set(`${siteId}\n${day}`, { siteId, day });
    }
    removeEvents.run(siteId, hash);
  }

  const rolled = db.prepare("SELECT 1 FROM daily_totals WHERE site_id = ? AND day = ?");
  for (const { siteId, day } of days.values()) {
    if (rolled.get(siteId, day)) {
      rollupDay(db, siteId, day);
    }
  }
}
