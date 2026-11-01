import * as perus from "./perus/reports.js";

// Installed modules and their reports. The API lists these at /api/v1/modules
// and runs them at /api/v1/sites/{site}/reports/{module}/{report}, so a
// dashboard can build its views without knowing the modules in advance.
// Each report gets (db, site, range, query, config) and returns plain data.

export const MODULES = {
  perus: {
    version: 1,
    reports: {
      summary: {
        params: ["compare"],
        run: (db, site, range, query) =>
          perus.summary(db, site.site_id, range, { compare: query.compare === "previous" }),
      },
      timeseries: {
        params: ["interval"],
        run: (db, site, range, query) =>
          perus.timeseries(db, site.site_id, range, { interval: query.interval || "day" }),
      },
      breakdown: {
        params: ["dimension", "limit", "sort"],
        dimensions: [...perus.BREAKDOWN_DIMENSIONS, "page_group"],
        run: (db, site, range, query, config) =>
          query.dimension === "page_group"
            ? perus.pageGroups(db, site.site_id, range, config.page_groups)
            : perus.breakdown(db, site.site_id, query.dimension, range, {
                limit: query.limit,
                sort: query.sort,
              }),
      },
    },
  },
};

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
