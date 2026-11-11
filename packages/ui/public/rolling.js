// Conversion over a rolling window of up to `days` days at each day: orders
// divided by sessions of the same days, so a single order on a quiet day does
// not swing the line. The window starts no earlier than the first day with
// sessions, so right after sessions start the points use 1, 2, ... days. Days
// before that (for example orders imported from an earlier system) have no
// sessions to divide by and get no rate.
//
// points: [{ period, orders, sessions }] in order, one per day.
// from: the first period to return; earlier points only fill the window.
export function rollingConversion(points, from, days = 7) {
  const first = points.findIndex((x) => x.sessions > 0);
  const rows = [];
  points.forEach((pt, i) => {
    if (pt.period < from) return;
    if (first < 0 || i < first) {
      rows.push({ period: pt.period, rate: null, orders: 0, sessions: 0, days: 0, day: pt });
      return;
    }
    const window = points.slice(Math.max(first, i - days + 1), i + 1);
    const orders = window.reduce((sum, x) => sum + x.orders, 0);
    const sessions = window.reduce((sum, x) => sum + x.sessions, 0);
    rows.push({ period: pt.period, rate: sessions ? (orders / sessions) * 100 : null, orders, sessions, days: window.length, day: pt });
  });
  return rows;
}
