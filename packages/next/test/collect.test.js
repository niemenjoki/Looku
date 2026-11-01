import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createIngestServer } from "../../engine/src/server.js";
import { setup } from "../../engine/test/helpers.js";
import { buildCollected, createCollectHandler, sendOrder } from "../src/index.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function collect(body, headers = {}) {
  return new Request("https://lieromaa.fi/api/looku", {
    method: "POST",
    headers: { "user-agent": UA, "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.23", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function receiver(t) {
  const context = setup();
  const server = createIngestServer(context.db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const options = {
    enabled: true,
    endpoint: `http://127.0.0.1:${server.address().port}`,
    siteId: "lieromaa",
    signingKey: context.signingKey,
  };
  return { ...context, options };
}

test("only known fields pass, never an identifier", () => {
  assert.deepEqual(buildCollected({ type: "engagement", path: "/a", dwell_ms: 1200.7, max_scroll_pct: 140, ip: "1.2.3.4" }), {
    type: "engagement", source: "client", path: "/a", dwell_ms: 1200, max_scroll_pct: 100,
  });
  assert.deepEqual(buildCollected({ type: "event", name: "add_to_cart", path: "/t", items: [{ sku: "A", quantity: 2, x: 1 }], ua: "x" }), {
    type: "event", name: "add_to_cart", path: "/t", items: [{ sku: "A", quantity: 2 }],
  });
  assert.equal(buildCollected({ type: "event", name: "Bad Name!", path: "/" }), null);
  assert.equal(buildCollected({ type: "engagement", path: "x", dwell_ms: 1, max_scroll_pct: 1 }), null);
  assert.equal(buildCollected({ type: "pageview", path: "/" }), null);
  assert.equal(buildCollected([]), null);
});

test("the collect route forwards same-origin data without the IP address", async (t) => {
  const { db, options } = await receiver(t);
  const POST = createCollectHandler(options);

  assert.equal((await POST(collect({ type: "engagement", path: "/oppaat/a", dwell_ms: 5000, max_scroll_pct: 80 }))).status, 204);
  assert.equal((await POST(collect({ type: "event", name: "add_to_cart", path: "/t", items: [{ sku: "A", quantity: 1 }] }))).status, 204);
  assert.equal((await POST(collect({ type: "engagement", path: "/x", dwell_ms: 1, max_scroll_pct: 1 }, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await POST(collect({ type: "engagement", path: "/x", dwell_ms: 1, max_scroll_pct: 1 }, { "sec-fetch-site": "", origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(collect({ type: "engagement", path: "/y", dwell_ms: 1, max_scroll_pct: 1 }, { "sec-fetch-site": "", origin: "https://lieromaa.fi" }))).status, 204);
  assert.equal((await POST(collect({ type: "engagement", path: "/b", dwell_ms: 1, max_scroll_pct: 1 }, { "user-agent": "Googlebot/2.1" }))).status, 204);
  assert.equal((await POST(collect("x".repeat(5000)))).status, 204);
  assert.equal((await POST(collect("not json"))).status, 204);

  assert.deepEqual(db.prepare("SELECT path, dwell_ms, max_scroll_pct FROM engagement ORDER BY id").all(), [
    { path: "/oppaat/a", dwell_ms: 5000, max_scroll_pct: 80 },
    { path: "/y", dwell_ms: 1, max_scroll_pct: 1 },
  ]);
  const event = db.prepare("SELECT name, visitor_hash FROM events").get();
  assert.deepEqual(event, { name: "add_to_cart", visitor_hash: null });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event_items").get().n, 1);
});

test("the collect route sends nothing outside production", async (t) => {
  const { db, options } = await receiver(t);
  const POST = createCollectHandler({ ...options, enabled: undefined, env: { NODE_ENV: "development" } });
  assert.equal((await POST(collect({ type: "engagement", path: "/a", dwell_ms: 1, max_scroll_pct: 1 }))).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM engagement").get().n, 0);
});

test("sendOrder delivers a signed order", async (t) => {
  const { db, options } = await receiver(t);
  assert.equal(await sendOrder({ id: "1001", ts: new Date().toISOString(), total: 34.9, items: [{ sku: "MATO", quantity: 2 }] }, options), true);
  assert.equal(await sendOrder({ id: "1002", ts: new Date().toISOString(), total: 1 }, { ...options, enabled: false }), false);
  assert.deepEqual(db.prepare("SELECT external_id, total FROM orders_ext").all(), [{ external_id: "1001", total: 34.9 }]);
});

test("a long body without Content-Length is not read past 4 kB", async (t) => {
  const { db, options } = await receiver(t);
  const POST = createCollectHandler(options);
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
      if (pulled > 1000) controller.close();
    },
  });
  const request = new Request("https://lieromaa.fi/api/looku", {
    method: "POST", body, duplex: "half",
    headers: { "user-agent": UA, "sec-fetch-site": "same-origin" },
  });
  assert.equal((await POST(request)).status, 204);
  assert.ok(pulled < 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM engagement").get().n, 0);
});

test("the collect route respects Do Not Track and Global Privacy Control", async (t) => {
  const { db, options } = await receiver(t);
  const POST = createCollectHandler(options);
  await POST(collect({ type: "engagement", path: "/a", dwell_ms: 1, max_scroll_pct: 1 }, { "sec-gpc": "1" }));
  await POST(collect({ type: "engagement", path: "/b", dwell_ms: 1, max_scroll_pct: 1 }, { dnt: "1" }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM engagement").get().n, 0);
});
