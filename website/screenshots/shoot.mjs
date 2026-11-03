// Takes documentation screenshots of the dashboard in both languages and themes.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://dashboard:8788";
const PASSWORD = fs.readFileSync("/shots/pw", "utf8").trim();
const OUT = "/shots/out";
fs.mkdirSync(OUT, { recursive: true });

// Each picture is one section or a row of sections, cut to where their content ends.
const SECTIONS = {
  fi: {
    pages: ["Suosituimmat sivut", "Aloitussivut", "Poistumissivut"], referrers: ["Mistä tultiin"], campaigns: ["Kampanjat"],
    shop: ["Verkkokauppa"], funnel: ["Ostopolku"], content: ["Lukuaika ja vieritys"],
    devices: ["Laitteet", "Selaimet ja järjestelmät", "Maat"],
  },
  en: {
    pages: ["Top pages", "Entry pages", "Exit pages"], referrers: ["Where visitors came from"], campaigns: ["Campaigns"],
    shop: ["Shop"], funnel: ["Purchase path"], content: ["Reading time and scroll"],
    devices: ["Devices", "Browsers and systems", "Countries"],
  },
};

async function shootSections(page, path, headings) {
  const clip = await page.evaluate((names) => {
    const boxes = [];
    for (const name of names) {
      const section = [...document.querySelectorAll("main section")].find((s) =>
        [...s.querySelectorAll("h1,h2,h3,h4")].some((h) => h.firstChild?.textContent?.trim() === name || h.textContent.trim().replace(/\s*CSV$/, "") === name));
      if (!section) return { missing: name };
      const box = section.getBoundingClientRect();
      const bottom = Math.max(...[...section.querySelectorAll("*")].map((el) => el.getBoundingClientRect().bottom));
      boxes.push({ left: box.left, top: box.top, right: box.right, bottom: Math.min(box.bottom, bottom + 16) });
    }
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    const right = Math.max(...boxes.map((b) => b.right));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    return { x: left, y: top + window.scrollY, width: right - left, height: bottom - top };
  }, headings);
  if (clip.missing) {
    console.log(`missing ${clip.missing}`);
    return;
  }
  await page.screenshot({ path, fullPage: true, clip });
}

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

    for (const [key, headings] of Object.entries(SECTIONS[lang])) {
      await shootSections(page, name(key), headings);
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
