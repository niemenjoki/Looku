import { DIMENSION_COLUMNS, sessionedPageviews } from "../../sessions.js";
import { addDays, isDayKey } from "../../time.js";

// Basic module reports. Rolled-up days are read from the rollup tables and
// the rest (today, and days not rolled up yet) from the raw page views, so the
// numbers are the same before and after the nightly job. Visitors over several
// days are the sum of daily visitors, because the visitor hash changes daily.

// A bad request (range, dimension, interval); the API answers 400.
export class ReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportError";
  }
}

export const BREAKDOWN_DIMENSIONS = [
  "page",
  "entry",
  "exit",
  ...Object.keys(DIMENSION_COLUMNS),
];

const MAX_RANGE_DAYS = 800;

function checkRange(range) {
  const { from, to } = range;
  if (!isDayKey(from) || !isDayKey(to) || from > to) {
    throw new ReportError("from and to must be days (YYYY-MM-DD), from <= to.");
  }
  if (dayCount(range) > MAX_RANGE_DAYS) {
    throw new ReportError(`The range can be at most ${MAX_RANGE_DAYS} days.`);
  }
}

const RAW_WHERE = `p.site_id = ? AND p.day BETWEEN ? AND ?
  AND p.day NOT IN (SELECT day FROM daily_totals WHERE site_id = ?)`;

function dailyTotals(db, siteId, { from, to }) {
  return db
    .prepare(
      `SELECT day, pageviews, visitors, sessions FROM daily_totals
         WHERE site_id = ? AND day BETWEEN ? AND ?
       UNION ALL
       SELECT day, COUNT(*), COUNT(DISTINCT visitor_hash), SUM(is_entry)
         FROM (${sessionedPageviews(RAW_WHERE)}) GROUP BY day
       ORDER BY day`,
    )
    .all(siteId, from, to, siteId, from, to, siteId);
}

function sumTotals(rows) {
  const totals = { pageviews: 0, visitors: 0, sessions: 0 };
  for (const row of rows) {
    totals.pageviews += row.pageviews;
    totals.visitors += row.visitors;
    totals.sessions += row.sessions;
  }
  totals.pages_per_session = totals.sessions
    ? Math.round((totals.pageviews / totals.sessions) * 100) / 100
    : 0;
  return totals;
}

function dayCount({ from, to }) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
}

