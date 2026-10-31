import crypto from "node:crypto";

import { dayKey } from "./time.js";

// The visitor hash is SHA-256(daily salt, site, IP address, user agent),
// shortened to 16 bytes. Only the current local day's salt is kept, so the
// same visitor gets a new hash every day and old hashes cannot be recomputed.
// The formula matches the one Lieromaa's order system has used since
// 29.10.2026, so its data can move here without a break.
export function createVisitorHasher(db) {
  const getSalt = db.prepare(
    "SELECT salt FROM daily_salt WHERE site_id = ? AND day = ?",
  );
  const deleteOtherSalts = db.prepare(
    "DELETE FROM daily_salt WHERE site_id = ? AND day <> ?",
  );
  const insertSalt = db.prepare(
    "INSERT INTO daily_salt (site_id, day, salt) VALUES (?, ?, ?)",
  );

  const getOrCreateSalt = db.transaction((siteId, day) => {
    let salt = getSalt.get(siteId, day)?.salt;
    if (!salt) {
      salt = crypto.randomBytes(32);
      deleteOtherSalts.run(siteId, day);
      insertSalt.run(siteId, day, salt);
    }
    return salt;
  });

  return function visitorHash(site, ip, userAgent, now) {
    const salt = getOrCreateSalt(site.site_id, dayKey(now, site.timezone));
    return crypto
      .createHash("sha256")
      .update(salt)
      .update(`\0${site.site_id}\0`)
      .update(ip)
      .update("\0")
      .update(userAgent)
      .digest("hex")
      .slice(0, 32);
  };
}
