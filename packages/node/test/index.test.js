import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { lookuMiddleware } from "../src/index.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test("counts successful HTML pages only, with the socket address unless a proxy is trusted", async (t) => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const options = { enabled: true, endpoint: "http://looku", siteId: "demo", signingKey: "k", fetchImpl };
  const track = lookuMiddleware(options);
  const server = http.createServer((req, res) => {
    track(req, res, () => {
      if (req.url === "/missing") res.writeHead(404, { "Content-Type": "text/html" });
      else if (req.url === "/cached") res.writeHead(304);
      else if (req.url === "/empty") res.writeHead(204);
      else if (req.url === "/data") res.writeHead(200, { "Content-Type": "application/json" });
      else res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("ok");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "user-agent": UA, "accept-language": "fi", "x-forwarded-for": "198.51.100.1" };
  for (const p of ["/oppaat/a?utm_campaign=syksy", "/missing", "/data", "/logo.png", "/empty"]) {
    await (await fetch(`${base}${p}`, { headers })).text();
  }
  await (await fetch(`${base}/cached`, { headers: { ...headers, accept: "text/html", "if-none-match": "\"x\"" } })).text();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].path, "/cached");
  assert.equal(sent[0].path, "/oppaat/a");
  assert.equal(sent[0].utm_campaign, "syksy");
  assert.equal(sent[0].ip, "127.0.0.1");

  const proxied = lookuMiddleware({ ...options, trustProxy: true });
  const req = { method: "GET", url: "/", headers: { ...headers, host: "demo.fi" }, socket: { remoteAddress: "10.0.0.1" } };
  const res = new (await import("node:events")).EventEmitter();
  res.statusCode = 200;
  res.getHeader = () => "text/html";
  proxied(req, res);
  res.emit("finish");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent[2].ip, "198.51.100.1");
  // A forged left-most entry does not count with one trusted proxy.
  req.headers["x-forwarded-for"] = "1.2.3.4, 198.51.100.9";
  proxied(req, res);
  res.emit("finish");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent[3].ip, "198.51.100.9");
});
