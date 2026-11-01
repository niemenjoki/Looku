# Looku

Cookieless, server-side web analytics with a LAN-only dashboard. Work in progress (phase 2 of the plan).

- `packages/engine` (`looku`): receiver (`POST /ingest`), SQLite data model, visitor hash, nightly maintenance
  (salts, rollups, retention) and the basic module's reports.
- `packages/next` (`@looku/next`): Next.js proxy/middleware connector that records page views on the server.
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

Run `looku maintain` once a night (salts, rollups, retention).

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

## Privacy

- Nothing is stored in the browser. The visitor hash is SHA-256 of a daily random salt, the site, the IP address and
  the user agent, shortened to 16 bytes. Only the current day's salt exists, so hashes cannot be linked across days.
- IP addresses and user agents are never written to disk or logs.
- Raw rows are kept 25 months (per site setting), daily rollups after that.
