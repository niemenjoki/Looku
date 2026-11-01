import { ReportError } from "../modules/perus/reports.js";
import { addDays, dayKey, subtractMonths } from "../time.js";

const RANGES = {
  "7d": (to) => addDays(to, -6),
  "28d": (to) => addDays(to, -27),
  "3m": (to) => addDays(subtractMonths(to, 3), 1),
  "12m": (to) => addDays(subtractMonths(to, 12), 1),
};

// from/to (days) or a range ending today in the site's time zone.
export function resolveRange(query, timezone, now = new Date()) {
  if (query.from || query.to) {
    return { from: String(query.from || ""), to: String(query.to || "") };
  }
  const name = query.range || "28d";
  if (!RANGES[name]) {
    throw new ReportError(`range must be one of ${Object.keys(RANGES).join(", ")}.`);
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
  };
}

const SECTION_PATTERN = /^[a-z0-9_.-]{1,40}$/;

export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ReportError("The settings must be a JSON object.");
  }
  const config = { language: "", page_groups: [], sections: null };

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
      const prefix = String(group?.prefix ?? "").trim();
      if (!name || name.length > 60 || !prefix.startsWith("/") || prefix.length > 200) {
        throw new ReportError("Each page group needs a name and a prefix that starts with /.");
      }
      return { name, prefix };
    });
  }

  if (input.sections !== undefined && input.sections !== null) {
    if (
      !Array.isArray(input.sections) ||
      input.sections.length > 50 ||
      !input.sections.every((id) => typeof id === "string" && SECTION_PATTERN.test(id))
    ) {
      throw new ReportError("sections must be a list of section ids.");
    }
    config.sections = [...new Set(input.sections)];
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
