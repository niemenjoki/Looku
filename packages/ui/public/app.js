import { T } from "./i18n.js";
import { buildReview, monthRange, percentChange, shiftMonth } from "./review.js";

// Looku dashboard: A (compact) and C (monthly review). Everything is built
// with DOM calls and text nodes, never from HTML strings, because page paths and UTM
// values come from visitors. The page talks only to /api/v1.

const SVG_NS = "http://www.w3.org/2000/svg";
const RANGE_KEYS = ["7d", "28d", "3m", "12m"];

// Sections of view A per module, in default order.
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
  { id: "shop_overview", module: "shop" },
  { id: "shop_funnel", module: "shop" },
  { id: "shop_products", module: "shop" },
  { id: "campaigns", module: "campaigns" },
  { id: "content_engagement", module: "content" },
  { id: "content_rising", module: "content" },
];

// Filters apply to the basic module's sections (see the API's filter params).
const FILTER_KEYS = ["page_group", "utm_campaign", "device"];
const ALL = "\u0001all";

const state = {
  sites: [],
  site: null,
  config: null,
  me: null,
  range: "28d",
  from: "",
  to: "",
  compare: true,
  hourly: false,
  filters: {},
  month: "",
  lang: "",
  theme: "auto",
};
let L = T.fi;
let renderToken = 0;

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "style") Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function load() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem("looku") || "{}"));
  } catch {
    // Storage blocked: defaults are used.
  }
}

function save() {
  try {
    const { site, range, from, to, compare, hourly, lang, theme } = state;
    localStorage.setItem("looku", JSON.stringify({ site: site?.id, range, from, to, compare, hourly, lang, theme }));
  } catch {
    // Storage blocked: settings last until the page is closed.
  }
}

const nf = (value, digits = 0) =>
  new Intl.NumberFormat(L.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

function formatDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  if (L.locale === "fi-FI") return `${d}.${m}.`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

function formatFullDay(day) {
  return L.locale === "fi-FI" ? `${formatDay(day)}${day.slice(0, 4)}` : `${formatDay(day)} ${day.slice(0, 4)}`;
}

function formatRange({ from, to }) {
  return `${formatDay(from)}-${formatFullDay(to)}`;
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

function chg(current, previous) {
  const p = percentChange(current, previous);
  if (p === null) return null;
  return h("span", { class: `chg ${p >= 0 ? "up" : "down"}` }, `${p >= 0 ? "+" : "−"}${nf(Math.abs(p))} %`);
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
  return value === null || value === undefined ? "" : nf(value, 2);
}

function duration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function rangeQuery() {
  if (state.range === "custom" && state.from && state.to) return `from=${state.from}&to=${state.to}`;
  return `range=${RANGE_KEYS.includes(state.range) ? state.range : "28d"}`;
}

function siteUrl(path) {
  return `/sites/${encodeURIComponent(state.site.id)}${path}`;
}

// ---------- charts ----------

function linePath(values, max, width, height) {
  if (!values.length) return "";
  const dx = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((y, i) => `${i ? "L" : "M"}${(i * dx).toFixed(1)},${(height - (max ? y / max : 0) * height).toFixed(1)}`)
    .join("");
}

function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const m = value / power;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power;
}

function spark(values) {
  const width = 100;
  const height = 24;
  const max = Math.max(...values, 0) * 1.08;
  const d = linePath(values, max, width, height);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  if (d) {
    svg.append(s("path", { d: `${d}L${width},${height}L0,${height}Z`, class: "spark-area" }));
    svg.append(s("path", { d, class: "spark-line", "vector-effect": "non-scaling-stroke" }));
  }
  return svg;
}

function lineChart(points, previousPoints, height = 140) {
  const width = 600;
  const pv = points.map((p) => p.pageviews);
  const vis = points.map((p) => p.visitors);
  const prev = (previousPoints || []).map((p) => p.pageviews).slice(0, pv.length);
  const max = niceMax(Math.max(...pv, ...prev, 1));

  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img", "aria-label": L.trend });
  svg.style.height = `${height}px`;
  for (const f of [0.5, 1]) {
    svg.append(s("line", { x1: 0, x2: width, y1: height - f * height, y2: height - f * height, class: "grid-line", "vector-effect": "non-scaling-stroke" }));
  }
  svg.append(s("line", { x1: 0, x2: width, y1: height, y2: height, class: "axis", "vector-effect": "non-scaling-stroke" }));
  if (prev.length) svg.append(s("path", { d: linePath(prev, max, width, height), class: "s-prev", "vector-effect": "non-scaling-stroke" }));
  const d = linePath(pv, max, width, height);
  if (d) {
    svg.append(s("path", { d: `${d}L${width},${height}L0,${height}Z`, class: "a-pv" }));
    svg.append(s("path", { d, class: "s-pv", "vector-effect": "non-scaling-stroke" }));
    svg.append(s("path", { d: linePath(vis, max, width, height), class: "s-vis", "vector-effect": "non-scaling-stroke" }));
  }

  const ticks = [];
  const count = Math.min(5, points.length);
  for (let i = 0; i < count; i += 1) {
    const index = count > 1 ? Math.round((i * (points.length - 1)) / (count - 1)) : 0;
    ticks.push(h("span", {}, formatPeriod(points[index].period)));
  }
  const top = h("span", { class: "yl" }, nf(max));
  top.style.top = "12px";
  const mid = h("span", { class: "yl" }, nf(max / 2));
  mid.style.top = `${12 + height / 2}px`;
  const chart = h("div", { class: "chart" }, top, mid, svg, h("div", { class: "xl" }, ticks));
  chart.style.paddingTop = "12px";

  return [
    chart,
    h("div", { class: "legend" },
      h("span", {}, h("i", { class: "i-pv" }), L.pv),
      h("span", {}, h("i", { class: "i-vis" }), L.vis),
      prev.length ? h("span", {}, h("i", { class: "i-prev" }), `${L.pv}, ${L.prevLine}`) : null),
  ];
}

function table(columns, rows) {
  if (!rows.length) return h("p", { class: "empty" }, L.none);
  return h("div", { class: "tbl" },
    h("table", {},
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.right ? "r" : null }, c.title)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, columns.map((c) => {
        const value = c.value(row);
        return h("td", { class: c.right ? "r" : c.path ? "p" : null, title: c.path ? value : null }, value);
      }))))));
}

