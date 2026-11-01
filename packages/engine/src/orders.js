import { cleanText } from "./classify.js";
import { IngestError } from "./ingest.js";
import { dayKey } from "./time.js";

const MAX_FUTURE_MS = 5 * 60 * 1000;
const EARLIEST = Date.parse("2000-01-01T00:00:00Z");
const MAX_ITEMS = 100;
const MAX_TOTAL = 10_000_000;

function money(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_TOTAL) {
    throw new IngestError(`${field} must be a number between 0 and ${MAX_TOTAL}.`);
  }
  return Math.round(number * 100) / 100;
}

// Only these fields are kept, so personal data the shop might send along
// (names, addresses, emails) is never stored.
export function normalizeOrder(payload, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new IngestError("Body must be a JSON object.");
  }
  const externalId = ["string", "number"].includes(typeof payload.id) ? cleanText(payload.id, 80) : "";
  if (!externalId) {
    throw new IngestError("id is required for an order.");
  }
  if (payload.status === "cancelled") {
    return { externalId, cancelled: true };
  }

  // Orders are the shop's own records, so past times are kept as such; this
  // also lets the shop send its order history.
  const time = Date.parse(payload.ts);
  if (Number.isNaN(time) || time < EARLIEST || time > now.getTime() + MAX_FUTURE_MS) {
    throw new IngestError("ts must be an ISO 8601 time, not in the future.");
  }

  if (payload.items !== undefined && !Array.isArray(payload.items)) {
    throw new IngestError("items must be a list.");
  }
  const items = [];
  for (const item of (payload.items || []).slice(0, MAX_ITEMS)) {
    const sku = cleanText(item?.sku, 80);
    const quantity = Math.trunc(Number(item?.quantity));
    if (!sku || !(quantity > 0)) {
      throw new IngestError("Each item needs a sku and a positive quantity.");
    }
    items.push({
      sku,
      name: cleanText(item.name, 120),
      quantity: Math.min(quantity, 10000),
      price: item.price === undefined ? null : money(item.price, "price"),
    });
  }

  return {
    externalId,
    cancelled: false,
    time: new Date(time),
    total: money(payload.total, "total"),
    items,
    utmCampaign: cleanText(payload.utm_campaign, 120),
  };
}

export function createOrderIngest(db) {
  const upsert = db.prepare(
    `INSERT INTO orders_ext (site_id, external_id, ts, day, total, items_json, utm_campaign)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site_id, external_id) DO UPDATE SET
       ts = excluded.ts, day = excluded.day, total = excluded.total,
       items_json = excluded.items_json, utm_campaign = excluded.utm_campaign`,
  );
  const remove = db.prepare("DELETE FROM orders_ext WHERE site_id = ? AND external_id = ?");

  // A repeated order replaces the earlier one, and status "cancelled" removes
  // it, so the shop can resend changed orders.
  return function recordOrder(site, payload, now = new Date()) {
    const order = normalizeOrder(payload, now);
    if (order.cancelled) {
      return { stored: remove.run(site.site_id, order.externalId).changes > 0, cancelled: true };
    }
    upsert.run(
      site.site_id,
      order.externalId,
      order.time.toISOString(),
      dayKey(order.time, site.timezone),
      order.total,
      JSON.stringify(order.items),
      order.utmCampaign,
    );
    return { stored: true };
  };
}
