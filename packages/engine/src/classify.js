export const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http|java\//i;

export function isBot(userAgent) {
  return !userAgent || BOT_USER_AGENT_PATTERN.test(userAgent);
}

export function deviceType(userAgent) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) {
    return "tablet";
  }
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) {
    return "mobile";
  }
  return "desktop";
}

const BROWSERS = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

export function browserFamily(userAgent) {
  return BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] || "Other";
}

const OPERATING_SYSTEMS = [
  [/Windows/, "Windows"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

export function osFamily(userAgent) {
  return (
    OPERATING_SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ||
    "Other"
  );
}

export function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizePath(value) {
  let path = String(value ?? "").trim();
  try {
    path = new URL(path, "http://x").pathname;
  } catch {
    return "/";
  }
  return decodePath(path).slice(0, 500) || "/";
}

// Paths are stored decoded ("/opas/lämpö", not "/opas/l%C3%A4mp%C3%B6"), so a
// page is one row however the browser wrote its address. Reserved characters
// such as %2F stay encoded, and an invalid encoding or one that would give a
// control character is kept as it is.
export function decodePath(path) {
  try {
    const decoded = decodeURI(path);
    return /[\u0000-\u001f\u007f]/.test(decoded) ? path : decoded;
  } catch {
    return path;
  }
}

export function normalizeHost(host) {
  return String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
}

// Only external referrers are kept, as host and path without the query.
export function parseReferrer(value, siteDomain) {
  if (!value) {
    return { host: "", path: "" };
  }
  try {
    const url = new URL(value);
    const host = normalizeHost(url.host);
    if (!host || host === normalizeHost(siteDomain)) {
      return { host: "", path: "" };
    }
    return { host: host.slice(0, 200), path: decodePath(url.pathname).slice(0, 300) };
  } catch {
    return { host: "", path: "" };
  }
}

export function normalizeCountry(value) {
  const country = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}
