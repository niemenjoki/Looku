import { lineChart, spark } from "./charts.js";
import { h, replace } from "./dom.js";
import { T } from "./i18n.js";
import { buildReview, monthRange, percentChange, shiftMonth } from "./review.js";
import { rollingConversion } from "./rolling.js";

// Looku dashboard: the compact dashboard, full lists, the monthly review and
// the settings. Everything is built with DOM calls and text nodes, never from
// HTML strings, because page paths and UTM values come from visitors. The page
// talks only to /api/v1. The view (range, filters, month) is kept in the
// address, so it can be bookmarked and the Back button works.

const RANGE_KEYS = ["24h", "7d", "28d", "3m", "12m"];

// Sections of the dashboard per module, in default order.
const SECTIONS = [
  { id: "pages", module: "perus" },
  { id: "entries", module: "perus" },
  { id: "exits", module: "perus" },
  { id: "referrers", module: "perus" },
  { id: "utm_source", module: "perus" },
  { id: "utm_campaign", module: "perus" },
  { id: "devices", module: "perus" },
  { id: "browsers", module: "perus" },
  { id: "countries", module: "perus" },
  { id: "page_groups", module: "perus" },
  { id: "missing_pages", module: "perus" },
  { id: "shop_overview", module: "shop" },
  { id: "shop_conversion", module: "shop" },
  { id: "shop_funnel", module: "shop" },
  { id: "shop_products", module: "shop" },
  { id: "campaigns", module: "campaigns" },
  { id: "content_engagement", module: "content" },
  { id: "content_rising", module: "content" },
];
// Sections added after sites could save a layout without hidden_sections.
const ADDED_LATER = ["shop_conversion", "missing_pages"];
const DEFAULT_WIDE = new Set(["shop_conversion"]);

// Sections that list one breakdown dimension. filter = the filter a row sets.
const BREAKDOWNS = {
  pages: { dim: "page", filter: "page", rows: 8, path: true, views: true, sorts: true },
  entries: { dim: "entry", filter: "page", rows: 8, path: true, views: true },
  exits: { dim: "exit", filter: "page", rows: 8, path: true, views: true },
  referrers: { dim: "referrer", filter: "referrer", rows: 8, sort: "entries", view: "bars", views: true, sorts: true },
  utm_source: { dim: "utm_source", filter: "utm_source", rows: 8, sort: "entries", view: "bars", views: true, sorts: true },
  utm_campaign: { dim: "utm_campaign", filter: "utm_campaign", rows: 8, sort: "entries", view: "bars", views: true, sorts: true },
  devices: { dim: "device", filter: "device", rows: 10, stack: true },
  browsers: { dim: "browser", rows: 10, stack: true },
  countries: { dim: "country", filter: "country", rows: 8, views: true, sorts: true },
  page_groups: { dim: "page_group", filter: "page_group", views: true },
};
// Module sections with a row list.
const MODULE_LISTS = {
  shop_products: { url: "/reports/shop/products", rows: 8 },
  campaigns: { url: "/reports/campaigns/overview", rows: 10 },
  content_engagement: { url: "/reports/content/engagement", rows: 8 },
  content_rising: { url: "/reports/content/rising", rows: 8 },
  missing_pages: { url: "/reports/perus/missing", rows: 8 },
};
const ROW_CHOICES = [5, 8, 10, 15, 25];

const FILTER_KEYS = ["page_group", "page", "utm_campaign", "utm_source", "referrer", "device", "country"];
const FILTER_DIMENSION = { page_group: "page_group", page: "page", utm_campaign: "utm_campaign", utm_source: "utm_source", referrer: "referrer", device: "device", country: "country" };
const ALL = "\u0001all";

const KPI_ORDER = ["pageviews", "visitors", "sessions", "pages_per_session", "orders", "revenue", "conversion"];
const DEFAULT_KPIS = ["pageviews", "visitors", "sessions", "pages_per_session"];
const SHOP_KPIS = ["orders", "revenue", "conversion"];
const NEEDS_VISITORS = new Set(["visitors", "sessions", "pages_per_session", "conversion"]);

// Starting layouts. Sections of modules a site does not have are left out.
const PRESETS = {
  default: { sections: null, kpis: null },
  simple: { sections: ["pages", "referrers", "devices"], kpis: ["pageviews", "visitors"] },
  blog: {
    sections: ["pages", "entries", "referrers", "content_engagement", "content_rising", "page_groups", "countries", "devices"],
    kpis: ["pageviews", "visitors", "sessions", "pages_per_session"],
  },
  shop: {
    sections: ["shop_overview", "shop_conversion", "shop_funnel", "shop_products", "pages", "referrers", "campaigns", "utm_campaign", "devices"],
    kpis: ["visitors", "orders", "revenue", "conversion"],
  },
};
const CURRENCIES = ["EUR", "SEK", "NOK", "DKK", "USD", "GBP"];

const state = {
  sites: [],
  site: null,
  config: null,
  draft: null,
  editing: false,
  dirty: false,
  flash: "",
  me: null,
  range: "24h",
  from: "",
  to: "",
  compare: true,
  hourly: false,
  filters: {},
  month: "",
  lang: "",
  theme: "auto",
  serverNow: null,
};
let L = T.fi;
let renderToken = 0;
let lastHash = location.hash;

// ---------- small helpers ----------

// Version 2 made the last 24 hours the default range: a saved range from
// before it is replaced once.
const DEFAULTS_VERSION = 2;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem("looku") || "{}");
    if (saved.defaults !== DEFAULTS_VERSION) {
      delete saved.range;
    }
    for (const key of ["site", "range", "from", "to", "compare", "hourly", "lang", "theme"]) {
      if (saved[key] !== undefined) state[key] = saved[key];
    }
  } catch {
    // Storage blocked: defaults are used.
  }
}

function save() {
  try {
    const { site, range, from, to, compare, hourly, lang, theme } = state;
    localStorage.setItem("looku", JSON.stringify({ site: site?.id, range, from, to, compare, hourly, lang, theme, defaults: DEFAULTS_VERSION }));
  } catch {
    // Storage blocked: settings last until the page is closed.
  }
}

const nf = (value, digits = 0) =>
  new Intl.NumberFormat(L.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

function addDays(day, n) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function formatDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  if (L.locale === "fi-FI") return `${d}.${m}.`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

function formatFullDay(day) {
  return L.locale === "fi-FI" ? `${formatDay(day)}${day.slice(0, 4)}` : `${formatDay(day)} ${day.slice(0, 4)}`;
}

function formatRange({ from, to, since, until }, timeZone) {
  if (since) {
    const time = new Intl.DateTimeFormat(L.locale, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
    return `${time.format(new Date(since))}-${time.format(new Date(until))}`;
  }
  return `${formatDay(from)}-${formatFullDay(to)}`;
}

// Query of a range from a report's meta: a time window or days.
function rangeParams(range) {
  return range.since
    ? `since=${encodeURIComponent(range.since)}&until=${encodeURIComponent(range.until)}`
    : `from=${range.from}&to=${range.to}`;
}

function formatPeriod(period) {
  if (period.includes("T")) {
    const hour = period.slice(11, 13);
    return L.locale === "fi-FI" ? `${formatDay(period.slice(0, 10))} klo ${Number(hour)}` : `${formatDay(period.slice(0, 10))} ${hour}:00`;
  }
  if (period.length === 7) {
    const [y, m] = period.split("-").map(Number);
    return L.locale === "fi-FI" ? `${m}/${y}` : new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
  }
  return formatDay(period);
}

// Change against the previous period. Small numbers jump a lot in percent,
// so below 20 the difference is shown as a count, and changes under 5 % are
// grey. kind: "count" (whole numbers), "amount" (money), "rate" (an average)
// or "points" (a percentage, changed in percentage points).
function chg(current, previous, { kind = "count" } = {}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (kind === "points") {
    const diff = current - previous;
    const flat = Math.abs(diff) < 0.05;
    return h("span", { class: `chg ${flat ? "flat" : diff > 0 ? "up" : "down"}`, title: L.change.points },
      `${diff >= 0 ? "+" : "−"}${nf(Math.abs(diff), 2)} ${L.change.pp}`);
  }
  if (!previous) return current > 0 ? h("span", { class: "chg flat" }, L.campaignStatus.new) : null;
  if (kind === "count" && previous < 20) {
    const diff = current - previous;
    return h("span", { class: "chg flat", title: L.change.small }, diff === 0 ? "±0" : `${diff > 0 ? "+" : "−"}${nf(Math.abs(diff))}`);
  }
  const p = percentChange(current, previous);
  if (p === null) return null;
  return h("span", { class: `chg ${Math.abs(p) < 5 ? "flat" : p >= 0 ? "up" : "down"}` }, `${p >= 0 ? "+" : "−"}${nf(Math.abs(p))} %`);
}

function label(dimension, value) {
  if (value === "") {
    if (dimension === "referrer" || dimension.startsWith("utm")) return L.names.direct;
    if (dimension === "page_group") return L.names.noGroup;
    return L.names.unknown;
  }
  if (dimension === "device") return L.names[value] || value;
  if (dimension === "country") {
    try {
      return new Intl.DisplayNames([L.locale], { type: "region" }).of(value) || value;
    } catch {
      return value;
    }
  }
  return value;
}

function daysBetween(from, to) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
}

function isAdmin() {
  return state.me?.scope === "admin";
}

function hasModules() {
  return state.site.modules.length > 1;
}

// ---------- API ----------

class AuthError extends Error {}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new AuthError();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function filterQuery() {
  // A page group removed or renamed in the settings is dropped.
  const group = state.filters.page_group;
  if (group && !(state.config?.page_groups || []).some((g) => g.name === group)) delete state.filters.page_group;
  return FILTER_KEYS.filter((key) => state.filters[key] !== undefined)
    .map((key) => `&${key}=${encodeURIComponent(state.filters[key])}`)
    .join("");
}

function money(value) {
  if (value === null || value === undefined) return "";
  const currency = state.config?.currency;
  if (currency) {
    try {
      return new Intl.NumberFormat(L.locale, { style: "currency", currency }).format(value);
    } catch {
      // An unknown code falls back to a plain number.
    }
  }
  return nf(value, 2);
}

function percent(value) {
  return `${nf(value, value < 10 ? 2 : 1)} %`;
}

function duration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function rangeQuery() {
  if (state.range === "custom" && state.from && state.to) return `from=${state.from}&to=${state.to}`;
  return `range=${RANGE_KEYS.includes(state.range) ? state.range : "24h"}`;
}

function siteUrl(path) {
  return `/sites/${encodeURIComponent(state.site.id)}${path}`;
}

function refreshSites(sites) {
  state.sites = sites;
  state.site = sites.find((x) => x.id === state.site?.id) || state.site;
}

// ---------- the address ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const index = raw.indexOf("?");
  const path = index === -1 ? raw : raw.slice(0, index);
  const params = new URLSearchParams(index === -1 ? "" : raw.slice(index + 1));
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "report") return { route: "report", params };
  if (parts[0] === "settings") return { route: "settings", params };
  if (parts[0] === "list" && parts[1]) {
    let card = "";
    try {
      card = decodeURIComponent(parts[1]);
    } catch {
      // A broken address shows the "not found" list.
    }
    return { route: "list", card, params };
  }
  return { route: "dashboard", params };
}

