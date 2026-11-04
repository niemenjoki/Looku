import { BURST_MS, BURST_PAGES } from "../ingest.js";
import { rollupDay } from "../maintenance.js";

// Two bot rules were added to the receiver (classify.js, ingest.js). This
// applies them once to the page views already stored: rows from a user agent
// with neither a known browser nor a system, and every row of a visitor who
// loaded more than BURST_PAGES pages within BURST_MS. Days that were already
// rolled up are rolled up again. Days that exist only as rollups stay as they are.
export default function removeBots(db) {
  db.exec(`
    CREATE TABLE bot_visitors (
      site_id TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (site_id, visitor_hash)
    );
  `);

  const days = new Map();
  const touch = (siteId, day) => days.set(`${siteId}\n${day}`, { siteId, day });

  for (const row of db
    .prepare("SELECT DISTINCT site_id, day FROM pageviews WHERE browser_family = 'Other' AND os_family = 'Other'")
    .all()) {
    touch(row.site_id, row.day);
  }
  db.prepare("DELETE FROM pageviews WHERE browser_family = 'Other' AND os_family = 'Other'").run();

  const bursts = [];
  let key = null;
  let times = [];
  let found = false;
  const finish = (row) => {
    if (found) {
      bursts.push(row);
    }
  };
  let last = null;
  for (const row of db
    .prepare("SELECT site_id, visitor_hash, day, ts FROM pageviews ORDER BY site_id, visitor_hash, ts")
    .iterate()) {
    const next = `${row.site_id}\n${row.visitor_hash}`;
    if (next !== key) {
      finish(last);
      key = next;
      times = [];
      found = false;
    }
    last = row;
    times.push(Date.parse(row.ts));
    const first = times.length - 1 - BURST_PAGES;
    if (first >= 0 && times[times.length - 1] - times[first] < BURST_MS) {
      found = true;
    }
  }
  finish(last);

  const removePageviews = db.prepare("DELETE FROM pageviews WHERE site_id = ? AND visitor_hash = ? RETURNING day");
  const removeEvents = db.prepare("DELETE FROM events WHERE site_id = ? AND visitor_hash = ?");
  for (const { site_id: siteId, visitor_hash: hash } of bursts) {
    for (const { day } of removePageviews.all(siteId, hash)) {
      touch(siteId, day);
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
