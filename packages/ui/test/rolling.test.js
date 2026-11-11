import assert from "node:assert/strict";
import test from "node:test";

import { T } from "../public/i18n.js";
import { rollingConversion } from "../public/rolling.js";

const day = (n) => `2026-11-${String(n).padStart(2, "0")}`;
const series = (rows) => rows.map(([orders, sessions], i) => ({ period: day(i + 1), orders, sessions }));

test("the window grows from the first day with sessions: 1, 2, ... 7 days", () => {
  // Days 1-3: orders imported from before sessions were recorded.
  const points = series([[5, 0], [4, 0], [3, 0], [1, 10], [0, 10], [2, 20], [1, 10], [0, 10], [1, 10], [0, 10], [1, 10], [0, 10]]);
  const rows = rollingConversion(points, day(1));
  assert.deepEqual(rows.map((x) => x.days), [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7]);
  assert.deepEqual(rows.slice(0, 3).map((x) => x.rate), [null, null, null]);
  assert.equal(rows[3].rate, 10); // 1 order / 10 sessions, the imported orders are not counted
  assert.equal(rows[4].rate, 5); // 1 / 20
  assert.equal(rows[9].sessions, 80); // days 4-10
  assert.equal(rows[9].orders, 5);
  assert.equal(rows[11].sessions, 80); // days 6-12
  assert.equal(rows[11].orders, 5);
});

test("with sessions all along, every point uses 7 days", () => {
  const points = series(Array.from({ length: 14 }, (_, i) => [i % 2, 10]));
  const rows = rollingConversion(points, day(7));
  assert.equal(rows.length, 8);
  assert.ok(rows.every((x) => x.days === 7 && x.sessions === 70));
});

test("no sessions at all gives no rate", () => {
  const rows = rollingConversion(series([[1, 0], [2, 0]]), day(1));
  assert.ok(rows.every((x) => x.rate === null && x.days === 0));
});

test("the tooltip names the length of the window", () => {
  assert.equal(T.fi.shop.window(3, "2", "40"), "3 pv: 2 tilausta / 40 istuntoa");
  assert.equal(T.en.shop.window(1, "0", "10"), "1 day: 0 orders / 10 sessions");
  assert.equal(T.en.shop.window(7, "5", "80"), "7 days: 5 orders / 80 sessions");
});
