import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { addSite, getSite } from "../src/sites.js";
import { createVisitorHasher } from "../src/visitor.js";
import { CHROME_UA, setup } from "./helpers.js";

test("same visitor gets the same hash within a local day and a new one the next day", () => {
  const { db, site } = setup();
  const hash = createVisitorHasher(db);

  const morning = hash(site, "203.0.113.5", CHROME_UA, new Date("2026-11-02T06:00:00Z"));
  const evening = hash(site, "203.0.113.5", CHROME_UA, new Date("2026-11-02T21:30:00Z"));
  // 2026-11-02T22:30Z is already 3 November in Helsinki (UTC+2).
  const nextDay = hash(site, "203.0.113.5", CHROME_UA, new Date("2026-11-02T22:30:00Z"));

  assert.equal(morning, evening);
  assert.notEqual(morning, nextDay);
  assert.match(morning, /^[0-9a-f]{32}$/);
});

test("only the current day's salt is kept", () => {
  const { db, site } = setup();
  const hash = createVisitorHasher(db);
  hash(site, "203.0.113.5", CHROME_UA, new Date("2026-11-02T06:00:00Z"));
  hash(site, "203.0.113.5", CHROME_UA, new Date("2026-11-03T06:00:00Z"));

  const days = db.prepare("SELECT day FROM daily_salt").all().map((row) => row.day);
  assert.deepEqual(days, ["2026-11-03"]);
});

test("different visitors and different sites get different hashes", () => {
  const { db, site } = setup();
  addSite(db, { siteId: "niemenjoki", domain: "niemenjoki.fi" });
  const other = getSite(db, "niemenjoki");
  const hash = createVisitorHasher(db);
  const now = new Date("2026-11-02T06:00:00Z");

  const a = hash(site, "203.0.113.5", CHROME_UA, now);
  assert.notEqual(a, hash(site, "203.0.113.6", CHROME_UA, now));
  assert.notEqual(a, hash(other, "203.0.113.5", CHROME_UA, now));
});

test("the formula matches Lieromaa's order system (phase 0)", () => {
  const { db, site } = setup();
  const hash = createVisitorHasher(db);
  const now = new Date("2026-11-02T06:00:00Z");
  const value = hash(site, "203.0.113.5", CHROME_UA, now);
  const { salt } = db.prepare("SELECT salt FROM daily_salt").get();

  const expected = crypto
    .createHash("sha256")
    .update(salt)
    .update("\0lieromaa\0")
    .update("203.0.113.5")
    .update("\0")
    .update(CHROME_UA)
    .digest("hex")
    .slice(0, 32);
  assert.equal(value, expected);
});
