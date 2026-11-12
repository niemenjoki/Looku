// Fills a database with three months of invented traffic, orders and reading
// time for the online demo. The data goes through the real receiver, so the
// same rules apply as in a real installation. Nothing here comes from a real
// site. The random numbers are seeded, so every build makes the same visitors.
import { addSite, getSite, setModules } from "../../packages/engine/src/sites.js";
import { createIngest } from "../../packages/engine/src/ingest.js";
import { createOrderIngest } from "../../packages/engine/src/orders.js";
import { runMaintenance } from "../../packages/engine/src/maintenance.js";

export const DEMO_SITE = "shop";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
};
const DEVICES = [["iphone", 30], ["android", 22], ["chromeWin", 18], ["edgeWin", 8], ["firefoxWin", 5], ["safariMac", 12], ["ipad", 5]];
const COUNTRIES = [["FI", 82], ["SE", 6], ["EE", 4], ["DE", 3], ["US", 3], ["", 2]];
const PRODUCTS = [
  ["seed-mix", "SEED-1", 8.9, 30], ["garden-gloves", "GLOVE-2", 14.5, 22], ["compost-bin", "BIN-3", 59, 10],
  ["worm-starter-kit", "WORM-4", 34.9, 18], ["rain-barrel", "BARREL-5", 79, 6],
];
const POSTS = [["how-to-compost", 40], ["winter-garden", 25], ["worms-in-a-flat", 30], ["first-raised-bed", 15]];
const DAYS = 92;

