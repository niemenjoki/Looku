import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { trackPageview } from "../../next/src/index.js";
import { createIngestServer } from "../src/server.js";
import { signBody } from "../src/signature.js";
import { CHROME_UA, IPHONE_UA, setup } from "./helpers.js";

async function start() {
  const context = setup();
  const server = createIngestServer(context.db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  async function post(payload, { key = context.signingKey, site = "lieromaa", raw } = {}) {
    const body = raw ?? JSON.stringify(payload);
    return fetch(`${endpoint}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Looku-Site": site,
        "X-Looku-Signature": signBody(key, body),
      },
      body,
    });
  }

  return { ...context, server, endpoint, post };
}

function allText(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  return tables
    .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()))
    .join("\n");
}

test("signed page view is stored without the IP address or user agent", async (t) => {
  const { db, server, post } = await start();
  t.after(() => server.close());

  const response = await post({
    type: "pageview",
    path: "/oppaat/kompostointi?x=1",
    referrer: "https://www.google.com/search?q=mato",
    ip: "198.51.100.23",
    ua: IPHONE_UA,
    country: "fi",
    utm_campaign: "  syksy  2026 ",
  });
  assert.equal(response.status, 202);

  const row = db.prepare("SELECT * FROM pageviews").get();
  assert.equal(row.path, "/oppaat/kompostointi");
  assert.equal(row.referrer_host, "google.com");
  assert.equal(row.device, "mobile");
  assert.equal(row.os_family, "iOS");
  assert.equal(row.country, "FI");
  assert.equal(row.utm_campaign, "syksy 2026");
  assert.equal(row.source, "server");

  const text = allText(db);
  assert.equal(text.includes("198.51.100.23"), false);
  assert.equal(text.includes("iPhone OS"), false);
});

test("rejects unsigned, wrongly signed and unknown-site requests", async (t) => {
  const { server, endpoint, post } = await start();
  t.after(() => server.close());
  const payload = { type: "pageview", path: "/", ip: "198.51.100.23", ua: CHROME_UA };

  assert.equal((await post(payload, { key: "wrong" })).status, 401);
  assert.equal((await post(payload, { site: "nobody" })).status, 401);
  const unsigned = await fetch(`${endpoint}/ingest`, {
    method: "POST",
    headers: { "X-Looku-Site": "lieromaa" },
    body: JSON.stringify(payload),
  });
  assert.equal(unsigned.status, 401);
});

test("bad input, size limit, methods, routes and bots", async (t) => {
  const { db, server, endpoint, post } = await start();
  t.after(() => server.close());

  assert.equal((await post(null, { raw: "{nope" })).status, 400);
  assert.equal((await post({ type: "other" })).status, 400);
  assert.equal((await post({ type: "pageview", path: "/" })).status, 400);
  assert.equal((await post(null, { raw: JSON.stringify({ pad: "x".repeat(9000) }) })).status, 413);
  assert.equal((await fetch(`${endpoint}/ingest`)).status, 405);
  assert.equal((await fetch(`${endpoint}/api/v1/sites`)).status, 404);
  assert.equal((await fetch(`${endpoint}/healthz`)).status, 200);

  const bot = await post({ type: "pageview", path: "/", ip: "198.51.100.23", ua: "Googlebot/2.1" });
  assert.equal(bot.status, 202);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 0);
});

test("events keep items and engagement has no visitor", async (t) => {
  const { db, server, post } = await start();
  t.after(() => server.close());

  const event = await post({
    type: "event",
    name: "add_to_cart",
    path: "/tuotteet/madot",
    value: 24.9,
    ip: "198.51.100.23",
    ua: CHROME_UA,
    items: [{ sku: "matoja-500g", quantity: 2 }, { sku: "", quantity: 1 }],
  });
  assert.equal(event.status, 202);
  const stored = db.prepare("SELECT * FROM events").get();
  assert.match(stored.visitor_hash, /^[0-9a-f]{32}$/);
  assert.deepEqual(
    db.prepare("SELECT sku, quantity FROM event_items").all().map((r) => ({ ...r })),
    [{ sku: "matoja-500g", quantity: 2 }],
  );

  const engagement = await post({ type: "engagement", path: "/oppaat/a", dwell_ms: 42000, max_scroll_pct: 180 });
  assert.equal(engagement.status, 202);
  const row = db.prepare("SELECT * FROM engagement").get();
  assert.equal(row.max_scroll_pct, 100);
  assert.equal("visitor_hash" in row, false);
});

test("the Next.js connector delivers a signed page view end to end", async (t) => {
  const { db, server, endpoint, signingKey } = await start();
  t.after(() => server.close());

  const request = new Request("https://lieromaa.fi/oppaat/a?utm_source=newsletter", {
    headers: {
      "user-agent": CHROME_UA,
      "accept-language": "fi-FI",
      "x-forwarded-for": "172.68.0.1",
      "cf-connecting-ip": "198.51.100.23",
    },
  });
  const ok = await trackPageview(request, undefined, {
    enabled: true,
    endpoint,
    siteId: "lieromaa",
    signingKey,
  });
  assert.equal(ok, true);

  const row = db.prepare("SELECT path, utm_source, browser_family FROM pageviews").get();
  assert.deepEqual({ ...row }, { path: "/oppaat/a", utm_source: "newsletter", browser_family: "Chrome" });
});
