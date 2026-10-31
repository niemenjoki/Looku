import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";

import { createIngest } from "../src/ingest.js";
import { runMaintenance } from "../src/maintenance.js";
import { breakdown, summary, timeseries } from "../src/modules/perus/reports.js";
import { createIngestServer } from "../src/server.js";
import { signBody } from "../src/signature.js";
import { isDayKey } from "../src/time.js";
import { CHROME_UA, setup } from "./helpers.js";

async function listen(db) {
  const server = createIngestServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
  });
}

test("a request target the URL parser rejects does not crash the receiver", async (t) => {
  const { db } = setup();
  const server = await listen(db);
  t.after(() => server.close());
  const { port } = server.address();

  const reply = await rawRequest(port, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  assert.match(reply, /^HTTP\/1\.1 404/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
});

test("the same signed request is accepted only once", async (t) => {
  const { db, signingKey } = setup();
  const server = await listen(db);
  t.after(() => server.close());
  const body = JSON.stringify({ type: "pageview", path: "/", ip: "198.51.100.1", ua: CHROME_UA });
  const init = {
    method: "POST",
    headers: { "X-Looku-Site": "lieromaa", "X-Looku-Signature": signBody(signingKey, body) },
    body,
  };
  const url = `http://127.0.0.1:${server.address().port}/ingest`;

  assert.equal((await fetch(url, init)).status, 202);
  assert.equal((await fetch(url, init)).status, 409);

  // Other spellings of the same signature are rejected outright.
  const [, ts, mac] = init.headers["X-Looku-Signature"].match(/^t=(\d+),v1=(\w+)$/);
  for (const variant of [`t=${ts}, v1=${mac}`, `v1=${mac},t=${ts}`, `t=0${ts},v1=${mac}`, `t=${ts},v1=${mac},x=1`]) {
    const response = await fetch(url, { ...init, headers: { ...init.headers, "X-Looku-Signature": variant } });
    assert.equal(response.status, 401, variant);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 1);
});

test("a late page view at midnight gives the same numbers before and after the rollup", () => {
  const { db, site } = setup();
  const ingest = createIngest(db);
  // Viewed 23:58 on 2 Nov in Helsinki, received 00:01 on 3 Nov; next view 00:05.
  ingest(
    site,
    { type: "pageview", ts: "2026-11-02T21:58:00Z", path: "/a", ip: "203.0.113.1", ua: CHROME_UA },
    new Date("2026-11-02T22:01:00Z"),
  );
  ingest(
    site,
    { type: "pageview", ts: "2026-11-02T22:05:00Z", path: "/b", ip: "203.0.113.1", ua: CHROME_UA },
    new Date("2026-11-02T22:05:00Z"),
  );
  const range = { from: "2026-11-02", to: "2026-11-03" };
  const before = [summary(db, "lieromaa", range), breakdown(db, "lieromaa", "entry", range)];

  runMaintenance(db, new Date("2026-11-05T06:00:00Z"));
  assert.deepEqual([summary(db, "lieromaa", range), breakdown(db, "lieromaa", "entry", range)], before);
  assert.equal(before[0].sessions, 2);
});

test("yesterday is not rolled up yet, so late rows still show", () => {
  const { db, site } = setup();
  const ingest = createIngest(db);
  const view = (iso, now) =>
    ingest(site, { type: "pageview", ts: iso, path: "/", ip: "203.0.113.1", ua: CHROME_UA }, new Date(now));

  view("2026-11-02T10:00:00Z", "2026-11-02T10:00:00Z");
  const report = runMaintenance(db, new Date("2026-11-02T23:30:00Z")); // 01:30 on 3 Nov
  assert.equal(report[0].daysRolledUp, 0);
  view("2026-11-02T21:00:00Z", "2026-11-03T02:00:00Z"); // arrives late
  assert.equal(summary(db, "lieromaa", { from: "2026-11-02", to: "2026-11-02" }).pageviews, 2);
});

test("report ranges are bounded and days must be real", () => {
  const { db } = setup();
  assert.equal(isDayKey("2026-02-31"), false);
  assert.equal(isDayKey("9999-12-31"), false);
  assert.equal(isDayKey("2026-11-02"), true);
  assert.throws(() => timeseries(db, "lieromaa", { from: "2026-01-01", to: "9999-12-31" }));
  assert.throws(() => summary(db, "lieromaa", { from: "2024-01-01", to: "2026-12-31" }), /at most 800/);
});
