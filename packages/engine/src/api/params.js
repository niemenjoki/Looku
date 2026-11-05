import { decodePath } from "../classify.js";
import { ReportError } from "../modules/perus/reports.js";
import { addDays, dayKey, subtractMonths } from "../time.js";

const RANGES = {
  "7d": (to) => addDays(to, -6),
  "28d": (to) => addDays(to, -27),
  "3m": (to) => addDays(subtractMonths(to, 3), 1),
  "12m": (to) => addDays(subtractMonths(to, 12), 1),
};

const HOUR_MS = 3600000;
const MAX_WINDOW_MS = 31 * 24 * HOUR_MS;

// A time window: page views after `since` up to and including `until` (UTC
// ISO times). `from` and `to` are the local days it touches; reports that
// keep only days (reading time, cart events) use those days.
export function timeWindow(since, until, timezone) {
  const start = new Date(since);
  const end = new Date(until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new ReportError("since and until must be times (ISO 8601), since < until.");
  }
  if (end - start > MAX_WINDOW_MS) {
    throw new ReportError("since and until can be at most 31 days apart.");
  }
  return {
    from: dayKey(start, timezone),
    to: dayKey(end, timezone),
    since: start.toISOString(),
    until: end.toISOString(),
  };
}

// from/to (days), since/until (a time window), or a range ending now: 24h
// is the last 24 hours, the others end today in the site's time zone.
export function resolveRange(query, timezone, now = new Date()) {
  if (query.since || query.until) {
    return timeWindow(query.since, query.until, timezone);
  }
  if (query.from || query.to) {
    return { from: String(query.from || ""), to: String(query.to || "") };
  }
  const name = query.range || "28d";
  if (name === "24h") {
    return timeWindow(new Date(now.getTime() - 24 * HOUR_MS), now, timezone);
  }
  if (!RANGES[name]) {
    throw new ReportError(`range must be one of 24h, ${Object.keys(RANGES).join(", ")}.`);
  }
  const to = dayKey(now, timezone);
  return { from: RANGES[name](to), to };
}

// Site settings for dashboards. Unknown keys are dropped.
export function parseConfig(json) {
  let value = {};
  try {
    value = JSON.parse(json || "{}");
  } catch {
    value = {};
  }
  return {
    language: ["fi", "en"].includes(value.language) ? value.language : "",
    page_groups: Array.isArray(value.page_groups) ? value.page_groups : [],
    sections: Array.isArray(value.sections) ? value.sections : null,
    shop: value.shop && typeof value.shop === "object" ? value.shop : {},
    opt_out_url: typeof value.opt_out_url === "string" ? value.opt_out_url : "",
    hidden_sections: Array.isArray(value.hidden_sections) ? value.hidden_sections : null,
    kpis: Array.isArray(value.kpis) ? value.kpis : null,
    cards: value.cards && typeof value.cards === "object" && !Array.isArray(value.cards) ? value.cards : {},
    currency: typeof value.currency === "string" ? value.currency : "",
    preset: typeof value.preset === "string" ? value.preset : "",
  };
}

// Figures the dashboard can show in its top row.
export const KPI_IDS = ["pageviews", "visitors", "sessions", "pages_per_session", "orders", "revenue", "conversion"];
// Starting layouts offered on the first visit; "default" shows every section.
export const PRESETS = ["default", "simple", "blog", "shop"];
const CARD_VIEWS = ["table", "bars"];
const CARD_SORTS = ["pageviews", "visitors", "entries"];

const SHOP_PATHS = ["product_prefix", "cart_path", "checkout_path"];

const SECTION_PATTERN = /^[a-z0-9_.-]{1,40}$/;

