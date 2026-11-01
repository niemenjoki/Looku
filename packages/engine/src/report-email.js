import { T } from "@looku/ui/public/i18n.js";
import { buildReview, monthRange, shiftMonth } from "@looku/ui/public/review.js";

import { breakdown, summary, timeseries } from "./modules/perus/reports.js";
import { hideVisitorCounts } from "./modules/visitors.js";

// Monthly review as an email: the same sentences as the dashboard's view C,
// built with the dashboard's own review.js. Nothing is sent unless SMTP is
// configured (LOOKU_SMTP_URL, LOOKU_REPORT_FROM, LOOKU_REPORT_TO).

function formatters(L) {
  const number = new Intl.NumberFormat(L.locale, { maximumFractionDigits: 0 });
  const formatDay = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    if (L.locale === "fi-FI") {
      return `${d}.${m}.`;
    }
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
  };
  return { formatNumber: (value) => number.format(value), formatDay };
}

export function buildMonthlyReview(db, site, month, { language = "fi" } = {}) {
  const L = T[language] || T.fi;
  const range = monthRange(month);
  const previous = monthRange(shiftMonth(month, -1));
  const id = site.site_id;
  // Without the visitor hash the review is told in page views, as in the dashboard.
  const hide = site.visitors === "off" ? hideVisitorCounts : (data) => data;
  const review = buildReview(
    L,
    hide({
      month,
      today: null,
      summary: summary(db, id, range),
      previous: summary(db, id, previous),
      points: timeseries(db, site, range).points,
      referrers: breakdown(db, id, "referrer", range, { limit: 100, sort: "entries" }).rows,
      devices: breakdown(db, id, "device", range).rows,
      pages: breakdown(db, id, "page", range, { limit: 5 }).rows,
      entries: breakdown(db, id, "entry", range, { limit: 5 }).rows,
    }),
    formatters(L),
  );
  return site.visitors === "off" ? { ...review, foot: L.report.footViews } : review;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderReviewEmail(site, review) {
  const lead = review.lead.map((part) => (typeof part === "string" ? part : part.b)).join("");
  const sections = review.sections.filter((section) => section.sentences.length);
  const text = [
    review.title,
    "",
    lead,
    ...sections.flatMap((section) => ["", section.title, section.sentences.join(" ")]),
    "",
    review.foot,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;color:#0F1729">
<p style="color:#4A5470">${escapeHtml(site.domain)}</p>
<h1 style="font-size:22px">${escapeHtml(review.title)}</h1>
<p>${review.lead.map((part) => (typeof part === "string" ? escapeHtml(part) : `<b>${escapeHtml(part.b)}</b>`)).join("")}</p>
${sections.map((section) => `<h2 style="font-size:16px">${escapeHtml(section.title)}</h2><p>${escapeHtml(section.sentences.join(" "))}</p>`).join("\n")}
<p style="color:#4A5470;font-size:13px">${escapeHtml(review.foot)}</p>
</body></html>`;
  return { subject: `${site.name}: ${review.title}`, text, html };
}

export function smtpSettings(env = process.env) {
  const url = env.LOOKU_SMTP_URL;
  const from = env.LOOKU_REPORT_FROM;
  const to = (env.LOOKU_REPORT_TO || "").split(",").map((a) => a.trim()).filter(Boolean);
  if (!url || !from || !to.length) {
    return null;
  }
  return { url, from, to, language: env.LOOKU_REPORT_LANG === "en" ? "en" : "fi" };
}

export async function sendMonthlyReports(db, { month, siteId, settings, transport } = {}) {
  if (!settings) {
    throw new Error("Monthly email is not configured: set LOOKU_SMTP_URL, LOOKU_REPORT_FROM and LOOKU_REPORT_TO.");
  }
  let mailer = transport;
  if (!mailer) {
    const { default: nodemailer } = await import("nodemailer");
    mailer = nodemailer.createTransport(settings.url);
  }
  const sites = db
    .prepare("SELECT * FROM sites WHERE ? IS NULL OR site_id = ? ORDER BY site_id")
    .all(siteId ?? null, siteId ?? null);
  const sent = [];
  for (const site of sites) {
    const email = renderReviewEmail(site, buildMonthlyReview(db, site, month, { language: settings.language }));
    await mailer.sendMail({ from: settings.from, to: settings.to, ...email });
    sent.push(site.site_id);
  }
  return sent;
}
