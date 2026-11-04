// The read API of the online demo, in the browser. It runs Looku's own report
// code (copied to ./engine at build time) on a SQLite database with invented
// data, loaded with sql.js. Changes, such as settings, stay in this tab and are
// gone after a reload.
import { describeModules, MODULES } from "./engine/modules/index.js";
import { ReportError } from "./engine/modules/errors.js";
import { hideVisitorCounts } from "./engine/modules/visitors.js";
import { parseConfig, resolveRange, toCsv, validateConfig } from "./engine/api/params.js";
import { openApiDocument } from "./engine/api/openapi.js";
import { dayKey } from "./engine/time.js";

// The part of better-sqlite3 that the reports use: prepare(sql).all/get/run
// with positional parameters.
class Statement {
  constructor(raw, sql) {
    this.raw = raw;
    this.sql = sql;
  }
  all(...params) {
    const statement = this.raw.prepare(this.sql);
    try {
      statement.bind(params.map((value) => (value === undefined ? null : value)));
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  get(...params) {
    return this.all(...params)[0];
  }
  run(...params) {
    this.raw.run(this.sql, params.map((value) => (value === undefined ? null : value)));
    return { changes: this.raw.getRowsModified() };
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function createDemoApi({ initSqlJs, base, fetch }) {
  const SQL = await initSqlJs({ locateFile: (file) => base + file });
  const [bytes, info] = await Promise.all([
    fetch(base + "demo.db").then((r) => r.arrayBuffer()),
    fetch(base + "demo.json").then((r) => r.json()),
  ]);
  const raw = new SQL.Database(new Uint8Array(bytes));
  const db = { prepare: (sql) => new Statement(raw, sql) };
  // The demo's clock stops when the data was made, so "the last 24 hours" always has data.
  const now = () => new Date(info.now);
  const siteRow = (id) => db.prepare("SELECT * FROM sites WHERE site_id = ?").get(id);

  function runReport(site, moduleId, reportId, query) {
    const enabled = JSON.parse(site.modules_json || "[]");
    const module = Object.hasOwn(MODULES, moduleId) ? MODULES[moduleId] : null;
    const report = enabled.includes(moduleId) && module && Object.hasOwn(module.reports, reportId) ? module.reports[reportId] : null;
    if (!report) throw new HttpError(404, "Unknown report.");
    const range = resolveRange(query, site.timezone, now());
    let data = report.run(db, site, range, query, parseConfig(site.config_json));
    if (site.visitors === "off") data = hideVisitorCounts(data);
    const extra = data.previous ? { previous: data.previous.range } : {};
    const meta = { site: site.site_id, timezone: site.timezone, range: data.range || range, sample: false, generated_at: now().toISOString(), ...extra };
    return { meta, data };
  }

  const ALIASES = { summary: ["perus", "summary"], timeseries: ["perus", "timeseries"] };

  function route(method, path, query, body) {
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (path === "/health") return { status: "ok", version: "demo" };
    if (path === "/openapi.json") return openApiDocument("1.0.0");
    if (path === "/login" || path === "/logout") return { ok: true };
    if (method !== "GET" && !["/login", "/logout"].includes(path) && parts[0] !== "tokens" && !(parts[2] === "config" && method === "PUT")) {
      throw new HttpError(404, "Not found.");
    }
    if (path === "/me") return { scope: "admin", site: null, login: true };
    if (path === "/modules") return { data: describeModules() };
    if (path === "/sites") {
      return {
        data: db.prepare("SELECT * FROM sites ORDER BY site_id").all().map((site) => ({
          id: site.site_id, name: site.name, domain: site.domain, timezone: site.timezone,
          today: dayKey(now(), site.timezone), modules: JSON.parse(site.modules_json || "[]"), visitors: site.visitors,
        })),
      };
    }
    if (parts[0] === "tokens") {
      if (method === "GET") return { data: [] };
      throw new HttpError(400, "API keys are not available in the demo.");
    }
    if (parts[0] === "sites" && parts.length >= 3) {
      const site = siteRow(parts[1]);
      if (!site) throw new HttpError(404, "Unknown site.");
      const rest = parts.slice(2);
      if (rest[0] === "config" && rest.length === 1) {
        if (method === "PUT") {
          const config = validateConfig(body || {});
          db.prepare("UPDATE sites SET config_json = ? WHERE site_id = ?").run(JSON.stringify(config), site.site_id);
          return { data: config };
        }
        return { data: parseConfig(site.config_json) };
      }
      if (Object.hasOwn(ALIASES, rest[0]) && rest.length === 1) return runReport(site, ...ALIASES[rest[0]], query);
      if (rest[0] === "breakdown" && rest.length === 2) return runReport(site, "perus", "breakdown", { ...query, dimension: rest[1] });
      if (rest[0] === "reports" && rest.length === 3) return runReport(site, rest[1], rest[2], query);
      if (rest[0] === "export.csv" && rest.length === 1) {
        const [moduleId, reportId] = String(query.report || "").includes("/") ? String(query.report).split("/") : ["perus", query.report];
        const { data } = runReport(site, moduleId, reportId, query);
        const rows = data.rows || data.points || data.steps || data.sold || [data];
        const columns = rows.length ? Object.keys(rows[0]).filter((key) => typeof rows[0][key] !== "object" || rows[0][key] === null) : ["value"];
        return { csv: toCsv(columns, rows), filename: `${site.site_id}-${reportId}.csv` };
      }
    }
    throw new HttpError(404, "Not found.");
  }

  // Answers one request: { status, body } with body as an object, or a CSV file.
  return function handle(method, url, body) {
    const target = new URL(url, location.href);
    const path = target.pathname.slice(target.pathname.indexOf("/api/v1") + "/api/v1".length) || "/";
    const query = Object.fromEntries(target.searchParams);
    try {
      return { status: 200, body: route(method, path, query, body) };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof ReportError || error instanceof URIError ? 400 : 500;
      return { status, body: { error: error.message } };
    }
  };
}
