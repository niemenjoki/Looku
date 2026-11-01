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

Looku is not a cookie banner tool and does not make anything legal by itself. See [privacy and the law](docs/privacy.md).

## Quick start

```bash
cd deploy
cp .env.example .env
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose run --rm ingest site:add example --domain example.com
docker compose run --rm -it dashboard admin:password
```

Then connect your site ([Next.js, Node.js, Cloudflare or your own](docs/connectors.md)) and open the dashboard
(`http://127.0.0.1:8788` by default).

- [Installing](docs/install.md): home server, public server, one process; backup and update
- [Connecting a site](docs/connectors.md): connectors, browser collector, shop orders, read API
- [Privacy and the law](docs/privacy.md): what is collected, the open legal question, a privacy notice template
- [Suomeksi](docs/fi/README.md)

## Packages

| Package | What |
|---|---|
| `packages/engine` | receiver, storage, reports, read API, CLI (`looku`) |
| `packages/ui` | the dashboard: static files that use the read API |
| `packages/next` | Next.js connector, browser collector route, `sendOrder` |
| `packages/node` | Node.js http and Express connector |
| `packages/browser` | browser collector for consenting visitors |

`npm install` and `npm test` in the root run all tests (Node.js 22 or newer).

## License

GNU Affero General Public License 3.0 ([LICENSE](LICENSE)). The dashboard font Space Grotesk is under the SIL Open
Font License 1.1 (`packages/ui/public/fonts/OFL.txt`).
