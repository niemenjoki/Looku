---
title: Read API
description: Read Looku's numbers from your own dashboards, scripts or Home Assistant with an API key.
sidebar:
  order: 3
---

The dashboard itself uses only the read API, so everything it shows is also available to you. The API returns totals
only, never single page views or visitor hashes. The full description is at `/api/v1/openapi.json` on your dashboard
address.

## Get a key

In the dashboard settings, or on the server:

```bash
docker compose run --rm ingest token:create homeassistant --scope read --site myblog
```

It prints `Key 1 created. Key (shown once):` and a key starting with `lk_`. A `read` key can read reports; an `admin`
key can also change settings and keys. `--site` limits the key to one site.

Send it in the `Authorization` header:

```bash
curl -H "Authorization: Bearer lk_…" "http://192.168.1.10:8788/api/v1/sites/myblog/summary?range=7d"
```

The API is on the dashboard's address, so the same rules apply: `LOOKU_API_HOSTS`, `LOOKU_API_ALLOW` and, on a home
server, your home network.

## Reports

All report paths start with `/api/v1/sites/<site>/`. Choose the period with `range` (`7d`, `28d`, `3m`, `12m`;
default `28d`, ending today in the site's time zone) or with `from` and `to` (`YYYY-MM-DD`).

| Path | Returns |
|---|---|
| `summary` | page views, visitors, sessions, pages per session; `compare=previous` adds the previous period |
| `timeseries` | totals per `interval`: `hour` (at most 31 days), `day`, `week` or `month` |
| `breakdown/<dimension>` | totals by `page`, `entry`, `exit`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `device`, `browser`, `os`, `country` or `page_group`; `limit` (default 50), `sort` |
| `reports/<module>/<report>` | module reports: `shop/summary`, `shop/timeseries`, `shop/funnel`, `shop/products`, `campaigns/overview`, `content/engagement`, `content/rising` |
| `export.csv?report=…` | any of the above as CSV |

`summary`, `timeseries` and `breakdown` also take filters: `page_group`, `utm_campaign`, `device`.

Every answer has `meta` (site, time zone, period) and `data`. When `meta.sample` is `true`, the numbers come only from
consenting visitors (reading time).

## Other paths

| Path | |
|---|---|
| `GET /api/v1/health` | status and version, no key needed |
| `GET /api/v1/sites` | sites this key can read |
| `GET /api/v1/modules` | modules and their reports |
| `GET /api/v1/me` | what the current key may do |
| `GET`, `PUT /api/v1/sites/<site>/config` | dashboard settings of a site (`PUT` needs an admin key) |
| `GET`, `POST /api/v1/tokens`, `DELETE /api/v1/tokens/<id>` | manage keys (admin) |

## Home Assistant example

A sensor for the last seven days' page views, in `configuration.yaml`:

```yaml
rest:
  - resource: http://192.168.1.10:8788/api/v1/sites/myblog/summary?range=7d
    headers:
      Authorization: !secret looku_key
    scan_interval: 900
    sensor:
      - name: Looku page views 7 days
        value_template: "{{ value_json.data.pageviews }}"
```

and in `secrets.yaml`: `looku_key: "Bearer lk_…"`. The `summary` answer looks like this, so other fields work the
same way (`value_json.data.visitors`):

```json
{"meta":{"site":"myblog","timezone":"Europe/Helsinki","range":{"from":"2026-10-28","to":"2026-11-03"},"sample":false},
 "data":{"pageviews":412,"visitors":198,"sessions":231,"pages_per_session":1.8}}
```
