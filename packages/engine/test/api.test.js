import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLoginLimiter, createToken, setPassword } from "../src/api/auth.js";
import { createApiServer } from "../src/api/server.js";
import { createIngest } from "../src/ingest.js";
import { addSite } from "../src/sites.js";
import { CHROME_UA, setup } from "./helpers.js";

const NOW = new Date("2026-11-03T10:00:00Z");

async function start(options = {}) {
  const context = setup();
  const ingest = createIngest(context.db);
  const view = (iso, pathName, ip, extra = {}) =>
    ingest(context.site, { type: "pageview", ts: iso, path: pathName, ip, ua: CHROME_UA, ...extra }, new Date(iso));
  view("2026-11-02T08:00:00Z", "/", "203.0.113.1");
  view("2026-11-02T08:05:00Z", "/oppaat/a", "203.0.113.1", { utm_campaign: "=HYPERLINK(1)" });
  view("2026-11-03T08:00:00Z", "/kauppa/madot", "203.0.113.2", { referrer: "https://www.google.com/" });
  addSite(context.db, { siteId: "toinen", domain: "toinen.fi" });
  setPassword(context.db, "oikea salasana 1");

  const server = createApiServer(context.db, { now: () => NOW, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...context, server, base };
}

function bearer(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function login(base, password = "oikea salasana 1") {
  const response = await fetch(`${base}/api/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return { response, cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
}

test("health and the API description need no key, reports do", async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const health = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.last_ingest, "2026-11-03T08:00:00.000Z");
  const doc = await (await fetch(`${base}/api/v1/openapi.json`)).json();
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.paths["/sites/{site}/breakdown/{dimension}"]);

  assert.equal((await fetch(`${base}/api/v1/sites`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/sites`, bearer("lk_wrong"))).status, 401);
});

test("a read key sees reports with meta, ranges resolve in the site's time zone", async (t) => {
  const { db, server, base } = await start();
  t.after(() => server.close());
  const { token } = createToken(db, { name: "ha", scope: "read" });

  const sites = await (await fetch(`${base}/api/v1/sites`, bearer(token))).json();
  assert.deepEqual(sites.data.map((s) => s.id), ["lieromaa", "toinen"]);
  assert.equal(sites.data[0].today, "2026-11-03");

  const summary = await (await fetch(`${base}/api/v1/sites/lieromaa/summary?range=7d&compare=previous`, bearer(token))).json();
  assert.deepEqual(summary.meta.range, { from: "2026-10-28", to: "2026-11-03" });
  assert.deepEqual(summary.meta.previous, { from: "2026-10-21", to: "2026-10-27" });
  assert.equal(summary.meta.sample, false);
  assert.equal(summary.data.pageviews, 3);
  assert.equal(summary.data.visitors, 2);

  const series = await (await fetch(`${base}/api/v1/sites/lieromaa/timeseries?from=2026-11-02&to=2026-11-03`, bearer(token))).json();
  assert.deepEqual(series.data.points.map((p) => p.pageviews), [2, 1]);

  const refs = await (await fetch(`${base}/api/v1/sites/lieromaa/breakdown/referrer?range=7d`, bearer(token))).json();
  assert.ok(refs.data.rows.some((r) => r.value === "google.com"));
  const same = await (await fetch(`${base}/api/v1/sites/lieromaa/reports/perus/breakdown?range=7d&dimension=referrer`, bearer(token))).json();
  assert.deepEqual(same.data, refs.data);

  const modules = await (await fetch(`${base}/api/v1/modules`, bearer(token))).json();
  assert.equal(modules.data[0].id, "perus");

  // No single rows or visitor hashes anywhere in a report.
  assert.doesNotMatch(JSON.stringify([summary, series, refs]), /visitor_hash|203\.0\.113/);
});

test("bad parameters give 400, unknown things 404", async (t) => {
  const { db, server, base } = await start();
  t.after(() => server.close());
  const { token } = createToken(db, { name: "x" });
  const status = async (url) => (await fetch(`${base}/api/v1${url}`, bearer(token))).status;

  assert.equal(await status("/sites/lieromaa/summary?range=99y"), 400);
  assert.equal(await status("/sites/lieromaa/summary?from=2026-11-03&to=2026-11-01"), 400);
  assert.equal(await status("/sites/lieromaa/breakdown/ip"), 400);
  assert.equal(await status("/sites/lieromaa/timeseries?interval=minute"), 400);
  assert.equal(await status("/sites/nope/summary"), 404);
  assert.equal(await status("/sites/lieromaa/reports/perus/__proto__"), 404);
  assert.equal(await status("/sites/lieromaa/reports/shop/funnel"), 404);
  assert.equal(await status("/sites/%E0/summary"), 400);
  assert.equal(await status("/nothing"), 404);
});

