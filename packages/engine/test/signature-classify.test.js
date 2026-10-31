import assert from "node:assert/strict";
import test from "node:test";

import {
  browserFamily,
  deviceType,
  isBot,
  normalizeCountry,
  normalizePath,
  osFamily,
  parseReferrer,
} from "../src/classify.js";
import { signBody, verifySignature } from "../src/signature.js";
import { subtractMonths } from "../src/time.js";
import { CHROME_UA, IPHONE_UA } from "./helpers.js";

test("signature: valid, wrong key, tampered body, expired and malformed", () => {
  const now = Date.parse("2026-11-02T06:00:00Z");
  const t = Math.floor(now / 1000);
  const header = signBody("key", '{"a":1}', t);

  assert.equal(verifySignature("key", '{"a":1}', header, now), true);
  assert.equal(verifySignature("other", '{"a":1}', header, now), false);
  assert.equal(verifySignature("key", '{"a":2}', header, now), false);
  assert.equal(verifySignature("key", '{"a":1}', header, now + 301_000), false);
  assert.equal(verifySignature("key", '{"a":1}', "t=1,v1=zz", now), false);
  assert.equal(verifySignature("key", '{"a":1}', undefined, now), false);
});

test("user agent classification", () => {
  assert.equal(deviceType(CHROME_UA), "desktop");
  assert.equal(deviceType(IPHONE_UA), "mobile");
  assert.equal(
    deviceType("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/141.0 Safari/537.36"),
    "tablet",
  );
  assert.equal(browserFamily(CHROME_UA), "Chrome");
  assert.equal(browserFamily(IPHONE_UA), "Safari");
  assert.equal(browserFamily(`${CHROME_UA} Edg/141.0.0.0`), "Edge");
  assert.equal(
    browserFamily("Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0"),
    "Firefox",
  );
  assert.equal(osFamily(CHROME_UA), "Windows");
  assert.equal(osFamily(IPHONE_UA), "iOS");
  assert.equal(
    osFamily("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36"),
    "Android",
  );
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBot(""), true);
  assert.equal(isBot(CHROME_UA), false);
});

test("paths, referrers and countries", () => {
  assert.equal(normalizePath("/oppaat/a?x=1#y"), "/oppaat/a");
  assert.equal(normalizePath(""), "/");
  assert.deepEqual(parseReferrer("https://www.lieromaa.fi/x", "lieromaa.fi"), { host: "", path: "" });
  assert.deepEqual(parseReferrer("https://www.google.com/search?q=mato", "lieromaa.fi"), {
    host: "google.com",
    path: "/search",
  });
  assert.deepEqual(parseReferrer("not a url", "lieromaa.fi"), { host: "", path: "" });
  assert.equal(normalizeCountry("fi"), "FI");
  assert.equal(normalizeCountry("XX"), "");
  assert.equal(normalizeCountry("FIN"), "");
});

test("retention cutoff months", () => {
  assert.equal(subtractMonths("2028-12-15", 25), "2026-11-15");
  assert.equal(subtractMonths("2027-03-31", 1), "2027-02-28");
});
