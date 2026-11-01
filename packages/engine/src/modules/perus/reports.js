import { DIMENSION_COLUMNS, sessionedPageviews } from "../../sessions.js";
import { addDays, isDayKey } from "../../time.js";
import { ReportError } from "../errors.js";
import { filteredPageviews } from "../filters.js";

// Basic module reports. Rolled-up days are read from the rollup tables and
// the rest (today, and days not rolled up yet) from the raw page views, so the
// numbers are the same before and after the nightly job. Visitors over several
// days are the sum of daily visitors, because the visitor hash changes daily.

// With filters (see filters.js) every report reads the raw page views only.

export { ReportError };

export const BREAKDOWN_DIMENSIONS = [
  "page",
  "entry",
  "exit",
  ...Object.keys(DIMENSION_COLUMNS),
];

const MAX_RANGE_DAYS = 800;

export function checkRange(range) {
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

export function dailyTotals(db, siteId, { from, to }, filters = null) {
  if (filters) {
    const { sql, params } = filteredPageviews(filters);
    return db
      .prepare(
        `SELECT day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors,
                COUNT(DISTINCT visitor_hash || ':' || session_no) AS sessions
         FROM (${sql}) GROUP BY day ORDER BY day`,
      )
      .all(siteId, from, to, ...params);
  }
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

export function sumTotals(rows) {
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

export function dayCount({ from, to }) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
}

export function previousRange(range) {
  const days = dayCount(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export function summary(db, siteId, range, { compare = false, filters = null } = {}) {
  checkRange(range);
  const result = { range, ...sumTotals(dailyTotals(db, siteId, range, filters)) };
  if (compare) {
    const previous = previousRange(range);
    result.previous = { range: previous, ...sumTotals(dailyTotals(db, siteId, previous, filters)) };
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

const MAX_HOURLY_DAYS = 31;

// Local hour label ("YYYY-MM-DDTHH") of a UTC hour. Zones with a half-hour
// offset get the hour the UTC hour starts in.
function localHour(utcHour, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(`${utcHour}:00:00Z`))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

// Hourly points from the raw page views, one per UTC hour of the range's
// local days (empty hours are zero). On the autumn clock change two points
// share a local label. Visitors are counted per hour, so they cannot be added
// up over hours; a session is counted in the hour of its first row.
function hourly(db, site, range, filters) {
  if (dayCount(range) > MAX_HOURLY_DAYS) {
    throw new ReportError(`Hourly series can cover at most ${MAX_HOURLY_DAYS} days.`);
  }
  const { sql, params } = filters
    ? filteredPageviews(filters)
    : { sql: sessionedPageviews("p.site_id = ? AND p.day BETWEEN ? AND ?"), params: [] };
  const first = filters
    ? "ROW_NUMBER() OVER (PARTITION BY day, visitor_hash, session_no ORDER BY ts, id) = 1"
    : "is_entry";
  const rows = new Map(
    db
      .prepare(
        `SELECT strftime('%Y-%m-%dT%H', ts) AS hour, COUNT(*) AS pageviews,
                COUNT(DISTINCT visitor_hash) AS visitors, SUM(first) AS sessions
         FROM (SELECT f.*, ${first} AS first FROM (${sql}) f) GROUP BY hour`,
      )
      .all(site.site_id, range.from, range.to, ...params)
      .map((row) => [row.hour, row]),
  );
  // Local days start at most 14 hours from UTC midnight.
  const points = [];
  const end = Date.parse(`${range.to}T00:00:00Z`) + 38 * 3600000;
  for (let t = Date.parse(`${range.from}T00:00:00Z`) - 14 * 3600000; t <= end; t += 3600000) {
    const hour = new Date(t).toISOString().slice(0, 13);
    const period = localHour(hour, site.timezone);
    const day = period.slice(0, 10);
    if (day < range.from || day > range.to) continue;
    const row = rows.get(hour);
    points.push({ period, pageviews: row?.pageviews || 0, visitors: row?.visitors || 0, sessions: row?.sessions || 0 });
  }
  return { range, interval: "hour", points };
}

export function timeseries(db, site, range, { interval = "day", filters = null } = {}) {
  checkRange(range);
  if (interval === "hour") {
    return hourly(db, site, range, filters);
  }
  if (!["day", "week", "month"].includes(interval)) {
    throw new ReportError("interval must be hour, day, week or month.");
  }

  const byDay = new Map(dailyTotals(db, site.site_id, range, filters).map((row) => [row.day, row]));
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
export function pageRows(db, siteId, range, top = null, filters = null) {
  const tail = top
    ? `HAVING SUM(${top.having}) > 0 ORDER BY SUM(${top.column}) DESC, path LIMIT ${top.limit}`
    : "";
  if (filters) {
    const { sql, params } = filteredPageviews(filters);
    return db
      .prepare(
        `SELECT path AS value, SUM(pageviews) AS pageviews, SUM(visitors) AS visitors,
                SUM(entries) AS entries, SUM(exits) AS exits
         FROM (
           SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_hash) AS visitors,
                  SUM(is_entry) AS entries, SUM(is_exit) AS exits
           FROM (${sql}) GROUP BY day, path
         )
         GROUP BY path ${tail}`,
      )
      .all(siteId, range.from, range.to, ...params);
  }
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
export function pageGroups(db, siteId, range, groups = [], { filters = null } = {}) {
  checkRange(range);
  const totals = new Map();
  for (const row of pageRows(db, siteId, range, null, filters)) {
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

export function breakdown(db, siteId, dimension, range, { limit = 50, sort, filters = null } = {}) {
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
    }, filters);
  } else if (filters) {
    const column = DIMENSION_COLUMNS[dimension];
    const { sql, params } = filteredPageviews(filters);
    rows = db
      .prepare(
        `SELECT value, SUM(pageviews) AS pageviews, SUM(visitors) AS visitors,
                SUM(entries) AS entries
         FROM (
           SELECT ${column} AS value, COUNT(*) AS pageviews,
                  COUNT(DISTINCT visitor_hash) AS visitors, SUM(is_entry) AS entries
           FROM (${sql}) GROUP BY day, ${column}
         )
         GROUP BY value`,
      )
      .all(siteId, range.from, range.to, ...params);
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
