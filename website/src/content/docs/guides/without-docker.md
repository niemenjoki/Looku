---
title: Without Docker
description: Run Looku directly with Node.js, as two processes or as one, and keep it running with systemd.
sidebar:
  order: 5
---

Looku is a Node.js program, so Docker is not required. This page is for readers who already run Node.js services.
If that is new to you, the Docker guides are easier.

**You need:** Node.js 22 or newer, git, and a reverse proxy or tunnel for the receiver as in the other guides.

## Try it first in your own folder

To try Looku on your computer, you need no root, service user or systemd, and Node.js from nvm is fine. In the folder
you cloned Looku into:

```bash
npm install --omit=dev
export LOOKU_DB="$PWD/data/looku.db"
npx looku site:add myblog --domain localhost --timezone Europe/Helsinki
npx looku admin:password
npx looku all
```

`looku all` keeps running in that terminal, so run other commands in a second one (set `LOOKU_DB` there too). The
dashboard is at `http://127.0.0.1:8788`, and the site's `LOOKU_ENDPOINT` is the same address, because `looku all`
receives page views on the same port. Stop it with Ctrl+C. For a real site, install it as below.

## Install

Node.js must be installed for all users (from your distribution or [NodeSource](https://github.com/nodesource/distributions)),
not with nvm, because nvm installs it in your own home folder where the service user cannot reach it.

```bash
sudo useradd --system --home /var/lib/looku --create-home looku
sudo git clone https://github.com/niemenjoki/Looku.git /opt/looku
cd /opt/looku
sudo npm install --omit=dev
```

`npm install` builds the SQLite library. If it fails with `gyp ERR!`, install build tools
(`sudo apt install python3 make g++`) and run it again.

Every command needs the database location (without `LOOKU_DB`, a command uses `./data/looku.db` in the current
folder and creates a new, empty database if there is none), and runs as the `looku` user so that the database belongs
to it:

```bash
sudo -u looku LOOKU_DB=/var/lib/looku/looku.db node packages/engine/src/cli.js site:add myblog --domain example.com --timezone Europe/Helsinki
sudo -u looku LOOKU_DB=/var/lib/looku/looku.db node packages/engine/src/cli.js admin:password
```

## Two processes or one

| Command | Listens on | Does |
|---|---|---|
| `looku ingest` | `LOOKU_INGEST_HOST:LOOKU_INGEST_PORT` (default `127.0.0.1:8787`) | receiver, nightly job, monthly email |
| `looku serve` | `LOOKU_API_HOST:LOOKU_API_PORT` (default `127.0.0.1:8788`) | dashboard and read API |
| `looku all` | `LOOKU_API_HOST:LOOKU_PORT` (default `127.0.0.1:8788`) | both on one port: `/ingest`, `/orders` and `/healthz` go to the receiver, everything else to the dashboard |

Two processes let you publish only the receiver. `looku all` is simpler when both sit behind the same HTTPS proxy;
then set `LOOKU_API_ALLOW`, so that only your own addresses can open the dashboard (see
[Settings](/looku/reference/settings/)).

## Keep it running with systemd

`/etc/systemd/system/looku-ingest.service`:

```ini
[Unit]
Description=Looku receiver
After=network.target

[Service]
User=looku
WorkingDirectory=/opt/looku
Environment=LOOKU_DB=/var/lib/looku/looku.db
Environment=LOOKU_TIMEZONE=Europe/Helsinki
ExecStart=/usr/bin/node packages/engine/src/cli.js ingest
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/looku-dashboard.service` is the same with `Description=Looku dashboard`, `serve` instead of
`ingest`, and the dashboard settings you need (for example `Environment=LOOKU_API_HOST=192.168.1.10` and
`Environment=LOOKU_API_HOSTS=192.168.1.10:8788`). Use the path that `which node` prints instead of
`/usr/bin/node` if it differs.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now looku-ingest looku-dashboard
systemctl status looku-ingest
```

The status should say `active (running)`. Logs: `journalctl -u looku-ingest`.

All settings are listed in [Settings](/looku/reference/settings/).
