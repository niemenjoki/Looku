// Takes documentation screenshots of the dashboard in both languages and themes.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://dashboard:8788";
const PASSWORD = fs.readFileSync("/shots/pw", "utf8").trim();
const OUT = "/shots/out";
fs.mkdirSync(OUT, { recursive: true });

const SECTIONS = {
  fi: { pages: "Suosituimmat sivut", referrers: "Mistä tultiin", campaigns: "Kampanjat", shop: "Verkkokauppa", funnel: "Ostopolku", content: "Lukuaika ja vieritys", devices: "Laitteet" },
  en: { pages: "Top pages", referrers: "Where visitors came from", campaigns: "Campaigns", shop: "Shop", funnel: "Purchase path", content: "Reading time and scroll", devices: "Devices" },
};

const browser = await chromium.launch();
for (const lang of ["fi", "en"]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === "fi" ? "fi-FI" : "en-GB" });
    await context.addInitScript(([l, t]) => {
      localStorage.setItem("looku", JSON.stringify({ site: "shop", range: "28d", compare: true, lang: l, theme: t }));
    }, [lang, theme]);
    const page = await context.newPage();
    const name = (n) => `${OUT}/${n}-${lang}-${theme}.png`;

    await page.goto(BASE);
    await page.waitForSelector("input[type=password]");
    await page.waitForTimeout(300);
    await page.screenshot({ path: name("login") });
    await page.fill("input[type=password]", PASSWORD);
    await page.press("input[type=password]", "Enter");
    await page.waitForSelector("main section", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: name("overview") });
    if (process.env.FULL) await page.screenshot({ path: name("full"), fullPage: true });

    for (const [key, text] of Object.entries(SECTIONS[lang])) {
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name: text, exact: true }) }).first();
      if (await section.count()) {
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await section.screenshot({ path: name(key) });
      } else {
        console.log(`missing ${lang} ${key}`);
      }
    }

    await page.goto(`${BASE}/#/report`);
    await page.waitForSelector("main section", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: name("report") });
    await page.goto(`${BASE}/#/settings`);
    await page.waitForSelector("main section", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: name("settings") });
    await context.close();
  }
}
await browser.close();
console.log(fs.readdirSync(OUT).length, "files");