function barList(rows, valueOf, labelOf) {
  if (!rows.length) return h("p", { class: "empty" }, L.none);
  const max = Math.max(...rows.map(valueOf), 1);
  return h("div", { class: "bars" }, rows.map((row) => {
    const fill = h("div", { class: "fill" });
    fill.style.width = `${((valueOf(row) / max) * 100).toFixed(1)}%`;
    const text = labelOf(row);
    return h("div", { class: "bar" }, h("span", { class: "lbl", title: text }, text), h("span", { class: "num" }, nf(valueOf(row))), h("div", { class: "track" }, fill));
  }));
}

function stack(rows, dimension) {
  const total = rows.reduce((sum, r) => sum + r.pageviews, 0);
  if (!total) return h("p", { class: "empty" }, L.none);
  const top = rows.slice(0, 3);
  const rest = total - top.reduce((sum, r) => sum + r.pageviews, 0);
  const parts = rest > 0 ? [...top, { value: null, pageviews: rest }] : top;
  const name = (r) => (r.value === null ? L.names.other : label(dimension, r.value));
  return [
    h("div", { class: "stack", role: "img", "aria-label": parts.map((r) => `${name(r)} ${nf((r.pageviews / total) * 100)} %`).join(", ") },
      parts.map((r, i) => {
        const el = h("div", { class: `c${i}` });
        el.style.width = `${((r.pageviews / total) * 100).toFixed(1)}%`;
        return el;
      })),
    h("div", { class: "legend" }, parts.map((r, i) => h("span", {}, h("i", { class: `c${i}` }), `${name(r)} ${nf((r.pageviews / total) * 100)} %`))),
  ];
}

// ---------- views ----------

function logo() {
  const svg = s("svg", { viewBox: "0 0 30 26", "aria-hidden": "true" });
  const points = [[3, 21], [11, 13], [18, 17], [27, 5]];
  svg.append(s("polyline", { points: points.map((p) => p.join(",")).join(" "), class: "logo-line" }));
  points.forEach(([x, y], i) => svg.append(s("circle", { cx: x, cy: y, r: 3, class: `logo-dot${i === 3 ? " last" : ""}` })));
  return svg;
}

