import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import { T } from "../public/i18n.js";
import { buildReview, monthRange, shiftMonth } from "../public/review.js";

const format = { formatNumber: (n) => String(n), formatDay: (d) => d.slice(5) };
const text = (review) =>
  [review.title, review.lead.map((p) => (typeof p === "string" ? p : p.b)).join(""), ...review.sections.flatMap((s) => s.sentences)].join(" ");

const data = {
  month: "2026-10",
  today: "2026-11-03",
  summary: { pageviews: 5000, visitors: 1200, sessions: 1500, pages_per_session: 3.33 },
  previous: { pageviews: 4000, visitors: 1000, sessions: 1300, pages_per_session: 3.08 },
  points: [{ period: "2026-10-01", pageviews: 100 }, { period: "2026-10-14", pageviews: 300 }],
  referrers: [
    { value: "", entries: 600 },
    { value: "google.com", entries: 700 },
    { value: "instagram.com", entries: 200 },
  ],
  devices: [{ value: "mobile", pageviews: 3400 }, { value: "desktop", pageviews: 1600 }],
  pages: [{ value: "/", pageviews: 1400 }],
  entries: [{ value: "/oppaat/a", entries: 400 }],
};

test("month helpers", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("Finnish review tells the numbers as sentences", () => {
  const review = buildReview(T.fi, data, format);
  assert.equal(review.title, "Lokakuu 2026: kävijöitä 20 % enemmän");
  const all = text(review);
  assert.match(all, /Lokakuussa sivustolla kävi 1200 kävijää/);
  assert.match(all, /20 % enemmän kuin syyskuussa/);
  assert.match(all, /Hakukoneista alkoi 47 % istunnoista/);
  assert.match(all, /Suurin yksittäinen lähde oli google\.com \(700 istuntoa\)/);
  assert.match(all, /Sivunäytöistä 68 % tehtiin puhelimella/);
  assert.match(all, /Vilkkain päivä oli 10-14/);
  assert.doesNotMatch(all, /kesken/);
  assert.doesNotMatch(JSON.stringify(T), /\u2013/, "no en dashes in texts");
});

test("English review, January compares with December, partial and empty months", () => {
  const review = buildReview(T.en, { ...data, month: "2026-01", today: "2026-01-20" }, format);
  assert.equal(review.title, "January 2026: 20 % more visitors");
  assert.match(text(review), /than in December/);
  assert.match(text(review), /The month is not over: numbers up to 01-20/);

  const first = buildReview(T.fi, { ...data, previous: { visitors: 0 } }, format);
  assert.match(first.title, /ensimmäiset luvut/);
  const empty = buildReview(T.fi, { ...data, summary: { pageviews: 0, visitors: 0, sessions: 0 } }, format);
  assert.deepEqual(empty.sections, []);
  assert.match(empty.title, /ei vielä käyntejä/);
});

test("dashboard scripts parse and never use innerHTML", () => {
  for (const file of ["app.js", "review.js", "i18n.js", "theme.js"]) {
    const source = fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
  }
  execFileSync(process.execPath, ["--check", new URL("../public/app.js", import.meta.url).pathname]);
});