export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ReportError("The settings must be a JSON object.");
  }
  const config = {
    language: "",
    page_groups: [],
    sections: null,
    shop: {},
    opt_out_url: "",
    hidden_sections: null,
    kpis: null,
    cards: {},
    currency: "",
    preset: "",
  };
  const sectionList = (value, name) => {
    if (
      !Array.isArray(value) ||
      value.length > 50 ||
      !value.every((id) => typeof id === "string" && SECTION_PATTERN.test(id))
    ) {
      throw new ReportError(`${name} must be a list of section ids.`);
    }
    return [...new Set(value)];
  };

  if (input.language !== undefined && input.language !== "") {
    if (!["fi", "en"].includes(input.language)) {
      throw new ReportError("language must be fi, en or empty.");
    }
    config.language = input.language;
  }

  if (input.page_groups !== undefined) {
    if (!Array.isArray(input.page_groups) || input.page_groups.length > 50) {
      throw new ReportError("page_groups must be a list of at most 50 groups.");
    }
    config.page_groups = input.page_groups.map((group) => {
      const name = String(group?.name ?? "").trim();
      const prefix = decodePath(String(group?.prefix ?? "").trim());
      if (!name || name.length > 60 || !prefix.startsWith("/") || prefix.length > 200) {
        throw new ReportError("Each page group needs a name and a prefix that starts with /.");
      }
      return { name, prefix };
    });
  }

  if (input.sections !== undefined && input.sections !== null) {
    config.sections = sectionList(input.sections, "sections");
  }
  // Sections hidden on purpose, so that sections added later (a new module or
  // a new version) can be told apart and shown.
  if (input.hidden_sections !== undefined && input.hidden_sections !== null) {
    config.hidden_sections = sectionList(input.hidden_sections, "hidden_sections");
  }

  if (input.kpis !== undefined && input.kpis !== null) {
    if (!Array.isArray(input.kpis) || input.kpis.length > KPI_IDS.length || !input.kpis.every((id) => KPI_IDS.includes(id))) {
      throw new ReportError(`kpis must be a list of: ${KPI_IDS.join(", ")}.`);
    }
    config.kpis = [...new Set(input.kpis)];
  }

  // Per-card options: rows (3-50), wide (true = two columns), view and sort.
  if (input.cards !== undefined && input.cards !== null) {
    if (typeof input.cards !== "object" || Array.isArray(input.cards) || Object.keys(input.cards).length > 50) {
      throw new ReportError("cards must be an object keyed by section id.");
    }
    for (const [id, options] of Object.entries(input.cards)) {
      if (!SECTION_PATTERN.test(id) || !options || typeof options !== "object" || Array.isArray(options)) {
        throw new ReportError("cards must be an object keyed by section id.");
      }
      const card = {};
      if (options.rows !== undefined && options.rows !== null) {
        const rows = Number(options.rows);
        if (!Number.isInteger(rows) || rows < 3 || rows > 50) {
          throw new ReportError("cards.*.rows must be a whole number from 3 to 50.");
        }
        card.rows = rows;
      }
      if (typeof options.wide === "boolean") {
        card.wide = options.wide;
      }
      if (options.view) {
        if (!CARD_VIEWS.includes(options.view)) throw new ReportError(`cards.*.view must be ${CARD_VIEWS.join(" or ")}.`);
        card.view = options.view;
      }
      if (options.sort) {
        if (!CARD_SORTS.includes(options.sort)) throw new ReportError(`cards.*.sort must be one of ${CARD_SORTS.join(", ")}.`);
        card.sort = options.sort;
      }
      if (Object.keys(card).length) {
        config.cards[id] = card;
      }
    }
  }

  if (input.currency !== undefined && input.currency !== null && input.currency !== "") {
    if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
      throw new ReportError("currency must be a three-letter code such as EUR, or empty.");
    }
    config.currency = input.currency;
  }

  if (input.preset !== undefined && input.preset !== null && input.preset !== "") {
    if (!PRESETS.includes(input.preset)) {
      throw new ReportError(`preset must be one of ${PRESETS.join(", ")}, or empty.`);
    }
    config.preset = input.preset;
  }

  // Shop funnel paths, e.g. product_prefix "/tuotteet/", cart_path "/ostoskori".
  if (input.shop !== undefined && input.shop !== null) {
    if (typeof input.shop !== "object" || Array.isArray(input.shop)) {
      throw new ReportError("shop must be an object.");
    }
    for (const key of SHOP_PATHS) {
      const value = decodePath(String(input.shop[key] ?? "").trim());
      if (value && (!value.startsWith("/") || value.length > 200)) {
        throw new ReportError(`shop.${key} must start with / (max 200 characters).`);
      }
      if (value) {
        config.shop[key] = value;
      }
    }
  }
  // The site's own page that sets its opt-out cookie, linked from the dashboard so the
  // owner can leave out a phone or another browser with one tap.
  if (input.opt_out_url !== undefined && input.opt_out_url !== null && String(input.opt_out_url).trim() !== "") {
    const value = String(input.opt_out_url).trim();
    let url = null;
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
    if (!url || !["https:", "http:"].includes(url.protocol) || value.length > 500) {
      throw new ReportError("opt_out_url must be a full http or https address (max 500 characters).");
    }
    config.opt_out_url = url.href;
  }
  return config;
}

// CSV with a header row. Values that a spreadsheet would read as a formula
// are prefixed with an apostrophe, because UTM values come from visitors.
export function toCsv(columns, rows) {
  const cell = (value) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((line) => line.map(cell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
