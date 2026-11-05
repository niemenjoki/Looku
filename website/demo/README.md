# Online demo

`https://niemenjoki.github.io/looku/demo/` is the real dashboard (`packages/ui/public`) with invented data. It needs
no server: `demo.js` answers the dashboard's requests to `/api/v1` in the browser, and `demo-api.js` runs Looku's own
report code (`packages/engine/src`, copied as it is) on a SQLite database loaded with [sql.js](https://sql.js.org).
Settings can be changed, but the changes stay in the browser tab.

- `seed.mjs` fills the database with three months of traffic, orders and reading time for an invented shop. The data
  goes through the real receiver, so the same rules apply as in a real installation. Nothing comes from a real site.
- `build.mjs` runs after `astro build` (`npm run build` in `website`) and writes everything to `dist/demo`. It needs
  the repository's own packages: run `npm install` in the root first. `DEMO_NOW=2026-11-04T12:00:00Z` makes the same
  data every time.
- The demo's clock stops when the data was made, so "the last 24 hours" always has data.
- `check.mjs` opens the built demo in Chromium and goes through the ranges, filters, chart readout, row filters, CSV
  export, monthly review and settings. It runs in the Playwright image from `website/screenshots`:

  ```bash
  docker build -t looku-pw:local -f screenshots/Dockerfile.pw screenshots
  docker run --rm -v "$PWD/dist:/site:ro" -v "$PWD/demo:/t:ro" looku-pw:local sh -c "cp /t/check.mjs /pw/ && mkdir /out && cd /pw && node check.mjs"
  ```