test("a key limited to one site cannot see the others", async (t) => {
  const { db, server, base } = await start();
  t.after(() => server.close());
  const { token } = createToken(db, { name: "toinen", siteId: "toinen" });

  const sites = await (await fetch(`${base}/api/v1/sites`, bearer(token))).json();
  assert.deepEqual(sites.data.map((s) => s.id), ["toinen"]);
  assert.equal((await fetch(`${base}/api/v1/sites/lieromaa/summary`, bearer(token))).status, 404);
  assert.equal((await fetch(`${base}/api/v1/sites/toinen/summary`, bearer(token))).status, 200);
});

test("settings and keys need admin; read keys cannot change anything", async (t) => {
  const { db, server, base } = await start();
  t.after(() => server.close());
  const read = createToken(db, { name: "read" }).token;
  const admin = createToken(db, { name: "admin", scope: "admin" }).token;
  const put = (token, body) =>
    fetch(`${base}/api/v1/sites/lieromaa/config`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const config = { language: "fi", page_groups: [{ name: "Oppaat", prefix: "/oppaat/" }, { name: "Kauppa", prefix: "/kauppa/" }] };
  assert.equal((await put(read, config)).status, 403);
  assert.equal((await put(admin, { page_groups: [{ name: "x", prefix: "ei-kauttaviivaa" }] })).status, 400);
  assert.equal((await put(admin, config)).status, 200);

  const groups = await (await fetch(`${base}/api/v1/sites/lieromaa/breakdown/page_group?range=7d`, bearer(read))).json();
  assert.deepEqual(groups.data.rows.map((r) => [r.value, r.pageviews]), [["", 1], ["Kauppa", 1], ["Oppaat", 1]]);

  assert.equal((await fetch(`${base}/api/v1/tokens`, bearer(read))).status, 403);
  const created = await fetch(`${base}/api/v1/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "kotiavustaja", scope: "read", site: "lieromaa" }),
  });
  assert.equal(created.status, 201);
  const { data } = await created.json();
  assert.match(data.token, /^lk_/);
  const list = await (await fetch(`${base}/api/v1/tokens`, bearer(admin))).json();
  assert.ok(list.data.every((row) => !("token" in row) && !("token_hash" in row)));
  assert.equal(list.data.find((row) => row.name === "read").last_used_day, "2026-11-03");

  const revoked = await fetch(`${base}/api/v1/tokens/${data.id}`, { method: "DELETE", ...bearer(admin) });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(`${base}/api/v1/sites`, bearer(data.token))).status, 401);
});

test("dashboard login: cookie flags, same-origin changes, logout, rate limit", async (t) => {
  const { server, base } = await start({ loginLimiter: createLoginLimiter({ limit: 3 }) });
  t.after(() => server.close());

  const { response, cookie } = await login(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const withCookie = (init = {}) => ({ ...init, headers: { Cookie: cookie, ...(init.headers || {}) } });

  const me = await (await fetch(`${base}/api/v1/me`, withCookie())).json();
  assert.deepEqual(me, { scope: "admin", site: null, login: true });

  const body = JSON.stringify({ language: "en" });
  const crossSite = await fetch(`${base}/api/v1/sites/lieromaa/config`, withCookie({
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body,
  }));
  assert.equal(crossSite.status, 403);
  const formPost = await fetch(`${base}/api/v1/sites/lieromaa/config`, withCookie({
    method: "PUT",
    headers: { "Content-Type": "text/plain", Origin: base },
    body,
  }));
  assert.equal(formPost.status, 415);
  const sameSite = await fetch(`${base}/api/v1/sites/lieromaa/config`, withCookie({
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body,
  }));
  assert.equal(sameSite.status, 200);

  const noOrigin = await fetch(`${base}/api/v1/sites/lieromaa/config`, withCookie({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  }));
  assert.equal(noOrigin.status, 403);
  assert.equal((await fetch(`${base}/api/v1/logout`, withCookie({ method: "POST", headers: { Origin: "http://localhost:9999" } }))).status, 403);
  assert.equal((await fetch(`${base}/api/v1/me`, withCookie())).status, 200);

  await fetch(`${base}/api/v1/logout`, withCookie({ method: "POST", headers: { Origin: base } }));
  assert.equal((await fetch(`${base}/api/v1/me`, withCookie())).status, 401);

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await login(base, "väärä salasana")).response.status, 401);
  }
  assert.equal((await login(base)).response.status, 429);
});

test("CSV export neutralises formulas, CORS only for listed origins", async (t) => {
  const { db, server, base } = await start({ allowedOrigins: ["https://oma.example"] });
  t.after(() => server.close());
  const { token } = createToken(db, { name: "csv" });

  const csv = await fetch(`${base}/api/v1/sites/lieromaa/export.csv?report=breakdown&dimension=utm_campaign&range=7d`, bearer(token));
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const text = await csv.text();
  assert.match(text, /^value,pageviews,visitors,entries\r\n/);
  assert.match(text, /'=HYPERLINK\(1\)/);
  const summaryCsv = await (await fetch(`${base}/api/v1/sites/lieromaa/export.csv?report=summary&range=7d`, bearer(token))).text();
  assert.match(summaryCsv, /^pageviews,visitors,sessions,pages_per_session\r\n3,2,/);

  const allowed = await fetch(`${base}/api/v1/sites`, { headers: { Origin: "https://oma.example", Authorization: `Bearer ${token}` } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://oma.example");
  const other = await fetch(`${base}/api/v1/sites`, { headers: { Origin: "https://muu.example", Authorization: `Bearer ${token}` } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("only the dashboard's own files are served, with a strict CSP", async (t) => {
  const uiDir = fs.mkdtempSync(path.join(os.tmpdir(), "looku-ui-"));
  fs.writeFileSync(path.join(uiDir, "index.html"), "<!doctype html><title>Looku</title>");
  fs.writeFileSync(path.join(uiDir, "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(uiDir, "secret.txt"), "no");
  const { server, base } = await start({ uiDir });
  t.after(() => {
    server.close();
    fs.rmSync(uiDir, { recursive: true });
  });

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(index.headers.get("x-frame-options"), "DENY");
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/secret.txt`)).status, 404);
  assert.equal((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
});

test("review fixes: site-limited admin keys, odd paths and bodies, host list, page limits", async (t) => {
  const { db, server, base } = await start({ allowedHosts: [] });
  t.after(() => server.close());
  const limitedAdmin = createToken(db, { name: "toinen-admin", scope: "admin", siteId: "toinen" }).token;
  const admin = createToken(db, { name: "admin", scope: "admin" }).token;

  // A key limited to one site cannot create, list or revoke keys.
  const escalate = await fetch(`${base}/api/v1/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${limitedAdmin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x", scope: "admin" }),
  });
  assert.equal(escalate.status, 403);
  assert.equal((await fetch(`${base}/api/v1/tokens`, bearer(limitedAdmin))).status, 403);
  assert.equal((await fetch(`${base}/api/v1/tokens/1`, { method: "DELETE", ...bearer(limitedAdmin) })).status, 403);

  for (const name of ["constructor", "toString", "__proto__"]) {
    assert.equal((await fetch(`${base}/api/v1/sites/lieromaa/${name}`, bearer(admin))).status, 404, name);
  }
  const nullBody = await fetch(`${base}/api/v1/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
    body: "null",
  });
  assert.equal(nullBody.status, 400);
  const nullLogin = await fetch(`${base}/api/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
  assert.equal(nullLogin.status, 400);

  // Entry pages: only pages where sessions started, limited in SQL.
  const entries = await (await fetch(`${base}/api/v1/sites/lieromaa/breakdown/entry?range=7d`, bearer(admin))).json();
  assert.deepEqual(entries.data.rows.map((r) => r.value).sort(), ["/", "/kauppa/madot"]);
  const one = await (await fetch(`${base}/api/v1/sites/lieromaa/breakdown/page?range=7d&limit=1`, bearer(admin))).json();
  assert.equal(one.data.rows.length, 1);
  const bySort = await (await fetch(`${base}/api/v1/sites/lieromaa/breakdown/exit?range=7d&sort=exits`, bearer(admin))).json();
  assert.equal(bySort.data.sort, "exits");
});

test("the health check answers on any Host, other routes need an allowed Host", async (t) => {
  const { server, base } = await start({ allowedHosts: ["looku.lan:8788"] });
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/api/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/sites`)).status, 421);
});
