import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { describeModules, MODULES } from "../modules/index.js";
import { hideVisitorCounts } from "../modules/visitors.js";
import { ReportError } from "../modules/perus/reports.js";
import { dayKey } from "../time.js";
import {
  checkPassword,
  createLoginLimiter,
  createSessionStore,
  createToken,
  findToken,
  hasPassword,
  listTokens,
  revokeToken,
} from "./auth.js";
import { openApiDocument } from "./openapi.js";
import { parseConfig, resolveRange, toCsv, validateConfig } from "./params.js";

export const API_VERSION = "0.9.1";
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = "looku_session";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
      reject(new HttpError(415, "Content-Type must be application/json."));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "The request body is too large."));
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new SyntaxError("not an object");
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, "The request body must be a JSON object."));
      }
    });
    req.on("error", reject);
  });
}

// Static files of the dashboard, listed once at start. Only these exact
// paths are served, so no request can reach outside the folder.
function loadStaticFiles(uiDir) {
  const files = new Map();
  if (!uiDir || !fs.existsSync(uiDir)) {
    return files;
  }
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`);
      } else if (CONTENT_TYPES[path.extname(entry.name)]) {
        files.set(`/${prefix}${entry.name}`, full);
      }
    }
  };
  walk(uiDir, "");
  if (files.has("/index.html")) {
    files.set("/", files.get("/index.html"));
  }
  return files;
}

// The LAN-only read API and the dashboard. `db` may be a read-only
// connection; `writeDb` is used only for settings, keys and key usage dates.
export function createApiServer(
  db,
  {
    writeDb = db,
    uiDir = null,
    allowedOrigins = [],
    secureCookie = false,
    publicOrigin = null,
    allowedHosts = [],
    allowedClients = [],
    trustProxy = 0,
    now = () => new Date(),
    sessions = createSessionStore(),
    loginLimiter = createLoginLimiter(),
  } = {},
) {
  const staticFiles = loadStaticFiles(uiDir);
  const origins = new Set(allowedOrigins);
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (publicOrigin) {
    hosts.add(new URL(publicOrigin).host.toLowerCase());
  }
  // Optional client allowlist (IP addresses or CIDR ranges), e.g. a public
  // server whose dashboard only the owner's networks may open.
  const clients = allowedClients.length ? new net.BlockList() : null;
  for (const entry of allowedClients) {
    const [address, prefix, extra] = entry.split("/");
    const type = net.isIPv6(address) ? "ipv6" : "ipv4";
    const bits = Number(prefix);
    // A typo must not open the list: "10.0.0.0/" or "/0" is refused.
    if (
      !net.isIP(address) ||
      extra !== undefined ||
      (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || bits < 1 || bits > (type === "ipv6" ? 128 : 32)))
    ) {
      throw new Error(`Not an IP address or range: ${entry}`);
    }
    if (prefix === undefined) clients.addAddress(address, type);
    else clients.addSubnet(address, bits, type);
  }
  // Over HTTPS the __Host- prefix binds the cookie to this exact origin.
  const cookieName = secureCookie ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;

  const getSite = db.prepare("SELECT * FROM sites WHERE site_id = ?");
  const allSites = db.prepare("SELECT site_id, name, domain, timezone, modules_json, visitors, config_json FROM sites ORDER BY site_id");
  const lastIngest = db.prepare("SELECT MAX(ts) AS ts FROM pageviews");
  // The newest page view of a site: the newest day through the index, then its rows.
  const lastPageview = db.prepare(
    `SELECT MAX(ts) AS ts FROM pageviews
     WHERE site_id = ? AND day = (SELECT MAX(day) FROM pageviews WHERE site_id = ?)`,
  );
  const touchToken = writeDb.prepare(
    "UPDATE api_tokens SET last_used_day = ? WHERE id = ? AND (last_used_day IS NULL OR last_used_day <> ?)",
  );
  // Key usage dates are written at most once a day per key and never fail a
  // request: a busy database only delays the date to the next use.
  const touched = new Map();
  function noteTokenUse(id) {
    const today = now().toISOString().slice(0, 10);
    if (touched.get(id) === today) {
      return;
    }
    try {
      touchToken.run(today, id, today);
      touched.set(id, today);
    } catch {
      // Retried on the next request.
    }
  }
  const saveConfig = writeDb.prepare("UPDATE sites SET config_json = ? WHERE site_id = ?");

  function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  function authenticate(req) {
    const header = String(req.headers.authorization || "");
    if (header) {
      const match = /^Bearer (\S+)$/.exec(header);
      const token = match && findToken(db, match[1]);
      if (!token) {
        throw new HttpError(401, "Invalid API key.");
      }
      noteTokenUse(token.id);
      return { scope: token.scope, siteId: token.site_id, viaCookie: false };
    }
    if (sessions.valid(parseCookies(req.headers.cookie)[cookieName])) {
      return { scope: "admin", siteId: null, viaCookie: true };
    }
    throw new HttpError(401, "Log in or send an API key.");
  }

  // Changes made with the login cookie must come from the dashboard itself:
  // the browser's Origin must be this server (or the configured public origin).
  function isSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) {
      return req.headers["sec-fetch-site"] === "same-origin";
    }
    if (publicOrigin) {
      return origin === publicOrigin;
    }
    return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  }

  function checkSameOrigin(req, auth) {
    if (auth.viaCookie && !isSameOrigin(req)) {
      throw new HttpError(403, "Cross-site request refused.");
    }
  }

  // The client address. With trustProxy = N (the number of reverse proxies
  // in front of Looku, LOOKU_TRUST_PROXY) it is the Nth X-Forwarded-For entry
  // from the right: each proxy appends the address it saw, and entries
  // further left come from the client and can be forged. Without it the
  // header is ignored.
  function clientIp(req) {
    let ip = req.socket.remoteAddress || "";
    if (trustProxy > 0) {
      const entries = String(req.headers["x-forwarded-for"] || "").split(",").map((e) => e.trim()).filter(Boolean);
      ip = entries.length >= trustProxy ? entries[entries.length - trustProxy] : "";
    }
    return ip.replace(/^::ffff:(?=\d+\.)/, "");
  }

  // Login limits per client; an IPv6 client is limited per /64 network,
  // because one host can use any address in it.
  function clientKey(req) {
    const ip = clientIp(req);
    return net.isIPv6(ip) ? ip.split(":").slice(0, 4).join(":") : ip;
  }

  function clientAllowed(req) {
    if (!clients) return true;
    const ip = clientIp(req);
    return net.isIP(ip) ? clients.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4") : false;
  }

  function requireAdmin(auth) {
    if (auth.scope !== "admin") {
      throw new HttpError(403, "This needs an admin key.");
    }
  }

  function siteFor(auth, siteId) {
    const site = getSite.get(siteId);
    if (!site || (auth.siteId && auth.siteId !== siteId)) {
      throw new HttpError(404, "Unknown site.");
    }
    return site;
  }

  function meta(site, range, extra = {}) {
    return {
      site: site.site_id,
      timezone: site.timezone,
      range,
      // Server-side counts cover all visits; reports from the consented
      // sample (later modules) set sample: true and n.
      sample: false,
      generated_at: now().toISOString(),
      ...extra,
    };
  }

  function runReport(site, moduleId, reportId, query) {
    const enabled = JSON.parse(site.modules_json || "[]");
    const module = Object.hasOwn(MODULES, moduleId) ? MODULES[moduleId] : null;
    const report =
      enabled.includes(moduleId) && module && Object.hasOwn(module.reports, reportId)
        ? module.reports[reportId]
        : null;
    if (!report) {
      throw new HttpError(404, "Unknown report.");
    }
    const range = resolveRange(query, site.timezone, now());
    let data = report.run(db, site, range, query, parseConfig(site.config_json));
    if (site.visitors === "off") {
      data = hideVisitorCounts(data);
    }
    const extra = data.previous ? { previous: data.previous.range } : {};
    return { meta: meta(site, data.range || range, extra), data };
  }

  const REPORT_ALIASES = {
    summary: ["perus", "summary"],
    timeseries: ["perus", "timeseries"],
  };

  async function handleApi(req, res, route, query) {
    const method = req.method;
    const parts = route.split("/").filter(Boolean).map(decodeURIComponent);

    if (route === "/health" && method === "GET") {
      // Open for health checks; the time of the last page view only with a
      // key or login, so the endpoint does not reveal when people visit.
      let known = false;
      try {
        known = Boolean(authenticate(req));
      } catch {
        known = false;
      }
      sendJson(res, 200, { status: "ok", version: API_VERSION, ...(known ? { last_ingest: lastIngest.get().ts } : {}) });
      return;
    }
    if (route === "/openapi.json" && method === "GET") {
      sendJson(res, 200, openApiDocument(API_VERSION));
      return;
    }

    if (route === "/login" && method === "POST") {
      const key = clientKey(req);
      if (loginLimiter.blocked(key)) {
        throw new HttpError(429, "Too many failed logins. Try again later.");
      }
      const body = await readJson(req);
      if (!hasPassword(db)) {
        throw new HttpError(409, "No password set. Run: looku admin:password");
      }
      if (!checkPassword(db, body.password)) {
        loginLimiter.fail(key);
        throw new HttpError(401, "Wrong password.");
      }
      loginLimiter.reset(key);
      const id = sessions.create();
      const maxAge = Math.floor(sessions.ttlMs / 1000);
      sendJson(res, 200, { ok: true }, {
        "Set-Cookie": `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`,
      });
      return;
    }
    if (route === "/logout" && method === "POST") {
      if (!isSameOrigin(req)) {
        throw new HttpError(403, "Cross-site request refused.");
      }
      sessions.destroy(parseCookies(req.headers.cookie)[cookieName]);
      sendJson(res, 200, { ok: true }, {
        "Set-Cookie": `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? "; Secure" : ""}`,
      });
      return;
    }

    const auth = authenticate(req);
    if (method !== "GET") {
      checkSameOrigin(req, auth);
    }

    if (route === "/me" && method === "GET") {
      sendJson(res, 200, { scope: auth.scope, site: auth.siteId, login: auth.viaCookie });
      return;
    }
    if (route === "/modules" && method === "GET") {
      sendJson(res, 200, { data: describeModules() });
      return;
    }
    if (route === "/sites" && method === "GET") {
      const sites = allSites
        .all()
        .filter((site) => !auth.siteId || site.site_id === auth.siteId)
        .map((site) => ({
          id: site.site_id,
          name: site.name,
          domain: site.domain,
          timezone: site.timezone,
          today: dayKey(now(), site.timezone),
          modules: JSON.parse(site.modules_json || "[]"),
          visitors: site.visitors,
          opt_out_url: parseConfig(site.config_json).opt_out_url || null,
          // Lets the dashboard tell whether the site's connector is sending.
          last_pageview: lastPageview.get(site.site_id, site.site_id).ts,
        }));
      sendJson(res, 200, { data: sites });
      return;
    }

    if (parts[0] === "tokens") {
      requireAdmin(auth);
      // A key limited to one site must not be able to make keys for others.
      if (auth.siteId) {
        throw new HttpError(403, "Keys are managed with the login or an unrestricted admin key.");
      }
      if (parts.length === 1 && method === "GET") {
        sendJson(res, 200, { data: listTokens(writeDb) });
        return;
      }
      if (parts.length === 1 && method === "POST") {
        const body = await readJson(req);
        let created;
        try {
          created = createToken(writeDb, { name: body.name, scope: body.scope, siteId: body.site || null });
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        sendJson(res, 201, { data: created });
        return;
      }
      if (parts.length === 2 && method === "DELETE") {
        if (!revokeToken(writeDb, parts[1])) {
          throw new HttpError(404, "Unknown key.");
        }
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    if (parts[0] === "sites" && parts.length >= 3) {
      const site = siteFor(auth, parts[1]);
      const rest = parts.slice(2);

      if (rest[0] === "config" && rest.length === 1) {
        if (method === "GET") {
          sendJson(res, 200, { data: parseConfig(site.config_json) });
          return;
        }
        if (method === "PUT") {
          requireAdmin(auth);
          const config = validateConfig(await readJson(req));
          saveConfig.run(JSON.stringify(config), site.site_id);
          sendJson(res, 200, { data: config });
          return;
        }
      }

      if (method === "GET") {
        if (Object.hasOwn(REPORT_ALIASES, rest[0]) && rest.length === 1) {
          const [moduleId, reportId] = REPORT_ALIASES[rest[0]];
          sendJson(res, 200, runReport(site, moduleId, reportId, query));
          return;
        }
        if (rest[0] === "breakdown" && rest.length === 2) {
          sendJson(res, 200, runReport(site, "perus", "breakdown", { ...query, dimension: rest[1] }));
          return;
        }
        if (rest[0] === "reports" && rest.length === 3) {
          sendJson(res, 200, runReport(site, rest[1], rest[2], query));
          return;
        }
        if (rest[0] === "export.csv" && rest.length === 1) {
          const [moduleId, reportId] = String(query.report || "").includes("/")
            ? String(query.report).split("/")
            : ["perus", query.report];
          const { data } = runReport(site, moduleId, reportId, query);
          const rows = data.rows || data.points || data.steps || data.sold || [data];
          const columns = rows.length
            ? Object.keys(rows[0]).filter((key) => typeof rows[0][key] !== "object" || rows[0][key] === null)
            : ["value"];
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${site.site_id}-${reportId}.csv"`,
            "Cache-Control": "no-store",
          });
          res.end(toCsv(columns, rows));
          return;
        }
      }
    }

    throw new HttpError(404, "Not found.");
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }

  async function handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    if (secureCookie) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    const isHealth = req.method === "GET" && String(req.url || "").split("?")[0] === "/api/v1/health";
    if (!isHealth && !clientAllowed(req)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    // DNS rebinding: with a host list set, other Host headers are refused.
    // The health check stays open for container health checks.
    if (
      hosts.size &&
      !hosts.has(String(req.headers.host || "").toLowerCase()) &&
      !isHealth
    ) {
      res.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Unknown host");
      return;
    }
    const target = String(req.url || "");
    const queryIndex = target.indexOf("?");
    const pathname = queryIndex === -1 ? target : target.slice(0, queryIndex);
    const query = Object.fromEntries(new URLSearchParams(queryIndex === -1 ? "" : target.slice(queryIndex + 1)));

    if (pathname.startsWith("/api/v1/") || pathname === "/api/v1") {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      try {
        await handleApi(req, res, pathname.slice("/api/v1".length) || "/", query);
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message });
        } else if (error instanceof ReportError || error instanceof URIError) {
          sendJson(res, 400, { error: error.message });
        } else {
          throw error;
        }
      }
      return;
    }

    const file = staticFiles.get(pathname);
    if (file && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(file)],
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(`api request failed: ${error?.name || "Error"}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal error." });
      } else {
        res.end();
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
