---
title: Security
description: What each part of Looku exposes, who should reach it, and the protections built in.
sidebar:
  order: 4
---

## Who should reach what

| Part | Port | Reachable from | Answers |
|---|---|---|---|
| Receiver | 8787 | your site's server, so usually the internet, through a tunnel or proxy | `POST /ingest`, `POST /orders`, `GET /healthz`; everything else `404` or `405` |
| Dashboard and read API | 8788 | you only: home network, Tailscale, or an allowlist | the dashboard, `/api/v1` |

The receiver has nothing to read. Without a valid signature it answers `401` and stores nothing. Still, let only
`POST /ingest` and `POST /orders` through your tunnel or proxy, so that other requests stop before your server.

## Receiver

- **Signatures.** Each record is signed with HMAC-SHA256 and the site's signing key. A signature is valid for five
  minutes and only once, so a captured request cannot be replayed.
- **Size limits.** Large bodies are refused with `413` before they are read.
- **Signing keys** are per site. If one leaks, `site:rotate-key` replaces it.

## Dashboard

- **Password** of at least 10 characters, stored as a salted hash. Use a long one on a public server.
- **Login limits.** 10 failed logins per client address in 15 minutes (an IPv6 client per /64 network), and 200 in
  total. Without `LOOKU_API_ALLOW`, anyone can use up the total limit and lock you out for up to 15 minutes, so set the
  allowlist on a public server.
- **Login cookie** is `HttpOnly` and `SameSite=Strict`. With `LOOKU_COOKIE_SECURE=1`, it is sent only over HTTPS and
  the dashboard adds HSTS.
- **Host check.** With `LOOKU_API_HOSTS` set, requests with another `Host` header get `421 Unknown host`. This stops
  DNS rebinding, where a web page tricks your browser into sending requests to a server on your home network.
- **Cross-site requests** that change something are refused (`403`).
- **Content Security Policy.** The dashboard loads nothing from other addresses and cannot be framed.
- **API keys** are shown once and stored as hashes. `read` keys cannot change anything; a key can be limited to one
  site.

## Client address and proxies

The dashboard needs the client's address for `LOOKU_API_ALLOW` and the login limits. By default it uses the address
of the connection. Behind a reverse proxy that address is the proxy's, so set `LOOKU_TRUST_PROXY` to the number of
proxies in front of the dashboard. Looku then reads the `X-Forwarded-For` header, taking the entry that many places
from the right: each proxy adds the address it saw to the end, and entries further left could have been written by
the client.

This is safe only if the dashboard's port cannot be reached without going through the proxies. Keep
`LOOKU_DASHBOARD_BIND=127.0.0.1` or leave the port unpublished. Otherwise anyone could send a forged header.

Your proxies must add to the header rather than replace it. Caddy replaces it when the request comes from an address
it does not trust, which is why the [VPS guide](/looku/guides/vps-caddy/#behind-cloudflares-proxy) uses Cloudflare
in DNS-only mode.

## Updates

Keep Looku, Docker and the tunnel up to date; see [Backup and update](/looku/operate/backup-and-update/). Report
security problems privately through GitHub's **Security → Report a vulnerability** on the repository.
