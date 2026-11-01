import assert from "node:assert/strict";
import test from "node:test";

// A minimal browser: window events, document visibility, location, history
// and sendBeacon. The collector must not touch storage or cookies.
const listeners = new Map();
const sent = [];
const doc = { visibilityState: "visible", documentElement: { scrollHeight: 3000, scrollTop: 0 } };
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.innerHeight = 1000;
globalThis.scrollY = 0;
globalThis.location = { pathname: "/oppaat/a" };
globalThis.history = { pushState(state, title, url) { location.pathname = url; } };
Object.defineProperty(globalThis, "navigator", {
  value: { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } },
  configurable: true,
});
globalThis.addEventListener = (type, fn) => listeners.set(type, fn);
globalThis.removeEventListener = (type) => listeners.delete(type);
for (const name of ["localStorage", "sessionStorage"]) {
  Object.defineProperty(globalThis, name, { get() { throw new Error(`${name} used`); }, configurable: true });
}
Object.defineProperty(doc, "cookie", { get() { throw new Error("cookie used"); }, set() { throw new Error("cookie used"); } });

const { event, start, stop } = await import("../src/index.js");
const body = async (i) => JSON.parse(await sent[i].blob.text());

test("measures a page view once and sends no identifier", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  start({ endpoint: "/api/looku" });
  globalThis.scrollY = 1000;
  listeners.get("scroll")();
  t.mock.timers.tick(30000);

  doc.visibilityState = "hidden";
  listeners.get("visibilitychange")();
  listeners.get("pagehide")();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/api/looku");
  assert.deepEqual(await body(0), { type: "engagement", path: "/oppaat/a", dwell_ms: 30000, max_scroll_pct: 50 });

  // Client-side navigation starts a new measurement.
  doc.visibilityState = "visible";
  globalThis.scrollY = 0;
  history.pushState({}, "", "/tuotteet/madot");
  t.mock.timers.tick(5000);
  event("add_to_cart", { items: [{ sku: "MATO", quantity: 1 }] });
  stop();
  assert.equal(sent.length, 3);
  assert.deepEqual(await body(1), { type: "event", name: "add_to_cart", path: "/tuotteet/madot", items: [{ sku: "MATO", quantity: 1 }] });
  assert.deepEqual(await body(2), { type: "engagement", path: "/tuotteet/madot", dwell_ms: 5000, max_scroll_pct: 0 });

  event("ignored");
  assert.equal(sent.length, 3);
  assert.equal(listeners.size, 0);
});

test("a page opened in a background tab is timed from when it is shown", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  sent.length = 0;
  doc.visibilityState = "hidden";
  location.pathname = "/tausta";
  start();
  t.mock.timers.tick(60000);
  doc.visibilityState = "visible";
  listeners.get("visibilitychange")();
  t.mock.timers.tick(7000);
  stop();
  assert.equal((await body(0)).dwell_ms, 7000);
});
