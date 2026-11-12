import assert from "node:assert/strict";
import test from "node:test";

import { createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { markMissing } from "../src/missing.js";
import { MODULES } from "../src/modules/index.js";
import { breakdown, missing, summary } from "../src/modules/perus/reports.js";
import { getSite } from "../src/sites.js";
import { CHROME_UA, IPHONE_UA, setup } from "./helpers.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = { from: "2026-11-04", to: "2026-11-04" };

function send(ingest, db, payload, at = NOW) {
  return ingest(getSite(db, "lieromaa"), { ts: at.toISOString(), ...payload }, at);
}
const view = (ingest, db, path, ip = "203.0.113.1", ua = CHROME_UA) =>
  send(ingest, db, { type: "pageview", path, ip, ua });
const notFound = (ingest, db, path, ua = CHROME_UA) => send(ingest, db, { type: "notfound", path, ua });

test("a page the site answers with not found is counted as missing, not as a page", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  view(ingest, db, "/");
  // The page view first, then the not-found message of the same request.
  view(ingest, db, "/wp-admin");
  assert.deepEqual(notFound(ingest, db, "/wp-admin"), { stored: true });
  // The other order: the not-found message arrives before the page view.
  notFound(ingest, db, "/blog/post/old");
  assert.deepEqual(view(ingest, db, "/blog/post/old", "203.0.113.2", IPHONE_UA), { stored: false, reason: "missing" });
  // Later views of the path that day are counted there too.
  view(ingest, db, "/wp-admin", "203.0.113.3");
  notFound(ingest, db, "/wp-admin");

  assert.deepEqual(db.prepare("SELECT path FROM pageviews").all(), [{ path: "/" }]);
  assert.equal(summary(db, "lieromaa", DAY).pageviews, 1);
  assert.deepEqual(breakdown(db, "lieromaa", "page", DAY).rows.map((row) => row.value), ["/"]);
  assert.deepEqual(missing(db, "lieromaa", DAY).rows, [
    { value: "/wp-admin", pageviews: 2, last_day: "2026-11-04" },
    { value: "/blog/post/old", pageviews: 1, last_day: "2026-11-04" },
  ]);
});

test("a missing path is matched as stored, and only on its own day", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  notFound(ingest, db, "/opas/l%C3%A4mp%C3%B6");
  assert.deepEqual(view(ingest, db, "/opas/lämpö").reason, "missing");
  // The next day the page may exist again.
  const tomorrow = new Date("2026-11-05T12:00:00Z");
  assert.equal(send(ingest, db, { type: "pageview", path: "/opas/lämpö", ip: "203.0.113.1", ua: CHROME_UA }, tomorrow).stored, true);
});

test("a not-found message from a bot or without a path changes nothing", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  view(ingest, db, "/tuotteet");
  assert.deepEqual(notFound(ingest, db, "/tuotteet", "curl/8.0"), { stored: false, reason: "bot" });
  assert.throws(() => send(ingest, db, { type: "notfound" }), /path is required/);
  assert.throws(() => send(ingest, db, { type: "notfound", path: "tuotteet" }), /path is required/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 1);
  assert.deepEqual(missing(db, "lieromaa", DAY).rows, []);
});

test("pages:missing moves stored page views and rolls their days up again", () => {
  const { db } = setup();
  const insert = db.prepare(
    `INSERT INTO pageviews (site_id, ts, day, visitor_hash, path, device, browser_family, os_family, source)
     VALUES ('lieromaa', ?, ?, 'v', ?, 'desktop', 'Chrome', 'Windows', 'server')`,
  );
  for (const [day, path] of [
    ["2026-10-20", "/"],
    ["2026-10-20", "/graphql"],
    ["2026-10-20", "/graphql"],
    ["2026-10-21", "/graphql"],
    ["2026-11-04", "/about"],
  ]) {
    insert.run(`${day}T10:00:00.000Z`, day, path);
  }
  runMaintenance(db, NOW);
  assert.equal(db.prepare("SELECT pageviews FROM daily_totals WHERE day = '2026-10-20'").get().pageviews, 3);

  const result = markMissing(db, "lieromaa", ["/graphql", "/about", "/not-viewed"]);
  assert.deepEqual(result, {
    pageviews: 4,
    days: 3,
    paths: [
      { path: "/graphql", pageviews: 3 },
      { path: "/about", pageviews: 1 },
      { path: "/not-viewed", pageviews: 0 },
    ],
  });
  assert.equal(db.prepare("SELECT pageviews FROM daily_totals WHERE day = '2026-10-20'").get().pageviews, 1);
  assert.equal(db.prepare("SELECT pageviews FROM daily_totals WHERE day = '2026-10-21'").get().pageviews, 0);
  assert.deepEqual(missing(db, "lieromaa", { from: "2026-10-01", to: "2026-11-04" }).rows, [
    { value: "/graphql", pageviews: 3, last_day: "2026-10-21" },
    { value: "/about", pageviews: 1, last_day: "2026-11-04" },
  ]);
  // A range limits the days.
  insert.run("2026-11-04T11:00:00.000Z", "2026-11-04", "/graphql");
  assert.equal(markMissing(db, "lieromaa", ["/graphql"], { from: "2026-11-01" }).pageviews, 1);
  assert.throws(() => markMissing(db, "nosuch", ["/x"]), /Unknown site/);
});

test("missing pages follow the retention period and are a perus report", () => {
  const { db } = setup();
  db.prepare("UPDATE sites SET retention_months = 1").run();
  db.prepare("INSERT INTO missing_pages (site_id, day, path, views) VALUES ('lieromaa', '2026-09-01', '/old', 2)").run();
  db.prepare("INSERT INTO missing_pages (site_id, day, path, views) VALUES ('lieromaa', '2026-11-01', '/new', 1)").run();
  runMaintenance(db, NOW);
  assert.deepEqual(db.prepare("SELECT path FROM missing_pages").all(), [{ path: "/new" }]);

  const site = getSite(db, "lieromaa");
  const rows = MODULES.perus.reports.missing.run(db, site, { from: "2026-11-01", to: "2026-11-04" }, { limit: "1" }, {}).rows;
  assert.deepEqual(rows, [{ value: "/new", pageviews: 1, last_day: "2026-11-01" }]);
});
