import { sessionedPageviews } from "../sessions.js";
import { ReportError } from "./errors.js";

// Report filters: page group (page level), campaign and device (session
// level: the campaign of the page where the session started). The rollup
// tables have no such combinations, so filtered reports read the raw page
// views, which are kept for the site's retention period (25 months by default).

export const FILTER_PARAMS = ["page_group", "utm_campaign", "device"];

// A range with a time window (since/until, e.g. the last 24 hours) is read
// from the raw page views like a filter.
export function withWindow(filters, range) {
  if (!range.since) {
    return filters;
  }
  return { ...(filters || {}), window: { since: range.since, until: range.until } };
}

// Returns null when no filter is set.
export function parseFilters(query, config = {}) {
  const filters = {};
  if (query.page_group !== undefined) {
    const groups = config.page_groups || [];
    const name = String(query.page_group);
    const index = groups.findIndex((group) => group.name === name);
    if (name && index === -1) {
      throw new ReportError(`Unknown page group: ${name}`);
    }
    // A page belongs to the first group whose prefix matches, so earlier
    // prefixes are excluded. An empty name means pages in no group.
    filters.pageGroup = {
      prefix: index === -1 ? null : groups[index].prefix,
      excluded: (index === -1 ? groups : groups.slice(0, index)).map((group) => group.prefix),
    };
  }
  if (query.utm_campaign !== undefined) {
    filters.campaign = String(query.utm_campaign).slice(0, 120);
  }
  if (query.device !== undefined) {
    filters.device = String(query.device).slice(0, 20);
  }
  return Object.keys(filters).length ? filters : null;
}

// Filtered page views of a site and range with is_entry, is_exit and
// session_no (visitor_hash + day + session_no identifies a session).
// Parameters: siteId, from, to, then the values from `params`.
export function filteredPageviews(filters) {
  const conditions = [];
  const params = [];
  if (filters.pageGroup) {
    const { prefix, excluded } = filters.pageGroup;
    if (prefix) {
      conditions.push("substr(t.path, 1, length(?)) = ?");
      params.push(prefix, prefix);
    }
    for (const other of excluded) {
      conditions.push("substr(t.path, 1, length(?)) <> ?");
      params.push(other, other);
    }
  }
  if (filters.campaign !== undefined) {
    conditions.push("e.utm_campaign = ?");
    params.push(filters.campaign);
  }
  if (filters.device !== undefined) {
    conditions.push("t.device = ?");
    params.push(filters.device);
  }
  if (filters.window) {
    conditions.push("t.ts > ? AND t.ts <= ?");
    params.push(filters.window.since, filters.window.until);
  }

  const sql = `
    WITH t AS (
      SELECT s.*, SUM(s.is_entry) OVER (
        PARTITION BY s.day, s.visitor_hash ORDER BY s.ts, s.id ROWS UNBOUNDED PRECEDING
      ) AS session_no
      FROM (${sessionedPageviews("p.site_id = ? AND p.day BETWEEN ? AND ?")}) s
    )
    SELECT t.* FROM t
    JOIN t e ON e.day = t.day AND e.visitor_hash = t.visitor_hash
      AND e.session_no = t.session_no AND e.is_entry = 1
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
  return { sql, params };
}
