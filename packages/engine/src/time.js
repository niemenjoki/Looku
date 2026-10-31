const formatters = new Map();

function getFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone) {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

// Local calendar day (YYYY-MM-DD) of a moment in the site's time zone.
export function dayKey(date, timeZone) {
  return getFormatter(timeZone).format(date);
}

export function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The same day of the month N months earlier, clamped to the month's end.
export function subtractMonths(day, months) {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, lastDay));
  return target.toISOString().slice(0, 10);
}

// A real calendar day between 2000 and 2100.
export function isDayKey(value) {
  return (
    typeof value === "string" &&
    /^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    addDays(value, 0) === value
  );
}
