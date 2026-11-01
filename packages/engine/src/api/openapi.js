import { BREAKDOWN_DIMENSIONS } from "../modules/perus/reports.js";

const rangeParams = [
  { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "First day (YYYY-MM-DD), with to." },
  { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "Last day (YYYY-MM-DD), with from." },
  { name: "range", in: "query", schema: { type: "string", enum: ["7d", "28d", "3m", "12m"], default: "28d" }, description: "Period ending today in the site's time zone. Ignored when from/to are given." },
];
const siteParam = { name: "site", in: "path", required: true, schema: { type: "string" } };

const errorResponses = {
  400: { description: "Bad parameters", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  401: { description: "Not logged in or invalid key" },
  404: { description: "Unknown site or report" },
};

function report(summary, extraParams = []) {
  return {
    get: {
      summary,
      parameters: [siteParam, ...rangeParams, ...extraParams],
      responses: { 200: { description: "Report", content: { "application/json": { schema: { $ref: "#/components/schemas/Report" } } } }, ...errorResponses },
    },
  };
}

// The read API description. The dashboard is one client of this API; any
// other client can be built against it.

const filterParams = [
  { name: "page_group", in: "query", schema: { type: "string" }, description: "Page group name from the site settings; empty = pages in no group." },
  { name: "utm_campaign", in: "query", schema: { type: "string" }, description: "Campaign of the page where the session started." },
  { name: "device", in: "query", schema: { type: "string", enum: ["mobile", "desktop", "tablet", ""] } },
];

export function openApiDocument(version) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Looku read API",
      version,
      description:
        "Aggregated, cookieless web analytics. Only totals are returned, never single page views or visitor hashes. Every report has a meta object with the range, time zone and whether the numbers come from a consented sample.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearer: [] }, { session: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "API key created with `looku token:create` or in the dashboard settings." },
        session: { type: "apiKey", in: "cookie", name: "looku_session", description: "Dashboard login (POST /login)." },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } } },
        Meta: {
          type: "object",
          properties: {
            site: { type: "string" },
            timezone: { type: "string" },
            range: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } },
            previous: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } },
            sample: { type: "boolean" },
            n: { type: "integer" },
            generated_at: { type: "string", format: "date-time" },
          },
        },
        Report: { type: "object", properties: { meta: { $ref: "#/components/schemas/Meta" }, data: { type: "object" } } },
        Config: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["", "fi", "en"] },
            page_groups: { type: "array", items: { type: "object", properties: { name: { type: "string" }, prefix: { type: "string" } } } },
            sections: { type: ["array", "null"], items: { type: "string" } },
          },
        },
      },
    },
    paths: {
      "/health": { get: { summary: "Version and time of the last received page view. No key needed.", security: [], responses: { 200: { description: "OK" } } } },
      "/openapi.json": { get: { summary: "This document.", security: [], responses: { 200: { description: "OK" } } } },
      "/login": {
        post: {
          summary: "Dashboard login. Sets an HttpOnly, SameSite=Strict cookie.",
          security: [],
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { password: { type: "string" } } } } } },
          responses: { 200: { description: "Logged in" }, 401: { description: "Wrong password" }, 429: { description: "Too many failed logins" } },
        },
      },
      "/logout": { post: { summary: "Ends the dashboard login.", security: [], responses: { 200: { description: "OK" } } } },
      "/me": { get: { summary: "Scope of the current key or login.", responses: { 200: { description: "OK" } } } },
      "/modules": { get: { summary: "Installed modules and their reports.", responses: { 200: { description: "OK" } } } },
      "/sites": { get: { summary: "Sites this key can read.", responses: { 200: { description: "OK" } } } },
      "/sites/{site}/config": {
        get: { summary: "Dashboard settings of the site.", parameters: [siteParam], responses: { 200: { description: "OK" } } },
        put: {
          summary: "Replace the dashboard settings. Admin only.",
          parameters: [siteParam],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Config" } } } },
          responses: { 200: { description: "Saved" }, 403: { description: "Not an admin key" }, ...errorResponses },
        },
      },
      "/sites/{site}/summary": report("Page views, visitors, sessions and pages per session.", [
        { name: "compare", in: "query", schema: { type: "string", enum: ["previous"] }, description: "Add the previous period of the same length." },
        ...filterParams,
      ]),
      "/sites/{site}/timeseries": report("Totals per hour (at most 31 days, local time), day, week (from Monday) or month.", [
        { name: "interval", in: "query", schema: { type: "string", enum: ["hour", "day", "week", "month"], default: "day" } },
        ...filterParams,
      ]),
      "/sites/{site}/breakdown/{dimension}": report("Totals by one dimension.", [
        { name: "dimension", in: "path", required: true, schema: { type: "string", enum: [...BREAKDOWN_DIMENSIONS, "page_group"] } },
        { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 1000 } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["pageviews", "visitors", "entries", "exits"] } },
        ...filterParams,
      ]),
      "/sites/{site}/reports/{module}/{report}": report("Any report of a module enabled for the site (see /modules): shop/summary, shop/timeseries, shop/funnel, shop/products, campaigns/overview, content/engagement, content/rising. Results with sample: true come only from consenting visitors.", [
        { name: "module", in: "path", required: true, schema: { type: "string" } },
        { name: "report", in: "path", required: true, schema: { type: "string" } },
      ]),
      "/sites/{site}/export.csv": report("Any report as CSV. report = summary, timeseries, breakdown or module/report.", [
        { name: "report", in: "query", required: true, schema: { type: "string" } },
        { name: "dimension", in: "query", schema: { type: "string" } },
      ]),
      "/tokens": {
        get: { summary: "List API keys (never the keys themselves). Admin only.", responses: { 200: { description: "OK" } } },
        post: {
          summary: "Create an API key. The key is shown only in this response. Admin only.",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, scope: { type: "string", enum: ["read", "admin"] }, site: { type: "string" } } } } } },
          responses: { 201: { description: "Created" } },
        },
      },
      "/tokens/{id}": { delete: { summary: "Revoke an API key. Admin only.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: { description: "Revoked" } } } },
    },
  };
}