function header(route) {
  const link = (key, hash) => h("a", { href: hash, "aria-current": route === key ? "page" : null }, L.nav[key]);
  const siteSelect = state.sites.length > 1
    ? h("select", { "aria-label": "Site", onchange: (e) => { state.site = state.sites.find((x) => x.id === e.target.value); state.config = null; state.filters = {}; save(); render(); } },
      state.sites.map((x) => h("option", { value: x.id, selected: x.id === state.site.id }, x.domain)))
    : h("strong", {}, state.site.domain);
  return h("header", { class: "top" },
    h("a", { class: "brand", href: "#/" }, logo(), "Looku"),
    siteSelect,
    h("nav", { class: "nav" }, link("dashboard", "#/"), link("report", "#/report"), link("settings", "#/settings")),
    h("span", { class: "sp" }),
    h("button", { class: "btn", type: "button", onclick: logout }, L.logout));
}

function sectionOrder() {
  const known = new Map(SECTIONS.map((x) => [x.id, x]));
  const modules = state.site.modules;
  let ids = state.config?.sections || SECTIONS.map((x) => x.id);
  // A module enabled after the order was saved shows all its sections.
  const listed = new Set(ids.map((id) => known.get(id)?.module));
  ids = [...ids, ...SECTIONS.filter((x) => !listed.has(x.module)).map((x) => x.id)];
  return ids.map((id) => known.get(id)).filter((x) => x && modules.includes(x.module));
}

