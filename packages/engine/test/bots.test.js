import assert from "node:assert/strict";
import test from "node:test";

import { isBot } from "../src/classify.js";
import { migrate } from "../src/db.js";
import { BURST_PAGES, createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { summary } from "../src/modules/perus/reports.js";
import { getSite } from "../src/sites.js";
import { CHROME_UA, IPHONE_UA, setup } from "./helpers.js";

const NOW = new Date("2026-11-04T12:00:00Z");

function view(ingest, db, { at = NOW, ip = "203.0.113.1", ua = CHROME_UA, path = "/" } = {}) {
  return ingest(getSite(db, "lieromaa"), { type: "pageview", ts: at.toISOString(), path, ip, ua }, at);
}

const seconds = (s) => new Date(NOW.getTime() + s * 1000);

test("a user agent with neither a known browser nor a system is a bot", () => {
  assert.equal(isBot("Mozilla/5.0"), true);
  assert.equal(isBot("Mozilla/5.0 (compatible) AppleWebKit/537.36 (KHTML, like Gecko)"), true);
  assert.equal(isBot(CHROME_UA), false);
  assert.equal(isBot(IPHONE_UA), false);
  // A browser on an unknown system, or a known system in an app, is still counted.
  assert.equal(isBot("Mozilla/5.0 (X11; FreeBSD amd64; rv:120.0) Gecko/20100101 Firefox/120.0"), false);
  assert.equal(isBot("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36"), false);
});

test("a burst of page views removes the visitor's day and stops further rows", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  // A person reading a few pages, and a reader as fast as the burst limit allows.
  view(ingest, db, { ip: "203.0.113.9", ua: IPHONE_UA });
  for (let i = 0; i < BURST_PAGES; i += 1) {
    assert.equal(view(ingest, db, { at: seconds(i * 6.5) }).stored, true);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, BURST_PAGES + 1);

  // The next one inside two minutes of the earliest of the last 20 is too many.
  for (let i = 0; i < BURST_PAGES; i += 1) {
    view(ingest, db, { ip: "198.51.100.7", at: seconds(i) });
  }
  assert.deepEqual(view(ingest, db, { ip: "198.51.100.7", at: seconds(BURST_PAGES) }), { stored: false, reason: "bot" });
  assert.deepEqual(view(ingest, db, { ip: "198.51.100.7", at: seconds(600) }), { stored: false, reason: "bot" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, BURST_PAGES + 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bot_visitors").get().n, 1);
  assert.equal(summary(db, "lieromaa", { from: "2026-11-04", to: "2026-11-04" }).visitors, 2);

  // The mark lasts only as long as the visitor hash.
  runMaintenance(db, new Date("2026-11-06T12:00:00Z"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bot_visitors").get().n, 0);
});

test("migration 008 removes stored bots and rolls their days up again", () => {
  const { db } = setup();
  const ingest = createIngest(db);
  const day = new Date("2026-10-20T10:00:00Z");
  const at = (s) => new Date(day.getTime() + s * 1000);
  view(ingest, db, { at: day, ip: "203.0.113.9", ua: IPHONE_UA });
  // Rows from before the rules: a burst and an unknown user agent, stored as they were.
  const insert = db.prepare(
    `INSERT INTO pageviews (site_id, ts, day, visitor_hash, path, device, browser_family, os_family, source)
     VALUES ('lieromaa', ?, '2026-10-20', ?, '/', 'desktop', ?, ?, 'server')`,
  );
  for (let i = 0; i < 25; i += 1) {
    insert.run(at(200 + i).toISOString(), "burst", "Chrome", "Android");
  }
  insert.run(at(400).toISOString(), "unknown", "Other", "Other");
  insert.run(at(500).toISOString(), "slow", "Chrome", "Windows");
  runMaintenance(db, NOW);
  assert.equal(db.prepare("SELECT pageviews FROM daily_totals WHERE day = '2026-10-20'").get().pageviews, 28);

  db.prepare("DROP TABLE bot_visitors").run();
  db.prepare("DELETE FROM schema_migrations WHERE name = '008_bot_rules.js'").run();
  migrate(db);

  assert.deepEqual(
    db.prepare("SELECT visitor_hash FROM pageviews WHERE day = '2026-10-20' AND visitor_hash IN ('burst', 'unknown', 'slow')").all(),
    [{ visitor_hash: "slow" }],
  );
  const totals = db.prepare("SELECT pageviews, visitors FROM daily_totals WHERE day = '2026-10-20'").get();
  assert.deepEqual(totals, { pageviews: 2, visitors: 2 });
});
