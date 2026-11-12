import { DIMENSION_COLUMNS, sessionedPageviews } from "./sessions.js";
import { addDays, dayKey, subtractMonths } from "./time.js";

// Page views may arrive up to a day late, so a day is rolled up only when it
// ended over a day ago; until then reports read it from the raw rows. Days
// still in the raw tables are re-rolled for this many days back.
const ROLLUP_DELAY_DAYS = 1;
const REROLL_DAYS = 3;

export function rollupDay(db, siteId, day) {
  const sessioned = sessionedPageviews("p.site_id = ? AND p.day = ?");

  db.transaction(() => {
    for (const table of ["daily_totals", "daily_rollup", "daily_dim_rollup"]) {
      db.prepare(`DELETE FROM ${table} WHERE site_id = ? AND day = ?`).run(
        siteId,
        day,
      );
    }

    db.prepare(
      `INSERT INTO daily_totals (site_id, day, pageviews, visitors, sessions)
       SELECT ?, ?, COUNT(*), COUNT(DISTINCT visitor_hash), COALESCE(SUM(is_entry), 0)
       FROM (${sessioned})`,
    ).run(siteId, day, siteId, day);

    db.prepare(
      `INSERT INTO daily_rollup (site_id, day, path, pageviews, visitors, entries, exits)
       SELECT ?, ?, path, COUNT(*), COUNT(DISTINCT visitor_hash), SUM(is_entry), SUM(is_exit)
       FROM (${sessioned}) GROUP BY path`,
    ).run(siteId, day, siteId, day);

    for (const [dimension, column] of Object.entries(DIMENSION_COLUMNS)) {
      db.prepare(
        `INSERT INTO daily_dim_rollup (site_id, day, dimension, value, pageviews, visitors, entries)
         SELECT ?, ?, ?, ${column}, COUNT(*), COUNT(DISTINCT visitor_hash), SUM(is_entry)
         FROM (${sessioned}) GROUP BY ${column}`,
      ).run(siteId, day, dimension, siteId, day);
    }
  })();
}

// Nightly job: removes old salts, rolls up finished days and deletes raw rows
// older than the site's retention period. Raw rows are deleted only for days
// that have a rollup.
export function runMaintenance(db, now = new Date()) {
  const sites = db.prepare("SELECT * FROM sites").all();
  const report = [];

  for (const site of sites) {
    const today = dayKey(now, site.timezone);

    const saltsDeleted = db
      .prepare("DELETE FROM daily_salt WHERE site_id = ? AND day <> ?")
      .run(site.site_id, today).changes;
    // A visitor hash is valid for one day, and page views may arrive a day late.
    db.prepare("DELETE FROM bot_visitors WHERE site_id = ? AND day < ?").run(
      site.site_id,
      addDays(today, -1),
    );

    const days = db
      .prepare(
        `SELECT DISTINCT day FROM pageviews
         WHERE site_id = ? AND day < ?
           AND (day >= ? OR day NOT IN (SELECT day FROM daily_totals WHERE site_id = ?))
         ORDER BY day`,
      )
      .all(
        site.site_id,
        addDays(today, -ROLLUP_DELAY_DAYS),
        addDays(today, -REROLL_DAYS),
        site.site_id,
      )
      .map((row) => row.day);
    for (const day of days) {
      rollupDay(db, site.site_id, day);
    }

    const cutoff = subtractMonths(today, site.retention_months);
    const deleted = db.transaction(() => {
      const counts = {};
      counts.pageviews = db
        .prepare(
          `DELETE FROM pageviews WHERE site_id = ? AND day < ?
             AND day IN (SELECT day FROM daily_totals WHERE site_id = ?)`,
        )
        .run(site.site_id, cutoff, site.site_id).changes;
      // Orders are the shop's own records without personal data and are kept.
      for (const table of ["events", "engagement", "missing_pages"]) {
        counts[table] = db
          .prepare(`DELETE FROM ${table} WHERE site_id = ? AND day < ?`)
          .run(site.site_id, cutoff).changes;
      }
      return counts;
    })();

    report.push({
      site: site.site_id,
      saltsDeleted,
      daysRolledUp: days.length,
      retentionCutoff: cutoff,
      deleted,
    });
  }

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('last_maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(now.toISOString());
  return report;
}
