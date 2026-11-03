---
title: Moving from another system
description: Import page views, events and reading time that your previous analytics collected, so your history continues in Looku.
sidebar:
  order: 5
---

If your site used another analytics system before, you can bring its history into Looku with
`looku history:import`. Your charts then continue without a gap.

**You need:** the earlier data as a file with one JSON object per line (JSON lines). Most systems can export to CSV
or JSON; you convert that to the format below with a small script or a spreadsheet.

## File format

```json
{"type":"pageview","ts":"2026-10-29T08:00:00Z","path":"/","visitor_hash":"a1b2c3","referrer_host":"google.com","referrer_path":"/","utm_source":"","utm_medium":"","utm_campaign":"","utm_content":"","utm_term":""}
{"type":"engagement","ts":"2026-10-29T08:02:00Z","path":"/","dwell_ms":12000,"max_scroll_pct":80}
{"type":"event","ts":"2026-10-29T08:03:00Z","path":"/","name":"add_to_cart","target":"","value":null,"props":{},"items":[{"sku":"A1","quantity":1}]}
```

| Field | For | What |
|---|---|---|
| `type` | all | `pageview`, `engagement` or `event` |
| `ts` | all | time in UTC (ISO 8601); Looku counts the day in the site's time zone |
| `path` | all | the page path |
| `visitor_hash` | page views | the earlier system's daily visitor identifier, never an IP address. Without it, every page view counts as a new visitor |
| `referrer_host`, `referrer_path`, `utm_…` | page views | optional |
| `dwell_ms`, `max_scroll_pct` | engagement | reading time in milliseconds and scroll depth 0–100 |
| `name`, `target`, `value`, `props`, `items` | events | as in [events](/looku/guides/consent-and-browser/#events) |

Device, browser and country stay empty for imported rows.

## Import

Find the time of the first page view Looku received itself: in the dashboard, or ask yourself when you connected the
site. Use it as `--before`, so that nothing is counted twice. Copy the file to the server's `deploy` folder
(from your own computer: `scp history.jsonl you@192.168.1.10:looku/deploy/`), and in that folder run:

```bash
docker compose run --rm -v "$PWD/history.jsonl:/tmp/history.jsonl:ro" ingest history:import myblog /tmp/history.jsonl --before 2026-11-02T12:00:00Z
```

You should see a summary like:

```
3 page views, 1 events, 1 engagement rows imported to myblog; 1 skipped at or after --before, 0 older than the retention; 1 days rolled up.
```

## Rules

- **All or nothing.** If one line is invalid, nothing is imported, and the message says which line. Fix it and run
  again.
- **The same file cannot be imported twice.** A changed file counts as a new file, so do not import overlapping
  files.
- **Put each day's rows in one file.** Visitor identifiers are hashed again with a key that exists only during one
  import, so the same visitor on the same day in two files would count twice.
- Rows older than the site's retention period (default 25 months) are skipped.
- Finished days are added up right away; the last two days are added up by the next nightly job.

For what this means for privacy, see [Privacy and the law](/looku/privacy/#what-looku-does).