// The view from the address. Values missing from it keep this browser's last choice.
// Filters belong to the dashboard and its lists; they are kept while the
// monthly review or the settings is open, so the dashboard link brings them back.
function applyParams(params, route) {
  const range = params.get("range");
  if (range && RANGE_KEYS.includes(range)) state.range = range;
  if (range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "")) {
    state.range = "custom";
    state.from = params.get("from");
    state.to = params.get("to");
  }
  if (params.has("compare")) state.compare = params.get("compare") !== "0";
  if (params.has("hourly")) state.hourly = params.get("hourly") === "1";
  if (route === "dashboard" || route === "list") {
    state.filters = {};
    for (const key of FILTER_KEYS) {
      if (params.has(key)) state.filters[key] = params.get(key);
    }
  }
  const month = params.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) state.month = month;
}

function viewParams() {
  const params = { range: state.range };
  if (state.range === "custom") {
    params.from = state.from;
    params.to = state.to;
  }
  if (!state.compare) params.compare = "0";
  if (state.hourly) params.hourly = "1";
  for (const key of FILTER_KEYS) {
    if (state.filters[key] !== undefined) params[key] = state.filters[key];
  }
  return params;
}

// Address of a view; overrides with null remove a value.
function href(route, overrides = {}) {
  const params = route === "dashboard" || route.startsWith("list/") ? viewParams() : route === "report" && state.month ? { month: state.month } : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) delete params[key];
    else params[key] = value;
  }
  if (params.range && params.range !== "custom") {
    delete params.from;
    delete params.to;
  }
  const query = new URLSearchParams(params).toString();
  const base = route === "dashboard" ? "#/" : `#/${route}`;
  return query ? `${base}?${query}` : base;
}

function go(route, overrides = {}) {
  // While editing the layout the range and filters can still be changed.
  if (!(state.editing && route === "dashboard") && !leaveOk()) return;
  history.pushState(null, "", href(route, overrides));
  render();
}

// Unsaved settings or layout changes are not lost without asking.
function leaveOk() {
  if (!state.dirty) return true;
  if (!window.confirm(L.unsaved)) return false;
  state.dirty = false;
  state.editing = false;
  state.draft = null;
  return true;
}

// ---------- tables, bars and stacks ----------

// A link that filters the dashboard by one value.
function filterLink(key, value, text) {
  if (!key) return text;
  return h("a", { class: "fl", href: href("dashboard", { [key]: value }), title: L.filters.by(text) }, text);
}

function table(columns, rows) {
  if (!rows.length) return h("p", { class: "empty" }, L.none);
  return h("div", { class: "tbl" },
    h("table", {},
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.right ? "r" : null }, c.title)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, columns.map((c) =>
        h("td", { class: c.right ? "r" : c.path ? "p" : null, title: c.path ? c.text(row) : null }, c.value(row))))))));
}

function barList(rows, valueOf, labelOf, head) {
  if (!rows.length) return h("p", { class: "empty" }, L.none);
  const max = Math.max(...rows.map(valueOf), 1);
  return h("div", { class: "bars" },
    head ? h("div", { class: "bars-h" }, h("span", {}, head[0]), h("span", {}, head[1])) : null,
    rows.map((row) => {
      const fill = h("div", { class: "fill" });
      fill.style.width = `${((valueOf(row) / max) * 100).toFixed(1)}%`;
      return h("div", { class: "bar" }, h("span", { class: "lbl" }, labelOf(row)), h("span", { class: "num" }, nf(valueOf(row))), h("div", { class: "track" }, fill));
    }));
}

function stack(rows, dimension, filterKey) {
  const total = rows.reduce((sum, r) => sum + r.pageviews, 0);
  if (!total) return h("p", { class: "empty" }, L.none);
  const top = rows.slice(0, 3);
  const rest = total - top.reduce((sum, r) => sum + r.pageviews, 0);
  const parts = rest > 0 ? [...top, { value: null, pageviews: rest }] : top;
  const name = (r) => (r.value === null ? L.names.other : label(dimension, r.value));
  const share = (r) => `${nf((r.pageviews / total) * 100)} %`;
  return [
    h("div", { class: "stack", role: "img", "aria-label": parts.map((r) => `${name(r)} ${share(r)}`).join(", ") },
      parts.map((r, i) => {
        const el = h("div", { class: `c${i}` });
        el.style.width = `${((r.pageviews / total) * 100).toFixed(1)}%`;
        return el;
      })),
    h("div", { class: "legend" }, parts.map((r, i) => h("span", {}, h("i", { class: `c${i}` }),
      r.value === null ? name(r) : filterLink(filterKey, r.value, name(r)), ` ${share(r)}`))),
  ];
}

// Tells empty card bodies apart, so the dashboard can list them on one line.
function empty(text = L.none) {
  return h("p", { class: "empty" }, text);
}

function isEmpty(body) {
  return body instanceof Element && body.classList.contains("empty");
}

function chartTexts() {
  return { keys: L.chart.keys, partial: L.chart.partial, partialLegend: L.chart.partialLegend };
}

// ---------- layout ----------

function effectiveConfig() {
  return state.draft || state.config;
}

function needHash() {
  // Without the visitor hash there are no sessions, so no entry, exit or funnel lists.
  return new Set(state.site.visitors === "off" ? ["entries", "exits", "shop_funnel", "shop_conversion"] : []);
}

function availableSections() {
  const skip = needHash();
  return SECTIONS.filter((x) => state.site.modules.includes(x.module) && !skip.has(x.id));
}

function sectionOrder(cfg) {
  const known = new Map(SECTIONS.map((x) => [x.id, x]));
  let ids = cfg.sections || SECTIONS.map((x) => x.id);
  if (cfg.hidden_sections) {
    // Sections in neither list are new (a module enabled later, a new version).
    const listed = new Set([...ids, ...cfg.hidden_sections]);
    ids = [...ids, ...SECTIONS.filter((x) => !listed.has(x.id)).map((x) => x.id)];
  } else {
    // Settings saved before hidden_sections: a module with none of its sections listed is new.
    const listed = new Set(ids.map((id) => known.get(id)?.module));
    ids = [...ids, ...SECTIONS.filter((x) => !listed.has(x.module) || (ADDED_LATER.includes(x.id) && !ids.includes(x.id))).map((x) => x.id)];
  }
  const available = new Set(availableSections().map((x) => x.id));
  return [...new Set(ids)].filter((id) => available.has(id)).map((id) => known.get(id));
}

function hiddenSectionsOf(cfg) {
  const shown = new Set(sectionOrder(cfg).map((x) => x.id));
  return availableSections().filter((x) => !shown.has(x.id));
}

function availableKpis() {
  return KPI_ORDER.filter((id) =>
    (!SHOP_KPIS.includes(id) || state.site.modules.includes("shop")) && (state.site.visitors !== "off" || !NEEDS_VISITORS.has(id)));
}

function kpiIds(cfg) {
  const available = new Set(availableKpis());
  const ids = (cfg.kpis || DEFAULT_KPIS).filter((id) => available.has(id));
  return ids.length ? ids : ["pageviews"];
}

function cardOption(cfg, id, key) {
  const value = cfg.cards?.[id]?.[key];
  if (key === "wide" && value === undefined) return DEFAULT_WIDE.has(id);
  return value;
}

function cardRows(cfg, id) {
  return cardOption(cfg, id, "rows") || BREAKDOWNS[id]?.rows || MODULE_LISTS[id]?.rows || 8;
}

function presetConfig(name) {
  const preset = PRESETS[name] || PRESETS.default;
  const available = availableSections().map((x) => x.id);
  const sections = preset.sections ? preset.sections.filter((id) => available.includes(id)) : null;
  return {
    sections,
    hidden_sections: sections ? available.filter((id) => !sections.includes(id)) : [],
    kpis: preset.kpis,
    cards: {},
    preset: name,
  };
}

function presetNames() {
  return Object.keys(PRESETS).filter((name) => name !== "shop" || state.site.modules.includes("shop"));
}

// The whole settings object for PUT /config.
function configBody(cfg) {
  return {
    language: cfg.language || "",
    page_groups: cfg.page_groups || [],
    sections: cfg.sections,
    hidden_sections: cfg.hidden_sections,
    shop: cfg.shop || {},
    opt_out_url: cfg.opt_out_url || "",
    kpis: cfg.kpis,
    cards: cfg.cards || {},
    currency: cfg.currency || "",
    preset: cfg.preset || "",
  };
}

// ---------- views ----------

function logo() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 30 26");
  svg.setAttribute("aria-hidden", "true");
  const points = [[3, 21], [11, 13], [18, 17], [27, 5]];
  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
  line.setAttribute("class", "logo-line");
  svg.append(line);
  points.forEach(([x, y], i) => {
    const dot = document.createElementNS(svg.namespaceURI, "circle");
    for (const [k, v] of Object.entries({ cx: x, cy: y, r: 3, class: `logo-dot${i === 3 ? " last" : ""}` })) dot.setAttribute(k, v);
    svg.append(dot);
  });
  return svg;
}

