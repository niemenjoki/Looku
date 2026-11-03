import assert from "node:assert/strict";
import test from "node:test";

import { resolveRange, timeWindow, validateConfig } from "../src/api/params.js";
import { decodePath, normalizePath } from "../src/classify.js";
import { migrate } from "../src/db.js";
import { createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { summary as shopSummary } from "../src/modules/shop/reports.js";
import { breakdown, summary, timeseries } from "../src/modules/perus/reports.js";
import { createOrderIngest } from "../src/orders.js";
import { getSite, setModules } from "../src/sites.js";
import { CHROME_UA, setup } from "./helpers.js";

const NOW = new Date("2026-11-03T12:00:00Z");
const ENCODED = "/opas/l%C3%A4mp%C3%B6";
const DECODED = "/opas/lämpö";

function view(ingest, db, path, at, ip = "203.0.113.1") {
  ingest(getSite(db, "lieromaa"), { type: "pageview", ts: at.toISOString(), path, ip, ua: CHROME_UA }, at);
}

test("paths are stored decoded, reserved and invalid encodings stay as they are", () => {
  assert.equal(normalizePath(ENCODED), DECODED);
  assert.equal(normalizePath(DECODED), DECODED);
  assert.equal(normalizePath("/a%2Fb?x=1"), "/a%2Fb");
  assert.equal(decodePath("/bad%E0%A4%A"), "/bad%E0%A4%A");
  assert.equal(decodePath("/line%0Abreak"), "/line%0Abreak");

  const { db } = setup();
  const ingest = createIngest(db);
  view(ingest, db, ENCODED, NOW);
  view(ingest, db, DECODED, NOW, "203.0.113.2");
  const rows = breakdown(db, "lieromaa", "page", { from: "2026-11-03", to: "2026-11-03" }).rows;
  assert.deepEqual(rows.map((row) => [row.value, row.pageviews]), [[DECODED, 2]]);
  assert.equal(validateConfig({ page_groups: [{ name: "Oppaat", prefix: "/opas/l%C3%A4" }] }).page_groups[0].prefix, "/opas/lä");
});

test("the migration decodes old rows, rolls up kept days again and merges older rollups", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  // A rolled-up day that still has its raw rows: one page view in each form.
  const day = new Date("2026-10-20T10:00:00Z");
  view(ingest, db, DECODED, day);
  view(ingest, db, DECODED, new Date(day.getTime() + 60000), "203.0.113.2");
  db.prepare("UPDATE pageviews SET path = ? WHERE id = (SELECT MIN(id) FROM pageviews)").run(ENCODED);
  runMaintenance(db, NOW);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_rollup WHERE day = '2026-10-20'").get().n, 2);
  // An old day that exists only as rollups.
  const insert = db.prepare(
    "INSERT INTO daily_rollup (site_id, day, path, pageviews, visitors, entries, exits) VALUES ('lieromaa', '2024-01-05', ?, ?, 1, 1, 1)",
  );
  insert.run(ENCODED, 3);
  insert.run(DECODED, 4);
  db.prepare("UPDATE sites SET config_json = ? WHERE site_id = 'lieromaa'").run(
    JSON.stringify({ page_groups: [{ name: "Oppaat", prefix: "/opas/l%C3%A4" }], shop: { cart_path: "/ostoskori%C3%A4" } }),
  );

  db.prepare("DELETE FROM schema_migrations WHERE name = '007_decoded_paths.js'").run();
  migrate(db);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews WHERE path = ?").get(DECODED).n, 2);
  const kept = db.prepare("SELECT path, pageviews, visitors FROM daily_rollup WHERE day = '2026-10-20'").all();
  assert.deepEqual(kept, [{ path: DECODED, pageviews: 2, visitors: 2 }]);
  const old = db.prepare("SELECT path, pageviews, visitors FROM daily_rollup WHERE day = '2024-01-05'").all();
  assert.deepEqual(old, [{ path: DECODED, pageviews: 7, visitors: 2 }]);
  const config = JSON.parse(getSite(db, "lieromaa").config_json);
  assert.equal(config.page_groups[0].prefix, "/opas/lä");
  assert.equal(config.shop.cart_path, "/ostoskoriä");
});

test("range 24h covers the last 24 hours and compares with the 24 hours before", () => {
  const { db } = setup();
  setModules(db, "lieromaa", ["shop"]);
  const ingest = createIngest(db);
  const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);
  view(ingest, db, "/a", hoursAgo(30));
  view(ingest, db, "/b", hoursAgo(23), "203.0.113.2");
  view(ingest, db, "/c", hoursAgo(1), "203.0.113.3");
  const order = createOrderIngest(db);
  order(getSite(db, "lieromaa"), { id: "1", ts: hoursAgo(2).toISOString(), total: 10 }, hoursAgo(2));
  order(getSite(db, "lieromaa"), { id: "2", ts: hoursAgo(26).toISOString(), total: 20 }, hoursAgo(26));

  const range = resolveRange({ range: "24h" }, "Europe/Helsinki", NOW);
  assert.deepEqual(range, {
    from: "2026-11-02",
    to: "2026-11-03",
    since: "2026-11-02T12:00:00.000Z",
    until: "2026-11-03T12:00:00.000Z",
  });

  const result = summary(db, "lieromaa", range, { compare: true });
  assert.equal(result.pageviews, 2);
  assert.equal(result.previous.pageviews, 1);
  assert.equal(result.previous.range.since, "2026-11-01T12:00:00.000Z");

  const series = timeseries(db, getSite(db, "lieromaa"), range, { interval: "hour" });
  assert.equal(series.points.length, 24);
  assert.equal(series.points.reduce((sum, point) => sum + point.pageviews, 0), 2);

  assert.deepEqual(breakdown(db, "lieromaa", "page", range).rows.map((row) => row.value), ["/b", "/c"]);
  const shop = shopSummary(db, "lieromaa", range, { compare: true });
  assert.equal(shop.orders, 1);
  assert.equal(shop.previous.orders, 1);

  assert.throws(() => timeWindow("2026-11-03T12:00:00Z", "2026-11-01T12:00:00Z", "UTC"), /since < until/);
  assert.throws(() => timeWindow("2026-09-01T00:00:00Z", "2026-11-01T00:00:00Z", "UTC"), /31 days/);
  assert.equal(resolveRange({ since: "2026-11-01T00:00:00Z", until: "2026-11-02T00:00:00Z" }, "UTC").from, "2026-11-01");
});
