// With visitors = off every page view is its own "visitor" and "session", so
// counts that need the visitor hash would only repeat the page views. They
// are replaced with null in every report of such a site.
const HASH_FIELDS = new Set([
  "visitors",
  "sessions",
  "pages_per_session",
  "entries",
  "exits",
  "conversion_pct",
  "previous_sessions",
]);

export function hideVisitorCounts(value) {
  if (Array.isArray(value)) {
    return value.map(hideVisitorCounts);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, HASH_FIELDS.has(key) ? null : hideVisitorCounts(item)]),
    );
  }
  return value;
}
