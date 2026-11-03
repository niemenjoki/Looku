---
title: Backup and update
description: Back up Looku's database while it runs, restore it, and update Looku and the Cloudflare tunnel.
sidebar:
  order: 1
---

All of Looku's data is in one file, `looku.db`, in the data folder (`LOOKU_DATA_DIR`, by default `deploy/data`).
Settings are in `.env`. Back up both.

## Back up

Do not copy `looku.db` while Looku is running: a plain copy can catch the file in the middle of a write. Let Looku
make the copy:

```bash
docker compose run --rm ingest backup /data/backup-$(date +%F).db
```

You should see `Backup written to /data/backup-2026-11-03.db.` with today's date. The file appears in your data folder
on the server (`/data` inside the container is the data folder outside it). Copy it somewhere else, for example to
another computer or a backup service; a backup on the same disk does not help if the disk fails.

The copy leaves out the daily salt on purpose, so visitor hashes in the copy cannot be recomputed from an IP address.

**Automatic daily backup.** Run `crontab -e` on the server and add a line (with your own path):

```
30 4 * * * cd /home/you/looku/deploy && docker compose run --rm -T ingest backup /data/backup-$(date +\%a).db >/dev/null
```

This keeps one copy per weekday (`backup-Mon.db` … `backup-Sun.db`), overwriting last week's. In crontab, `%` must
be written `\%`. If you need `sudo` for `docker`, use `sudo crontab -e` instead, so the job runs as root. The next
day, check that `ls data/` shows the file.

**Copy the backups off the server**, from your own computer:

```bash
scp you@192.168.1.10:looku/deploy/data/backup-*.db .
```

Without Docker: `LOOKU_DB=/var/lib/looku/looku.db npx looku backup /backups/looku.db`.

## Restore

```bash
cd ~/looku/deploy
docker compose stop ingest dashboard
sudo mv data/looku.db data/looku.db.broken
sudo rm -f data/looku.db-wal data/looku.db-shm
sudo cp data/backup-Mon.db data/looku.db
sudo chown 1000:1000 data/looku.db
docker compose start ingest dashboard
```

Choose the copy you want with `ls -l data/`. The files belong to the container's user (1000), which is why `sudo`
is needed. `looku.db.broken` is kept until you
have checked the dashboard; delete it after that. Page views sent while Looku is stopped are lost, so keep the break short. Because the copy has no daily salt, visitors
on the day of the restore may be counted twice.

## Update Looku

Read the changelog (`CHANGELOG.md`) first. Then:

```bash
cd ~/looku
git pull
cd deploy
docker compose up -d --build
```

`git pull` downloads the new version, and `up -d --build` builds a new image and replaces the containers. Database
changes run by themselves when the receiver starts. The receiver is down for a few seconds, and page views sent during
that time are lost. Check afterwards:

```bash
docker compose ps
```

All containers should be `Up`, and `ingest` and `dashboard` `(healthy)` after a minute.

## Update the tunnel

The tunnel container (`cloudflared`) does not update itself. In `.env`, `CLOUDFLARED_VERSION` chooses the version; empty
means `latest` at the time of the first download. To update, set a newer version from
[Cloudflare's releases](https://github.com/cloudflare/cloudflared/releases) (for example `2026.10.7`) or keep it
empty, and run:

```bash
docker compose --profile tunnel pull tunnel
docker compose --profile tunnel up -d tunnel
```

Check in the Cloudflare dashboard (**Networking → Tunnels**) that the tunnel is connected again, and run the `curl`
check from the [home server guide](/looku/guides/home-server-cloudflare/#4-let-through-only-what-the-receiver-needs).
