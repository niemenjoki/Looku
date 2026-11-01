# Connecting a site

A connector runs on your site's server. For each page request it sends the receiver a signed record. Every connector
needs three settings from `looku site:add`: `LOOKU_ENDPOINT` (the receiver's address), `LOOKU_SITE_ID` and
`LOOKU_SIGNING_KEY`. By default the connectors send data only in production.

The connector packages are not on npm yet. Copy the files into your project: `packages/next/src/index.js` has no
dependencies; `packages/node/src/index.js` imports it as `@looku/next`, so change that import to the path of your
copy. `@looku/browser` is `packages/browser/src/index.js`.

## Next.js (proxy.js or middleware.js)

```js
import { NextResponse } from "next/server";
import { trackPageview } from "@looku/next";

export function proxy(request, event) {
  trackPageview(request, event, { excludePaths: ["/private"] });
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|.*[.]).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "(.*)prefetch(.*)" },
      ],
    },
  ],
};
```

The dot is written as `[.]` because it needs no escaping. A single backslash in a JavaScript string (`"\."`) leaves
a plain dot that matches any character, and the pattern then matches only the front page.

The proxy runs before the page, so it cannot know whether the page exists. Requests to missing pages (404) are also
counted. `examples/next-demo` is a complete small site.

## Node.js http and Express

```js
import express from "express";
import { lookuMiddleware } from "@looku/node";

const app = express();
app.use(lookuMiddleware({ trustProxy: true })); // trustProxy only behind a proxy that sets X-Forwarded-For
```

This counts only successful HTML responses (status 2xx, or 304 when the browser revalidates a cached page), so
missing pages are not counted. `trustProxy` is the number of proxies in front of the app (`true` = 1); without it,
the socket address is used and forwarded address headers are ignored. Behind Cloudflare without another proxy, use
`ipHeaders: ["cf-connecting-ip"]` instead. For a plain `http` server, call `trackNodeRequest(req, res)` at the start
of the handler.

## Cloudflare Workers and Pages (static sites)

`examples/cloudflare-worker/worker.js` serves the site and sends a page view in the background after a successful
HTML response. Only Cloudflare's own `cf-connecting-ip` header is trusted.

## Your own connector

Send `POST <endpoint>/ingest` with a JSON body and two headers:

- `X-Looku-Site: <site id>`
- `X-Looku-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the signing key>`

Body: `{ "type": "pageview", "ts": "<ISO time>", "path": "/a", "referrer": "...", "ip": "...", "ua": "...",
"country": "FI", "utm_source": "..." }`. Each signature is accepted once and for five minutes. See `sendToLooku` in
`packages/next/src/index.js`.

## Browser collector (consenting visitors only)

```js
// app/api/looku/route.js
import { createCollectHandler } from "@looku/next";
export const POST = createCollectHandler();

// in the page, after consent
import { event, start, stop } from "@looku/browser";
start();
event("add_to_cart", { items: [{ sku: "A1", quantity: 1 }] });
stop(); // consent withdrawn
```

The route accepts same-origin requests only and forwards the data without the IP address or user agent.

## Shop orders

```js
import { sendOrder } from "@looku/next";
await sendOrder({ id: "1001", ts: new Date().toISOString(), total: 34.9, utm_campaign: "autumn",
  items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }] });
await sendOrder({ id: "1001", status: "cancelled" });
```

Only these fields are stored. Import order history with `looku orders:import <site> orders.jsonl` (one order per
line). Set the purchase path (product, cart and checkout paths) in the dashboard settings.

## Read API

The dashboard uses only `/api/v1`, described at `/api/v1/openapi.json`. Create a read key in the settings (or with
`looku token:create`) and send it as `Authorization: Bearer lk_...`, for example from Home Assistant.
