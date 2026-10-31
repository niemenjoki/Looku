# Looku

Cookieless, server-side web analytics with a LAN-only dashboard. Work in progress (phase 1 of the plan).

- `packages/engine` (`looku`): receiver (`POST /ingest`), SQLite data model, visitor hash, nightly maintenance
  (salts, rollups, retention) and the basic module's reports.
- `packages/next` (`@looku/next`): Next.js proxy/middleware connector that records page views on the server.

The read API (`/api/v1`) and the dashboard come in phase 2.

## Try it

```bash
npm install
npm test
LOOKU_DB=./data/looku.db npx looku site:add example --domain example.com
LOOKU_DB=./data/looku.db npx looku ingest
```

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
