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
- Monthly email, `looku backup`, `looku all` (one process), client allowlist and HSTS for public servers.
- Connectors: Next.js, Node.js http and Express, Cloudflare Worker example, browser collector.
- Docker image and Compose file.
