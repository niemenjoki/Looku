import {
  browserFamily,
  cleanText,
  deviceType,
  isBot,
  normalizeCountry,
  normalizePath,
  osFamily,
  parseReferrer,
} from "./classify.js";
import { dayKey } from "./time.js";
import { createVisitorHasher } from "./visitor.js";

const MAX_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

export class IngestError extends Error {}

// Times outside a day back or five minutes ahead are replaced with the
// receive time, so a wrong clock on the site cannot scatter the data.
function eventTime(value, now) {
  const time = Date.parse(value);
  if (
    Number.isNaN(time) ||
    time < now.getTime() - MAX_PAST_MS ||
    time > now.getTime() + MAX_FUTURE_MS
  ) {
    return now;
  }
  return new Date(time);
}

function clientInfo(payload) {
  const ip = cleanText(payload.ip, 100);
  const userAgent = cleanText(payload.ua, 500);
  return { ip, userAgent };
}

export function createIngest(db) {
  const visitorHash = createVisitorHasher(db);

  const insertPageview = db.prepare(
    `INSERT INTO pageviews (site_id, ts, day, visitor_hash, path, referrer_host,
       referrer_path, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       device, browser_family, os_family, country, source)
     VALUES (@site_id, @ts, @day, @visitor_hash, @path, @referrer_host,
       @referrer_path, @utm_source, @utm_medium, @utm_campaign, @utm_content,
       @utm_term, @device, @browser_family, @os_family, @country, @source)`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (site_id, ts, day, visitor_hash, path, name, target, value, props_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEventItem = db.prepare(
    "INSERT INTO event_items (event_id, sku, quantity) VALUES (?, ?, ?)",
  );
  const insertEngagement = db.prepare(
    `INSERT INTO engagement (site_id, ts, day, path, dwell_ms, max_scroll_pct)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const setLastIngest = db.prepare(
    "INSERT INTO meta (key, value) VALUES ('last_ingest', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  function recordPageview(site, payload, now = new Date()) {
    const { ip, userAgent } = clientInfo(payload);
    if (!ip || !userAgent) {
      throw new IngestError("ip and ua are required for a page view.");
    }
    // Bots are filtered here too, in case the site's own filter misses some.
    if (isBot(userAgent)) {
      return { stored: false, reason: "bot" };
    }

    const time = eventTime(payload.ts, now);
    const referrer = parseReferrer(payload.referrer, site.domain);
    const row = {
      site_id: site.site_id,
      ts: time.toISOString(),
      day: dayKey(time, site.timezone),
      visitor_hash: visitorHash(site, ip, userAgent, now),
      path: normalizePath(payload.path),
      referrer_host: referrer.host,
      referrer_path: referrer.path,
      device: deviceType(userAgent),
      browser_family: browserFamily(userAgent),
      os_family: osFamily(userAgent),
      country: normalizeCountry(payload.country),
      source: payload.source === "client" ? "client" : "server",
    };
    for (const field of UTM_FIELDS) {
      row[field] = cleanText(payload[field], 120);
    }

    insertPageview.run(row);
    setLastIngest.run(now.toISOString());
    return { stored: true };
  }

  const recordEvent = db.transaction((site, payload, now = new Date()) => {
    const name = cleanText(payload.name, 80);
    if (!name) {
      throw new IngestError("name is required for an event.");
    }
    const { ip, userAgent } = clientInfo(payload);
    if (userAgent && isBot(userAgent)) {
      return { stored: false, reason: "bot" };
    }

    const time = eventTime(payload.ts, now);
    const value = Number(payload.value);
    let props = "{}";
    if (payload.props && typeof payload.props === "object") {
      props = JSON.stringify(payload.props);
      if (props.length > 2000) {
        throw new IngestError("props is too large.");
      }
    }

    const { lastInsertRowid } = insertEvent.run(
      site.site_id,
      time.toISOString(),
      dayKey(time, site.timezone),
      ip && userAgent ? visitorHash(site, ip, userAgent, now) : null,
      normalizePath(payload.path),
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
    setLastIngest.run(now.toISOString());
    return { stored: true };
  });

  function recordEngagement(site, payload, now = new Date()) {
    const dwellMs = Math.trunc(Number(payload.dwell_ms));
    const scroll = Math.trunc(Number(payload.max_scroll_pct));
    if (!(dwellMs >= 0) || !(scroll >= 0)) {
      throw new IngestError("dwell_ms and max_scroll_pct are required.");
    }

    const time = eventTime(payload.ts, now);
    insertEngagement.run(
      site.site_id,
      time.toISOString(),
      dayKey(time, site.timezone),
      normalizePath(payload.path),
      Math.min(dwellMs, 6 * 60 * 60 * 1000),
      Math.min(scroll, 100),
    );
    setLastIngest.run(now.toISOString());
    return { stored: true };
  }

  return function ingest(site, payload, now = new Date()) {
    if (!payload || typeof payload !== "object") {
      throw new IngestError("Body must be a JSON object.");
    }
    switch (payload.type) {
      case "pageview":
        return recordPageview(site, payload, now);
      case "event":
        return recordEvent(site, payload, now);
      case "engagement":
        return recordEngagement(site, payload, now);
      default:
        throw new IngestError("type must be pageview, event or engagement.");
    }
  };
}
