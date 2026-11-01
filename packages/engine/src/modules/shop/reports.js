import { sessionedPageviews } from "../../sessions.js";
import { addDays } from "../../time.js";
import { checkRange, dailyTotals, pageRows, previousRange, sumTotals } from "../perus/reports.js";

// Shop module. Orders come from the shop adapter (POST /orders) without
// personal data and are never linked to visitors or sessions, so conversion
// is orders per session over the whole period, not a per-visitor path.
// The funnel steps are counted from the server page views of all visitors;
// cart events from the browser collector are a consented sample and are
// reported separately.

function orderTotals(db, siteId, { from, to }) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders_ext WHERE site_id = ? AND day BETWEEN ? AND ?`,
    )
    .get(siteId, from, to);
  return { orders: row.orders, revenue: Math.round(row.revenue * 100) / 100 };
}

function rate(part, total) {
  return total ? Math.round((part / total) * 10000) / 100 : 0;
}

function periodSummary(db, siteId, range) {
  const { sessions } = sumTotals(dailyTotals(db, siteId, range));
  const { orders, revenue } = orderTotals(db, siteId, range);
  return {
    range,
    orders,
    revenue,
    average_order: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
    sessions,
    conversion_pct: rate(orders, sessions),
  };
}

export function summary(db, siteId, range, { compare = false } = {}) {
  checkRange(range);
  const result = periodSummary(db, siteId, range);
  if (compare) {
    result.previous = periodSummary(db, siteId, previousRange(range));
  }
  return result;
}

export function timeseries(db, siteId, range) {
  checkRange(range);
  const sessions = new Map(dailyTotals(db, siteId, range).map((row) => [row.day, row.sessions]));
  const orders = new Map(
    db
      .prepare(
        `SELECT day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders_ext
         WHERE site_id = ? AND day BETWEEN ? AND ? GROUP BY day`,
      )
      .all(siteId, range.from, range.to)
      .map((row) => [row.day, row]),
  );
  const points = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const order = orders.get(day);
    points.push({
      period: day,
      orders: order?.orders || 0,
      revenue: Math.round((order?.revenue || 0) * 100) / 100,
      sessions: sessions.get(day) || 0,
    });
  }
  return { range, interval: "day", points };
}

// Sessions that reached each step, from the raw page views (kept for the
// retention period). A step without a configured path is left out.
export function funnel(db, siteId, range, shop = {}) {
  checkRange(range);
  // Product pages match by prefix; cart and checkout match the path itself
  // or its subpages, so "/ostoskori" does not match "/ostoskorit-ohje".
  const steps = [
    ["product", shop.product_prefix, false],
    ["cart", shop.cart_path, true],
    ["checkout", shop.checkout_path, true],
  ].filter(([, prefix]) => prefix);

  const columns = steps
    .map(([id, , exact]) =>
      exact
        ? `, MAX(path = ? OR substr(path, 1, length(?) + 1) = ? || '/') AS ${id}`
        : `, MAX(substr(path, 1, length(?)) = ?) AS ${id}`,
    )
    .join("");
  const sums = steps.map(([id]) => `, COALESCE(SUM(${id}), 0) AS ${id}`).join("");
  const params = steps.flatMap(([, prefix, exact]) => (exact ? [prefix, prefix, prefix] : [prefix, prefix]));
  const row = db
    .prepare(
      `WITH t AS (
         SELECT s.*, SUM(s.is_entry) OVER (
           PARTITION BY s.day, s.visitor_hash ORDER BY s.ts, s.id ROWS UNBOUNDED PRECEDING
         ) AS session_no
         FROM (${sessionedPageviews("p.site_id = ? AND p.day BETWEEN ? AND ?")}) s
       )
       SELECT COUNT(*) AS sessions ${sums} FROM (
         SELECT 1 AS one ${columns} FROM t GROUP BY day, visitor_hash, session_no
       )`,
    )
    .get(siteId, range.from, range.to, ...params);
  const { orders } = orderTotals(db, siteId, range);

  return {
    range,
    steps: [
      { id: "sessions", count: row.sessions, pct: row.sessions ? 100 : 0 },
      ...steps.map(([id]) => ({ id, count: row[id], pct: rate(row[id], row.sessions) })),
      { id: "order", count: orders, pct: rate(orders, row.sessions) },
    ],
    configured: steps.length > 0,
  };
}

export function products(db, siteId, range, shop = {}, { limit = 20 } = {}) {
  checkRange(range);
  const rowLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 200);

  const sold = db
    .prepare(
      `SELECT json_extract(j.value, '$.sku') AS sku,
              MAX(json_extract(j.value, '$.name')) AS name,
              SUM(json_extract(j.value, '$.quantity')) AS quantity,
              SUM(json_extract(j.value, '$.quantity') * json_extract(j.value, '$.price')) AS revenue,
              COUNT(DISTINCT o.external_id) AS orders
       FROM orders_ext o, json_each(o.items_json) j
       WHERE o.site_id = ? AND o.day BETWEEN ? AND ?
       GROUP BY sku ORDER BY quantity DESC, sku LIMIT ?`,
    )
    .all(siteId, range.from, range.to, rowLimit)
    .map((row) => ({
      ...row,
      name: row.name || "",
      revenue: row.revenue === null ? null : Math.round(row.revenue * 100) / 100,
    }));

  const prefix = shop.product_prefix;
  const pages = prefix
    ? pageRows(db, siteId, range)
        .filter((row) => row.value.startsWith(prefix) && row.value !== prefix)
        .sort((a, b) => b.pageviews - a.pageviews || a.value.localeCompare(b.value))
        .slice(0, rowLimit)
        .map(({ value, pageviews, entries }) => ({ value, pageviews, entries }))
    : [];

  const cartRows = db
    .prepare(
      `SELECT i.sku AS sku, SUM(i.quantity) AS quantity, COUNT(DISTINCT e.id) AS events
       FROM events e JOIN event_items i ON i.event_id = e.id
       WHERE e.site_id = ? AND e.day BETWEEN ? AND ? AND e.name = 'add_to_cart'
       GROUP BY i.sku ORDER BY quantity DESC, sku LIMIT ?`,
    )
    .all(siteId, range.from, range.to, rowLimit);
  const cartEvents = db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
       WHERE site_id = ? AND day BETWEEN ? AND ? AND name = 'add_to_cart'`,
    )
    .get(siteId, range.from, range.to).n;

  return {
    range,
    sold,
    pages,
    cart_sample: { sample: true, sample_size: cartEvents, rows: cartRows },
  };
}
