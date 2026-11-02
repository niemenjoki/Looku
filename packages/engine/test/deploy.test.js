import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createToken, hasPassword } from "../src/api/auth.js";
import { createApiServer } from "../src/api/server.js";
import { openDatabase } from "../src/db.js";
import { createIngest } from "../src/ingest.js";
import { addSite, getSite, setVisitors } from "../src/sites.js";
import { signBody } from "../src/signature.js";
import { CHROME_UA, setup } from "./helpers.js";

const NOW = new Date("2026-11-03T10:00:00Z");
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("with visitors off, no hash links page views and reports hide visitor counts", async (t) => {
  const { db } = setup();
  setVisitors(db, "lieromaa", "off");
  assert.throws(() => setVisitors(db, "lieromaa", "maybe"), /daily-hash or off/);
  const ingest = createIngest(db);
  const site = getSite(db, "lieromaa");
  for (const p of ["/", "/a"]) {
    ingest(site, { type: "pageview", ts: NOW.toISOString(), path: p, ip: "203.0.113.1", ua: CHROME_UA }, NOW);
  }
  ingest(site, { type: "event", name: "x", path: "/", ip: "203.0.113.1", ua: CHROME_UA }, NOW);
  const hashes = db.prepare("SELECT visitor_hash FROM pageviews").all().map((row) => row.visitor_hash);
  assert.notEqual(hashes[0], hashes[1]);
  assert.equal(db.prepare("SELECT visitor_hash FROM events").get().visitor_hash, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_salt").get().n, 0);

  const server = createApiServer(db, { now: () => NOW });
  const base = await listen(server);
  t.after(() => server.close());
  const { token } = createToken(db, { name: "x" });
  const get = async (url) => (await fetch(`${base}/api/v1${url}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const summary = (await get("/sites/lieromaa/summary?from=2026-11-03&to=2026-11-03")).data;
  assert.deepEqual([summary.pageviews, summary.visitors, summary.sessions, summary.pages_per_session], [2, null, null, null]);
  const pages = (await get("/sites/lieromaa/breakdown/page?from=2026-11-03&to=2026-11-03")).data.rows;
  assert.equal(pages[0].entries, null);
  assert.equal((await get("/sites")).data[0].visitors, "off");
});

test("client allowlist, rightmost X-Forwarded-For and HSTS", async (t) => {
  const { db } = setup();
  const server = createApiServer(db, {
    now: () => NOW,
    publicOrigin: "https://looku.example.com",
    secureCookie: true,
    allowedClients: ["198.51.100.0/24", "2001:db8::/32"],
    trustProxy: 1,
  });
  const base = await listen(server);
  t.after(() => server.close());
  // fetch cannot set Host, so a plain request is used.
  const get = (xff) => new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/v1/me`, { headers: { Host: "looku.example.com", "X-Forwarded-For": xff } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, headers: { get: (name) => res.headers[name] } });
    });
    req.on("error", reject);
  });

  // The proxy appends the real client last; a forged first entry does not help.
  assert.equal((await get("198.51.100.7, 203.0.113.9")).status, 403);
  const allowed = await get("203.0.113.9, 198.51.100.7");
  assert.equal(allowed.status, 401);
  assert.equal(allowed.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal((await get("2001:db8::1")).status, 401);
  const health = await fetch(`${base}/api/v1/health`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
  assert.equal(health.status, 200);
  for (const bad of ["not-an-ip", "10.0.0.0/", "10.0.0.0/0", "10.0.0.0/33", "::/0", "1.2.3.4/8/1"]) {
    assert.throws(() => createApiServer(db, { allowedClients: [bad] }), /Not an IP/, bad);
  }
});

