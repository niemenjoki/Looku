import { generateSigningKey } from "./signature.js";
import { isValidTimeZone } from "./time.js";

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function addSite(db, { siteId, name, domain, timezone = "Europe/Helsinki" }) {
  if (!SITE_ID_PATTERN.test(siteId || "")) {
    throw new Error(
      "Site id must be lowercase letters, numbers and dashes (max 63).",
    );
  }
  if (!domain) {
    throw new Error("Domain is required.");
  }
  if (!isValidTimeZone(timezone)) {
    throw new Error(`Unknown time zone: ${timezone}`);
  }

  const signingKey = generateSigningKey();
  db.prepare(
    `INSERT INTO sites (site_id, name, domain, timezone, signing_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    siteId,
    name || siteId,
    String(domain).toLowerCase().replace(/^www\./, ""),
    timezone,
    signingKey,
    new Date().toISOString(),
  );
  return { siteId, signingKey };
}

export function rotateSigningKey(db, siteId) {
  const signingKey = generateSigningKey();
  const result = db
    .prepare("UPDATE sites SET signing_key = ? WHERE site_id = ?")
    .run(signingKey, siteId);
  if (result.changes === 0) {
    throw new Error(`Unknown site: ${siteId}`);
  }
  return signingKey;
}

export function getSite(db, siteId) {
  return db.prepare("SELECT * FROM sites WHERE site_id = ?").get(siteId);
}

export function listSites(db) {
  return db
    .prepare(
      "SELECT site_id, name, domain, timezone, modules_json, retention_months, created_at FROM sites ORDER BY site_id",
    )
    .all();
}