async function dashboardView(container, token) {
  const q = rangeQuery();
  const fq = filterQuery();
  const summary = await api(siteUrl(`/summary?${q}&compare=${state.compare ? "previous" : ""}${fq}`));
  if (token !== renderToken) return;
  const range = summary.meta.range;
  const days = daysBetween(range.from, range.to);
  const interval = state.hourly && days <= 31 ? "hour" : days > 400 ? "month" : days > 92 ? "week" : "day";
  const previous = summary.meta.previous;

  const sections = sectionOrder();
  const dims = {
    pages: "page?limit=8", entries: "entry?limit=8", exits: "exit?limit=8", referrers: "referrer?limit=8&sort=entries",
    utm_source: "utm_source?limit=8&sort=entries", utm_campaign: "utm_campaign?limit=8&sort=entries", devices: "device?limit=10",
    browsers: "browser?limit=10", countries: "country?limit=8", page_groups: "page_group?",
  };
  const moduleUrls = {
    shop_overview: `/reports/shop/summary?${q}&compare=previous`,
    shop_funnel: `/reports/shop/funnel?${q}`,
    shop_products: `/reports/shop/products?${q}&limit=8`,
    campaigns: `/reports/campaigns/overview?${q}&limit=10`,
    content_engagement: `/reports/content/engagement?${q}&limit=8`,
    content_rising: `/reports/content/rising?${q}&limit=8`,
  };
  const requests = {
    series: api(siteUrl(`/timeseries?${q}&interval=${interval}${fq}`)),
    prevSeries: previous ? api(siteUrl(`/timeseries?from=${previous.from}&to=${previous.to}&interval=${interval}${fq}`)) : null,
    prevPages: previous && sections.some((x) => x.id === "pages") ? api(siteUrl(`/breakdown/page?from=${previous.from}&to=${previous.to}&limit=200${fq}`)) : null,
    os: sections.some((x) => x.id === "browsers") ? api(siteUrl(`/breakdown/os?${q}&limit=10${fq}`)) : null,
    campaignList: api(siteUrl(`/breakdown/utm_campaign?${q}&limit=50&sort=entries`)),
  };
  for (const section of sections) {
    if (dims[section.id]) {
      const [dim, params] = dims[section.id].split("?");
      requests[section.id] = api(siteUrl(`/breakdown/${dim}?${q}&${params}${fq}`));
    } else {
      requests[section.id] = api(siteUrl(moduleUrls[section.id]));
    }
  }
  const keys = Object.keys(requests);
  const values = await Promise.all(keys.map((k) => requests[k]));
  if (token !== renderToken) return;
  const r = Object.fromEntries(keys.map((k, i) => [k, values[i]]));

  const d = summary.data;
  const p = d.previous;
  const points = r.series.data.points;
  const kpis = [
    [L.pv, nf(d.pageviews), p && chg(d.pageviews, p.pageviews), points.map((x) => x.pageviews)],
    [L.vis, nf(d.visitors), p && chg(d.visitors, p.visitors), points.map((x) => x.visitors)],
    [L.ses, nf(d.sessions), p && chg(d.sessions, p.sessions), points.map((x) => x.sessions)],
    [L.pps, nf(d.pages_per_session, 1), p && chg(d.pages_per_session, p.pages_per_session), points.map((x) => (x.sessions ? x.pageviews / x.sessions : 0))],
  ];

  const prevPages = new Map((r.prevPages?.data.rows || []).map((row) => [row.value, row.pageviews]));
  const csv = (report) => h("a", { href: `/api/v1${siteUrl(`/export.csv?${q}&report=${report}${report.includes("/") ? "" : fq}`)}`, download: true }, L.csv);
  const rows = (id) => r[id].data.rows.filter((row) => !(id.startsWith("utm") && row.value === "") && (!["referrers", "utm_source", "utm_campaign"].includes(id) || row.entries > 0));
  const bodies = {
    pages: () => table([
      { title: L.col.page, value: (row) => row.value, path: true },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true },
      ...(previous ? [{ title: "%", value: (row) => chg(row.pageviews, prevPages.get(row.value)) || "", right: true }] : []),
    ], rows("pages")),
    entries: () => table([{ title: L.col.page, value: (row) => row.value, path: true }, { title: L.col.entries, value: (row) => nf(row.entries), right: true }], rows("entries")),
    exits: () => table([{ title: L.col.page, value: (row) => row.value, path: true }, { title: L.col.exits, value: (row) => nf(row.exits), right: true }], rows("exits")),
    referrers: () => barList(rows("referrers"), (row) => row.entries, (row) => label("referrer", row.value)),
    utm_source: () => barList(rows("utm_source"), (row) => row.entries, (row) => row.value),
    utm_campaign: () => barList(rows("utm_campaign"), (row) => row.entries, (row) => row.value),
    devices: () => stack(rows("devices"), "device"),
    browsers: () => [stack(rows("browsers"), "browser"), stack(r.os.data.rows, "os")],
    countries: () => table([{ title: L.col.value, value: (row) => label("country", row.value) }, { title: L.col.views, value: (row) => nf(row.pageviews), right: true }], rows("countries")),
    page_groups: () => (state.config?.page_groups?.length
      ? table([{ title: L.col.group, value: (row) => label("page_group", row.value) }, { title: L.col.views, value: (row) => nf(row.pageviews), right: true }, { title: L.col.entries, value: (row) => nf(row.entries), right: true }], rows("page_groups"))
      : h("p", { class: "empty" }, L.noGroups)),
  };
  const sample = (data) => h("p", { class: "note" }, L.sampleNote(nf(data.sample_size)));
  const moduleBodies = {
    shop_overview: () => {
      const x = r.shop_overview.data;
      const px = x.previous;
      const figs = [
        [L.shop.orders, nf(x.orders), chg(x.orders, px.orders)],
        [L.shop.revenue, money(x.revenue), chg(x.revenue, px.revenue)],
        [L.shop.average, money(x.average_order), chg(x.average_order, px.average_order)],
        [L.shop.conversion, `${nf(x.conversion_pct, 2)} %`, chg(x.conversion_pct, px.conversion_pct)],
      ];
      return [
        h("div", { class: "figs" }, figs.map(([k, v, c]) => h("div", {}, h("div", { class: "k" }, k), h("div", { class: "v" }, v), c))),
        h("p", { class: "note" }, L.shop.conversionNote),
      ];
    },
    shop_funnel: () => {
      const f = r.shop_funnel.data;
      return [
        barList(f.steps, (row) => row.count, (row) => `${L.shop.steps[row.id]} · ${nf(row.pct, row.pct % 1 ? 1 : 0)} %`),
        h("p", { class: "note" }, f.configured ? L.shop.funnelNote : L.shop.funnelSetup),
      ];
    },
    shop_products: () => {
      const p = r.shop_products.data;
      const cart = p.cart_sample;
      return [
        table([
          { title: L.shop.product, value: (row) => row.name || row.sku },
          { title: L.shop.quantity, value: (row) => nf(row.quantity), right: true },
          { title: L.shop.revenue, value: (row) => money(row.revenue), right: true },
        ], p.sold),
        cart.sample_size
          ? h("p", { class: "note" }, L.shop.cartSample(nf(cart.sample_size), cart.rows.slice(0, 3).map((row) => `${row.sku} (${nf(row.quantity)})`).join(", ")))
          : null,
      ];
    },
    campaigns: () => table([
      { title: L.col.campaign, value: (row) => row.value },
      { title: L.col.sessions, value: (row) => nf(row.sessions), right: true },
      { title: "%", value: (row) => (row.status === "new" || row.status === "ended" ? L.campaignStatus[row.status] : chg(row.sessions, row.previous_sessions) || ""), right: true },
      { title: L.shop.orders, value: (row) => nf(row.orders), right: true },
    ], r.campaigns.data.rows),
    content_engagement: () => [
      table([
        { title: L.col.page, value: (row) => row.value, path: true },
        { title: L.col.time, value: (row) => duration(row.median_seconds), right: true },
        { title: L.col.scroll, value: (row) => `${nf(row.avg_scroll_pct)} %`, right: true },
        { title: L.col.n, value: (row) => nf(row.n), right: true },
      ], r.content_engagement.data.rows),
      sample(r.content_engagement.data),
    ],
    content_rising: () => table([
      { title: L.col.page, value: (row) => row.value, path: true },
      { title: L.col.views, value: (row) => nf(row.pageviews), right: true },
      { title: "%", value: (row) => (row.change_pct === null ? L.campaignStatus.new : `+${nf(row.change_pct)} %`), right: true },
    ], r.content_rising.data.rows),
  };
  Object.assign(bodies, moduleBodies);

  // Filter bar. Page group "" means pages in no group, so "all" has its own value.
  const pick = (key, value) => {
    if (value === ALL) delete state.filters[key];
    else state.filters[key] = value;
    render();
  };
  const filterSelect = (key, labelText, options) => h("select", { "aria-label": labelText, onchange: (e) => pick(key, e.target.value) },
    h("option", { value: ALL }, labelText),
    options.map(([value, text]) => h("option", { value, selected: state.filters[key] === value }, text)));
  const groups = state.config?.page_groups || [];
  const campaignNames = r.campaignList.data.rows.map((row) => row.value).filter(Boolean);
  if (state.filters.utm_campaign && !campaignNames.includes(state.filters.utm_campaign)) campaignNames.push(state.filters.utm_campaign);
  const filtered = Object.keys(state.filters).length > 0;
  const filterBar = h("div", { class: "va-bar filters" },
    h("span", { class: "muted" }, L.filters.title),
    groups.length ? filterSelect("page_group", L.filters.allGroups, [...groups.map((g) => [g.name, g.name]), ["", L.names.noGroup]]) : null,
    campaignNames.length ? filterSelect("utm_campaign", L.filters.allCampaigns, campaignNames.map((name) => [name, name])) : null,
    filterSelect("device", L.filters.allDevices, ["mobile", "desktop", "tablet"].map((v) => [v, L.names[v]])),
    filtered ? h("button", { class: "btn", type: "button", onclick: () => { state.filters = {}; render(); } }, L.filters.clear) : null,
    days <= 31 ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.hourly, onchange: (e) => { state.hourly = e.target.checked; save(); render(); } }), L.hourly) : null,
    filtered ? h("span", { class: "muted" }, L.filters.note) : null);

  const csvReport = {
    shop_overview: "shop/summary", shop_funnel: "shop/funnel", shop_products: "shop/products",
    campaigns: "campaigns/overview", content_engagement: "content/engagement", content_rising: "content/rising",
    pages: "breakdown&dimension=page", entries: "breakdown&dimension=entry", exits: "breakdown&dimension=exit",
    referrers: "breakdown&dimension=referrer", utm_source: "breakdown&dimension=utm_source", utm_campaign: "breakdown&dimension=utm_campaign",
    devices: "breakdown&dimension=device", browsers: "breakdown&dimension=browser", countries: "breakdown&dimension=country", page_groups: "breakdown&dimension=page_group",
  };

  const rangeButtons = h("div", { class: "seg", role: "group" },
    [...RANGE_KEYS, "custom"].map((key) => h("button", {
      type: "button",
      "aria-pressed": String(state.range === key),
      onclick: () => {
        state.range = key;
        if (key === "custom" && !state.from) {
          state.from = range.from;
          state.to = range.to;
        }
        save();
        render();
      },
    }, L.ranges[key])));
  const fromInput = h("input", { type: "date", value: state.from || range.from, max: state.site.today, "aria-label": "from" });
  const toInput = h("input", { type: "date", value: state.to || range.to, max: state.site.today, "aria-label": "to" });
  const custom = state.range === "custom"
    ? h("form", { class: "custom", onsubmit: (e) => { e.preventDefault(); state.from = fromInput.value; state.to = toInput.value; save(); render(); } },
      fromInput, toInput, h("button", { class: "btn", type: "submit" }, L.apply))
    : null;

  container.replaceChildren(
    h("div", { class: "va" },
      h("div", { class: "va-bar" },
        h("span", { class: "muted" }, formatRange(range)),
        rangeButtons, custom,
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.compare, onchange: (e) => { state.compare = e.target.checked; save(); render(); } }), L.compare),
        h("span", { class: "sp" }),
        previous ? h("span", { class: "muted" }, L.prevPeriod(formatRange(previous))) : null,
        h("a", { class: "btn", href: `/api/v1${siteUrl(`/export.csv?${q}&report=timeseries&interval=${interval}${fq}`)}`, download: true }, L.exportSeries)),
      filterBar,
      h("div", { class: "va-kpi m-perus" }, kpis.map(([k, v, c, series]) => h("div", {}, h("div", { class: "k" }, k), h("div", { class: "v" }, v), c, spark(series)))),
      h("div", { class: "va-main" }, lineChart(points, r.prevSeries?.data.points, 130)),
      h("div", { class: "va-grid" }, sections.map((section) =>
        h("section", { class: `m-${section.module}` },
          h("div", { class: "va-h" }, h("h3", {}, L.sections[section.id]), csv(csvReport[section.id]), h("span", { class: "tag" }, L.modules[section.module])),
          bodies[section.id]())))));
}

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
  const figs = [[L.vis, d.visitors, pd.visitors], [L.pv, d.pageviews, pd.pageviews], [L.ses, d.sessions, pd.sessions], [L.pps, d.pages_per_session, pd.pages_per_session]];
  const go = (delta) => { state.month = shiftMonth(state.month, delta); render(); };
  const sectionBody = {
    visitors: () => [lineChart(series.data.points, prevSeries.data.points, 150)],
    content: () => [table([{ title: L.col.page, value: (row) => row.value, path: true }, { title: L.col.views, value: (row) => nf(row.pageviews), right: true }], pages.data.rows)],
  };

  container.replaceChildren(
    h("article", { class: "vc" },
      h("div", { class: "vc-in" },
        h("div", { class: "vc-meta" },
          h("span", {}, `${state.site.domain} · ${L.report.meta}`),
          h("span", { class: "seg" },
            h("button", { type: "button", "aria-label": L.report.prev, onclick: () => go(-1) }, "‹"),
            h("button", { type: "button", "aria-label": L.report.next, disabled: state.month >= thisMonth, onclick: () => go(1) }, "›"))),
        h("h2", {}, review.title),
        h("p", { class: "lead" }, review.lead.map((part) => (typeof part === "string" ? part : h("b", {}, part.b)))),
        d.pageviews
          ? h("div", { class: "vc-figs" }, figs.map(([k, v, pv], i) => h("div", {}, h("div", { class: "v" }, nf(v, i === 3 ? 1 : 0)), h("div", { class: "k" }, `${k} `, chg(v, pv)))))
          : null,
        review.sections.map((section) => h("section", { class: "m-perus" },
          h("h3", {}, section.title, h("span", { class: "tag" }, L.modules.perus)),
          section.sentences.length ? h("p", {}, section.sentences.join(" ")) : null,
          sectionBody[section.id]())),
        h("p", { class: "foot" }, review.foot))));
}