export function previousRange(range) {
  const days = dayCount(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export function summary(db, siteId, range, { compare = false } = {}) {
  checkRange(range);
  const result = { range, ...sumTotals(dailyTotals(db, siteId, range)) };
  if (compare) {
    const previous = previousRange(range);
    result.previous = { range: previous, ...sumTotals(dailyTotals(db, siteId, previous)) };
  }
  return result;
}

function bucketKey(day, interval) {
  if (interval === "month") {
    return day.slice(0, 7);
  }
  if (interval === "week") {
    // Monday of the ISO week.
    const date = new Date(`${day}T00:00:00Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    return addDays(day, -offset);
  }
  return day;
}

export function timeseries(db, siteId, range, { interval = "day" } = {}) {
  checkRange(range);
  if (!["day", "week", "month"].includes(interval)) {
    throw new ReportError("interval must be day, week or month.");
  }

  const byDay = new Map(dailyTotals(db, siteId, range).map((row) => [row.day, row]));
  const buckets = new Map();
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const key = bucketKey(day, interval);
    const bucket = buckets.get(key) || { period: key, pageviews: 0, visitors: 0, sessions: 0 };
    const row = byDay.get(day);
    if (row) {
      bucket.pageviews += row.pageviews;
      bucket.visitors += row.visitors;
      bucket.sessions += row.sessions;
    }
    buckets.set(key, bucket);
  }
  return { range, interval, points: [...buckets.values()] };
}

// With `top`, only the best rows are returned, sorted and limited in SQL, so
// sites with many distinct paths (bots trying URLs) stay cheap to report.
function pageRows(db, siteId, range, top = null) {
  const tail = top
    ? `HAVING SUM(${top.having}) > 0 ORDER BY SUM(${top.column}) DESC, path LIMIT ${top.limit}`
    : "";
  return db
    .prepare(
      `SELECT path AS value, SUM(pageviews) AS pageviews, SUM(visitors) AS visitors,
              SUM(entries) AS entries, SUM(exits) AS exits
       FROM (
         SELECT path, pageviews, visitors, entries, exits FROM daily_rollup
           WHERE site_id = ? AND day BETWEEN ? AND ?
         UNION ALL
         SELECT path, COUNT(*), COUNT(DISTINCT visitor_hash), SUM(is_entry), SUM(is_exit)
           FROM (${sessionedPageviews(RAW_WHERE)}) GROUP BY day, path
       )
       GROUP BY path ${tail}`,
    )
    .all(siteId, range.from, range.to, siteId, range.from, range.to, siteId);
}

// Page groups are path prefixes from the site settings, e.g. "/oppaat/". A
// page belongs to the first group whose prefix matches, others to "".
// Visitors are not given for groups: daily visitors per page cannot be added
// up without counting a visitor who saw several pages more than once.
export function pageGroups(db, siteId, range, groups = []) {
  checkRange(range);
  const totals = new Map();
  for (const row of pageRows(db, siteId, range)) {
    const group = groups.find((g) => row.value.startsWith(g.prefix));
    const name = group ? group.name : "";
    const total = totals.get(name) || { value: name, pageviews: 0, entries: 0, exits: 0 };
    total.pageviews += row.pageviews;
    total.entries += row.entries;
    total.exits += row.exits;
    totals.set(name, total);
  }
  const rows = [...totals.values()].sort(
    (a, b) => b.pageviews - a.pageviews || a.value.localeCompare(b.value),
  );
  return { range, dimension: "page_group", sort: "pageviews", rows };
}

const SORT_COLUMNS = ["pageviews", "visitors", "entries", "exits"];

export function breakdown(db, siteId, dimension, range, { limit = 50, sort } = {}) {
  checkRange(range);
  if (!BREAKDOWN_DIMENSIONS.includes(dimension)) {
    throw new ReportError(`Unknown dimension: ${dimension}`);
  }
  const rowLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 1000);

  const defaultSort = { entry: "entries", exit: "exits" }[dimension] || "pageviews";
  const isPage = ["page", "entry", "exit"].includes(dimension);
  const sortable = isPage ? SORT_COLUMNS : SORT_COLUMNS.filter((c) => c !== "exits");
  const sortColumn = sortable.includes(sort) ? sort : defaultSort;

  let rows;
  if (isPage) {
    // Entry and exit lists show only pages where sessions started or ended.
    rows = pageRows(db, siteId, range, {
      column: sortColumn,
      having: { entry: "entries", exit: "exits" }[dimension] || "pageviews",
      limit: rowLimit,
    });
  } else {
    const column = DIMENSION_COLUMNS[dimension];
    rows = db
      .prepare(
        `SELECT value, SUM(pageviews) AS pageviews, SUM(visitors) AS visitors,
                SUM(entries) AS entries
         FROM (
           SELECT value, pageviews, visitors, entries FROM daily_dim_rollup
             WHERE site_id = ? AND day BETWEEN ? AND ? AND dimension = ?
           UNION ALL
           SELECT ${column}, COUNT(*), COUNT(DISTINCT visitor_hash), SUM(is_entry)
             FROM (${sessionedPageviews(RAW_WHERE)}) GROUP BY day, ${column}
         )
         GROUP BY value`,
      )
      .all(siteId, range.from, range.to, dimension, siteId, range.from, range.to, siteId);
  }

  rows.sort((a, b) => b[sortColumn] - a[sortColumn] || String(a.value).localeCompare(String(b.value)));

  return { range, dimension, sort: sortColumn, rows: rows.slice(0, rowLimit) };
}