test("looku all serves the receiver and the dashboard on one port; backup copies the data", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "looku.db");
  const db = openDatabase(file);
  const { signingKey } = addSite(db, { siteId: "demo", domain: "demo.fi" });
  db.close();

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [CLI, "all"], {
    env: { ...process.env, LOOKU_DB: file, LOOKU_PORT: String(port), LOOKU_SCHEDULER: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => String(chunk).includes("on http://") && resolve());
    child.once("exit", (code) => reject(new Error(`exited ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({ type: "pageview", path: "/", ip: "203.0.113.1", ua: CHROME_UA });
  const posted = await fetch(`${base}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Looku-Site": "demo", "X-Looku-Signature": signBody(signingKey, body) },
    body,
  });
  assert.equal(posted.status, 202);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/sites`)).status, 401);

  const copy = path.join(dir, "copy.db");
  const backup = spawn(process.execPath, [CLI, "backup", copy], { env: { ...process.env, LOOKU_DB: file } });
  assert.equal((await once(backup, "exit"))[0], 0);
  const restored = openDatabase(copy, { readonly: true });
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 1);
  restored.close();
});

test("without trustProxy, X-Forwarded-For is ignored", async (t) => {
  const { db } = setup();
  const server = createApiServer(db, { now: () => NOW, allowedClients: ["198.51.100.0/24"] });
  const base = await listen(server);
  t.after(() => server.close());
  const response = await fetch(`${base}/api/v1/me`, { headers: { "X-Forwarded-For": "198.51.100.7" } });
  assert.equal(response.status, 403);
});

test("visitors off deletes the salt; backup leaves the salt out; orders outlive retention", async (t) => {
  const { db, site } = setup();
  const ingest = createIngest(db);
  ingest(site, { type: "pageview", ts: NOW.toISOString(), path: "/", ip: "203.0.113.1", ua: CHROME_UA }, NOW);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_salt").get().n, 1);
  setVisitors(db, "lieromaa", "off");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_salt").get().n, 0);

  const { createOrderIngest } = await import("../src/orders.js");
  const { runMaintenance } = await import("../src/maintenance.js");
  createOrderIngest(db)(site, { id: "old", ts: "2020-01-05T10:00:00Z", total: 5 }, NOW);
  runMaintenance(db, NOW);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders_ext").get().n, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "looku.db");
  const live = openDatabase(file);
  const { site: s2 } = { site: (addSite(live, { siteId: "demo", domain: "demo.fi" }), getSite(live, "demo")) };
  createIngest(live)(s2, { type: "pageview", ts: NOW.toISOString(), path: "/", ip: "203.0.113.1", ua: CHROME_UA }, NOW);
  live.close();
  const copy = path.join(dir, "copy.db");
  const backup = spawn(process.execPath, [CLI, "backup", copy], { env: { ...process.env, LOOKU_DB: file } });
  assert.equal((await once(backup, "exit"))[0], 0);
  const restored = openDatabase(copy, { readonly: true });
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM daily_salt").get().n, 0);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM pageviews").get().n, 1);
  restored.close();
});

test("monthly email with visitors off speaks of page views only", async () => {
  const { db, site } = setup();
  setVisitors(db, "lieromaa", "off");
  const ingest = createIngest(db);
  for (const p of ["/a", "/b"]) {
    ingest(getSite(db, "lieromaa"), { type: "pageview", ts: "2026-10-10T10:00:00Z", path: p, ip: "203.0.113.1", ua: CHROME_UA }, new Date("2026-10-10T10:00:00Z"));
  }
  const { buildMonthlyReview, renderReviewEmail } = await import("../src/report-email.js");
  const email = renderReviewEmail(site, buildMonthlyReview(db, getSite(db, "lieromaa"), "2026-10"));
  assert.match(email.text, /sivuja katsottiin 2 kertaa/);
  assert.doesNotMatch(email.text, /kävijää|istunno|^Kävijät$/m);
});

test("admin:password reads the password from stdin and stores it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-password-"));
  const file = path.join(dir, "looku.db");
  const child = spawn(process.execPath, [CLI, "admin:password"], { env: { ...process.env, LOOKU_DB: file } });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.stdin.end("correct horse battery\n");
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  assert.match(output, /Password set/);
  const db = openDatabase(file);
  assert.equal(hasPassword(db), true);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
