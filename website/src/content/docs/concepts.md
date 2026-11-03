---
title: How Looku works
description: The path of one page view, from the visitor's request to the dashboard, and why Looku has two parts.
---

This page follows one page view through Looku. Once you have read it, the installation steps should make sense:
each one sets up a link in this chain.

## The path of one page view

```
 Visitor's browser
       │  1. asks for https://myblog.com/hello
       ▼
 Your site's server  (Next.js, Express, Cloudflare Worker …)
       │  2. the connector builds a record and signs it with the signing key
       │  3. sends it over the internet:  POST https://looku.myblog.com/ingest
       ▼
 Tunnel or reverse proxy  (Cloudflare Tunnel, Caddy)
       │  4. passes on POST /ingest and POST /orders, refuses everything else
       ▼
 Looku receiver  (port 8787)
       │  5. checks the signature, computes the daily visitor hash,
       │     drops the IP address and browser string, writes the row
       ▼
 SQLite database  (one file, looku.db)
       ▲
       │  6. reads
 Looku dashboard and read API  (port 8788)
       ▲
       │  7. you open it with a password, from your home network or a network you allow
 You
```

1. **The visitor asks for a page.** The browser sends the request to your site, as it always does. Looku adds
   nothing to the page: no script, no cookie.
2. **The connector builds a record** on your site's server: the path (`/hello`), where the visitor came from (the
   referrer), campaign tags (`utm_source` and so on), the visitor's IP address and the browser's user agent string. It
   skips bots, prefetches, files and visitors who send Do Not Track or Global Privacy Control.
3. **The connector signs the record and sends it** to the receiver. The signature is computed from the record and
   your site's signing key. It proves that the record came from your site and has not been changed on the way, and
   each signature is accepted only once and only for five minutes. The page is not slowed down: the record is sent
   after the response, in the background.
4. **The tunnel or proxy** gives the receiver a public HTTPS address. You set it to let through only the two
   addresses the receiver needs.
5. **The receiver checks the signature.** A record without a valid signature gets the answer `401` and is dropped.
   It uses the IP address and user agent only to compute the visitor hash and to recognise the device type and
   browser family, and then forgets them.
6. **The database** is one SQLite file. Every night the receiver adds up finished days and removes data older than
   the retention period.
7. **The dashboard** reads the same file and shows the numbers. It has a password and is meant to be private.

## Why two parts

The receiver must be reachable from the internet, because your site's server sends data to it. The dashboard should
not be, because it shows your numbers and has a login page. Splitting them lets you keep the dashboard on your home
network while only the receiver is published. The receiver has nothing to read: it only answers "accepted" or "no".

If you do not need this split, `looku all` runs both on one port. See [Without Docker](/looku/guides/without-docker/).

## Visitors without identifiers

To count visitors, Looku needs to know which page views came from the same person on the same day. It computes a
hash (a fingerprint that cannot be reversed) from the IP address, the user agent, the site id and a random value that
changes every day (the daily salt). When the day ends, the salt is deleted. After that, nobody, including you, can
recompute a hash from an IP address, and hashes from different days cannot be linked.

You can turn the hash off for a site. Looku then counts page views, but not visitors or sessions. See
[Privacy and the law](/looku/privacy/).

## Modules

Every site has the basic module (`perus`): page views, visitors, referrers and devices. You can turn on more per site:

| Module | Shows | Needs |
|---|---|---|
| `campaigns` | campaigns and their results | links with `utm_` tags |
| `content` | reading time and scroll depth | the [browser collector](/looku/guides/consent-and-browser/) and the visitor's consent |
| `shop` | orders, purchase path, best sellers | [orders sent from your shop](/looku/guides/shop-orders/) |

## Where things are

| Thing | Where |
|---|---|
| Settings | the `.env` file next to `compose.yaml` ([all settings](/looku/reference/settings/)) |
| Data | one folder, `LOOKU_DATA_DIR` (default `deploy/data`), with `looku.db` in it |
| Sites, modules, keys, password | in the database, changed with `looku` commands ([all commands](/looku/reference/cli/)) |
| Signing key | printed once by `looku site:add`; your site keeps it in its own settings |
