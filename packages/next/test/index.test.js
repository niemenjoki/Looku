import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { buildPageview, sendToLooku, trackPageview } from "../src/index.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function request(path = "/oppaat/a", headers = {}, init = {}) {
  return new Request(`https://lieromaa.fi${path}`, {
    headers: {
      "user-agent": UA,
      "accept-language": "fi",
      "sec-fetch-mode": "navigate",
      "x-forwarded-for": "198.51.100.23",
      ...headers,
    },
    ...init,
  });
}

test("builds a page view with UTM values and the client IP", () => {
  const payload = buildPageview(request("/oppaat/a?utm_source=uutiskirje&utm_campaign=syksy", { referer: "https://google.com/" }));
  assert.equal(payload.type, "pageview");
  assert.equal(payload.path, "/oppaat/a");
  assert.equal(payload.ip, "198.51.100.23");
  assert.equal(payload.utm_source, "uutiskirje");
  assert.equal(payload.utm_campaign, "syksy");
  assert.equal(payload.referrer, "https://google.com/");
});

test("prefers Cloudflare's client IP header and allows a custom order", () => {
  const headers = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "172.68.0.1, 10.0.0.1" };
  assert.equal(buildPageview(request("/", headers)).ip, "203.0.113.9");
  assert.equal(buildPageview(request("/", headers), { ipHeaders: ["x-forwarded-for"] }).ip, "172.68.0.1");
});

test("reads the country from Cloudflare when the address comes from Cloudflare", () => {
  const both = { "cf-ipcountry": "FI", "x-vercel-ip-country": "SE" };
  assert.equal(buildPageview(request("/", { ...both, "cf-connecting-ip": "203.0.113.9" })).country, "FI");
  // Behind Cloudflare without its country header, Vercel's header would name Cloudflare's server.
  assert.equal(buildPageview(request("/", { "cf-connecting-ip": "203.0.113.9", "x-vercel-ip-country": "SE" })).country, "");
  assert.equal(buildPageview(request("/", { "x-vercel-ip-country": "SE" })).country, "SE");
  assert.equal(buildPageview(request("/", both)).country, "SE");
  assert.equal(buildPageview(request("/", { "cf-ipcountry": "FI" })).country, "FI");
  assert.equal(buildPageview(request("/")).country, "");
});

test("skips a modern browser's user agent without Fetch Metadata", () => {
  const bare = (url, ua, headers = {}) =>
    new Request(url, { headers: { "user-agent": ua, "accept-language": "fi", "x-forwarded-for": "198.51.100.23", ...headers } });
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const OLD_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
  const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
  const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
  const OLD_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36";

  for (const ua of [UA, IPHONE, FIREFOX, MAC_SAFARI]) {
    assert.equal(buildPageview(bare("https://lieromaa.fi/", ua)), null, ua);
    // A client-side navigation is a fetch, not a navigation, and still counts.
    assert.ok(buildPageview(bare("https://lieromaa.fi/", ua, { "sec-fetch-mode": "cors" })), ua);
  }
  // Browsers too old for Fetch Metadata are counted without it.
  assert.ok(buildPageview(bare("https://lieromaa.fi/", OLD_IPHONE)));
  assert.ok(buildPageview(bare("https://lieromaa.fi/", OLD_CHROME)));
  // Browsers send it only over HTTPS, as the proxy in front of the site reports.
  assert.ok(buildPageview(bare("https://lieromaa.fi/", UA, { "x-forwarded-proto": "http" })));
  assert.ok(buildPageview(bare("http://localhost:3000/", UA)));
  assert.ok(buildPageview(bare("https://lieromaa.fi/", UA), { requireFetchMetadata: false }));
});

test("skips requests that are not real page views", () => {
  const skipped = [
    request("/", { "next-router-prefetch": "1" }),
    request("/", { purpose: "prefetch" }),
    request("/", { "sec-purpose": "prefetch;prerender" }),
    request("/api/orders"),
    request("/_next/static/chunk.js"),
    request("/kuva.webp"),
    request("/", { "user-agent": "Googlebot/2.1" }),
    request("/", { "accept-language": "" }),
    request("/", { dnt: "1" }),
    request("/", { "sec-gpc": "1" }),
    request("/", { "x-forwarded-for": "" }),
    request("/", {}, { method: "POST", body: "x" }),
  ];
  for (const item of skipped) {
    assert.equal(buildPageview(item), null, `${item.method} ${item.url}`);
  }
  assert.equal(buildPageview(request("/tietopyynto/lataa/123"), { excludePaths: ["/tietopyynto/lataa"] }), null);
  assert.equal(buildPageview(request("/x"), { excludePaths: [/^\/x$/] }), null);
  assert.equal(
    buildPageview(request("/", { cookie: "a=1; looku_opt_out=1" }), { optOutCookie: { name: "looku_opt_out", value: "1" } }),
    null,
  );
  assert.notEqual(buildPageview(request("/", { rsc: "1" })), null);
  assert.notEqual(
    buildPageview(request("/", { cookie: "looku_opt_out=%E0" }), { optOutCookie: { name: "looku_opt_out", value: "1" } }),
    null,
  );
});

test("sends a correctly signed request and never throws", async () => {
  let captured;
  const ok = await sendToLooku(
    { type: "pageview", path: "/" },
    {
      endpoint: "https://looku.example/",
      siteId: "lieromaa",
      signingKey: "secret",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return new Response(null, { status: 202 });
      },
    },
  );
  assert.equal(ok, true);
  assert.equal(captured.url, "https://looku.example/ingest");
  assert.equal(captured.init.headers["X-Looku-Site"], "lieromaa");
  const [, t, mac] = captured.init.headers["X-Looku-Signature"].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  const expected = crypto.createHmac("sha256", "secret").update(`${t}.${captured.init.body}`).digest("hex");
  assert.equal(mac, expected);

  const failed = await sendToLooku({}, {
    endpoint: "https://looku.example",
    siteId: "lieromaa",
    signingKey: "secret",
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.equal(failed, false);
});

test("is disabled outside production unless enabled explicitly", () => {
  const options = { endpoint: "https://x", siteId: "s", signingKey: "k", fetchImpl: async () => new Response() };
  assert.equal(trackPageview(request(), undefined, { ...options, env: { VERCEL_ENV: "preview" } }), null);
  assert.equal(trackPageview(request(), undefined, { ...options, env: { NODE_ENV: "development" } }), null);

  const waited = [];
  const sending = trackPageview(request(), { waitUntil: (p) => waited.push(p) }, { ...options, env: { VERCEL_ENV: "production" } });
  assert.ok(sending instanceof Promise);
  assert.equal(waited.length, 1);
});
