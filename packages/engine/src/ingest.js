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
import { createVisitorHasher, randomVisitor } from "./visitor.js";

const MAX_PAST_MS = 24 * 60 * 60 * 1000;
// A visitor who loads more pages than this within the window is a bot that
// passes as a browser: its page views and events are removed, and later ones
// on the same day are not stored.
export const BURST_PAGES = 20;
export const BURST_MS = 2 * 60 * 1000;
// A faster burst under the limit above: nobody reads five pages in three
// seconds, but a crawler that walks the menu does.
export const FAST_BURST_PAGES = 4;
export const FAST_BURST_MS = 3 * 1000;
const BURSTS = [
  [BURST_PAGES, BURST_MS],
  [FAST_BURST_PAGES, FAST_BURST_MS],
];
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

// Engagement and unhashed events keep only the day (decision 7).
function dayStart(time) {
  return `${time.toISOString().slice(0, 10)}T00:00:00.000Z`;
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
  const isBotVisitor = db.prepare(
    "SELECT 1 FROM bot_visitors WHERE site_id = ? AND visitor_hash = ?",
  );
  const countRecent = db.prepare(
    "SELECT COUNT(*) AS n FROM pageviews WHERE site_id = ? AND visitor_hash = ? AND ts > ?",
  );
  const markBot = db.transaction((siteId, hash, day) => {
    db.prepare(
      "INSERT INTO bot_visitors (site_id, visitor_hash, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    ).run(siteId, hash, day);
    db.prepare("DELETE FROM pageviews WHERE site_id = ? AND visitor_hash = ?").run(siteId, hash);
    db.prepare("DELETE FROM events WHERE site_id = ? AND visitor_hash = ?").run(siteId, hash);
  });
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
      visitor_hash: site.visitors === "off" ? randomVisitor() : visitorHash(site, ip, userAgent, now),
      path: normalizePath(payload.path),
      referrer_host: referrer.host,
      referrer_path: referrer.path,
      device: deviceType(userAgent),
      browser_family: browserFamily(userAgent),
      os_family: osFamily(userAgent),
      country: site.store_country === 0 ? "" : normalizeCountry(payload.country),
      source: payload.source === "client" ? "client" : "server",
    };
    for (const field of UTM_FIELDS) {
      row[field] = cleanText(payload[field], 120);
    }

    if (site.visitors !== "off") {
      if (isBotVisitor.get(site.site_id, row.visitor_hash)) {
        return { stored: false, reason: "bot" };
      }
      for (const [pages, ms] of BURSTS) {
        const since = new Date(time.getTime() - ms).toISOString();
        if (countRecent.get(site.site_id, row.visitor_hash, since).n >= pages) {
          markBot(site.site_id, row.visitor_hash, row.day);
          return { stored: false, reason: "bot" };
        }
      }
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

    // Without a visitor hash, the time is kept only to the day, so the event
    // cannot be matched to a page view by its time.
    const hashed = Boolean(ip && userAgent) && site.visitors !== "off";
    const hash = hashed ? visitorHash(site, ip, userAgent, now) : null;
    if (hash && isBotVisitor.get(site.site_id, hash)) {
      return { stored: false, reason: "bot" };
    }
    const { lastInsertRowid } = insertEvent.run(
      site.site_id,
      hashed ? time.toISOString() : dayStart(time),
      dayKey(time, site.timezone),
      hash,
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
      dayStart(time),
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
