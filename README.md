# Looku

Cookieless, server-side web analytics with a LAN-only dashboard. Work in progress (phase 3a of the plan).

- `packages/engine` (`looku`): receiver (`POST /ingest`, `POST /orders`), SQLite data model, visitor hash, nightly
  maintenance (salts, rollups, retention), monthly email and the modules: basic (`perus`), shop, campaigns, content.
- `packages/next` (`@looku/next`): Next.js proxy/middleware connector that records page views on the server, a route
  handler for the browser collector and `sendOrder` for a shop.
- `packages/browser` (`@looku/browser`): reading time, scroll depth and events from visitors who consented. Stores
  nothing in the browser and sends no identifier.
- `packages/ui` (`@looku/ui`): the dashboard, plain static files (no build step) that only use the read API. View A
  (compact dashboard), view C (monthly review in sentences) and settings, in Finnish and English.

Two processes share one SQLite file:

| Process | Command | Default address | Exposed to |
|---|---|---|---|
| Receiver | `looku ingest` | 127.0.0.1:8787 | the internet (via a tunnel), write only, no read routes |
| Read API and dashboard | `looku serve` | 127.0.0.1:8788 | LAN or Tailscale only |

The read API is described at `/api/v1/openapi.json`. Keys are sent as `Authorization: Bearer lk_...`; the dashboard
logs in with a password and an HttpOnly, SameSite=Strict cookie.

## Try it

```bash
npm install
npm test
LOOKU_DB=./data/looku.db npx looku site:add example --domain example.com
LOOKU_DB=./data/looku.db npx looku ingest
LOOKU_DB=./data/looku.db npx looku admin:password
LOOKU_DB=./data/looku.db npx looku serve        # dashboard at http://127.0.0.1:8788
LOOKU_DB=./data/looku.db npx looku token:create home-assistant --scope read
```

`looku ingest` runs the nightly job (salts, rollups, retention) after 03:00 and, when SMTP is set, the monthly email on
the 1st (`LOOKU_SCHEDULER=0` turns this off; `looku maintain` runs the nightly job by hand). Enable more modules with
`looku site:modules example shop,campaigns,content`. With Docker: see `deploy/compose.yaml`.

## Next.js

```js
// proxy.js (Next 16) or middleware.js
import { NextResponse } from "next/server";
import { trackPageview } from "@looku/next";

export function proxy(request, event) {
  trackPageview(request, event, {
    // LOOKU_ENDPOINT, LOOKU_SITE_ID and LOOKU_SIGNING_KEY are read from the environment by default.
    excludePaths: ["/private"],
  });
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "(.*)prefetch(.*)" },
      ],
    },
  ],
};
```

## Browser collector (consenting visitors only)

```js
// app/api/looku/route.js
import { createCollectHandler } from "@looku/next";
export const POST = createCollectHandler();

// in the page, after the visitor has consented
import { event, start, stop } from "@looku/browser";
start();                       // reading time and scroll depth per page view
event("add_to_cart", { items: [{ sku: "A1", quantity: 1 }] });
stop();                        // consent withdrawn
```

The route accepts same-origin requests only and forwards the data signed, without the IP address or user agent.

## Shop orders

```js
import { sendOrder } from "@looku/next";
await sendOrder({ id: "1001", ts: new Date().toISOString(), total: 34.9, utm_campaign: "syksy",
  items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }] });
await sendOrder({ id: "1001", status: "cancelled" });
```

Only these fields are stored; send no names, addresses or emails. Order history can be imported with
`looku orders:import <site> orders.jsonl` (one order per line). Set the purchase path (product, cart and checkout
paths) in the dashboard settings.

## Privacy

- Nothing is stored in the browser. The visitor hash is SHA-256 of a daily random salt, the site, the IP address and
  the user agent, shortened to 16 bytes. Only the current day's salt exists, so hashes cannot be linked across days.
- IP addresses and user agents are never written to disk or logs.
- Raw rows are kept 25 months (per site setting), daily rollups after that.