function ago(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return L.status.now;
  if (minutes < 60) return L.status.minutes(minutes);
  if (minutes < 48 * 60) return L.status.hours(Math.round(minutes / 60));
  return L.status.days(Math.round(minutes / 1440));
}

// When the site's newest page view arrived: tells at a glance that collection works.
function collectStatus() {
  const ts = state.site.last_pageview;
  if (!ts) return h("span", { class: "status warn", title: L.status.neverTitle }, h("i"), L.status.never);
  const ms = Date.parse(state.serverNow || new Date().toISOString()) - Date.parse(ts);
  const time = new Intl.DateTimeFormat(L.locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
  return h("span", { class: `status ${ms <= 3600000 ? "ok" : ms > 86400000 ? "warn" : ""}`, title: L.status.title(time) }, h("i"), L.status.last(ago(ms)));
}

function header(route) {
  const link = (key, target) => h("a", { href: target, "aria-current": route === key ? "page" : null }, L.nav[key]);
  const clear = Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));
  const siteSelect = state.sites.length > 1
    ? h("select", { "aria-label": L.site, onchange: (e) => {
      if (!leaveOk()) {
        e.target.value = state.site.id;
        return;
      }
      state.site = state.sites.find((x) => x.id === e.target.value);
      state.config = null;
      state.draft = null;
      state.editing = false;
      save();
      go(route === "list" ? "dashboard" : route, clear);
    } }, state.sites.map((x) => h("option", { value: x.id, selected: x.id === state.site.id }, x.domain)))
    : h("strong", {}, state.site.domain);
  return h("header", { class: "top" },
    h("a", { class: "brand", href: href("dashboard") }, logo(), "Looku"),
    siteSelect,
    h("nav", { class: "nav" }, link("dashboard", href("dashboard")), link("report", href("report")), link("settings", "#/settings")),
    collectStatus(),
    h("span", { class: "sp" }),
    h("button", { class: "btn", type: "button", onclick: logout }, L.logout));
}

// A site that has not sent a page view yet: what to do next.
function firstRun(container, token) {
  replace(container, h("div", { class: "panel setup" },
    h("h2", {}, L.setup.title),
    h("ol", {},
      h("li", { class: "done" }, L.setup.added(state.site.domain, state.site.id)),
      h("li", {}, L.setup.connect, " ", h("a", { href: L.setup.guideUrl, target: "_blank", rel: "noopener" }, L.setup.guide)),
      h("li", {}, L.setup.open)),
    h("p", { class: "note" }, L.setup.wait)));
  const poll = async () => {
    if (token !== renderToken) return;
    try {
      refreshSites((await api("/sites")).data);
    } catch {
      // Tried again on the next round.
    }
    if (token !== renderToken) return;
    if (state.site.last_pageview) render();
    else setTimeout(poll, 10000);
  };
  setTimeout(poll, 10000);
}

