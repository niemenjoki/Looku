# Installing Looku

Looku has two parts that share one SQLite database:

- the **receiver** (`looku ingest`, port 8787): takes page views from your site. It must be reachable from your
  site's server (usually from the internet). It only writes and has no read routes.
- the **dashboard and read API** (`looku serve`, port 8788): where you read the numbers.

Choose one of three setups.

| Setup | Receiver | Dashboard | For |
|---|---|---|---|
| Home | behind a tunnel (e.g. Cloudflare Tunnel) | only on your LAN or Tailscale | a home server |
| Public server | behind an HTTPS reverse proxy | behind the same proxy, password and optional IP allowlist | a VPS or any Docker host |
| One process | `looku all`: both on one port | same | small installs and trying it out |

## With Docker Compose

```bash
git clone <repo> looku && cd looku/deploy
cp .env.example .env            # edit it
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose run --rm ingest site:add example --domain example.com
docker compose run --rm -it dashboard admin:password
```

`site:add` prints the site's signing key once. Your site's connector needs it with the receiver address and the site
id (`LOOKU_ENDPOINT`, `LOOKU_SITE_ID`, `LOOKU_SIGNING_KEY`).

Enable more modules per site: `docker compose run --rm ingest site:modules example shop,campaigns,content`.

### Home setup

- In `.env`, set `LOOKU_DASHBOARD_BIND` to the server's LAN or Tailscale address and `LOOKU_API_HOSTS` to the address
  and port you open in the browser (for example `192.168.1.10:8788`).
- Receiver through Cloudflare Tunnel: create a tunnel, put its token in `LOOKU_TUNNEL_TOKEN` and run
  `docker compose --profile tunnel up -d`. Route the public hostname to `http://ingest:8787`. Allow only
  `POST /ingest` and `POST /orders` there (for example with a WAF rule).

### Public server

Put both behind Caddy (or another HTTPS proxy). The example assumes Caddy runs in the same Docker network as the
Looku services (add it to `compose.yaml` or attach it to the `looku_default` network); otherwise use the published
ports instead of `ingest:8787` and `dashboard:8788`.

```
looku.example.com {
	@receiver path /ingest /orders
	reverse_proxy @receiver ingest:8787
	reverse_proxy dashboard:8788
}
```

In `.env`:

- `LOOKU_PUBLIC_ORIGIN=https://looku.example.com` and `LOOKU_COOKIE_SECURE=1`: secure cookies and HSTS.
- `LOOKU_TRUST_PROXY=1`: the number of proxies in front of the dashboard (Caddy alone = 1; Cloudflare in front of
  Caddy = 2). Only then is the client address taken from `X-Forwarded-For`. The dashboard port must then be
  reachable only through the proxy (keep `LOOKU_DASHBOARD_BIND=127.0.0.1` or leave the port unpublished), or anyone
  could send a forged header.
- `LOOKU_API_ALLOW=203.0.113.0/24,2001:db8::/48` (recommended): only these networks can open the dashboard; others
  get 403. The receiver stays open.

Failed logins are limited per client (10 in 15 minutes; an IPv6 client per /64 network) and in total (200 in 15
minutes). Without `LOOKU_API_ALLOW`, anyone can use up the total limit and keep you out for 15 minutes at a time, so
the allowlist is recommended on a public server. Use a long password (at least 10 characters are required) and keep
Looku updated.

The open health check `/api/v1/health` answers without a key, but gives the time of the last page view only with a
key or login.

### One process

`looku all` serves `/ingest`, `/orders` and `/healthz` from the receiver and everything else from the dashboard, on
`LOOKU_PORT` (default 8788). Put it behind an HTTPS proxy when it is open to the internet, as above.

## Without Docker

Node.js 22 or newer:

```bash
npm install
LOOKU_DB=./data/looku.db npx looku site:add example --domain example.com
LOOKU_DB=./data/looku.db npx looku ingest &
LOOKU_DB=./data/looku.db npx looku admin:password
LOOKU_DB=./data/looku.db npx looku serve
```

## Scheduled jobs

The receiver runs the nightly job (rollups, retention, salts) after 03:00. On the 1st of the month (or later in the
first week if it was down) after 07:00, it also sends the monthly email when SMTP is set. Times are in
`LOOKU_TIMEZONE`. `LOOKU_SCHEDULER=0` turns this off; `looku maintain` runs the nightly job by hand, and
`looku report:send --dry-run` prints the monthly email.

## Backup and update

- Backup while Looku runs: `looku backup /backups/looku-$(date +%F).db`. The copy leaves out the daily salt. With Docker:
  `docker compose run --rm ingest backup /data/backup.db`. Plain file copies of a running database can be
  inconsistent.
- Update: pull the new version, then `docker compose up -d --build`. Database changes run automatically at start.

## Settings reference

All settings are environment variables; `looku` without arguments lists them.
