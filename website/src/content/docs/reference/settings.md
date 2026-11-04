---
title: Settings
description: Every environment variable Looku reads, with its default and when to change it.
sidebar:
  order: 1
---

Looku is configured with environment variables. With Docker Compose they live in `deploy/.env`; after a change, run
`docker compose up -d` in the `deploy` folder so that the containers are recreated with the new values. Without
Docker, set them in your shell or service file. `looku` without arguments prints the list.

## Docker Compose only

These are read by `compose.yaml`, not by Looku itself.

| Setting | Default | What |
|---|---|---|
| `LOOKU_DATA_DIR` | `./data` | folder on the host for the database; back it up. `looku-data` keeps the database in a Docker volume instead, for [trying Looku](/looku/tutorials/try-it/) on a desktop computer |
| `LOOKU_DASHBOARD_BIND` | `127.0.0.1` | host address the dashboard port is published on: a LAN or Tailscale address keeps it private, `127.0.0.1` only for a proxy on the same host |
| `LOOKU_DASHBOARD_PORT` | `8788` | host port of the dashboard |
| `LOOKU_VERSION` | `1` | version of the Looku image (`ghcr.io/niemenjoki/looku`); `1` is the newest 1.x, a full version such as `1.0.0` stays put |
| `CLOUDFLARED_VERSION` | empty = `latest` | version of the Cloudflare tunnel image |
| `LOOKU_TUNNEL_TOKEN` | empty | token of your Cloudflare tunnel (profile `tunnel`) |

The receiver's port is not published on the host. A tunnel or proxy in the same Compose project reaches it as
`http://ingest:8787`.

## General

| Setting | Default | What |
|---|---|---|
| `LOOKU_DB` | `./data/looku.db` | database file (`/data/looku.db` in the Docker image) |
| `LOOKU_TIMEZONE` | `Europe/Helsinki` | time zone of the nightly job and the monthly email |
| `LOOKU_SCHEDULER` | on | `0` = the receiver does not run the nightly job or send the monthly email; then run `looku maintain` every night yourself |

## Receiver

| Setting | Default | What |
|---|---|---|
| `LOOKU_INGEST_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | address the receiver listens on |
| `LOOKU_INGEST_PORT` | `8787` | receiver port |

## Dashboard and read API

| Setting | Default | What |
|---|---|---|
| `LOOKU_API_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | address the dashboard listens on (also `looku all`) |
| `LOOKU_API_PORT` | `8788` | dashboard port |
| `LOOKU_PORT` | `8788` | port of `looku all` |
| `LOOKU_API_HOSTS` | empty = any | accepted `Host` headers, comma separated, e.g. `192.168.1.10:8788`. Others get `Unknown host`. Protects against DNS rebinding; set it. |
| `LOOKU_PUBLIC_ORIGIN` | empty | public address behind a reverse proxy, e.g. `https://looku.example.com`; also accepted as a host |
| `LOOKU_COOKIE_SECURE` | `0` | `1` = login cookie only over HTTPS, and HSTS; set it behind HTTPS |
| `LOOKU_TRUST_PROXY` | `0` | number of reverse proxies in front of the dashboard; only then is `X-Forwarded-For` read. See [Security](/looku/reference/security/#client-address-and-proxies) |
| `LOOKU_API_ALLOW` | empty = all | addresses or networks allowed to open the dashboard, e.g. `203.0.113.0/24,2001:db8::/48`; others get `Forbidden`. The health check stays open. |
| `LOOKU_API_CORS` | empty | web origins allowed to call the API from a browser, comma separated |
| `LOOKU_UI_DIR` | the `@looku/ui` package | folder of the dashboard files |

## Monthly email

Nothing is sent while `LOOKU_SMTP_URL` is empty.

| Setting | Default | What |
|---|---|---|
| `LOOKU_SMTP_URL` | empty | mail server, e.g. `smtps://user:password@smtp.example.com:465` |
| `LOOKU_REPORT_FROM` | empty | sender address |
| `LOOKU_REPORT_TO` | empty | recipients, comma separated |
| `LOOKU_REPORT_LANG` | `fi` | `fi` or `en` |

The email is sent on the 1st of the month after 07:00 (`LOOKU_TIMEZONE`), or later in the first week if Looku was
down. Preview it with `looku report:send --dry-run`.

## Per site

These are stored in the database and changed with commands, not environment variables: modules, visitors on or off,
country and retention. The site's time zone, which decides when a day changes in its reports, is set with
`site:add --timezone` and changed with `site:timezone`. See [Commands](/looku/reference/cli/).