async function dashboardView(container, token) {
  const cfg = effectiveConfig();
  const q = rangeQuery();
  const fq = filterQuery();
  const [summary, sites] = await Promise.all([
    api(siteUrl(`/summary?${q}&compare=${state.compare ? "previous" : ""}${fq}`)),
    api("/sites").catch(() => null),
  ]);
  if (token !== renderToken) return;
  if (sites) refreshSites(sites.data);
  state.serverNow = summary.meta.generated_at;
  if (!state.site.last_pageview) return firstRun(container, token);

  const range = summary.meta.range;
  const days = daysBetween(range.from, range.to);
  const interval = range.since || (state.hourly && days <= 31) ? "hour" : days > 400 ? "month" : days > 92 ? "week" : "day";
  const previous = summary.meta.previous;
  const timeZone = summary.meta.timezone;
  const noVisitors = state.site.visitors === "off";
  const filtered = Object.keys(state.filters).length > 0;

  const sections = sectionOrder(cfg);
  const kpiList = kpiIds(cfg);
  const hasShop = state.site.modules.includes("shop");
  const needShop = hasShop && (kpiList.some((id) => SHOP_KPIS.includes(id)) || sections.some((x) => x.module === "shop"));
  // The conversion chart shows at least 28 days, and its weekly average needs 6 more.
  const shopFrom = range.from < addDays(range.to, -27) ? range.from : addDays(range.to, -27);
  // The weekly average needs 6 days before the first point; the API reads at most 800 days.
  const shopStart = addDays(shopFrom, -6) < addDays(range.to, -799) ? addDays(range.to, -799) : addDays(shopFrom, -6);

  const measureOf = (id) => {
    if (noVisitors) return "pageviews";
    return cardOption(cfg, id, "sort") || BREAKDOWNS[id].sort || { entries: "entries", exits: "exits" }[id] || "pageviews";
  };
  const requests = {
    series: api(siteUrl(`/timeseries?${q}&interval=${interval}${fq}`)),
    prevSeries: previous ? api(siteUrl(`/timeseries?${rangeParams(previous)}&interval=${interval}${fq}`)) : null,
    prevPages: previous && sections.some((x) => x.id === "pages") ? api(siteUrl(`/breakdown/page?${rangeParams(previous)}&limit=1000${fq}`)) : null,
    os: sections.some((x) => x.id === "browsers") ? api(siteUrl(`/breakdown/os?${q}&limit=10${fq}`)) : null,
    campaignList: api(siteUrl(`/breakdown/utm_campaign?${q}&limit=50&sort=entries`)),
    shopSummary: needShop ? api(siteUrl(`/reports/shop/summary?${q}${state.compare ? "&compare=previous" : ""}`)) : null,
    shopSeries: needShop ? api(siteUrl(`/reports/shop/timeseries?from=${shopStart}&to=${range.to}`)) : null,
  };
  for (const section of sections) {
    const id = section.id;
    // One row more than shown tells whether "Show all" is needed.
    const limit = cardRows(cfg, id) + 1;
    if (BREAKDOWNS[id]) {
      const spec = BREAKDOWNS[id];
      const measure = measureOf(id);
      const sort = ["entries", "exits"].includes(id) ? "" : `&sort=${measure}`;
      requests[id] = api(siteUrl(`/breakdown/${spec.dim}?${q}${spec.stack ? `&limit=${spec.rows}` : id === "page_groups" ? "" : `&limit=${limit}`}${sort}${fq}`));
    } else if (MODULE_LISTS[id]) {
      requests[id] = api(siteUrl(`${MODULE_LISTS[id].url}?${q}&limit=${limit}`));
    } else if (id === "shop_funnel") {
      requests[id] = api(siteUrl(`/reports/shop/funnel?${q}`));
    }
  }
  const keys = Object.keys(requests);
  const values = await Promise.all(keys.map((k) => requests[k]));
  if (token !== renderToken) return;
  const r = Object.fromEntries(keys.map((k, i) => [k, values[i]]));

  const d = summary.data;
  const p = d.previous;
  const points = r.series.data.points;
  const shop = r.shopSummary?.data;
  // Shop numbers come per day: a range of a day or two gets no daily sparkline.
  const shopPoints = r.shopSeries && days > 2 ? r.shopSeries.data.points.filter((x) => x.period >= range.from) : null;
  const shopSpark = (pick) => (shopPoints ? shopPoints.map(pick) : null);

  // Top row figures.
  const perDay = !range.since && days > 1 && d.visitors !== null ? L.perDay(nf(d.visitors / days)) : null;
  const kpiNote = h("p", { class: "note kpi-note", hidden: true }, L.visitorsNote);
  const info = h("button", { class: "info", type: "button", "aria-expanded": "false", "aria-label": L.visitorsInfo, onclick: (e) => {
    kpiNote.hidden = !kpiNote.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!kpiNote.hidden));
  } }, "?");
  const KPIS = {
    pageviews: () => [L.pv, nf(d.pageviews), p && chg(d.pageviews, p.pageviews), points.map((x) => x.pageviews)],
    visitors: () => [[L.vis, " ", info], nf(d.visitors), p && chg(d.visitors, p.visitors), points.map((x) => x.visitors), perDay],
    sessions: () => [L.ses, nf(d.sessions), p && chg(d.sessions, p.sessions), points.map((x) => x.sessions)],
    pages_per_session: () => [L.pps, nf(d.pages_per_session, 1), p && chg(d.pages_per_session, p.pages_per_session, { kind: "rate" }), points.map((x) => (x.sessions ? x.pageviews / x.sessions : null))],
    orders: () => [L.shop.orders, nf(shop.orders), shop.previous && chg(shop.orders, shop.previous.orders), shopSpark((x) => x.orders)],
    revenue: () => [L.shop.revenue, money(shop.revenue), shop.previous && chg(shop.revenue, shop.previous.revenue, { kind: "amount" }), shopSpark((x) => x.revenue)],
    conversion: () => [L.shop.conversion, percent(shop.conversion_pct), shop.previous && chg(shop.conversion_pct, shop.previous.conversion_pct, { kind: "points" }), shopSpark((x) => (x.sessions ? (x.orders / x.sessions) * 100 : null))],
  };
  const kpiRow = h("div", { class: "va-kpi" }, kpiList.map((id) => {
    const [k, v, c, series, sub] = KPIS[id]();
    // Shop numbers come from the order system and are not filtered.
    const unfiltered = filtered && SHOP_KPIS.includes(id);
    return h("div", { class: `${SHOP_KPIS.includes(id) ? "m-shop" : "m-perus"}${unfiltered ? " unfiltered" : ""}` },
      h("div", { class: "k" }, k, unfiltered ? h("span", { class: "tag plain" }, L.filters.notFiltered) : null),
      h("div", { class: "v" }, v), c, sub ? h("span", { class: "sub" }, ` ${sub}`) : null, series ? spark(series) : null);
  }));

  // Incomplete periods: the range runs to now, or a week or month bucket is cut at the start.
  const weekday = new Date(`${range.from}T00:00:00Z`).getUTCDay();
  const partial = {
    last: Boolean(range.since) || range.to >= state.site.today,
    first: Boolean(range.since) || (interval === "week" && weekday !== 1) || (interval === "month" && !range.from.endsWith("-01")),
  };
  const prevPoints = r.prevSeries?.data.points;
  const trend = lineChart({
    periods: points.map((x) => x.period),
    series: [
      { label: L.pv, values: points.map((x) => x.pageviews), cls: "s-pv", legendCls: "i-pv", area: true },
      ...(noVisitors ? [] : [{ label: interval === "hour" || interval === "day" ? L.vis : L.visSum, values: points.map((x) => x.visitors), cls: "s-vis", legendCls: "i-vis" }]),
    ],
    previous: prevPoints ? { label: `${L.pv}, ${L.prevLine}`, values: prevPoints.map((x) => x.pageviews) } : null,
    height: 130,
    format: (v) => nf(v),
    periodLabel: formatPeriod,
    partial,
    label: L.trend,
    texts: chartTexts(),
    extra: prevPoints ? (i) => (prevPoints[i] ? h("div", { class: "muted" }, formatPeriod(prevPoints[i].period)) : null) : null,
  });

  // Section bodies.
  const prevPages = new Map((r.prevPages?.data.rows || []).map((row) => [row.value, row.pageviews]));
  const rowsOf = (id) => r[id].data.rows.filter((row) => !(id.startsWith("utm") && row.value === "")
    && (!["referrers", "utm_source", "utm_campaign"].includes(id) || row[measureOf(id)] > 0));
  const measureTitle = (id, key) => (key === "pageviews" ? L.col.views : key === "visitors" ? L.col.visitors : key === "exits" ? L.col.exits
    : ["pages", "entries", "page_groups"].includes(id) ? L.col.entries : L.col.sessions);
  const nameTitle = (id) => ({ referrers: L.col.source, utm_source: L.col.source, utm_campaign: L.col.campaign, countries: L.col.country, page_groups: L.col.group }[id] || L.col.page);
  const more = {};

  const breakdownBody = (id) => {
    const spec = BREAKDOWNS[id];
    if (spec.stack) {
      return id === "browsers"
        ? [h("div", { class: "sub" }, L.col.browser), stack(rowsOf(id), "browser"), h("div", { class: "sub" }, L.col.os), stack(r.os.data.rows, "os")]
        : stack(rowsOf(id), spec.dim, spec.filter);
    }
    if (id === "page_groups" && !cfg.page_groups?.length) return empty(L.noGroups);
    const all = rowsOf(id);
    const limit = cardRows(cfg, id);
    const rows = id === "page_groups" ? all : all.slice(0, limit);
    more[id] = id !== "page_groups" && all.length > limit;
    const key = measureOf(id);
    const text = (row) => label(spec.dim, row.value);
    const name = (row) => filterLink(spec.filter, row.value, text(row));
    if ((cardOption(cfg, id, "view") || spec.view || "table") === "bars") {
      return barList(rows, (row) => row[key] || 0, name, [nameTitle(id), measureTitle(id, key)]);
    }
    return table([
      { title: nameTitle(id), value: name, text, path: spec.path },
      { title: measureTitle(id, key), value: (row) => nf(row[key] || 0), right: true },
      ...(id === "pages" && previous && key === "pageviews"
        ? [{ title: L.col.change, value: (row) => chg(row.pageviews, prevPages.get(row.value) || 0) || "", right: true }] : []),
      ...(id === "page_groups" && !noVisitors && key !== "entries" ? [{ title: L.col.entries, value: (row) => nf(row.entries), right: true }] : []),
    ], rows);
  };

  const sample = (data) => h("p", { class: "note" }, L.sampleNote(nf(data.sample_size)));
  const moduleRows = (id) => {
    const all = r[id].data.rows || r[id].data.sold;
    const limit = cardRows(cfg, id);
    more[id] = all.length > limit;
    return all.slice(0, limit);
  };
  const moduleBodies = {
    shop_overview: () => {
      const x = shop;
      const px = x.previous || {};
      const figs = [
        [L.shop.orders, nf(x.orders), chg(x.orders, px.orders), shopSpark((pt) => pt.orders)],
        [L.shop.revenue, money(x.revenue), chg(x.revenue, px.revenue, { kind: "amount" }), shopSpark((pt) => pt.revenue)],
        [L.shop.average, money(x.average_order), chg(x.average_order, px.average_order, { kind: "amount" }), null],
        ...(x.conversion_pct === null ? [] : [[L.shop.conversion, percent(x.conversion_pct), chg(x.conversion_pct, px.conversion_pct, { kind: "points" }), null]]),
      ];
      return [
        h("div", { class: "figs" }, figs.map(([k, v, c, series]) => h("div", {}, h("div", { class: "k" }, k), h("div", { class: "v" }, v), c, series ? spark(series) : null))),
        x.conversion_pct === null ? null : h("p", { class: "note" }, L.shop.conversionNote),
      ];
    },
    shop_conversion: () => {
      // Orders divided by sessions over the last 7 days at each day, from the
      // first day with sessions on (rolling.js).
      const rows = rollingConversion(r.shopSeries.data.points, shopFrom);
      if (!rows.some((x) => x.day.sessions)) return empty();
      return [
        lineChart({
          periods: rows.map((x) => x.period),
          series: [{ label: L.shop.rolling, values: rows.map((x) => x.rate), cls: "s-shop", legendCls: "i-shop" }],
          height: 110,
          format: percent,
          periodLabel: formatPeriod,
          partial: { last: range.to >= state.site.today },
          label: L.sections.shop_conversion,
          texts: chartTexts(),
          extra: (i) => [
            rows[i].days ? h("div", { class: "muted" }, L.shop.window(rows[i].days, nf(rows[i].orders), nf(rows[i].sessions))) : null,
            h("div", { class: "muted" }, L.shop.day(nf(rows[i].day.orders), nf(rows[i].day.sessions))),
          ],
        }),
        h("p", { class: "note" }, shopFrom < range.from ? L.shop.rollingLong : L.shop.rollingNote),
      ];
    },
    shop_funnel: () => {
      const f = r.shop_funnel.data;
      return [
        barList(f.steps, (row) => row.count, (row) => `${L.shop.steps[row.id]} · ${nf(row.pct, row.pct % 1 ? 1 : 0)} %`, [L.shop.step, L.col.sessions]),
        h("p", { class: "note" }, f.configured ? L.shop.funnelNote : [L.shop.funnelSetup, " ", h("a", { href: "#/settings?at=shop" }, L.nav.settings)]),
      ];
    },
    shop_products: () => {
      const data = r.shop_products.data;
      const cart = data.cart_sample;
      return [
        moduleTable("shop_products", moduleRows("shop_products"), data),
        cart.sample_size
          ? h("p", { class: "note" }, L.shop.cartSample(nf(cart.sample_size), cart.rows.slice(0, 3).map((row) => `${row.sku} (${nf(row.quantity)})`).join(", ")))
          : null,
      ];
    },
    campaigns: () => moduleTable("campaigns", moduleRows("campaigns"), r.campaigns.data),
    content_engagement: () => [moduleTable("content_engagement", moduleRows("content_engagement"), r.content_engagement.data), sample(r.content_engagement.data)],
    content_rising: () => moduleTable("content_rising", moduleRows("content_rising"), r.content_rising.data),
    missing_pages: () => moduleTable("missing_pages", moduleRows("missing_pages"), r.missing_pages.data),
  };

  // Filter bar: active filters as chips, and lists for the common ones.
  const groups = state.config?.page_groups || [];
  const campaignNames = r.campaignList.data.rows.map((row) => row.value).filter(Boolean);
  if (state.filters.utm_campaign && !campaignNames.includes(state.filters.utm_campaign)) campaignNames.push(state.filters.utm_campaign);
  const filterSelect = (key, labelText, options) => h("select", { "aria-label": labelText, onchange: (e) => go("dashboard", { [key]: e.target.value === ALL ? null : e.target.value }) },
    h("option", { value: ALL }, labelText),
    options.map(([value, text]) => h("option", { value, selected: state.filters[key] === value }, text)));
  const chips = FILTER_KEYS.filter((key) => state.filters[key] !== undefined).map((key) => h("span", { class: "chip" },
    `${L.filterNames[key]}: `, h("b", {}, label(FILTER_DIMENSION[key], state.filters[key])),
    h("a", { href: href("dashboard", { [key]: null }), "aria-label": L.filters.remove(L.filterNames[key]) }, "×")));
  const clearAll = Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));
  const filterBar = h("div", { class: "va-bar filters" },
    h("span", { class: "muted" }, L.filters.title),
    chips,
    groups.length ? filterSelect("page_group", L.filters.allGroups, [...groups.map((g) => [g.name, g.name]), ["", L.names.noGroup]]) : null,
    campaignNames.length ? filterSelect("utm_campaign", L.filters.allCampaigns, campaignNames.map((name) => [name, name])) : null,
    filterSelect("device", L.filters.allDevices, ["mobile", "desktop", "tablet"].map((v) => [v, L.names[v]])),
    filtered ? h("a", { class: "btn", href: href("dashboard", clearAll) }, L.filters.clear) : null,
    days <= 31 && !range.since ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.hourly, onchange: (e) => go("dashboard", { hourly: e.target.checked ? "1" : null }) }), L.hourly) : null,
    filtered ? h("span", { class: "muted" }, L.filters.note) : h("span", { class: "muted hint" }, L.filters.hint));

  const csvReport = {
    shop_overview: "shop/summary", shop_conversion: "shop/timeseries", shop_funnel: "shop/funnel", shop_products: "shop/products",
    campaigns: "campaigns/overview", content_engagement: "content/engagement", content_rising: "content/rising",
    missing_pages: "perus/missing", pages: "breakdown&dimension=page", entries: "breakdown&dimension=entry", exits: "breakdown&dimension=exit",
    referrers: "breakdown&dimension=referrer", utm_source: "breakdown&dimension=utm_source", utm_campaign: "breakdown&dimension=utm_campaign",
    devices: "breakdown&dimension=device", browsers: "breakdown&dimension=browser", countries: "breakdown&dimension=country", page_groups: "breakdown&dimension=page_group",
  };
  const csv = (report) => h("a", { href: `/api/v1${siteUrl(`/export.csv?${q}&report=${report}${report.includes("/") ? "" : fq}`)}`, download: true }, L.csv);

  const rangeButtons = h("div", { class: "seg", role: "group", "aria-label": L.rangeLabel },
    [...RANGE_KEYS, "custom"].map((key) => h("button", {
      type: "button",
      "aria-pressed": String(state.range === key),
      onclick: () => (key === "custom"
        ? go("dashboard", { range: "custom", from: state.from || range.from, to: state.to || range.to })
        : go("dashboard", { range: key })),
    }, L.ranges[key])));
  const fromInput = h("input", { type: "date", value: state.from || range.from, max: state.site.today, "aria-label": L.fromDay });
  const toInput = h("input", { type: "date", value: state.to || range.to, max: state.site.today, "aria-label": L.toDay });
  const custom = state.range === "custom"
    ? h("form", { class: "custom", onsubmit: (e) => { e.preventDefault(); go("dashboard", { range: "custom", from: fromInput.value, to: toInput.value }); } },
      fromInput, toInput, h("button", { class: "btn", type: "submit" }, L.apply))
    : null;

  // The grid. Empty sections are listed on one line, except while editing.
  const showTag = hasModules();
  const cards = [];
  const empties = [];
  for (const section of sections) {
    const id = section.id;
    const body = BREAKDOWNS[id] ? breakdownBody(id) : moduleBodies[id]();
    if (isEmpty(body) && !state.editing) {
      empties.push(L.sections[id]);
      continue;
    }
    // Missing pages have no page views to filter.
    const unfiltered = filtered && (section.module !== "perus" || id === "missing_pages");
    const listLink = more[id] ? h("a", { class: "more", href: href(`list/${id}`) }, L.showAll) : null;
    const el = h("section", {
      class: `m-${section.module}${cardOption(cfg, id, "wide") ? " wide" : ""}${unfiltered ? " unfiltered" : ""}`,
      "data-id": id,
    },
    h("div", { class: "va-h" },
      state.editing ? dragHandle(id) : null,
      h("h3", {}, L.sections[id]),
      state.editing ? null : csv(csvReport[id]),
      unfiltered ? h("span", { class: "tag plain" }, L.filters.notFiltered) : showTag ? h("span", { class: "tag" }, L.modules[section.module]) : null,
      state.editing ? editButtons(id) : null),
    state.editing ? cardTools(cfg, id) : null,
    body,
    listLink);
    cards.push(el);
  }

  replace(container,
    state.editing ? editBar(cfg) : presetBanner(cfg),
    flashMessage(),
    h("div", { class: "va" },
      h("div", { class: "va-bar" },
        h("span", { class: "muted" }, formatRange(range, timeZone)),
        rangeButtons, custom,
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.compare, onchange: (e) => go("dashboard", { compare: e.target.checked ? null : "0" }) }), L.compare),
        h("span", { class: "sp" }),
        previous ? h("span", { class: "muted" }, L.prevPeriod(formatRange(previous, timeZone))) : null,
        h("a", { class: "btn", href: `/api/v1${siteUrl(`/export.csv?${q}&report=timeseries&interval=${interval}${fq}`)}`, download: true }, L.exportSeries),
        isAdmin() && !state.editing ? h("button", { class: "btn", type: "button", onclick: startEdit }, L.edit.open) : null),
      filterBar,
      kpiRow,
      kpiNote,
      h("div", { class: "va-main" }, trend),
      h("div", { class: "va-grid" }, cards),
      empties.length ? h("p", { class: "note empties" }, L.emptyCards(empties.join(", "))) : null),
    optOutLinks());
}

