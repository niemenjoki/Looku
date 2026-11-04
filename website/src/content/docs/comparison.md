---
title: Looku and the alternatives
description: How Looku differs from Plausible Community Edition, Umami, GoatCounter and Matomo, with sources.
---

This page compares how Looku and four other self-hosted analytics tools collect and store data. It is not a ranking.
Each of them suits some sites better than Looku does. Everything here can be checked from the linked sources, which
were read on 4 November 2026. Versions change, so check the sources before you decide.

## All of them can record page views on the server

Looku's page views come from your site's server, not from a script in the browser. The others can do that too:

- **Plausible** has an Events API for "server side tracking". You send the visitor's user agent and IP address with
  each page view.
- **Umami** accepts page views at `/api/send` without a token, as long as the request has a proper user agent.
- **GoatCounter** has an HTTP API for backend middleware, and it can import the logs of nginx, Apache, Caddy and
  other servers.
- **Matomo** can import web server logs (Log Analytics), with fewer features than its JavaScript tracking.

The difference is the default. In the others, the browser script is the usual way, and the server route is an
alternative you build yourself. In Looku, the server route is the only basic way, and the connectors for Next.js and
Node.js do it for you, including passing on the visitor's address and user agent. For Cloudflare Workers there is a
ready example.

## At a glance

| | Looku 1.0.0 | Plausible CE 3.2.1 | Umami | GoatCounter | Matomo 6 |
|---|---|---|---|---|---|
| **Usual way to collect** | Your site's server (connector) | Browser script | Browser script | Browser script | Browser script |
| **Server-side route** | The only basic route | Events API | `/api/send` | HTTP API, log import | Log Analytics (log import) |
| **Database** | SQLite | PostgreSQL and ClickHouse | PostgreSQL | SQLite or PostgreSQL | MySQL 8+ or MariaDB 10.6+ |
| **What you run** | One image: receiver and dashboard (2 containers in the Compose file) | 3 containers: app, PostgreSQL, ClickHouse | 2 containers: app, PostgreSQL | One static program | PHP 8.1+ application and its database |
| **License** | AGPL-3.0, connectors MIT | AGPL-3.0, tracker script MIT | MIT | EUPL 1.2 (modified), script ISC | GPL-3.0 or later |

Notes:

- Plausible Community Edition leaves out some features of Plausible's cloud service, such as funnels, ecommerce
  revenue goals, SSO and the sites API. It is released about twice a year and has basic bot filtering.
- Looku can also run as one process (`looku all`) without Docker. See [Without Docker](/looku/guides/without-docker/).

## Choose Looku if

- your site runs on a server of its own (Next.js, Node.js, Express) or behind Cloudflare,
- you want one small service and one database file that is easy to back up,
- you want shop orders and page views in the same place, or a dashboard in Finnish.

## Choose another tool if

- you can only paste a script into your pages (a hosted site builder, plain static hosting): all four others work
  with a script,
- you need several users or teams with their own logins: Looku has one admin password and API keys,
- you need heatmaps or session recordings: Looku has neither,
- you already run PostgreSQL or ClickHouse and want to use them.

## Sources

Read on 4 November 2026.

- Plausible: [github.com/plausible/analytics](https://github.com/plausible/analytics) (license, databases,
  Community Edition), [community-edition compose.yml](https://github.com/plausible/community-edition/blob/master/compose.yml)
  (containers, v3.2.1), [Events API](https://plausible.io/docs/events-api)
- Umami: [github.com/umami-software/umami](https://github.com/umami-software/umami) (license, PostgreSQL),
  [docker-compose.yml](https://github.com/umami-software/umami/blob/master/docker-compose.yml),
  [Sending stats](https://docs.umami.is/docs/api/sending-stats)
- GoatCounter: [github.com/arp242/goatcounter](https://github.com/arp242/goatcounter) (databases, ways to collect,
  binaries), [LICENSE](https://github.com/arp242/goatcounter/blob/master/LICENSE)
- Matomo: [requirements](https://matomo.org/faq/on-premise/matomo-requirements/),
  [Log Analytics](https://matomo.org/log-analytics/), [github.com/matomo-org/matomo](https://github.com/matomo-org/matomo)
  (license)

Found a mistake? [Open an issue](https://github.com/niemenjoki/Looku/issues).
