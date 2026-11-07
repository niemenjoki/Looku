# Changelog

## 1.0.0 (unreleased)

First public version.

**Install and run**
- Docker image `ghcr.io/niemenjoki/looku` (amd64 and arm64) and a Compose file; `looku all` runs everything in one
  process without Docker.
- One SQLite file. `looku backup` makes a consistent copy without the daily salt.
- Client allowlist and HSTS for public servers; the dashboard can stay on the home network.

**Collect**
- Server-side page views (`POST /ingest`) and shop orders (`POST /orders`), signed with HMAC-SHA256 and protected
  against replay.
- Connectors: Next.js, Node.js http and Express, a Cloudflare Worker example, and a browser collector for events and
  engagement from visitors who consented.
- Bots are dropped: known bots, user agents with neither a browser nor a system, and visitors with more than 20 page
  views in two minutes or more than 4 in three seconds.
- The Next.js connector skips requests that claim a modern browser but lack its `Sec-Fetch-Mode` header: crawlers
  that copy a browser's user agent (`requireFetchMetadata`).
- On Vercel behind Cloudflare, the Next.js connector reads the country from Cloudflare; Vercel's header would name
  Cloudflare's server.
- Paths are stored decoded (`/opas/lämpö`, not `/opas/l%C3%A4mp%C3%B6`).
- `looku history:import` brings page views, events and engagement from an earlier system.

**Report**
- Modules: basic, shop (orders, purchase path, best sellers), campaigns, content (reading time, scroll, rising pages).
- Dashboard in English and Finnish, light and dark, with a compact view and settings. Default range: the last
  24 hours.
- Charts can be read point by point with the mouse, a finger or the arrow keys; an incomplete period is drawn dashed.
  Small changes are shown as counts, not percentages.
- Tap a row (a page, source, campaign, device or country) to filter the whole dashboard by it. The range and filters
  are kept in the address, so views can be bookmarked and Back works. **Show all** opens a card's full list with
  search and sorting.
- Starting views (everything, simple, blog, shop) on the first visit, and **Edit view** on the dashboard itself:
  drag cards, hide them, choose rows, table or bars, order, width and the figures in the top row.
- Conversion over time in a shop, as a 7-day rolling rate, and the shop's currency.
- The header shows when the newest page view arrived; a site with none yet shows a short checklist.
- Settings on one page with a save bar that appears when something changed.
- Links to the sites' own opt-out pages at the bottom of the dashboard, so you can leave out your own phone with
  one tap.
- Monthly review in plain sentences, in the dashboard and by email.
- Read API `/api/v1` with an OpenAPI description, read and admin keys, CSV export, filters (page, page group,
  source, campaign, device, country), hourly series, and time windows with `since` and `until`.

**Privacy**
- No cookies for visitors and nothing stored on the visitor's device.
- Visitors from a hash that changes daily, or no visitor hash at all (`site:visitors off`). Country is optional.
- Single page views are kept for 25 months, then only daily totals. Time zone per site (`site:timezone`).

**Known limitations**
- A site needs a server (or a Cloudflare Worker) to send page views; plain static hosting is not enough.
- A bot with a full browser user agent that reads slowly is counted as a visitor.
- One admin password per installation; no user accounts or teams. Read and admin API keys can be limited to one site.

**License:** GNU AGPL 3.0 for the receiver and dashboard, MIT for the connectors (`@looku/next`, `@looku/node`,
`@looku/browser`).
