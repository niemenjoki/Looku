import { openDatabase } from "../src/db.js";
import { addSite, getSite } from "../src/sites.js";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

export function setup() {
  const db = openDatabase(":memory:");
  const { signingKey } = addSite(db, {
    siteId: "lieromaa",
    domain: "lieromaa.fi",
    name: "Lieromaa",
  });
  return { db, site: getSite(db, "lieromaa"), signingKey };
}
