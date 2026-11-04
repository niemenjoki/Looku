# Changelog

## 1.0.0 (unreleased)

First public version.

- Receiver: server-side page views (`POST /ingest`), events and engagement from the browser collector, and shop
  orders (`POST /orders`), signed with HMAC-SHA256 and protected against replay.
- Daily visitor hash without cookies, or no visitor hash at all (`site:visitors off`); optional country.
- SQLite storage, nightly rollups and retention (25 months of single page views, then daily totals).
- Modules: basic, shop (orders, purchase path, best sellers), campaigns, content (reading time, scroll, rising pages).
- Read API `/api/v1` with OpenAPI description, read and admin keys, CSV export, filters and hourly series.
- Dashboard: compact view, monthly review in sentences, settings; Finnish and English; light and dark.
- `looku history:import` for page views, events and engagement from an earlier system.
- `looku site:timezone` changes a site's time zone after `site:add`.
- Paths are stored decoded (`/opas/lämpö`, not `/opas/l%C3%A4mp%C3%B6`); older rows are converted once.
- The receiver drops bots that pass as browsers: a user agent with neither a browser nor a system, and a visitor
  with more than 20 page views in two minutes (that visitor's day is removed). Stored rows are cleaned once.
- Range `24h`, the last 24 hours up to now, also the dashboard's default; time windows with `since` and `until`.
- Monthly email, `looku backup`, `looku all` (one process), client allowlist and HSTS for public servers.
- Connectors: Next.js, Node.js http and Express, Cloudflare Worker example, browser collector.
- Docker image and Compose file.
- License: GNU AGPL 3.0 for the receiver and dashboard, MIT for the connectors (`@looku/next`, `@looku/node`,
  `@looku/browser`).
