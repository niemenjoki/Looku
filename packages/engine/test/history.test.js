import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../src/db.js";
import { importHistory } from "../src/history.js";
import { addSite, getSite, setVisitors } from "../src/sites.js";
import { setup } from "./helpers.js";

const NOW = new Date("2026-11-03T10:00:00Z");
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function jsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

const HISTORY = jsonl([
  { type: "pageview", ts: "2026-10-29T08:00:00Z", path: "/", visitor_hash: "a1", referrer_host: "Google.com",
    utm_source: "news", utm_campaign: "autumn" },
  { type: "pageview", ts: "2026-10-29T08:01:00Z", path: "/tuotteet?x=1", visitor_hash: "a1" },
  { type: "pageview", ts: "2026-10-29T09:00:00Z", path: "/", visitor_hash: "b2" },
  { type: "pageview", ts: "2026-11-02T09:00:00Z", path: "/", visitor_hash: "a1" },
  { type: "engagement", ts: "2026-10-29T08:02:00Z", path: "/tuotteet", dwell_ms: 12000, max_scroll_pct: 80 },
  { type: "event", ts: "2026-10-29T08:03:00Z", path: "/tuotteet", name: "add_to_cart", target: "A1",
    value: null, props: {}, items: [{ sku: "A1", quantity: 2 }] },
]);

test("history:import keeps past times, re-hashes visitors and rolls up finished days", () => {
  const { db, site } = setup();
  const result = importHistory(db, site, HISTORY, { now: NOW });
  assert.deepEqual(result, {
    pageview: 4, event: 1, engagement: 1, skippedBefore: 0, skippedRetention: 0, daysRolledUp: 1,
  });

  const rows = db.prepare("SELECT * FROM pageviews ORDER BY ts").all();
  assert.equal(rows[0].ts, "2026-10-29T08:00:00.000Z");
  assert.equal(rows[0].day, "2026-10-29");
  assert.equal(rows[0].referrer_host, "google.com");
  assert.equal(rows[0].utm_campaign, "autumn");
  assert.equal(rows[0].source, "server");
  assert.equal(rows[1].path, "/tuotteet");
  // Same visitor on the same day keeps one hash, which is not the imported one.
  assert.equal(rows[0].visitor_hash, rows[1].visitor_hash);
  assert.notEqual(rows[0].visitor_hash, rows[2].visitor_hash);
  assert.notEqual(rows[0].visitor_hash, "a1");
  // Another day gets another hash, as with the daily salt.
  assert.notEqual(rows[3].visitor_hash, rows[0].visitor_hash);

  const totals = db.prepare("SELECT * FROM daily_totals WHERE day = '2026-10-29'").get();
  assert.equal(totals.pageviews, 3);
  assert.equal(totals.visitors, 2);
  // 2.11. is not finished yet for the nightly job, so it stays in the raw rows.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_totals WHERE day = '2026-11-02'").get().n, 0);

  const event = db.prepare("SELECT * FROM events").get();
  assert.equal(event.ts, "2026-10-29T00:00:00.000Z");
  assert.equal(event.visitor_hash, null);
  assert.deepEqual(db.prepare("SELECT sku, quantity FROM event_items").all(), [{ sku: "A1", quantity: 2 }]);
  const engagement = db.prepare("SELECT * FROM engagement").get();
  assert.equal(engagement.ts, "2026-10-29T00:00:00.000Z");
  assert.equal(engagement.dwell_ms, 12000);
});

test("history:import refuses the same file twice and skips rows at or after --before", () => {
  const { db, site } = setup();
  const result = importHistory(db, site, HISTORY, { before: "2026-11-01T00:00:00Z", now: NOW });
  assert.equal(result.pageview, 3);
  assert.equal(result.skippedBefore, 1);
  assert.throws(() => importHistory(db, site, HISTORY, { now: NOW }), /already imported/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 3);
});

test("history:import imports nothing when a line is invalid", () => {
  const { db, site } = setup();
  const bad = HISTORY + jsonl([{ type: "pageview", ts: "2030-01-01T00:00:00Z", path: "/" }]);
  assert.throws(() => importHistory(db, site, bad, { now: NOW }), /Line 7: ts must be/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM history_imports").get().n, 0);
  // The file can be imported once it is fixed.
  importHistory(db, site, HISTORY, { now: NOW });
});

test("history:import follows the site's visitors and retention settings", () => {
  const { db } = setup();
  addSite(db, { siteId: "other", domain: "example.com", name: "Other" });
  setVisitors(db, "other", "off");
  db.prepare("UPDATE sites SET retention_months = 1 WHERE site_id = 'other'").run();
  const site = getSite(db, "other");
  const old = jsonl([{ type: "pageview", ts: "2026-09-01T08:00:00Z", path: "/", visitor_hash: "a1" }]);
  const result = importHistory(db, site, HISTORY + old, { now: NOW });
  assert.equal(result.skippedRetention, 1);
  const hashes = db.prepare("SELECT visitor_hash FROM pageviews WHERE day = '2026-10-29' ORDER BY ts").all();
  assert.notEqual(hashes[0].visitor_hash, hashes[1].visitor_hash);
});

test("looku history:import reads a file and reports the counts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-history-"));
  const file = path.join(dir, "looku.db");
  const db = openDatabase(file);
  addSite(db, { siteId: "lieromaa", domain: "lieromaa.fi", name: "Lieromaa" });
  db.close();
  const input = path.join(dir, "history.jsonl");
  fs.writeFileSync(input, HISTORY);

  const child = spawn(process.execPath, [CLI, "history:import", "lieromaa", input, "--before", "2026-11-01T00:00:00Z"],
    { env: { ...process.env, LOOKU_DB: file } });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  assert.match(output, /3 page views, 1 events, 1 engagement rows imported to lieromaa/);
  assert.match(output, /1 skipped at or after --before/);
  fs.rmSync(dir, { recursive: true, force: true });
});