// Columns of the module lists, shared by the card and the full list.
function moduleColumns(id, data) {
  const page = (row) => filterLink("page", row.value, row.value);
  const columns = {
    shop_products: [
      { title: L.shop.product, value: (row) => row.name || row.sku, text: (row) => row.name || row.sku, sort: (row) => row.name || row.sku },
      { title: L.shop.quantity, value: (row) => nf(row.quantity), right: true, sort: (row) => row.quantity },
      { title: L.shop.revenue, value: (row) => money(row.revenue), right: true, sort: (row) => row.revenue },
    ],
    campaigns: [
      { title: L.col.campaign, value: (row) => filterLink("utm_campaign", row.value, row.value), text: (row) => row.value, sort: (row) => row.value },
      { title: data.measure === "pageviews" ? L.col.views : L.col.sessions, value: (row) => nf(row.count), right: true, sort: (row) => row.count },
      { title: L.col.change, value: (row) => (row.status === "ended" ? L.campaignStatus.ended : chg(row.count, row.previous_count) || ""), right: true, sort: (row) => row.count - row.previous_count },
      { title: L.shop.orders, value: (row) => nf(row.orders), right: true, sort: (row) => row.orders },
    ],
    content_engagement: [
      { title: L.col.page, value: page, text: (row) => row.value, path: true, sort: (row) => row.value },
      { title: L.col.time, value: (row) => duration(row.median_seconds), right: true, sort: (row) => row.median_seconds },
      { title: L.col.scroll, value: (row) => `${nf(row.avg_scroll_pct)} %`, right: true, sort: (row) => row.avg_scroll_pct },
      { title: L.col.readThrough, value: (row) => `${nf(row.read_through_pct)} %`, right: true, sort: (row) => row.read_through_pct },
      { title: L.col.n, value: (row) => nf(row.n), right: true, sort: (row) => row.n },
    ],
    content_rising: [
      { title: L.col.page, value: page, text: (row) => row.value, path: true, sort: (row) => row.value },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true, sort: (row) => row.pageviews },
      { title: L.col.change, value: (row) => chg(row.pageviews, row.pageviews - row.change) || "", right: true, sort: (row) => row.change },
    ],
    // The site answered these with "not found", so they are not filter links.
    missing_pages: [
      { title: L.col.page, value: (row) => row.value, text: (row) => row.value, path: true, sort: (row) => row.value },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true, sort: (row) => row.pageviews },
    ],
  };
  return columns[id];
}

function moduleTable(id, rows, data) {
  return table(moduleColumns(id, data), rows);
}

function flashMessage() {
  if (!state.flash) return null;
  const text = state.flash;
  state.flash = "";
  return h("p", { class: "flash", role: "status" }, text);
}

// Links to the sites' own opt-out pages, so the owner can leave out a phone with one tap.
// Only in the logged-in dashboard; the link opens the site itself, which sets its cookie.
function optOutLinks() {
  const sites = state.me?.login ? state.sites.filter((x) => x.opt_out_url) : [];
  if (!sites.length) return null;
  return h("p", { class: "note optout" }, L.optOutLinks, " ",
    sites.map((x, i) => [i ? " · " : "", h("a", { href: x.opt_out_url, target: "_blank", rel: "noopener noreferrer" }, x.domain)]));
}

// ---------- editing the dashboard ----------

// The layout written out in full, so that edits have lists to work on.
// Sections and figures that are not available now (a module turned off,
// visitors off) keep their place, so they come back as they were.
function fullLayout(cfg) {
  const available = new Set(availableSections().map((x) => x.id));
  const keepShown = (cfg.sections || []).filter((id) => !available.has(id));
  const keepHidden = (cfg.hidden_sections || []).filter((id) => !available.has(id) && !keepShown.includes(id));
  const kpisNow = new Set(availableKpis());
  return {
    ...cfg,
    sections: [...sectionOrder(cfg).map((x) => x.id), ...keepShown],
    hidden_sections: [...hiddenSectionsOf(cfg).map((x) => x.id), ...keepHidden],
    kpis: [...kpiIds(cfg), ...(cfg.kpis || []).filter((id) => !kpisNow.has(id))],
    cards: { ...(cfg.cards || {}) },
  };
}

function startEdit() {
  state.draft = fullLayout(state.config);
  state.editing = true;
  render();
}

function applyPreset(name) {
  state.draft = fullLayout({ ...state.draft, ...presetConfig(name) });
  state.dirty = true;
  render();
}

function updateDraft(changes, { redraw = true } = {}) {
  state.draft = { ...state.draft, ...changes };
  state.dirty = true;
  if (redraw) render();
}

function cancelEdit() {
  state.draft = null;
  state.editing = false;
  state.dirty = false;
  render();
}

async function saveLayout(status) {
  const site = state.site.id;
  try {
    const saved = (await api(siteUrl("/config"), { method: "PUT", body: configBody(state.draft) })).data;
    if (state.site.id !== site) return;
    state.config = saved;
    state.draft = null;
    state.editing = false;
    state.dirty = false;
    state.flash = L.edit.saved;
    render();
  } catch (error) {
    if (error instanceof AuthError) return showLogin();
    status.textContent = error.message;
  }
}

async function choosePreset(name) {
  const site = state.site.id;
  try {
    const saved = (await api(siteUrl("/config"), { method: "PUT", body: configBody({ ...state.config, ...presetConfig(name) }) })).data;
    if (state.site.id !== site) return;
    state.config = saved;
    render();
  } catch (error) {
    if (error instanceof AuthError) return showLogin();
    state.flash = error.message;
    render();
  }
}

// Offered once, until a layout is chosen or saved.
function presetBanner(cfg) {
  if (!isAdmin() || cfg.preset || cfg.sections) return null;
  return h("div", { class: "banner" },
    h("div", {}, h("strong", {}, L.edit.startTitle), " ", h("span", { class: "muted" }, L.edit.startNote)),
    h("div", { class: "row" },
      presetNames().map((name) => h("button", { class: "btn", type: "button", title: L.edit.presetNotes[name], onclick: () => choosePreset(name) }, L.edit.presets[name])),
      h("button", { class: "btn", type: "button", onclick: startEdit }, L.edit.own)));
}

