import assert from "node:assert/strict";
import test from "node:test";

import { createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { breakdown, summary, timeseries } from "../src/modules/perus/reports.js";
import { CHROME_UA, IPHONE_UA, setup } from "./helpers.js";

const SITE = { site_id: "lieromaa", timezone: "Europe/Helsinki" };

// Two Helsinki days. Visitor A: two sessions on day 1 (gap over 30 min).
// Visitor B: one session on day 1 from Google. Visitor A again on day 2.
function seed() {
  const context = setup();
  const ingest = createIngest(context.db);
  const view = (iso, path, ip, ua, extra = {}) => {
    const now = new Date(iso);
    ingest(context.site, { type: "pageview", ts: iso, path, ip, ua, ...extra }, now);
  };

  view("2026-11-02T08:00:00Z", "/", "203.0.113.1", CHROME_UA);
  view("2026-11-02T08:05:00Z", "/oppaat/a", "203.0.113.1", CHROME_UA);
  view("2026-11-02T09:00:00Z", "/", "203.0.113.1", CHROME_UA);
  view("2026-11-02T10:00:00Z", "/oppaat/a", "203.0.113.2", IPHONE_UA, {
    referrer: "https://www.google.com/",
    country: "FI",
  });
  view("2026-11-03T08:00:00Z", "/kauppa", "203.0.113.1", CHROME_UA);
  return context;
}

const DAY1 = { from: "2026-11-02", to: "2026-11-02" };
const BOTH = { from: "2026-11-02", to: "2026-11-03" };

test("summary counts page views, daily visitors and 30 minute sessions", () => {
  const { db } = seed();
  assert.deepEqual(
    { ...summary(db, "lieromaa", DAY1), range: undefined },
    { range: undefined, pageviews: 4, visitors: 2, sessions: 3, pages_per_session: 1.33 },
  );
  const both = summary(db, "lieromaa", BOTH, { compare: true });
  assert.equal(both.pageviews, 5);
  assert.equal(both.visitors, 3);
  assert.equal(both.sessions, 4);
  assert.deepEqual(both.previous.range, { from: "2026-10-31", to: "2026-11-01" });
  assert.equal(both.previous.pageviews, 0);
});

test("reports are the same before and after the nightly rollup", () => {
  const { db } = seed();
  const before = {
    summary: summary(db, "lieromaa", BOTH),
    pages: breakdown(db, "lieromaa", "page", BOTH),
    entries: breakdown(db, "lieromaa", "entry", BOTH),
    referrers: breakdown(db, "lieromaa", "referrer", BOTH),
    series: timeseries(db, SITE, BOTH),
  };

  const report = runMaintenance(db, new Date("2026-11-05T06:00:00Z"));
  assert.equal(report[0].daysRolledUp, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_totals").get().n, 2);

  assert.deepEqual(summary(db, "lieromaa", BOTH), before.summary);
  assert.deepEqual(breakdown(db, "lieromaa", "page", BOTH), before.pages);
  assert.deepEqual(breakdown(db, "lieromaa", "entry", BOTH), before.entries);
  assert.deepEqual(breakdown(db, "lieromaa", "referrer", BOTH), before.referrers);
  assert.deepEqual(timeseries(db, SITE, BOTH), before.series);
});

test("breakdowns: pages, entries, exits and dimensions", () => {
  const { db } = seed();
  const pages = breakdown(db, "lieromaa", "page", DAY1).rows.map((r) => ({ ...r }));
  assert.deepEqual(pages, [
    { value: "/", pageviews: 2, visitors: 1, entries: 2, exits: 1 },
    { value: "/oppaat/a", pageviews: 2, visitors: 2, entries: 1, exits: 2 },
  ]);
  assert.deepEqual(
    breakdown(db, "lieromaa", "exit", DAY1).rows.map((r) => r.value),
    ["/oppaat/a", "/"],
  );
  const devices = breakdown(db, "lieromaa", "device", DAY1).rows.map((r) => [r.value, r.pageviews]);
  assert.deepEqual(devices, [["desktop", 3], ["mobile", 1]]);
  const countries = breakdown(db, "lieromaa", "country", DAY1, { limit: 1 }).rows;
  assert.equal(countries.length, 1);
  assert.throws(() => breakdown(db, "lieromaa", "ip", DAY1), /Unknown dimension/);
  assert.throws(() => summary(db, "lieromaa", { from: "2026-11-03", to: "2026-11-02" }));
});

test("weekly and monthly series fill empty days", () => {
  const { db } = seed();
  const weeks = timeseries(db, SITE, { from: "2026-11-01", to: "2026-11-10" }, { interval: "week" });
  assert.deepEqual(
    weeks.points.map((p) => [p.period, p.pageviews]),
    [["2026-10-26", 0], ["2026-11-02", 5], ["2026-11-09", 0]],
  );
  const days = timeseries(db, SITE, { from: "2026-11-01", to: "2026-11-03" });
  assert.deepEqual(days.points.map((p) => p.pageviews), [0, 4, 1]);
});

test("retention deletes raw rows after 25 months but keeps the rollups", () => {
  const { db } = seed();
  runMaintenance(db, new Date("2026-11-05T06:00:00Z"));
  db.prepare(
    "INSERT INTO engagement (site_id, ts, day, path, dwell_ms, max_scroll_pct) VALUES ('lieromaa', '2026-11-02T08:00:00Z', '2026-11-02', '/', 1000, 50)",
  ).run();

  const report = runMaintenance(db, new Date("2028-12-15T06:00:00Z"));
  assert.equal(report[0].retentionCutoff, "2026-11-15");
  assert.equal(report[0].deleted.pageviews, 5);
  assert.equal(report[0].deleted.engagement, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 0);
  assert.equal(summary(db, "lieromaa", BOTH).pageviews, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_salt").get().n, 0);
});
