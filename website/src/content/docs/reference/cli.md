---
title: Commands
description: Every looku command, what it prints, and how to run it with Docker or without.
sidebar:
  order: 2
---

## How to run a command

| Setup | Form | Where |
|---|---|---|
| Docker Compose | `docker compose run --rm ingest <command>` | on the server, in the `deploy` folder |
| Docker Compose, command that asks something | `docker compose run --rm -it ingest <command>` | same |
| Without Docker | `npx looku <command>` with `LOOKU_DB` set | in the Looku folder |

`run --rm ingest` starts a temporary container from the same image and with the same data folder, runs the command
and removes the container. The running receiver and dashboard are not touched. Use `ingest`, not `dashboard`: Compose
may restart the receiver before a `dashboard` command, because the dashboard depends on it.

A file on the host is not visible inside the container. To give one to a command, mount it:
`docker compose run --rm -v "$PWD/file.jsonl:/tmp/file.jsonl:ro" ingest orders:import myblog /tmp/file.jsonl`.

## Sites

| Command | Does | Prints |
|---|---|---|
| `site:add <id> --domain <domain> [--name <name>] [--timezone <tz>]` | adds a site; id is a short name of your choice, domain without `https://`, time zone default `Europe/Helsinki` | `Site <id> added. Signing key (shown once):` and the key |
| `site:list` | lists sites and their settings | a table |
| `site:rotate-key <id>` | makes a new signing key; the old one stops working at once | the new key |
| `site:modules <id> <module,...>` | sets the site's modules: `perus` (always on), `campaigns`, `content`, `shop`. List all you want. | `Modules of <id>: perus, …` |
| `site:visitors <id> daily-hash\|off` | visitors with the daily hash (default) or not at all | `Visitors for <id>: off. Applies to new page views.` |
| `site:country <id> on\|off` | store the visitor's country (default on) | `Country for <id>: off.` |
| `site:retention <id> <months>` | how long single page views are kept (default 25), after which only daily totals remain | `Retention for <id>: 13 months. Applies from the next nightly job.` |

## Dashboard access

| Command | Does |
|---|---|
| `admin:password` | sets the dashboard password (at least 10 characters). It is asked once, and nothing shows while you type. Existing logins stay valid until the dashboard restarts. |
| `token:create <name> [--scope read\|admin] [--site <id>]` | creates an API key for the [read API](/looku/reference/api/), shown once; `--site` limits it to one site |
| `token:list` | lists keys (never the keys themselves) |
| `token:revoke <id>` | revokes a key by its number from `token:list` |

## Data

| Command | Does |
|---|---|
| `backup <file>` | consistent copy of the database while Looku runs, without the daily salt; see [Backup](/looku/operate/backup-and-update/) |
| `orders:import <id> <file>` | imports orders, one JSON object per line; all or nothing |
| `history:import <id> <file> [--before <time>]` | imports page views, events and reading time from an earlier system; see [Moving from another system](/looku/guides/moving-from-another/) |
| `maintain` | runs the nightly job now: deletes old salts, adds up finished days, applies retention. Prints a summary per site. |
| `report:send [--month YYYY-MM] [--site <id>] [--dry-run]` | sends the monthly email (default: last month); `--dry-run` prints it instead |

## Processes

These start Looku and keep running. With Docker Compose they are started by `compose.yaml`; you do not run them
yourself.

| Command | Starts |
|---|---|
| `ingest` | the receiver, the nightly job and the monthly email |
| `serve` | the dashboard and read API |
| `all` | both in one process on one port |