function editBar(cfg) {
  const status = h("span", { class: "note error", role: "alert" });
  const chosen = kpiIds(cfg);
  const hidden = hiddenSectionsOf(cfg);
  const toggleKpi = (id, on) => {
    const current = cfg.kpis || DEFAULT_KPIS;
    const next = KPI_ORDER.filter((k) => (k === id ? on : current.includes(k)));
    // At least one figure that can be shown now stays.
    if (next.some((k) => availableKpis().includes(k))) updateDraft({ kpis: next });
    else render();
  };
  return h("div", { class: "editbar" },
    h("div", {}, h("strong", {}, L.edit.title), " ", h("span", { class: "muted" }, L.edit.note)),
    h("div", { class: "row" }, h("span", { class: "muted" }, L.edit.preset),
      h("div", { class: "seg", role: "group" }, presetNames().map((name) => h("button", {
        type: "button", "aria-pressed": String(cfg.preset === name), title: L.edit.presetNotes[name],
        onclick: () => applyPreset(name),
      }, L.edit.presets[name])))),
    h("div", { class: "row" }, h("span", { class: "muted" }, L.edit.kpis),
      availableKpis().map((id) => h("label", { class: "check chip" },
        h("input", { type: "checkbox", checked: chosen.includes(id), onchange: (e) => toggleKpi(id, e.target.checked) }), L.kpiNames[id]))),
    hidden.length
      ? h("div", { class: "row" }, h("span", { class: "muted" }, L.edit.hidden),
        hidden.map((x) => h("button", { class: "btn", type: "button", onclick: () => showSection(x.id) }, `+ ${L.sections[x.id]}`)))
      : null,
    h("div", { class: "row" },
      h("button", { class: "btn primary", type: "button", onclick: () => saveLayout(status) }, L.edit.save),
      h("button", { class: "btn", type: "button", onclick: cancelEdit }, L.edit.cancel),
      h("button", { class: "btn", type: "button", onclick: () => applyPreset("default") }, L.edit.reset),
      status));
}

function showSection(id) {
  updateDraft({
    sections: [...state.draft.sections, id],
    hidden_sections: state.draft.hidden_sections.filter((x) => x !== id),
  });
}

function hideSection(id) {
  updateDraft({
    sections: state.draft.sections.filter((x) => x !== id),
    hidden_sections: [...state.draft.hidden_sections.filter((x) => x !== id), id],
  });
}

// The order of the cards on the screen becomes the saved order.
function orderFromGrid(grid) {
  const ids = [...grid.querySelectorAll(":scope > section[data-id]")].map((el) => el.dataset.id);
  updateDraft({ sections: [...ids, ...state.draft.sections.filter((id) => !ids.includes(id))] }, { redraw: false });
}

function moveCard(button, delta) {
  const card = button.closest("section[data-id]");
  const target = delta < 0 ? card.previousElementSibling : card.nextElementSibling;
  if (!target) return;
  if (delta < 0) target.before(card);
  else target.after(card);
  orderFromGrid(card.parentElement);
  button.focus();
}

// Dragging works with a mouse and a finger: the card follows the pointer
// over the other cards, and the order is kept when it is let go.
function dragHandle(id) {
  return h("button", {
    class: "handle", type: "button", "aria-label": L.edit.drag(L.sections[id]), title: L.edit.dragTitle,
    onpointerdown: (event) => {
      const handle = event.currentTarget;
      const card = handle.closest("section[data-id]");
      const grid = card.parentElement;
      event.preventDefault();
      card.classList.add("dragging");
      // Listened on the document: moving the card in the page would release a
      // pointer capture on the handle, and the release would be missed.
      const move = (e) => {
        if (e.pointerId !== event.pointerId) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("section[data-id]");
        if (!target || target === card || target.parentElement !== grid) return;
        const items = [...grid.children];
        if (items.indexOf(target) > items.indexOf(card)) target.after(card);
        else target.before(card);
      };
      const done = (e) => {
        if (e.pointerId !== event.pointerId) return;
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", done);
        document.removeEventListener("pointercancel", done);
        card.classList.remove("dragging");
        orderFromGrid(grid);
        handle.focus();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", done);
      document.addEventListener("pointercancel", done);
    },
  }, "⠿");
}

function editButtons(id) {
  const name = L.sections[id];
  return h("span", { class: "edit-buttons" },
    h("button", { class: "btn icon", type: "button", "aria-label": L.edit.earlier(name), onclick: (e) => moveCard(e.currentTarget, -1) }, "←"),
    h("button", { class: "btn icon", type: "button", "aria-label": L.edit.later(name), onclick: (e) => moveCard(e.currentTarget, 1) }, "→"),
    h("button", { class: "btn icon", type: "button", "aria-label": L.edit.hide(name), title: L.edit.hide(name), onclick: () => hideSection(id) }, "×"));
}

function cardTools(cfg, id) {
  const spec = BREAKDOWNS[id];
  const set = (key, value) => {
    const cards = { ...(state.draft.cards || {}) };
    const card = { ...(cards[id] || {}) };
    if (value === "" || value === null) delete card[key];
    else card[key] = value;
    if (Object.keys(card).length) cards[id] = card;
    else delete cards[id];
    updateDraft({ cards });
  };
  const select = (labelText, key, options, current) => h("label", { class: "check" }, labelText,
    h("select", { onchange: (e) => set(key, key === "rows" ? Number(e.target.value) : e.target.value) },
      options.map(([value, text]) => h("option", { value, selected: String(current) === String(value) }, text))));
  const hasRows = (spec && !spec.stack && id !== "page_groups") || MODULE_LISTS[id];
  const sortChoices = state.site.visitors === "off" ? [] : [["pageviews", L.col.views], ["visitors", L.col.visitors], ["entries", ["pages", "countries"].includes(id) ? L.col.entries : L.col.sessions]];
  return h("div", { class: "tools" },
    hasRows ? select(L.edit.rows, "rows", [...new Set([...ROW_CHOICES, cardRows(cfg, id)])].sort((a, b) => a - b).map((n) => [n, String(n)]), cardRows(cfg, id)) : null,
    spec?.views ? select(L.edit.view, "view", [["table", L.edit.views.table], ["bars", L.edit.views.bars]], cardOption(cfg, id, "view") || spec.view || "table") : null,
    spec?.sorts && sortChoices.length ? select(L.edit.sort, "sort", sortChoices, cardOption(cfg, id, "sort") || spec.sort || "pageviews") : null,
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: cardOption(cfg, id, "wide"), onchange: (e) => set("wide", e.target.checked) }), L.edit.wide));
}

// ---------- full list ----------

async function listView(container, token, id) {
  const spec = BREAKDOWNS[id];
  const back = h("a", { href: href("dashboard") }, `‹ ${L.nav.dashboard}`);
  if (!L.sections[id] || !(spec && id !== "page_groups" && id !== "devices") && !MODULE_LISTS[id]) {
    replace(container, h("div", { class: "panel" }, back, h("p", {}, L.notFound)));
    return;
  }
  const q = rangeQuery();
  const fq = filterQuery();
  const noVisitors = state.site.visitors === "off";
  let rows;
  let columns;
  let meta;
  if (spec) {
    const dim = spec.dim;
    const answer = await api(siteUrl(`/breakdown/${dim}?${q}&limit=1000${fq}`));
    meta = answer.meta;
    rows = answer.data.rows.filter((row) => !(id.startsWith("utm") && row.value === ""));
    const text = (row) => label(dim, row.value);
    const isPage = ["page", "entry", "exit"].includes(dim);
    columns = [
      { title: id === "browsers" ? L.col.browser : ({ referrers: L.col.source, utm_source: L.col.source, utm_campaign: L.col.campaign, countries: L.col.country }[id] || L.col.page), value: (row) => filterLink(spec.filter, row.value, text(row)), text, path: spec.path, sort: text },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true, sort: (row) => row.pageviews },
      ...(noVisitors ? [] : [
        { title: L.col.visitors, value: (row) => nf(row.visitors), right: true, sort: (row) => row.visitors },
        { title: isPage ? L.col.entries : L.col.sessions, value: (row) => nf(row.entries), right: true, sort: (row) => row.entries },
      ]),
      ...(isPage && !noVisitors ? [{ title: L.col.exits, value: (row) => nf(row.exits), right: true, sort: (row) => row.exits }] : []),
    ];
  } else {
    const answer = await api(siteUrl(`${MODULE_LISTS[id].url}?${q}&limit=1000`));
    meta = answer.meta;
    rows = answer.data.rows || answer.data.sold;
    columns = moduleColumns(id, answer.data);
  }
  if (token !== renderToken) return;

  let sortIndex = -1;
  let ascending = false;
  const body = h("tbody");
  const count = h("p", { class: "note" });
  const search = h("input", { type: "search", placeholder: L.search, "aria-label": L.search, oninput: () => draw() });
  const heads = columns.map((c, i) => h("th", { class: c.right ? "r" : null, "aria-sort": "none" },
    h("button", { class: "sorter", type: "button", onclick: () => {
      ascending = sortIndex === i ? !ascending : !c.right;
      sortIndex = i;
      draw();
    } }, c.title)));
  function draw() {
    const term = search.value.trim().toLowerCase();
    let shown = rows.filter((row) => !term || String((columns[0].text || columns[0].sort)(row)).toLowerCase().includes(term));
    if (sortIndex >= 0) {
      const key = columns[sortIndex].sort;
      shown = [...shown].sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), L.locale);
        return ascending ? order : -order;
      });
    }
    heads.forEach((th, i) => th.setAttribute("aria-sort", i === sortIndex ? (ascending ? "ascending" : "descending") : "none"));
    replace(body, ...shown.map((row) => h("tr", {}, columns.map((c) =>
      h("td", { class: c.right ? "r" : c.path ? "p" : null, title: c.path ? c.text(row) : null }, c.value(row))))));
    count.textContent = L.rowsShown(nf(shown.length), nf(rows.length));
  }
  draw();
  const chips = FILTER_KEYS.filter((key) => state.filters[key] !== undefined).map((key) =>
    h("span", { class: "chip" }, `${L.filterNames[key]}: `, h("b", {}, label(FILTER_DIMENSION[key], state.filters[key]))));
  replace(container, h("div", { class: "panel list-view" },
    back,
    h("h2", {}, L.sections[id]),
    h("div", { class: "row" }, h("span", { class: "muted" }, formatRange(meta.range, meta.timezone)),
      spec ? chips : chips.length ? h("span", { class: "muted" }, L.filters.notFiltered) : null,
      spec || id === "campaigns" ? h("span", { class: "muted" }, L.filters.byRow) : null),
    h("div", { class: "row" }, search, count),
    rows.length ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, heads)), body)) : empty()));
}

