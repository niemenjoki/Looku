import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createToken } from "../src/api/auth.js";
import { validateConfig } from "../src/api/params.js";
import { createApiServer } from "../src/api/server.js";
import { createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { overview } from "../src/modules/campaigns/reports.js";
import { engagement, rising } from "../src/modules/content/reports.js";
import { parseFilters } from "../src/modules/filters.js";
import { breakdown, summary, timeseries } from "../src/modules/perus/reports.js";
import { funnel, products, summary as shopSummary } from "../src/modules/shop/reports.js";
import { createOrderIngest } from "../src/orders.js";
import { buildMonthlyReview, renderReviewEmail } from "../src/report-email.js";
import { createScheduler } from "../src/scheduler.js";
import { createIngestServer } from "../src/server.js";
import { signBody } from "../src/signature.js";
import { getSite, setModules, setStoreCountry } from "../src/sites.js";
import { CHROME_UA, IPHONE_UA, setup } from "./helpers.js";

const SITE = { site_id: "lieromaa", timezone: "Europe/Helsinki" };
const SHOP = { product_prefix: "/tuotteet/", cart_path: "/ostoskori", checkout_path: "/kassa" };
const NOW = new Date("2026-11-03T12:00:00Z");

// Week 2026-10-27..11-02 is the previous period of 11-03..11-09 (7 days).
function seed() {
  const context = setup();
  const ingest = createIngest(context.db);
  const view = (iso, path, ip, extra = {}) =>
    ingest(context.site, { type: "pageview", ts: iso, path, ip, ua: extra.ua || CHROME_UA, ...extra }, new Date(iso));
  // Visitor A: campaign "syksy", product, cart, checkout.
  view("2026-11-03T08:00:00Z", "/", "203.0.113.1", { utm_campaign: "syksy" });
  view("2026-11-03T08:01:00Z", "/tuotteet/madot", "203.0.113.1");
  view("2026-11-03T08:02:00Z", "/ostoskori", "203.0.113.1");
  view("2026-11-03T08:03:00Z", "/kassa", "203.0.113.1");
  // Visitor B on a phone: guide and product, no campaign.
  view("2026-11-03T09:00:00Z", "/oppaat/kompostointi", "203.0.113.2", { ua: IPHONE_UA });
  view("2026-11-03T09:01:00Z", "/tuotteet/madot", "203.0.113.2", { ua: IPHONE_UA });
  // Visitor A again later the same day without a campaign: a second session.
  view("2026-11-03T11:00:00Z", "/oppaat/kompostointi", "203.0.113.1");
  // Previous period: campaign "kevat" and one guide view.
  view("2026-10-30T08:00:00Z", "/", "203.0.113.3", { utm_campaign: "kevat" });
  view("2026-10-30T08:01:00Z", "/oppaat/kompostointi", "203.0.113.3");

  const orders = createOrderIngest(context.db);
  orders(context.site, {
    id: "1001",
    ts: "2026-11-03T08:04:00Z",
    total: 34.9,
    utm_campaign: "syksy",
    items: [{ sku: "MATO-250", name: "Kompostimadot 250 g", quantity: 2, price: 17.45 }],
    customer: { email: "x@example.com", name: "Matti" },
  }, NOW);
  orders(context.site, { id: "1002", ts: "2026-11-03T10:00:00Z", total: 10, items: [{ sku: "RUOKA", quantity: 1 }] }, NOW);

  ingest(context.site, { type: "engagement", path: "/oppaat/kompostointi", dwell_ms: 60000, max_scroll_pct: 90 }, NOW);
  ingest(context.site, { type: "engagement", path: "/oppaat/kompostointi", dwell_ms: 20000, max_scroll_pct: 40 }, NOW);
  ingest(context.site, { type: "engagement", path: "/oppaat/kompostointi", dwell_ms: 3600000, max_scroll_pct: 100 }, NOW);
  ingest(context.site, { type: "event", name: "add_to_cart", path: "/tuotteet/madot", items: [{ sku: "MATO-250", quantity: 1 }] }, NOW);
  return context;
}

const WEEK = { from: "2026-11-03", to: "2026-11-09" };

test("orders keep only the allowed fields, update and cancel", () => {
  const { db } = seed();
  const rows = db.prepare("SELECT * FROM orders_ext ORDER BY external_id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, "2026-11-03");
  assert.doesNotMatch(JSON.stringify(rows), /example\.com|Matti/);
  assert.deepEqual(JSON.parse(rows[0].items_json), [{ sku: "MATO-250", name: "Kompostimadot 250 g", quantity: 2, price: 17.45 }]);

  const site = db.prepare("SELECT * FROM sites").get();
  const orders = createOrderIngest(db);
  orders(site, { id: "1002", ts: "2026-11-03T10:00:00Z", total: 12, items: [] }, NOW);
  assert.equal(db.prepare("SELECT total FROM orders_ext WHERE external_id = '1002'").get().total, 12);
  assert.deepEqual(orders(site, { id: "1002", status: "cancelled" }, NOW), { stored: true, cancelled: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders_ext").get().n, 1);

  assert.throws(() => orders(site, { id: "x", ts: "2026-11-04T12:00:00Z", total: 1 }, NOW), /future/);
  assert.throws(() => orders(site, { id: "x", ts: "2026-11-03T10:00:00Z", total: -1 }, NOW), /total/);
  assert.throws(() => orders(site, { ts: "2026-11-03T10:00:00Z", total: 1 }, NOW), /id/);
  assert.throws(() => orders(site, { id: "x", ts: "2026-11-03T10:00:00Z", total: 1, items: [{ sku: "a" }] }, NOW), /quantity/);
  // Order history from earlier years is accepted.
  orders(site, { id: "old", ts: "2024-05-01T10:00:00Z", total: 5 }, NOW);
  assert.equal(db.prepare("SELECT day FROM orders_ext WHERE external_id = 'old'").get().day, "2024-05-01");
});

test("POST /orders is signed and replay protected", async (t) => {
  const { db, signingKey } = setup();
  const server = createIngestServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/orders`;
  const body = JSON.stringify({ id: "A1", ts: new Date().toISOString(), total: 20, items: [{ sku: "S", quantity: 1 }] });
  const headers = (key) => ({ "Content-Type": "application/json", "X-Looku-Site": "lieromaa", "X-Looku-Signature": signBody(key, body) });

  assert.equal((await fetch(url, { method: "POST", headers: headers("wrong"), body })).status, 401);
  const signed = headers(signingKey);
  assert.equal((await fetch(url, { method: "POST", headers: signed, body })).status, 202);
  assert.equal((await fetch(url, { method: "POST", headers: signed, body })).status, 409);
  const bad = JSON.stringify({ id: "A2" });
  assert.equal((await fetch(url, { method: "POST", headers: { ...signed, "X-Looku-Signature": signBody(signingKey, bad) }, body: bad })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders_ext").get().n, 1);
});

test("shop summary, funnel and products", () => {
  const { db } = seed();
  const s = shopSummary(db, "lieromaa", WEEK, { compare: true });
  assert.equal(s.orders, 2);
  assert.equal(s.revenue, 44.9);
  assert.equal(s.sessions, 3);
  assert.equal(s.conversion_pct, 66.67);
  assert.equal(s.previous.orders, 0);

  const f = funnel(db, "lieromaa", WEEK, SHOP);
  assert.deepEqual(f.steps.map((step) => [step.id, step.count]), [
    ["sessions", 3], ["product", 2], ["cart", 1], ["checkout", 1], ["order", 2],
  ]);
  assert.deepEqual(funnel(db, "lieromaa", WEEK, {}).steps.map((step) => step.id), ["sessions", "order"]);

  const p = products(db, "lieromaa", WEEK, SHOP);
  assert.deepEqual(p.sold[0], { sku: "MATO-250", name: "Kompostimadot 250 g", quantity: 2, revenue: 34.9, orders: 1 });
  assert.equal(p.sold[1].revenue, null);
  assert.deepEqual(p.pages, [{ value: "/tuotteet/madot", pageviews: 2, entries: 0 }]);
  assert.equal(p.cart_sample.sample, true);
  assert.equal(p.cart_sample.sample_size, 1);
});

test("campaigns compare with the previous period and count orders", () => {
  const { db } = seed();
  const result = overview(db, "lieromaa", WEEK);
  const byName = Object.fromEntries(result.rows.map((row) => [row.value, row]));
  assert.equal(byName.syksy.status, "new");
  assert.equal(byName.syksy.orders, 1);
  assert.equal(byName.syksy.revenue, 34.9);
  assert.equal(byName.kevat.status, "ended");
  assert.deepEqual(result.rising, ["syksy"]);
});

test("content engagement is a sample with medians; rising pages use all visitors", () => {
  const { db } = seed();
  const e = engagement(db, "lieromaa", WEEK);
  assert.equal(e.sample, true);
  assert.equal(e.sample_size, 3);
  assert.deepEqual(e.rows[0], { value: "/oppaat/kompostointi", n: 3, avg_scroll_pct: 77, read_through_pct: 67, median_seconds: 60 });

  const r = rising(db, "lieromaa", WEEK, { min: 1 });
  assert.equal(r.rows[0].value, "/tuotteet/madot");
  assert.equal(r.rows[0].change_pct, null);
  const guide = r.rows.find((row) => row.value === "/oppaat/kompostointi");
  assert.deepEqual([guide.pageviews, guide.previous_pageviews, guide.change_pct], [2, 1, 100]);
});

test("filters: campaign by session, page group by page, device", () => {
  const { db } = seed();
  const config = { page_groups: [{ name: "Oppaat", prefix: "/oppaat/" }, { name: "Kauppa", prefix: "/tuotteet/" }] };
  const syksy = summary(db, "lieromaa", WEEK, { filters: parseFilters({ utm_campaign: "syksy" }, config) });
  // Only the first session of visitor A came from the campaign.
  assert.deepEqual([syksy.pageviews, syksy.sessions, syksy.visitors], [4, 1, 1]);

  const guides = breakdown(db, "lieromaa", "page", WEEK, { filters: parseFilters({ page_group: "Oppaat" }, config) });
  assert.deepEqual(guides.rows.map((row) => [row.value, row.pageviews]), [["/oppaat/kompostointi", 2]]);
  const none = summary(db, "lieromaa", WEEK, { filters: parseFilters({ page_group: "" }, config) });
  assert.equal(none.pageviews, 3);

  const phone = breakdown(db, "lieromaa", "device", WEEK, { filters: parseFilters({ device: "mobile" }, config) });
  assert.deepEqual(phone.rows.map((row) => [row.value, row.pageviews]), [["mobile", 2]]);
  assert.throws(() => parseFilters({ page_group: "Ei ole" }, config), /Unknown page group/);

  // Rolled-up days give the same filtered numbers, because filters read raw rows.
  runMaintenance(db, new Date("2026-11-06T03:00:00Z"));
  assert.deepEqual(summary(db, "lieromaa", WEEK, { filters: parseFilters({ utm_campaign: "syksy" }, config) }).pageviews, 4);
});

test("hourly series has every local hour, sessions in their first hour", () => {
  const { db } = seed();
  const result = timeseries(db, SITE, { from: "2026-11-03", to: "2026-11-03" }, { interval: "hour" });
  assert.equal(result.points.length, 24);
  assert.equal(result.points[0].period, "2026-11-03T00");
  assert.deepEqual(result.points.filter((p) => p.pageviews).map((p) => [p.period, p.pageviews]), [
    ["2026-11-03T10", 4], ["2026-11-03T11", 2], ["2026-11-03T13", 1],
  ]);
  // Filtered by page group: the session of visitor A that reached a guide at 13 counts there.
  const config = { page_groups: [{ name: "Oppaat", prefix: "/oppaat/" }] };
  const guides = timeseries(db, SITE, { from: "2026-11-03", to: "2026-11-03" }, { interval: "hour", filters: parseFilters({ page_group: "Oppaat" }, config) });
  const sessions = guides.points.reduce((sum, p) => sum + p.sessions, 0);
  assert.equal(sessions, summary(db, "lieromaa", { from: "2026-11-03", to: "2026-11-03" }, { filters: parseFilters({ page_group: "Oppaat" }, config) }).sessions);
  // The autumn clock change day has 25 hours in Helsinki.
  assert.equal(timeseries(db, SITE, { from: "2026-10-25", to: "2026-10-25" }, { interval: "hour" }).points.length, 25);
  assert.throws(() => timeseries(db, SITE, { from: "2026-10-01", to: "2026-11-03" }, { interval: "hour" }), /31 days/);
});

test("shop settings are validated", () => {
  assert.deepEqual(validateConfig({ shop: { product_prefix: "/tuotteet/", cart_path: "" } }).shop, { product_prefix: "/tuotteet/" });
  assert.throws(() => validateConfig({ shop: { cart_path: "ostoskori" } }), /start with/);
  assert.throws(() => validateConfig({ shop: [] }), /object/);
});

test("module reports need the module to be enabled", async (t) => {
  const { db } = seed();
  const server = createApiServer(db, { now: () => NOW });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { token } = createToken(db, { name: "x" });
  const get = (url) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/sites/lieromaa${url}`, { headers: { Authorization: `Bearer ${token}` } });

  assert.equal((await get("/reports/shop/summary?from=2026-11-03&to=2026-11-09")).status, 404);
  assert.deepEqual(setModules(db, "lieromaa", ["shop", "campaigns", "content"]), ["perus", "shop", "campaigns", "content"]);
  assert.throws(() => setModules(db, "lieromaa", ["kassa"]), /Unknown module/);
  const response = await get("/reports/shop/summary?from=2026-11-03&to=2026-11-09");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.orders, 2);
  assert.equal((await get("/summary?from=2026-11-03&to=2026-11-09&utm_campaign=syksy")).status, 200);
  assert.equal((await get("/summary?from=2026-11-03&to=2026-11-09&page_group=x")).status, 400);
  const csv = await (await get("/export.csv?report=shop/funnel&from=2026-11-03&to=2026-11-09")).text();
  assert.match(csv, /^id,count,pct\r\nsessions,3,100\r\n/);
});

test("monthly email has the review sentences and escapes HTML", () => {
  const { db, site } = seed();
  const email = renderReviewEmail(
    { ...site, name: "Lieromaa <test>" },
    buildMonthlyReview(db, site, "2026-11"),
  );
  assert.match(email.subject, /^Lieromaa <test>: Marraskuu 2026/);
  assert.match(email.text, /Marraskuussa sivustolla kävi/);
  assert.match(email.html, /Lieromaa|lieromaa\.fi/);
  assert.doesNotMatch(email.html, /<test>/);
});

test("scheduler runs maintenance once a day and the report once a month", async () => {
  const { db } = seed();
  const sent = [];
  const scheduler = createScheduler(db, {
    settings: { to: ["a@example.com"] },
    send: async (_db, { month }) => {
      sent.push(month);
      return ["lieromaa"];
    },
    log: { log() {}, error() {} },
  });
  await scheduler.tick(new Date("2026-12-01T00:30:00Z")); // 02:30 Helsinki: too early
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'scheduled_maintenance_day'").get(), undefined);
  await scheduler.tick(new Date("2026-12-01T02:00:00Z")); // 04:00
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'scheduled_maintenance_day'").get().value, "2026-12-01");
  assert.deepEqual(sent, []);
  await scheduler.tick(new Date("2026-12-01T06:00:00Z")); // 08:00
  await scheduler.tick(new Date("2026-12-01T07:00:00Z"));
  assert.deepEqual(sent, ["2026-11"]);
  // Down on the 1st: the report goes on a later day, at most on the 7th.
  await scheduler.tick(new Date("2027-01-03T08:00:00Z"));
  await scheduler.tick(new Date("2027-02-08T08:00:00Z"));
  assert.deepEqual(sent, ["2026-11", "2026-12"]);
});

test("client engagement and unhashed events keep only the day", () => {
  const { db } = seed();
  assert.deepEqual(db.prepare("SELECT DISTINCT ts FROM engagement").all(), [{ ts: "2026-11-03T00:00:00.000Z" }]);
  assert.equal(db.prepare("SELECT ts FROM events").get().ts, "2026-11-03T00:00:00.000Z");
});

test("cart and checkout paths match the page or its subpages only", () => {
  const { db, site } = seed();
  createIngest(db)(site, { type: "pageview", ts: "2026-11-03T12:00:00Z", path: "/ostoskorit-ohje", ip: "203.0.113.9", ua: CHROME_UA }, NOW);
  assert.equal(funnel(db, "lieromaa", WEEK, SHOP).steps.find((s) => s.id === "cart").count, 1);
});

test("order ids must be strings or numbers", () => {
  const { db, site } = seed();
  assert.throws(() => createOrderIngest(db)(site, { id: { a: 1 }, ts: "2026-11-03T10:00:00Z", total: 1 }, NOW), /id/);
});

test("a site can turn off storing the country", () => {
  const { db } = setup();
  setStoreCountry(db, "lieromaa", false);
  const ingest = createIngest(db);
  ingest(getSite(db, "lieromaa"), { type: "pageview", path: "/", ip: "203.0.113.1", ua: CHROME_UA, country: "FI" }, NOW);
  assert.equal(db.prepare("SELECT country FROM pageviews").get().country, "");
  assert.throws(() => setStoreCountry(db, "nope", false), /Unknown site/);
});

test("maintenance runs in a worker thread on its own connection", async (t) => {
  const { runMaintenanceInWorker } = await import("../src/maintenance-worker.js");
  const { openDatabase } = await import("../src/db.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "looku.db");
  openDatabase(file).close();
  const report = await runMaintenanceInWorker(file, NOW);
  assert.deepEqual(report, []);
});
