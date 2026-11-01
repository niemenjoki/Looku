import { checkRange, pageRows, previousRange } from "../perus/reports.js";

// Content module. Reading time and scroll depth come from the browser
// collector, only from visitors who consented, and are never linked to a
// visitor (decision 7), so they are a sample: every result says so and gives
// the sample size. Rising pages use the server page views of all visitors.

const READ_THROUGH_PCT = 75;

export function engagement(db, siteId, range, { limit = 50 } = {}) {
  checkRange(range);
  const rowLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500);
  const where = "site_id = ? AND day BETWEEN ? AND ?";
  const params = [siteId, range.from, range.to];

  const rows = db
    .prepare(
      `SELECT path AS value, COUNT(*) AS n,
              ROUND(AVG(max_scroll_pct)) AS avg_scroll_pct,
              ROUND(100.0 * SUM(max_scroll_pct >= ${READ_THROUGH_PCT}) / COUNT(*)) AS read_through_pct
       FROM engagement WHERE ${where}
       GROUP BY path ORDER BY n DESC, path LIMIT ?`,
    )
    .all(...params, rowLimit);

  // Median, because a tab left open would skew an average.
  const medians = new Map(
    db
      .prepare(
        `SELECT path, AVG(dwell_ms) AS median_ms FROM (
           SELECT path, dwell_ms,
                  ROW_NUMBER() OVER (PARTITION BY path ORDER BY dwell_ms) AS rn,
                  COUNT(*) OVER (PARTITION BY path) AS c
           FROM engagement WHERE ${where}
         ) WHERE rn IN ((c + 1) / 2, (c + 2) / 2) GROUP BY path`,
      )
      .all(...params)
      .map((row) => [row.path, row.median_ms]),
  );
  const sampleSize = db.prepare(`SELECT COUNT(*) AS n FROM engagement WHERE ${where}`).get(...params).n;

  return {
    range,
    sample: true,
    sample_size: sampleSize,
    rows: rows.map((row) => ({
      ...row,
      median_seconds: Math.round((medians.get(row.value) || 0) / 1000),
    })),
  };
}

// Pages whose page views grew the most compared with the previous period.
export function rising(db, siteId, range, { limit = 20, min = 3 } = {}) {
  checkRange(range);
  const rowLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 200);
  const minimum = Math.max(Math.trunc(Number(min)) || 3, 1);
  const previous = new Map(
    pageRows(db, siteId, previousRange(range)).map((row) => [row.value, row.pageviews]),
  );
  const rows = pageRows(db, siteId, range)
    .map((row) => {
      const before = previous.get(row.value) || 0;
      return {
        value: row.value,
        pageviews: row.pageviews,
        previous_pageviews: before,
        change: row.pageviews - before,
        change_pct: before ? Math.round(((row.pageviews - before) / before) * 100) : null,
      };
    })
    .filter((row) => row.change > 0 && row.pageviews >= minimum)
    .sort((a, b) => b.change - a.change || a.value.localeCompare(b.value))
    .slice(0, rowLimit);
  return { range, previous: { range: previousRange(range) }, rows };
}
