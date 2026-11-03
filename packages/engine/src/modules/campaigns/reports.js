import { breakdown, checkRange, previousRange } from "../perus/reports.js";

// Campaigns module: UTM campaigns compared with the previous period of the
// same length, with orders from the shop adapter by campaign.

function orderRows(db, siteId, range) {
  const window = range.since ? " AND ts > ? AND ts <= ?" : "";
  return new Map(
    db
      .prepare(
        `SELECT utm_campaign AS value, COUNT(*) AS orders, SUM(total) AS revenue
         FROM orders_ext WHERE site_id = ? AND day BETWEEN ? AND ?${window} AND utm_campaign <> ''
         GROUP BY utm_campaign`,
      )
      .all(siteId, range.from, range.to, ...(range.since ? [range.since, range.until] : []))
      .map((row) => [row.value, row]),
  );
}

function sessionRows(db, siteId, range) {
  return new Map(
    breakdown(db, siteId, "utm_campaign", range, { limit: 1000 })
      .rows.filter((row) => row.value)
      .map((row) => [row.value, row]),
  );
}

// measure "pageviews" compares campaigns by page views instead of sessions
// (sites without the visitor hash).
export function overview(db, siteId, range, { limit = 50, measure = "sessions" } = {}) {
  const field = measure === "pageviews" ? "pageviews" : "entries";
  checkRange(range);
  const rowLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500);
  const previous = previousRange(range);
  const now = sessionRows(db, siteId, range);
  const before = sessionRows(db, siteId, previous);
  const orders = orderRows(db, siteId, range);
  const previousOrders = orderRows(db, siteId, previous);

  const names = new Set([...now.keys(), ...before.keys(), ...orders.keys()]);
  const rows = [...names].map((value) => {
    const sessions = now.get(value)?.[field] || 0;
    const previousSessions = before.get(value)?.[field] || 0;
    let status = "same";
    if (!previousSessions && sessions) {
      status = "new";
    } else if (previousSessions && !sessions) {
      status = "ended";
    } else if (sessions > previousSessions) {
      status = "up";
    } else if (sessions < previousSessions) {
      status = "down";
    }
    return {
      value,
      count: sessions,
      previous_count: previousSessions,
      change_pct: previousSessions
        ? Math.round(((sessions - previousSessions) / previousSessions) * 100)
        : null,
      pageviews: now.get(value)?.pageviews || 0,
      orders: orders.get(value)?.orders || 0,
      revenue: Math.round((orders.get(value)?.revenue || 0) * 100) / 100,
      previous_orders: previousOrders.get(value)?.orders || 0,
      status,
    };
  });
  rows.sort((a, b) => b.count - a.count || b.orders - a.orders || a.value.localeCompare(b.value));

  const rising = rows
    .filter((row) => row.count > row.previous_count)
    .sort((a, b) => b.count - b.previous_count - (a.count - a.previous_count))
    .slice(0, 5)
    .map((row) => row.value);

  return { range, previous: { range: previous }, measure: field === "entries" ? "sessions" : "pageviews", rows: rows.slice(0, rowLimit), rising };
}
