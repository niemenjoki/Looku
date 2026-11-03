---
title: Start here
description: What you need, which setup suits you, and the words used in these guides.
---

This page helps you choose a setup. New to servers? Follow the three **tutorials** in order:
[1. Try Looku on your computer](/looku/tutorials/try-it/), [2. Your first installation on a home server](/looku/tutorials/home-server/)
and [3. Connect your site](/looku/tutorials/connect-your-site/). They explain each step and show what you should see.
The other pages are the documentation: shorter, with all the options. [What you can do with Looku](/looku/use-cases/)
shows what to turn on for your needs.

Read this page even if you have run servers before: Looku has two parts with different rules about who may reach
them.

## What you need

- **A site whose server you control**, or at least whose server-side code you can change: Next.js (also on Vercel),
  Node.js or Express, or a static site served through Cloudflare. If you can only paste a script into a page builder,
  Looku does not fit.
- **A place to run Looku**: your own computer (to try it), a home server, or a virtual private server (VPS). It needs
  Docker, or Node.js 22 or newer. Looku is small: its two processes use about 100 MB of memory together, and all
  data is in one database file.
- **A way for your site to reach Looku.** Your site's server sends each page view to Looku over the internet, so the
  receiving part of Looku needs a public HTTPS address. The guides show two ways: a Cloudflare Tunnel (no open ports at
  home) or a reverse proxy on a VPS.
- **About an hour** for the first real installation. Trying it on your own computer takes about 20 minutes.

You do not need to know Docker, tunnels or signatures beforehand. Each guide explains them where they come up, and
[How Looku works](/looku/concepts/) explains the whole picture.

## Choose a setup

| | Try it locally | Home server + Cloudflare | VPS + Caddy |
|---|---|---|---|
| **For** | seeing Looku before you decide | a home server or a Raspberry Pi you already have | anyone without a home server |
| **Costs** | nothing | a domain (about 10 € a year); the Cloudflare account is free | a VPS (a few euros a month) and a domain |
| **Receiver** (takes page views) | on your computer | behind a Cloudflare Tunnel | behind Caddy, with HTTPS |
| **Dashboard** (where you read the numbers) | on your computer | only on your home network (or [Tailscale](/looku/guides/tailscale/)) | on the internet behind a password, limited to your own networks |
| **Real visitors?** | no, only the demo site | yes | yes |
| **Tutorial** | [1. Try Looku on your computer](/looku/tutorials/try-it/) | [2. Your first installation](/looku/tutorials/home-server/) | |
| **Documentation** | | [Home server + Cloudflare](/looku/guides/home-server-cloudflare/) | [VPS + Caddy](/looku/guides/vps-caddy/) (step by step) |

Not sure? Start with [1. Try Looku on your computer](/looku/tutorials/try-it/). Nothing you do there affects a real site.

If you already run a reverse proxy other than Caddy (nginx, Traefik), follow the VPS guide and adapt the proxy step.
To run Looku without Docker, see [Without Docker](/looku/guides/without-docker/).

## After the installation

1. **Connect your site** so that it sends page views: [Next.js](/looku/guides/connect-nextjs/) or
   [Node.js, Express, Cloudflare or your own](/looku/guides/connect-other/).
2. **Update your privacy notice.** [Privacy and the law](/looku/privacy/) has a template and explains what is stored.
3. Optional: [reading time and scroll depth](/looku/guides/consent-and-browser/) from visitors who consent,
   [shop orders](/looku/guides/shop-orders/), or [data from your previous analytics](/looku/guides/moving-from-another/).
4. Set up [backups and updates](/looku/operate/backup-and-update/).

## Words used in these guides

**Receiver**
: The part of Looku that takes page views from your site (`looku ingest`, port 8787). It must be reachable from your
  site's server, usually over the internet. It only accepts data that carries a valid signature, and it has nothing
  to read.

**Dashboard**
: The part where you read the numbers (`looku serve`, port 8788). It needs a password. Keep it as private as you can.

**Connector**
: A small piece of code that you add to your site. On every page request it sends a signed record to the receiver.

**Site id and signing key**
: When you add a site to Looku, it gets a short id that you choose (for example `myblog`) and a long random signing
  key. The connector signs each record with the key, so the receiver knows the record really came from your site.
  Keep the key secret, like a password.

**Terminal, shell**
: The text window where you type commands: Terminal on macOS and Linux, PowerShell on Windows. See
  [1. Try Looku on your computer](/looku/tutorials/try-it/#get-the-tools). On a server you open it with `ssh`, which also works
  in PowerShell.

**Docker, container, Compose**
: Docker runs a program in an isolated box (a container) with everything it needs, so you do not install Node.js or
  libraries on the server. Docker Compose starts several containers from one file (`compose.yaml`) and one settings
  file (`.env`).

**Environment variable**
: A named setting given to a program from outside, for example `LOOKU_TIMEZONE=Europe/Helsinki`. With Docker, these
  live in the `.env` file. See [Settings](/looku/reference/settings/).

**Reverse proxy**
: A web server in front of your apps (Caddy, nginx). It holds the HTTPS certificate and forwards each request to the
  right app.

**Tunnel**
: A program on your server that opens an outgoing connection to a service such as Cloudflare. Requests to your public
  address come back through that connection, so you do not open any ports in your home router.

**Domain, hostname**
: `example.com` is a domain; `looku.example.com` is a hostname under it. The receiver needs a hostname of its own.