async function settingsView(container, token) {
  const S = L.settings;
  const admin = state.me?.scope === "admin";
  const tokens = admin ? (await api("/tokens")).data : [];
  if (token !== renderToken) return;
  const config = state.config || { language: "", page_groups: [], sections: null, shop: {} };
  const enabled = SECTIONS.filter((x) => state.site.modules.includes(x.module));

  // Your view (this browser only).
  const seg = (options, current, onPick) => h("div", { class: "seg", role: "group" },
    options.map(([key, text]) => h("button", { type: "button", "aria-pressed": String(current === key), onclick: () => { onPick(key); save(); applyTheme(); render(); } }, text)));
  const viewer = h("section", { class: "panel" },
    h("h2", {}, S.viewer),
    h("div", { class: "row" }, h("span", { class: "muted" }, S.theme), seg(Object.entries(S.themes), state.theme, (k) => { state.theme = k; })),
    h("div", { class: "row" }, h("span", { class: "muted" }, S.language), seg([["", S.languageAuto], ["fi", "Suomi"], ["en", "English"]], state.lang, (k) => { state.lang = k; })),
    h("p", { class: "note" }, S.viewerNote));

  // Site settings: language, page groups, sections.
  const status = h("p", { class: "note", role: "status" });
  const groups = config.page_groups.map((g) => ({ ...g }));
  const groupList = h("div", { class: "list" });
  const drawGroups = () => groupList.replaceChildren(...groups.map((g, i) => h("div", { class: "row" },
    h("input", { type: "text", value: g.name, placeholder: S.groupName, "aria-label": S.groupName, oninput: (e) => { g.name = e.target.value; } }),
    h("input", { type: "text", value: g.prefix, placeholder: "/oppaat/", "aria-label": S.groupPrefix, oninput: (e) => { g.prefix = e.target.value; } }),
    h("button", { class: "btn", type: "button", onclick: () => { groups.splice(i, 1); drawGroups(); } }, S.remove))));
  drawGroups();

  const order = sectionOrder().map((x) => x.id);
  const hidden = enabled.map((x) => x.id).filter((id) => !order.includes(id));
  const sectionRows = [...order.map((id) => ({ id, on: true })), ...hidden.map((id) => ({ id, on: false }))];
  const sectionList = h("div", { class: "list" });
  const drawSections = () => sectionList.replaceChildren(...sectionRows.map((row, i) => h("div", { class: "item" },
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: row.on, onchange: (e) => { row.on = e.target.checked; } }), L.sections[row.id]),
    h("span", { class: "row" },
      h("button", { class: "btn", type: "button", disabled: i === 0, "aria-label": `${S.up}: ${L.sections[row.id]}`, onclick: () => { [sectionRows[i - 1], sectionRows[i]] = [sectionRows[i], sectionRows[i - 1]]; drawSections(); } }, "↑"),
      h("button", { class: "btn", type: "button", disabled: i === sectionRows.length - 1, "aria-label": `${S.down}: ${L.sections[row.id]}`, onclick: () => { [sectionRows[i + 1], sectionRows[i]] = [sectionRows[i], sectionRows[i + 1]]; drawSections(); } }, "↓")))));
  drawSections();

  const shop = { ...(config.shop || {}) };
  const shopFields = state.site.modules.includes("shop")
    ? [h("h2", {}, S.shop), h("p", { class: "note" }, S.shopNote),
      ...[["product_prefix", "/tuotteet/"], ["cart_path", "/ostoskori"], ["checkout_path", "/kassa"]].map(([key, example]) => h("div", { class: "row" },
        h("span", { class: "muted" }, S.shopPaths[key]),
        h("input", { type: "text", value: shop[key] || "", placeholder: example, "aria-label": S.shopPaths[key], oninput: (e) => { shop[key] = e.target.value; } })))]
    : [];

  const languageSelect = h("select", { "aria-label": S.siteLanguage },
    [["", S.languageAuto], ["fi", "Suomi"], ["en", "English"]].map(([v, t]) => h("option", { value: v, selected: config.language === v }, t)));

  const saveSite = async () => {
    try {
      const body = {
        language: languageSelect.value,
        page_groups: groups.filter((g) => g.name.trim() || g.prefix.trim()),
        sections: sectionRows.filter((row) => row.on).map((row) => row.id),
        shop,
      };
      state.config = (await api(siteUrl("/config"), { method: "PUT", body })).data;
      state.filters = {};
      status.textContent = S.saved;
      status.className = "note";
    } catch (error) {
      if (error instanceof AuthError) return showLogin();
      status.textContent = error.message;
      status.className = "note error";
    }
  };

  const site = h("section", { class: "panel" },
    h("h2", {}, `${S.site}: ${state.site.domain}`),
    h("div", { class: "row" }, h("span", { class: "muted" }, S.siteLanguage), languageSelect),
    h("h2", {}, S.groups), h("p", { class: "note" }, S.groupsNote), groupList,
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { groups.push({ name: "", prefix: "/" }); drawGroups(); } }, S.add)),
    shopFields,
    h("h2", {}, S.sections), h("p", { class: "note" }, S.sectionsNote), sectionList,
    admin ? h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: saveSite }, S.save), status) : null);

  // API keys.
  const newToken = h("div");
  const nameInput = h("input", { type: "text", placeholder: S.tokenName, "aria-label": S.tokenName, maxlength: 100 });
  const scopeSelect = h("select", { "aria-label": "scope" }, h("option", { value: "read" }, S.scopeRead), h("option", { value: "admin" }, S.scopeAdmin));
  const siteChoice = h("select", { "aria-label": "site" }, h("option", { value: "" }, S.allSites), state.sites.map((x) => h("option", { value: x.id }, x.domain)));
  const tokenStatus = h("p", { class: "note", role: "status" });
  const keys = admin ? h("section", { class: "panel" },
    h("h2", {}, S.tokens), h("p", { class: "note" }, S.tokensNote, " ", h("a", { href: "/api/v1/openapi.json" }, S.apiDoc)),
    h("div", { class: "list" }, tokens.map((t) => h("div", { class: "item" },
      h("span", {}, h("strong", {}, t.name), " ", h("span", { class: "muted" }, `${t.scope === "admin" ? S.scopeAdmin : S.scopeRead} · ${t.site_id || S.allSites} · ${t.last_used_day ? `${S.lastUsed} ${formatFullDay(t.last_used_day)}` : S.never}`)),
      h("button", { class: "btn", type: "button", onclick: async () => {
        try {
          await api(`/tokens/${t.id}`, { method: "DELETE" });
          render();
        } catch (error) {
          if (error instanceof AuthError) return showLogin();
          tokenStatus.textContent = error.message;
          tokenStatus.className = "note error";
        }
      } }, S.revoke)))),
    h("form", { class: "row", onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { data } = await api("/tokens", { method: "POST", body: { name: nameInput.value, scope: scopeSelect.value, site: siteChoice.value || undefined } });
        await render();
        // Shown after the redraw, once.
        const box = document.getElementById("new-token");
        if (box) box.replaceChildren(h("p", { class: "note" }, S.newToken), h("div", { class: "token" }, data.token));
      } catch (error) {
        if (error instanceof AuthError) return showLogin();
        tokenStatus.textContent = error.message;
        tokenStatus.className = "note error";
      }
    } }, nameInput, scopeSelect, siteChoice, h("button", { class: "btn", type: "submit" }, S.create)),
    tokenStatus, h("div", { id: "new-token" }, newToken)) : null;

  container.replaceChildren(h("div", { class: "settings" }, viewer, site, keys));
}

