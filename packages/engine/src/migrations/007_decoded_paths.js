import { decodePath } from "../classify.js";
import { rollupDay } from "../maintenance.js";

// Paths were stored as the browser sent them, so "/opas/l%C3%A4mp%C3%B6" and
// "/opas/lämpö" were two pages. New paths are stored decoded (classify.js);
// this turns the old rows into the same form. Days whose raw page views are
// still kept are rolled up again; older days, which exist only as rollups,
// are merged by adding their totals.
export default function decodeStoredPaths(db) {
  db.function("looku_decode_path", { deterministic: true }, (value) => decodePath(value));
  const encoded = "LIKE '%\\%%' ESCAPE '\\'";

  const rolledDays = db
    .prepare(
      `SELECT DISTINCT p.site_id, p.day FROM pageviews p
       JOIN daily_totals d ON d.site_id = p.site_id AND d.day = p.day
       WHERE p.path ${encoded} AND looku_decode_path(p.path) <> p.path`,
    )
    .all();

  db.exec(`
    UPDATE pageviews SET path = looku_decode_path(path) WHERE path ${encoded};
    UPDATE pageviews SET referrer_path = looku_decode_path(referrer_path) WHERE referrer_path ${encoded};
    UPDATE events SET path = looku_decode_path(path) WHERE path ${encoded};
    UPDATE engagement SET path = looku_decode_path(path) WHERE path ${encoded};
  `);

  for (const { site_id: siteId, day } of rolledDays) {
    rollupDay(db, siteId, day);
  }

  // Rollups of days without raw rows. Visitors are added up too, which can
  // count a visitor who saw both forms of the page twice on that day.
  db.exec(`
    CREATE TEMP TABLE decoded_rollup AS
      SELECT site_id, day, looku_decode_path(path) AS path, SUM(pageviews) AS pageviews,
             SUM(visitors) AS visitors, SUM(entries) AS entries, SUM(exits) AS exits
      FROM daily_rollup WHERE path ${encoded} AND looku_decode_path(path) <> path
      GROUP BY site_id, day, looku_decode_path(path);
    DELETE FROM daily_rollup WHERE path ${encoded} AND looku_decode_path(path) <> path;
    INSERT INTO daily_rollup (site_id, day, path, pageviews, visitors, entries, exits)
      SELECT site_id, day, path, pageviews, visitors, entries, exits FROM decoded_rollup WHERE true
      ON CONFLICT (site_id, day, path) DO UPDATE SET
        pageviews = pageviews + excluded.pageviews,
        visitors = visitors + excluded.visitors,
        entries = entries + excluded.entries,
        exits = exits + excluded.exits;
    DROP TABLE decoded_rollup;
  `);

  // Page group prefixes and shop paths in the dashboard settings.
  const sites = db.prepare("SELECT site_id, config_json FROM sites").all();
  const save = db.prepare("UPDATE sites SET config_json = ? WHERE site_id = ?");
  for (const { site_id: siteId, config_json: json } of sites) {
    let config;
    try {
      config = JSON.parse(json || "{}");
    } catch {
      continue;
    }
    if (Array.isArray(config.page_groups)) {
      config.page_groups = config.page_groups.map((group) =>
        typeof group?.prefix === "string" ? { ...group, prefix: decodePath(group.prefix) } : group,
      );
    }
    if (config.shop && typeof config.shop === "object") {
      for (const key of Object.keys(config.shop)) {
        if (typeof config.shop[key] === "string") {
          config.shop[key] = decodePath(config.shop[key]);
        }
      }
    }
    save.run(JSON.stringify(config), siteId);
  }
}
