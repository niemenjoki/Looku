import assert from "node:assert/strict";
import test from "node:test";

import { PATH_HEADER, buildNotFound, lookuRequestHeaders, trackNotFound } from "../src/index.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const OPTIONS = { enabled: true, endpoint: "https://looku.example", siteId: "lieromaa", signingKey: "secret" };

function request(path, headers = {}) {
  return new Request(`https://lieromaa.fi${path}`, {
    headers: {
      "user-agent": UA,
      "accept-language": "fi",
      "sec-fetch-mode": "navigate",
      "x-forwarded-for": "198.51.100.23",
      ...headers,
    },
  });
}

test("the proxy passes the path to the not-found page, signed", async () => {
  const headers = await lookuRequestHeaders(request("/wp-admin", { [PATH_HEADER]: "forged:/tuotteet" }), OPTIONS);
  assert.match(headers.get(PATH_HEADER), /^[0-9a-f]{64}:\/wp-admin$/);
  assert.equal(headers.get("user-agent"), UA);

  const payload = await buildNotFound(headers, OPTIONS);
  assert.equal(payload.type, "notfound");
  assert.equal(payload.path, "/wp-admin");
  assert.equal(payload.ua, UA);
  assert.equal(payload.ip, undefined);
  assert.ok(Date.parse(payload.ts));
});

test("a path header the proxy did not make is not sent", async () => {
  const signed = (await lookuRequestHeaders(request("/vanha"), OPTIONS)).get(PATH_HEADER);
  const headersWith = (value) => {
    const headers = new Headers(request("/x.php").headers);
    headers.set(PATH_HEADER, value);
    return headers;
  };
  assert.equal(await buildNotFound(headersWith("forged:/tuotteet"), OPTIONS), null);
  assert.equal(await buildNotFound(headersWith(signed.replace("/vanha", "/tuotteet")), OPTIONS), null);
  assert.equal(await buildNotFound(headersWith(signed), { ...OPTIONS, signingKey: "other" }), null);
  assert.equal(await buildNotFound(new Headers(request("/x").headers), OPTIONS), null);
  // Outside production, or without a key, the proxy removes the visitor's copy.
  const off = await lookuRequestHeaders(request("/x", { [PATH_HEADER]: signed }), { ...OPTIONS, enabled: false });
  assert.equal(off.has(PATH_HEADER), false);
});

test("the not-found message follows the page view rules", async () => {
  const headers = async (extra) => lookuRequestHeaders(request("/vanha", extra), OPTIONS);
  assert.equal(await buildNotFound(await headers({ "user-agent": "curl/8.0" }), OPTIONS), null);
  assert.equal(await buildNotFound(await headers({ dnt: "1" }), OPTIONS), null);
  assert.equal(await buildNotFound(await headers(), { ...OPTIONS, excludePaths: ["/vanha"] }), null);
});

test("trackNotFound sends the message and never throws", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), site: init.headers["X-Looku-Site"] });
    return new Response(null, { status: 202 });
  };
  const headers = await lookuRequestHeaders(request("/blog/post/old"), OPTIONS);
  assert.equal(await trackNotFound(headers, { ...OPTIONS, fetchImpl }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://looku.example/ingest");
  assert.equal(sent[0].site, "lieromaa");
  assert.equal(sent[0].body.path, "/blog/post/old");

  assert.equal(await trackNotFound(headers, { ...OPTIONS, enabled: false, fetchImpl }), false);
  assert.equal(await trackNotFound({ get: () => { throw new Error("broken"); } }, { ...OPTIONS, fetchImpl }), false);
  assert.equal(sent.length, 1);
});
