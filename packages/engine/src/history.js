import crypto from "node:crypto";

import { cleanText, normalizePath } from "./classify.js";
import { IngestError } from "./ingest.js";
import { rollupDay } from "./maintenance.js";
import { addDays, dayKey, subtractMonths } from "./time.js";
import { randomVisitor } from "./visitor.js";

const EARLIEST = Date.parse("2000-01-01T00:00:00Z");
const MAX_FUTURE_MS = 5 * 60 * 1000;
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function historyTime(value, now) {
  const time = Date.parse(value);
  if (Number.isNaN(time) || time < EARLIEST || time > now.getTime() + MAX_FUTURE_MS) {
    throw new IngestError("ts must be an ISO 8601 time, not in the future.");
  }
  return new Date(time);
}

function dayStart(time) {
  return `${time.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

// Imports page views, events and engagement that an earlier system collected,
// e.g. a site moving to Looku. Unlike POST /ingest, past times are kept as
// such. Rows carry no IP address or user agent: page views bring the earlier
// system's daily visitor hash, which is hashed again with a key that exists
// only during this import, so the stored hashes cannot be matched to the
// earlier system's rows. A day's rows therefore belong in one file.
// The same file cannot be imported twice; rows at or after `before` and rows
// older than the site's retention are skipped; finished days are rolled up.
export function importHistory(db, site, text, { before = null, now = new Date() } = {}) {
  const fileHash = crypto.createHash("sha256").update(text).digest("hex");
  const previous = db
    .prepare("SELECT imported_at FROM history_imports WHERE site_id = ? AND file_sha256 = ?")
    .get(site.site_id, fileHash);
  if (previous) {
    throw new Error(`This file was already imported to ${site.site_id} at ${previous.imported_at}.`);
  }
  const beforeTime = before === null ? null : Date.parse(before);
  if (Number.isNaN(beforeTime)) {
    throw new Error("--before must be an ISO 8601 time.");
  }

  const key = crypto.randomBytes(32);
  const rehash = (day, hash) =>
    crypto.createHmac("sha256", key).update(`${day}\0${hash}`).digest("hex").slice(0, 32);
  const cutoff = subtractMonths(dayKey(now, site.timezone), site.retention_months);

  const insertPageview = db.prepare(
    `INSERT INTO pageviews (site_id, ts, day, visitor_hash, path, referrer_host, referrer_path,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, source)
     VALUES (@site_id, @ts, @day, @visitor_hash, @path, @referrer_host, @referrer_path,
       @utm_source, @utm_medium, @utm_campaign, @utm_content, @utm_term, 'server')`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (site_id, ts, day, visitor_hash, path, name, target, value, props_json)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  const insertEventItem = db.prepare("INSERT INTO event_items (event_id, sku, quantity) VALUES (?, ?, ?)");
  const insertEngagement = db.prepare(
    `INSERT INTO engagement (site_id, ts, day, path, dwell_ms, max_scroll_pct)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const counts = { pageview: 0, event: 0, engagement: 0, skippedBefore: 0, skippedRetention: 0 };
  const pageviewDays = new Set();

  function record(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new IngestError("Each line must be a JSON object.");
    }
    if (!["pageview", "event", "engagement"].includes(payload.type)) {
      throw new IngestError("type must be pageview, event or engagement.");
    }
    const time = historyTime(payload.ts, now);
    if (beforeTime !== null && time.getTime() >= beforeTime) {
      counts.skippedBefore += 1;
      return;
    }
    const day = dayKey(time, site.timezone);
    if (day < cutoff) {
      counts.skippedRetention += 1;
      return;
    }
    const path = normalizePath(payload.path);

    if (payload.type === "pageview") {
      const hash = cleanText(payload.visitor_hash, 128);
      const row = {
        site_id: site.site_id,
        ts: time.toISOString(),
        day,
        visitor_hash: site.visitors === "off" || !hash ? randomVisitor() : rehash(day, hash),
        path,
        referrer_host: cleanText(payload.referrer_host, 200).toLowerCase(),
        referrer_path: cleanText(payload.referrer_path, 300),
      };
      for (const field of UTM_FIELDS) {
        row[field] = cleanText(payload[field], 120);
      }
      insertPageview.run(row);
      pageviewDays.add(day);
    } else if (payload.type === "event") {
      const name = cleanText(payload.name, 80);
      if (!name) {
        throw new IngestError("name is required for an event.");
      }
      const props = payload.props && typeof payload.props === "object" ? JSON.stringify(payload.props) : "{}";
      if (props.length > 2000) {
        throw new IngestError("props is too large.");
      }
      const value = payload.value === null || payload.value === undefined ? NaN : Number(payload.value);
      // Imported events are not linked to a visitor, so like unhashed events
      // they keep only the day.
      const { lastInsertRowid } = insertEvent.run(
        site.site_id,
        dayStart(time),
        day,
        path,
        name,
        cleanText(payload.target, 200),
        Number.isFinite(value) ? value : null,
        props,
      );
      const items = Array.isArray(payload.items) ? payload.items.slice(0, 50) : [];
      for (const item of items) {
        const sku = cleanText(item?.sku, 80);
        const quantity = Math.trunc(Number(item?.quantity));
        if (sku && quantity > 0) {
          insertEventItem.run(lastInsertRowid, sku, Math.min(quantity, 10000));
        }
      }
    } else {
      const dwellMs = Math.trunc(Number(payload.dwell_ms));
      const scroll = Math.trunc(Number(payload.max_scroll_pct));
      if (!(dwellMs >= 0) || !(scroll >= 0)) {
        throw new IngestError("dwell_ms and max_scroll_pct are required.");
      }
      insertEngagement.run(
        site.site_id,
        dayStart(time),
        day,
        path,
        Math.min(dwellMs, 6 * 60 * 60 * 1000),
        Math.min(scroll, 100),
      );
    }
    counts[payload.type] += 1;
  }

  const lines = text.split(/\r?\n/);
  db.transaction(() => {
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      try {
        record(JSON.parse(line));
      } catch (error) {
        throw new Error(`Line ${index + 1}: ${error.message}`);
      }
    });
    db.prepare(
      "INSERT INTO history_imports (site_id, file_sha256, imported_at, counts_json) VALUES (?, ?, ?, ?)",
    ).run(site.site_id, fileHash, now.toISOString(), JSON.stringify(counts));
  })();

  // Days the nightly job would already have rolled up are rolled up now; newer
  // days are read from the raw rows until the nightly job rolls them up.
  const lastFinished = addDays(dayKey(now, site.timezone), -2);
  const rolledUp = [...pageviewDays].filter((day) => day <= lastFinished).sort();
  for (const day of rolledUp) {
    rollupDay(db, site.site_id, day);
  }
  return { ...counts, daysRolledUp: rolledUp.length };
}