// ---------- monthly review ----------

function lastCompleteMonth() {
  return shiftMonth(state.site.today.slice(0, 7), -1);
}

async function reportView(container, token) {
  const thisMonth = state.site.today.slice(0, 7);
  if (!state.month || state.month > thisMonth) state.month = lastCompleteMonth();
  const range = monthRange(state.month);
  if (state.month === thisMonth) range.to = state.site.today;
  // A month in progress is compared with the same days of the previous month.
  const prevRange = monthRange(shiftMonth(state.month, -1));
  if (state.month === thisMonth) {
    const day = Math.min(Number(state.site.today.slice(8, 10)), Number(prevRange.to.slice(8, 10)));
    prevRange.to = `${prevRange.from.slice(0, 8)}${String(day).padStart(2, "0")}`;
  }
  const q = `from=${range.from}&to=${range.to}`;
  const pq = `from=${prevRange.from}&to=${prevRange.to}`;

  const [summary, previous, series, prevSeries, referrers, devices, pages, entries] = await Promise.all([
    api(siteUrl(`/summary?${q}`)),
    api(siteUrl(`/summary?${pq}`)),
    api(siteUrl(`/timeseries?${q}`)),
    api(siteUrl(`/timeseries?${pq}`)),
    api(siteUrl(`/breakdown/referrer?${q}&limit=100&sort=entries`)),
    api(siteUrl(`/breakdown/device?${q}`)),
    api(siteUrl(`/breakdown/page?${q}&limit=5`)),
    api(siteUrl(`/breakdown/entry?${q}&limit=5`)),
  ]);
  if (token !== renderToken) return;

  const review = buildReview(L, {
    month: state.month,
    today: state.site.today,
    summary: summary.data,
    previous: previous.data,
    points: series.data.points,
    referrers: referrers.data.rows,
    devices: devices.data.rows,
    pages: pages.data.rows,
    entries: entries.data.rows,
  }, { formatNumber: (v) => nf(v), formatDay });

  const d = summary.data;
  const pd = previous.data;
  const allFigs = [[L.vis, d.visitors, pd.visitors], [L.pv, d.pageviews, pd.pageviews], [L.ses, d.sessions, pd.sessions], [L.pps, d.pages_per_session, pd.pages_per_session]];
  const figs = d.visitors === null ? allFigs.slice(1, 2) : allFigs;
  const points = series.data.points;
  const sectionBody = {
    visitors: () => lineChart({
      periods: points.map((x) => x.period),
      series: [
        { label: L.pv, values: points.map((x) => x.pageviews), cls: "s-pv", legendCls: "i-pv", area: true },
        ...(d.visitors === null ? [] : [{ label: L.vis, values: points.map((x) => x.visitors), cls: "s-vis", legendCls: "i-vis" }]),
      ],
      previous: { label: `${L.pv}, ${L.prevLine}`, values: prevSeries.data.points.map((x) => x.pageviews) },
      height: 150,
      format: (v) => nf(v),
      periodLabel: formatPeriod,
      partial: { last: state.month === thisMonth },
      label: L.trend,
      texts: chartTexts(),
    }),
    content: () => [table([
      { title: L.col.page, value: (row) => row.value, text: (row) => row.value, path: true },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true },
    ], pages.data.rows)],
  };
  const tag = () => (hasModules() ? h("span", { class: "tag" }, L.modules.perus) : null);

  replace(container,
    h("article", { class: "vc" },
      h("div", { class: "vc-in" },
        h("div", { class: "vc-meta" },
          h("span", {}, `${state.site.domain} · ${L.report.meta}`),
          h("span", { class: "seg" },
            h("button", { type: "button", "aria-label": L.report.prev, onclick: () => go("report", { month: shiftMonth(state.month, -1) }) }, "‹"),
            h("button", { type: "button", "aria-label": L.report.next, disabled: state.month >= thisMonth, onclick: () => go("report", { month: shiftMonth(state.month, 1) }) }, "›"))),
        h("h2", {}, review.title),
        h("p", { class: "lead" }, review.lead.map((part) => (typeof part === "string" ? part : h("b", {}, part.b)))),
        d.pageviews
          ? h("div", { class: "vc-figs" }, figs.map(([k, v, pv]) => h("div", {}, h("div", { class: "v" }, nf(v, k === L.pps ? 1 : 0)), h("div", { class: "k" }, `${k} `, chg(v, pv, { kind: k === L.pps ? "rate" : "count" })))))
          : null,
        review.sections.map((section) => h("section", { class: "m-perus" },
          h("h3", {}, section.title, tag()),
          section.sentences.length ? h("p", {}, section.sentences.join(" ")) : null,
          sectionBody[section.id]())),
        h("p", { class: "foot" }, d.visitors === null ? L.report.footViews : review.foot))));
}

// ---------- settings ----------

