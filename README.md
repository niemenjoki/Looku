<p align="center"><img src="packages/ui/public/favicon.svg" width="56" alt=""></p>

# Looku

Cookieless, server-side web analytics that you host yourself. Page views are recorded by your site's server, so
nothing is stored in the visitor's browser and no script is needed. The dashboard and the data stay on your own
server, for example on your home network.

- **Server-side page views** for all visitors: pages, referrers, campaigns, devices, countries.
- **Visitors and sessions** from a hash that changes daily, or none at all (a per-site setting).
- **Modules:** shop (orders, purchase path, best sellers), campaigns, content (reading time and scroll depth from
  visitors who consented).
- **Dashboard** in Finnish and English, a monthly review in plain sentences, and the same review by email.
- **Read API** (`/api/v1`, OpenAPI) for your own dashboards or Home Assistant.
- **One SQLite file**, one Docker image, no external services.

Looku is not a cookie banner tool and does not make anything legal by itself. See [privacy and the law](https://niemenjoki.github.io/looku/privacy/).

## Documentation

**[niemenjoki.github.io/looku](https://niemenjoki.github.io/looku/)**, in English and Finnish. Step-by-step guides for beginners and a
reference for the rest:

- [Start here](https://niemenjoki.github.io/looku/start-here/): what you need and which setup suits you
- [Try it locally](https://niemenjoki.github.io/looku/guides/try-locally/) in 15 minutes, without touching a real site
- Install on a [home server with Cloudflare](https://niemenjoki.github.io/looku/guides/home-server-cloudflare/) or a
  [VPS with Caddy](https://niemenjoki.github.io/looku/guides/vps-caddy/)
- [Connect a Next.js site](https://niemenjoki.github.io/looku/guides/connect-nextjs/), or [Node.js, Express, Cloudflare or your own](https://niemenjoki.github.io/looku/guides/connect-other/)
- [Privacy and the law](https://niemenjoki.github.io/looku/privacy/): what is collected, the open legal question, a privacy notice template
- [Suomeksi](https://niemenjoki.github.io/looku/fi/)

The pages are Markdown files in [`website/src/content/docs`](website/src/content/docs), so they can also be read here.

## Quick start

For readers who know Docker; the guides above explain each step.

```bash
cd deploy
cp .env.example .env
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose run --rm ingest site:add example --domain example.com
docker compose run --rm -it ingest admin:password
```

Then [connect your site](https://niemenjoki.github.io/looku/guides/connect-nextjs/) and open the dashboard (`http://127.0.0.1:8788` by default).

## Packages

| Package | What |
|---|---|
| `packages/engine` | receiver, storage, reports, read API, CLI (`looku`) |
| `packages/ui` | the dashboard: static files that use the read API |
| `packages/next` | Next.js connector, browser collector route, `sendOrder` |
| `packages/node` | Node.js http and Express connector |
| `packages/browser` | browser collector for consenting visitors |

`npm install` and `npm test` in the root run all tests (Node.js 22 or newer). The documentation site is in
`website` (`npm install` and `npm run dev` there; Node.js 22.22 or newer).

## License

The receiver, storage, read API and dashboard (`packages/engine`, `packages/ui`) are under the GNU Affero General
Public License 3.0 ([LICENSE](LICENSE)). The connectors that you add to your site (`packages/next`, `packages/node`,
`packages/browser`) are under the MIT License (`LICENSE` in each package), so you can use them in any site, open or
closed. The dashboard font Space Grotesk is under the SIL Open Font License 1.1
(`packages/ui/public/fonts/OFL.txt`).