// ---------- login and routing ----------

function showLogin(message = "") {
  renderToken += 1;
  const input = h("input", { type: "password", autocomplete: "current-password", required: true, "aria-label": L.password, placeholder: L.password });
  const status = h("p", { class: "note error", role: "alert" }, message);
  const app = document.getElementById("app");
  app.replaceChildren(h("div", { class: "panel login" },
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

function chooseLanguage() {
  const preferred = state.lang || state.config?.language || (navigator.language || "fi").slice(0, 2);
  L = T[preferred] || T.en;
  document.documentElement.lang = L === T.fi ? "fi" : "en";
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash === "report" ? "report" : hash === "settings" ? "settings" : "dashboard";
}

async function render() {
  const token = ++renderToken;
  const route = currentRoute();
  try {
    if (!state.config) {
      const config = (await api(siteUrl("/config"))).data;
      if (token !== renderToken) return;
      state.config = config;
    }
    chooseLanguage();
    const app = document.getElementById("app");
    const main = h("main", {}, h("p", { class: "muted loading" }, "…"));
    app.replaceChildren(header(route), main);
    const view = { dashboard: dashboardView, report: reportView, settings: settingsView }[route];
    await view(main, token);
  } catch (error) {
    if (error instanceof AuthError) return showLogin();
    if (token !== renderToken) return;
    document.querySelector("main")?.replaceChildren(h("p", { class: "error" }, `${L.loadError} ${error.message}`));
  }
}

async function start() {
  try {
    state.me = await api("/me");
    state.sites = (await api("/sites")).data;
  } catch (error) {
    chooseLanguage();
    if (error instanceof AuthError) return showLogin();
    document.getElementById("app").replaceChildren(h("p", { class: "error" }, `${L.loadError} ${error.message}`));
    return;
  }
  if (!state.sites.length) {
    chooseLanguage();
    document.getElementById("app").replaceChildren(h("p", {}, L.noSites));
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
window.addEventListener("hashchange", () => render());
start();
