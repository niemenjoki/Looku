import * as campaigns from "./campaigns/reports.js";
import * as content from "./content/reports.js";
import { FILTER_PARAMS, parseFilters } from "./filters.js";
import * as perus from "./perus/reports.js";
import * as shop from "./shop/reports.js";

// Installed modules and their reports. The API lists these at /api/v1/modules
// and runs them at /api/v1/sites/{site}/reports/{module}/{report}, so a
// dashboard can build its views without knowing the modules in advance.
// Each report gets (db, site, range, query, config) and returns plain data.
// A site enables modules with `looku site:modules`; perus is always on.

export const MODULES = {
  perus: {
    version: 3,
    reports: {
      summary: {
        params: ["compare", ...FILTER_PARAMS],
        run: (db, site, range, query, config) =>
          perus.summary(db, site.site_id, range, {
            compare: query.compare === "previous",
            filters: parseFilters(query, config),
          }),
      },
      timeseries: {
        params: ["interval", ...FILTER_PARAMS],
        run: (db, site, range, query, config) =>
          perus.timeseries(db, site, range, {
            interval: query.interval || "day",
            filters: parseFilters(query, config),
          }),
      },
      breakdown: {
        params: ["dimension", "limit", "sort", ...FILTER_PARAMS],
        dimensions: [...perus.BREAKDOWN_DIMENSIONS, "page_group"],
        run: (db, site, range, query, config) => {
          const filters = parseFilters(query, config);
          return query.dimension === "page_group"
            ? perus.pageGroups(db, site.site_id, range, config.page_groups, { filters })
            : perus.breakdown(db, site.site_id, query.dimension, range, {
                limit: query.limit,
                sort: query.sort,
                filters,
              });
        },
      },
      missing: {
        params: ["limit"],
        run: (db, site, range, query) => perus.missing(db, site.site_id, range, { limit: query.limit }),
      },
    },
  },
  shop: {
    version: 1,
    reports: {
      summary: {
        params: ["compare"],
        run: (db, site, range, query) =>
          shop.summary(db, site.site_id, range, { compare: query.compare === "previous" }),
      },
      timeseries: {
        params: [],
        run: (db, site, range) => shop.timeseries(db, site.site_id, range),
      },
      funnel: {
        params: [],
        run: (db, site, range, query, config) =>
          site.visitors === "off"
            ? { range, steps: [], configured: false, unavailable: "visitors_off" }
            : shop.funnel(db, site.site_id, range, config.shop),
      },
      products: {
        params: ["limit"],
        run: (db, site, range, query, config) =>
          shop.products(db, site.site_id, range, config.shop, { limit: query.limit }),
      },
    },
  },
  campaigns: {
    version: 1,
    reports: {
      overview: {
        params: ["limit"],
        run: (db, site, range, query) =>
          campaigns.overview(db, site.site_id, range, {
            limit: query.limit,
            measure: site.visitors === "off" ? "pageviews" : "sessions",
          }),
      },
    },
  },
  content: {
    version: 1,
    reports: {
      engagement: {
        params: ["limit"],
        run: (db, site, range, query) => content.engagement(db, site.site_id, range, { limit: query.limit }),
      },
      rising: {
        params: ["limit", "min"],
        run: (db, site, range, query) =>
          content.rising(db, site.site_id, range, { limit: query.limit, min: query.min }),
      },
    },
  },
};

export const MODULE_IDS = Object.keys(MODULES);

export function describeModules() {
  return Object.entries(MODULES).map(([id, module]) => ({
    id,
    version: module.version,
    reports: Object.entries(module.reports).map(([reportId, report]) => ({
      id: reportId,
      params: report.params,
      ...(report.dimensions ? { dimensions: report.dimensions } : {}),
    })),
  }));
}