export function seedDemo(db, now) {
  let seed = 20261104;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => {
    const total = list.reduce((sum, [, w]) => sum + w, 0);
    let r = rand() * total;
    for (const [value, w] of list) if ((r -= w) < 0) return value;
    return list[0][0];
  };

  addSite(db, { siteId: DEMO_SITE, domain: "shop.example", name: "Example shop", timezone: "Europe/Helsinki" });
  setModules(db, DEMO_SITE, ["campaigns", "shop", "content"]);
  db.prepare("UPDATE sites SET config_json = ? WHERE site_id = ?").run(JSON.stringify({
    language: "",
    page_groups: [{ name: "Products", prefix: "/products/" }, { name: "Blog", prefix: "/blog/" }],
    sections: null,
    shop: { product_prefix: "/products/", cart_path: "/cart", checkout_path: "/checkout" },
  }), DEMO_SITE);
  const site = getSite(db, DEMO_SITE);
  const ingest = createIngest(db);
  const order = createOrderIngest(db);

  let visitorNo = 0;
  let orderNo = 1000;
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const weekday = day.getUTCDay();
    const growth = 1 + ((DAYS - d) / DAYS) * 0.6;
    // Two campaigns: a newsletter three weeks ago and an Instagram post last week.
    const newsletter = d <= 24 && d >= 17;
    const insta = d <= 10 && d >= 5;
    let visitors = Math.round((45 + rand() * 25) * growth * (weekday === 0 || weekday === 6 ? 0.75 : 1) * (newsletter ? 1.5 : 1) * (insta ? 1.4 : 1));
    if (d === 0) visitors = Math.round(visitors * Math.min(1, (now.getUTCHours() + 2) / 24));

    for (let v = 0; v < visitors; v++) {
      visitorNo++;
      const ip = `10.${(visitorNo >> 16) & 255}.${(visitorNo >> 8) & 255}.${visitorNo & 255}`;
      const ua = UA[pick(DEVICES)];
      const country = pick(COUNTRIES);
      const hour = Math.floor(pick([[7, 1], [9, 2], [11, 3], [13, 3], [15, 3], [18, 4], [20, 5], [22, 3]]) + rand() * 2);
      let t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 2, Math.floor(rand() * 60)));
      if (t > now) t = new Date(now.getTime() - Math.floor(rand() * 3600000));

      const source = pick([
        ["google", 38], ["direct", 22], ["duckduckgo", 5], ["facebook", 7], ["instagram", 5], ["bing", 3],
        ...(newsletter ? [["newsletter", 30]] : []), ...(insta ? [["insta", 25]] : []),
      ]);
      const utm = source === "newsletter" ? { utm_source: "newsletter", utm_medium: "email", utm_campaign: "autumn-sale" }
        : source === "insta" ? { utm_source: "instagram", utm_medium: "social", utm_campaign: "worm-kit-launch" } : {};
      const referrer = { google: "https://www.google.com/", duckduckgo: "https://duckduckgo.com/", facebook: "https://m.facebook.com/",
        instagram: "https://l.instagram.com/", bing: "https://www.bing.com/", insta: "https://l.instagram.com/" }[source] || "";

      const path = [];
      const post = pick(POSTS);
      const product = pick(PRODUCTS.map((p) => [p, p[3]]));
      const entry = source === "newsletter" ? `/products/${product[0]}` : source === "insta" ? "/products/worm-starter-kit"
        : pick([["/", 35], [`/blog/${post}`, 40], [`/products/${product[0]}`, 20], ["/about", 5]]);
      path.push(entry);
      const pages = pick([[1, 45], [2, 25], [3, 15], [4, 10], [6, 5]]);
      for (let i = 1; i < pages; i++) path.push(pick([["/products/", 3], [`/products/${pick(PRODUCTS.map((p) => [p[0], p[3]]))}`, 5], [`/blog/${pick(POSTS)}`, 3], ["/", 2], ["/cart", 2]]));
      const buys = rand() < (source === "newsletter" ? 0.09 : source === "insta" ? 0.07 : 0.035);
      if (buys) path.push("/cart", "/checkout");

      path.forEach((p, i) => {
        const at = new Date(t.getTime() + i * (40000 + rand() * 90000));
        if (at > now) return;
        ingest(site, { type: "pageview", ts: at.toISOString(), path: p, ip, ua, country, referrer: i === 0 ? referrer : "", ...(i === 0 ? utm : {}) }, at);
        if (p.startsWith("/blog/") && rand() < 0.4) {
          ingest(site, { type: "engagement", ts: at.toISOString(), path: p, dwell_ms: Math.round(30000 + rand() * 200000), max_scroll_pct: Math.round(35 + rand() * 65) }, at);
        }
      });
      // Some visitors come back later the same day.
      const back = new Date(t.getTime() + (2 + rand() * 4) * 3600000);
      if (rand() < 0.2 && back < now && back.getUTCDate() === t.getUTCDate()) {
        ["/", `/products/${pick(PRODUCTS.map((p) => [p[0], p[3]]))}`].slice(0, 1 + Math.floor(rand() * 2)).forEach((p, i) => {
          const at = new Date(back.getTime() + i * 60000);
          if (at <= now) ingest(site, { type: "pageview", ts: at.toISOString(), path: p, ip, ua, country }, at);
        });
      }
      const paid = new Date(t.getTime() + path.length * 90000);
      if (buys && paid <= now) {
        const items = [{ sku: product[1], name: product[0], quantity: 1 + Math.floor(rand() * 2), price: product[2] }];
        if (rand() < 0.3) items.push({ sku: "SEED-1", name: "seed-mix", quantity: 1, price: 8.9 });
        const total = Math.round(items.reduce((sum, it) => sum + it.quantity * it.price, 0) * 100) / 100;
        order(site, { id: String(++orderNo), ts: paid.toISOString(), total, items, ...(utm.utm_campaign ? { utm_campaign: utm.utm_campaign } : {}) }, paid);
      }
    }

    // Old links and bots trying addresses, which the shop answers with "not found".
    for (const [p, every] of [["/wp-admin", 2], ["/old-shop/worms", 5], ["/blog/2019/compost-tips", 9]]) {
      const at = new Date(now.getTime() - d * 86400000 - 3600000);
      if (d % every !== 0) continue;
      const visitor = { ip: `192.0.2.${every}`, ua: UA.chromeWin };
      ingest(site, { type: "pageview", ts: at.toISOString(), path: p, ...visitor }, at);
      ingest(site, { type: "notfound", ts: at.toISOString(), path: p, ua: visitor.ua }, at);
    }
  }
  runMaintenance(db, now);
  return { visitors: visitorNo, orders: orderNo - 1000 };
}