async function settingsView(container, token) {
  const S = L.settings;
  const admin = isAdmin();
  const tokens = admin ? (await api("/tokens")).data : [];
  if (token !== renderToken) return;
  const config = state.config;
  state.dirty = false;

  // This browser: theme and language, applied at once.
  const seg = (options, current, onPick, redraw = true) => h("div", { class: "seg", role: "group" },
    options.map(([key, text]) => h("button", { type: "button", "aria-pressed": String(current === key), onclick: (e) => {
      // The language needs a redraw, which would drop unsaved site settings: ask first.
      if (redraw && !leaveOk()) return;
      onPick(key);
      save();
      applyTheme();
      if (redraw) render();
      else e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
    } }, text)));
  const viewer = h("section", { class: "panel" },
    h("h2", {}, S.viewer),
    h("p", { class: "note" }, S.viewerNote),
    h("div", { class: "field" }, h("span", { class: "muted" }, S.theme), seg(Object.entries(S.themes), state.theme, (k) => { state.theme = k; }, false)),
    h("div", { class: "field" }, h("span", { class: "muted" }, S.language), seg([["", S.languageSite], ["fi", "Suomi"], ["en", "English"]], state.lang, (k) => { state.lang = k; })));

  // The site: saved for everyone with the Save bar.
  const errors = h("span", { class: "error", role: "alert" });
  const saveBar = h("div", { class: "savebar", hidden: true },
    h("span", {}, S.unsaved), errors, h("span", { class: "sp" }),
    h("button", { class: "btn", type: "button", onclick: () => { state.dirty = false; render(); } }, S.discard),
    h("button", { class: "btn primary", type: "button", onclick: () => saveSite() }, S.save));
  const markDirty = () => {
    if (!admin) return;
    state.dirty = true;
    saveBar.hidden = false;
  };

  const languageSelect = h("select", { "aria-label": S.siteLanguage },
    [["", S.languageAuto], ["fi", "Suomi"], ["en", "English"]].map(([v, t]) => h("option", { value: v, selected: config.language === v }, t)));
  const currencySelect = h("select", { "aria-label": S.currency },
    h("option", { value: "" }, S.currencyNone),
    CURRENCIES.map((code) => h("option", { value: code, selected: config.currency === code }, code)));
  const optOutInput = h("input", { type: "url", value: config.opt_out_url || "", placeholder: `https://${state.site.domain}/…`, "aria-label": S.optOutUrl, maxlength: 500 });
  const hasShop = state.site.modules.includes("shop");

  const site = h("section", { class: "panel", id: "site" },
    h("h2", {}, `${S.site}: ${state.site.domain}`),
    h("div", { class: "field" }, h("span", { class: "muted" }, S.siteLanguage), languageSelect),
    h("p", { class: "note" }, S.siteLanguageNote),
    hasShop ? h("div", { class: "field" }, h("span", { class: "muted" }, S.currency), currencySelect) : null,
    h("h3", {}, S.optOut), h("p", { class: "note" }, S.optOutNote),
    h("div", { class: "field" }, h("span", { class: "muted" }, S.optOutUrl), optOutInput));

  const groups = (config.page_groups || []).map((g) => ({ ...g }));
  const groupList = h("div", { class: "list" });
  const drawGroups = () => replace(groupList, ...groups.map((g, i) => h("div", { class: "row" },
    h("input", { type: "text", value: g.name, placeholder: S.groupName, "aria-label": S.groupName, oninput: (e) => { g.name = e.target.value; } }),
    h("input", { type: "text", value: g.prefix, placeholder: "/oppaat/", "aria-label": S.groupPrefix, oninput: (e) => { g.prefix = e.target.value; } }),
    h("button", { class: "btn", type: "button", onclick: () => { groups.splice(i, 1); drawGroups(); markDirty(); } }, S.remove))));
  drawGroups();
  const groupPanel = h("section", { class: "panel", id: "groups" },
    h("h2", {}, S.groups), h("p", { class: "note" }, S.groupsNote), groupList,
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { groups.push({ name: "", prefix: "" }); drawGroups(); markDirty(); groupList.querySelector(".row:last-child input")?.focus(); } }, S.add)));

  const shop = { ...(config.shop || {}) };
  const shopPanel = hasShop
    ? h("section", { class: "panel", id: "shop" },
      h("h2", {}, S.shop), h("p", { class: "note" }, S.shopNote),
      [["product_prefix", "/tuotteet/"], ["cart_path", "/ostoskori"], ["checkout_path", "/kassa"]].map(([key, example]) => h("div", { class: "field" },
        h("span", { class: "muted" }, S.shopPaths[key]),
        h("input", { type: "text", value: shop[key] || "", placeholder: example, "aria-label": S.shopPaths[key], oninput: (e) => { shop[key] = e.target.value; } }))))
    : null;

  const dashboardPanel = h("section", { class: "panel", id: "dashboard" },
    h("h2", {}, S.dashboard), h("p", { class: "note" }, S.dashboardNote),
    admin ? h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { if (leaveOk()) { history.pushState(null, "", href("dashboard")); startEdit(); } } }, L.edit.open)) : null);

  for (const panel of [site, groupPanel, shopPanel]) {
    if (!panel) continue;
    panel.addEventListener("input", markDirty);
    panel.addEventListener("change", markDirty);
    if (!admin) panel.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
  }

  // Checked here first, so the messages are in the dashboard's language.
  const problems = (cleanGroups) => {
    const list = [];
    for (const g of cleanGroups) {
      if (!g.name) list.push(S.errors.groupName(g.prefix));
      else if (!g.prefix.startsWith("/")) list.push(S.errors.groupPrefix(g.name));
    }
    for (const [key, value] of Object.entries(shop)) {
      if (value.trim() && !value.trim().startsWith("/")) list.push(S.errors.shopPath(S.shopPaths[key]));
    }
    const url = optOutInput.value.trim();
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) list.push(S.errors.optOut);
    return list;
  };

  async function saveSite() {
    const cleanGroups = groups.map((g) => ({ name: g.name.trim(), prefix: g.prefix.trim() })).filter((g) => g.name || (g.prefix && g.prefix !== "/"));
    const found = problems(cleanGroups);
    if (found.length) {
      errors.textContent = found.join(" ");
      return;
    }
    try {
      const body = configBody({
        ...config,
        language: languageSelect.value,
        currency: hasShop ? currencySelect.value : config.currency,
        page_groups: cleanGroups,
        shop: Object.fromEntries(Object.entries(shop).map(([k, v]) => [k, v.trim()])),
        opt_out_url: optOutInput.value.trim(),
      });
      const site = state.site.id;
      const saved = (await api(siteUrl("/config"), { method: "PUT", body })).data;
      if (state.site.id !== site) return;
      state.config = saved;
      state.site.opt_out_url = state.config.opt_out_url || null;
      state.dirty = false;
      state.flash = S.saved;
      render();
    } catch (error) {
      if (error instanceof AuthError) return showLogin();
      errors.textContent = error.message;
    }
  }

  // API keys.
  const nameInput = h("input", { type: "text", placeholder: S.tokenName, "aria-label": S.tokenName, maxlength: 100 });
  const scopeSelect = h("select", { "aria-label": S.scope }, h("option", { value: "read" }, S.scopeRead), h("option", { value: "admin" }, S.scopeAdmin));
  const siteChoice = h("select", { "aria-label": S.siteChoice }, h("option", { value: "" }, S.allSites), state.sites.map((x) => h("option", { value: x.id }, x.domain)));
  const tokenStatus = h("p", { class: "note error", role: "alert" });
  const revokeButton = (t) => h("button", { class: "btn", type: "button", onclick: async (e) => {
    const button = e.currentTarget;
    // Two steps: the first press asks, the second revokes.
    if (!button.dataset.sure) {
      button.dataset.sure = "1";
      button.textContent = S.revokeSure;
      button.classList.add("danger");
      return;
    }
    if (!leaveOk()) return;
    try {
      await api(`/tokens/${t.id}`, { method: "DELETE" });
      render();
    } catch (error) {
      if (error instanceof AuthError) return showLogin();
      tokenStatus.textContent = error.message;
    }
  } }, S.revoke);
  const keys = admin ? h("section", { class: "panel", id: "keys" },
    h("h2", {}, S.tokens), h("p", { class: "note" }, S.tokensNote, " ", h("a", { href: "/api/v1/openapi.json" }, S.apiDoc)),
    h("div", { id: "new-token" }),
    h("div", { class: "list" }, tokens.map((t) => h("div", { class: "item" },
      h("span", {}, h("strong", {}, t.name), " ", h("span", { class: "muted" }, `${t.scope === "admin" ? S.scopeAdmin : S.scopeRead} · ${t.site_id || S.allSites} · ${t.last_used_day ? `${S.lastUsed} ${formatFullDay(t.last_used_day)}` : S.never}`)),
      revokeButton(t)))),
    h("form", { class: "row", onsubmit: async (e) => {
      e.preventDefault();
      if (!leaveOk()) return;
      try {
        const { data } = await api("/tokens", { method: "POST", body: { name: nameInput.value, scope: scopeSelect.value, site: siteChoice.value || undefined } });
        await render();
        // Shown after the redraw, once.
        const box = document.getElementById("new-token");
        if (box) replace(box, newTokenBox(data.token));
      } catch (error) {
        if (error instanceof AuthError) return showLogin();
        tokenStatus.textContent = error.message;
      }
    } }, nameInput, scopeSelect, siteChoice, h("button", { class: "btn", type: "submit" }, S.create)),
    tokenStatus) : null;

  replace(container, h("div", { class: "settings" },
    flashMessage(),
    admin ? null : h("p", { class: "note" }, S.readOnly),
    viewer, site, groupPanel, shopPanel, dashboardPanel, keys, saveBar));
  // A link to one part of the settings, e.g. #/settings?at=shop.
  const at = parseHash().params.get("at");
  if (at) requestAnimationFrame(() => document.getElementById(at)?.scrollIntoView());
}

function newTokenBox(token) {
  const S = L.settings;
  const field = h("input", { type: "text", readonly: true, value: token, class: "token", "aria-label": S.newTokenLabel, onfocus: (e) => e.target.select() });
  const copy = h("button", { class: "btn", type: "button", onclick: async () => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      // Without a secure connection the clipboard API is missing: copy the selection.
      field.select();
      document.execCommand("copy");
    }
    copy.textContent = S.copied;
  } }, S.copy);
  return [h("p", { class: "note" }, S.newToken), h("div", { class: "row" }, field, copy)];
}

// ---------- login and routing ----------

function showLogin(message = "") {
  renderToken += 1;
  const input = h("input", { type: "password", autocomplete: "current-password", required: true, "aria-label": L.password, placeholder: L.password });
  const status = h("p", { class: "note error", role: "alert" }, message);
  const app = document.getElementById("app");
  app.dataset.route = "";
  replace(app, h("div", { class: "panel login" },
    h("div", { class: "brand" }, logo(), "Looku"),
    h("h1", { class: "sr" }, L.loginTitle),
    h("form", { onsubmit: async (e) => {
      e.preventDefault();
      try {
        const response = await fetch("/api/v1/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: input.value }) });
        if (response.ok) return start();
        status.textContent = response.status === 429 ? L.tooMany : response.status === 409 ? L.noPassword : response.status === 401 ? L.wrongPassword : L.loadError;
      } catch {
        status.textContent = L.loadError;
      }
    } }, input, h("button", { class: "btn primary", type: "submit" }, L.login), status)));
  input.focus();
}

async function logout() {
  if (!leaveOk()) return;
  try {
    await fetch("/api/v1/logout", { method: "POST" });
  } catch {
    // The login screen is shown anyway; the session ends when it expires.
  }
  showLogin();
}

function applyTheme() {
  if (state.theme === "light" || state.theme === "dark") document.documentElement.setAttribute("data-theme", state.theme);
  else document.documentElement.removeAttribute("data-theme");
}

// This browser's choice, then the site's default, then the browser's language.
function chooseLanguage() {
  const preferred = state.lang || state.config?.language || (navigator.language || "fi").slice(0, 2);
  L = T[preferred] || T.en;
  document.documentElement.lang = L === T.fi ? "fi" : "en";
}

async function render() {
  const token = ++renderToken;
  const { route, card, params } = parseHash();
  applyParams(params, route);
  lastHash = location.hash;
  const app = document.getElementById("app");
  try {
    if (!state.config) {
      const config = (await api(siteUrl("/config"))).data;
      if (token !== renderToken) return;
      state.config = config;
    }
    chooseLanguage();
    if (route === "dashboard") save();
    // The page stays in place while the new numbers load.
    const old = app.querySelector("main");
    if (old && app.dataset.route === route) {
      old.classList.add("busy");
      old.setAttribute("aria-busy", "true");
    } else {
      replace(app, header(route), h("main", {}, h("p", { class: "muted loading" }, "…")));
      app.dataset.route = route;
    }
    const main = h("main", {});
    const view = { dashboard: dashboardView, report: reportView, settings: settingsView, list: listView }[route];
    await view(main, token, card);
    if (token !== renderToken) return;
    replace(app, header(route), main);
    app.dataset.route = route;
  } catch (error) {
    if (error instanceof AuthError) return showLogin();
    if (token !== renderToken) return;
    replace(app, header(route), h("main", {}, h("p", { class: "error" }, `${L.loadError} ${error.message}`)));
    app.dataset.route = "";
  }
}

async function start() {
  try {
    state.me = await api("/me");
    state.sites = (await api("/sites")).data;
  } catch (error) {
    chooseLanguage();
    if (error instanceof AuthError) return showLogin();
    replace(document.getElementById("app"), h("p", { class: "error" }, `${L.loadError} ${error.message}`));
    return;
  }
  if (!state.sites.length) {
    chooseLanguage();
    replace(document.getElementById("app"), h("p", {}, L.noSites));
    return;
  }
  const saved = typeof state.site === "string" ? state.site : state.site?.id;
  state.site = state.sites.find((x) => x.id === saved) || state.sites[0];
  state.config = null;
  render();
}

load();
applyTheme();
chooseLanguage();
// Links, Back and Forward change the address; the view follows it. Browsers
// fire popstate, hashchange or both, so the address is compared first.
function followAddress() {
  if (location.hash === lastHash) return;
  if (state.editing && parseHash().route === "dashboard") return render();
  if (state.dirty && !window.confirm(L.unsaved)) {
    history.replaceState(null, "", lastHash);
    return;
  }
  state.dirty = false;
  state.editing = false;
  state.draft = null;
  render();
}
window.addEventListener("popstate", followAddress);
window.addEventListener("hashchange", followAddress);
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
start();
