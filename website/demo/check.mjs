// Opens the built demo in Chromium from a static server under /looku/ and
// checks that every view loads without errors. Screenshots go to /out.
// See README.md in this folder for how to run it.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const SITE = "/site";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".db": "application/octet-stream", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!p.startsWith("/looku/")) { res.writeHead(404); return res.end(); }
  p = path.join(SITE, p.slice("/looku".length));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(8080);

const problems = [];
const browser = await chromium.launch();
for (const lang of ["en", "fi"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === "fi" ? "fi-FI" : "en-GB", acceptDownloads: true });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${lang} console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${lang} pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`${lang} ${r.status()} ${r.url()}`); });

  await page.goto(`http://127.0.0.1:8080/looku/demo/?lang=${lang}`);
  await page.waitForSelector("main section", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const text = await page.locator("body").innerText();
  if (/error|virhe/i.test(await page.locator("main").innerText())) problems.push(`${lang}: error text on dashboard`);
  console.log(`${lang} ribbon: ${text.split("\n")[0]}`);
  await page.screenshot({ path: `/out/dashboard-${lang}.png`, fullPage: true });

  // Every range button.
  const ranges = await page.locator("header button, .ranges button, [role=group] button").allInnerTexts();
  console.log(`${lang} buttons: ${ranges.slice(0, 20).join(" | ")}`);
  for (const name of ranges.filter((t) => /^(7|28|30|90|12|24|Today|Tänään|Month|Kuukausi)/i.test(t.trim())).slice(0, 6)) {
    await page.getByRole("button", { name, exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(700);
    const mainText = await page.locator("main").innerText();
    if (/error|virhe/i.test(mainText)) problems.push(`${lang} range ${name}: error text`);
  }

  // Filters: the second option of each filter list.
  const selects = await page.locator("main select").count();
  for (let i = 0; i < selects; i++) {
    const select = page.locator("main select").nth(i);
    const before = await page.locator("main").innerText();
    const options = await select.locator("option").allInnerTexts();
    console.log(`${lang} select ${i}: ${options.slice(0, 6).join(" | ")}`);
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(900);
    if (!(await page.locator("main").count())) {
      problems.push(`${lang} select ${i}: no main after choosing ${options[1]}: ${(await page.locator("body").innerText()).slice(0, 300)}`);
      await page.screenshot({ path: `/out/broken-${lang}-${i}.png` });
      break;
    }
    const mainText = await page.locator("main").innerText();
    if (/error|virhe/i.test(mainText)) problems.push(`${lang} filter: error text`);
    console.log(`${lang} filter ${await select.inputValue()}: changed=${before !== mainText}`);
    await select.selectOption({ index: 0 });
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `/out/after-${lang}.png` });

  // Reading the chart with the mouse, and a row that filters the dashboard.
  const plot = page.locator(".va-main .plot");
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  if (!(await page.locator(".va-main .tip").isVisible())) problems.push(`${lang}: no chart readout`);
  else console.log(`${lang} readout: ${(await page.locator(".va-main .tip").innerText()).replace(/\n/g, " | ")}`);
  await page.locator("section[data-id=pages] a.fl").first().click();
  await page.waitForTimeout(1500);
  if (!page.url().includes("page=") || !(await page.locator(".chip").count())) problems.push(`${lang}: row filter did not apply`);
  if (/error|virhe/i.test(await page.locator("main").innerText())) problems.push(`${lang} row filter: error text`);
  await page.goBack();
  await page.waitForTimeout(1500);

  // CSV download.
  const csv = page.locator("a[download]").first();
  if (await csv.count()) {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => null), csv.click()]);
    if (!download) problems.push(`${lang}: CSV link did not download`);
    else console.log(`${lang} csv: ${download.suggestedFilename()} ${(await fs.promises.readFile(await download.path(), "utf8")).split("\r\n")[0]}`);
  }

  for (const hash of ["report", "settings"]) {
    await page.goto(`http://127.0.0.1:8080/looku/demo/?lang=${lang}#${hash}`);
    await page.waitForSelector("main section, main .panel", { timeout: 20000 });
    await page.waitForTimeout(1200);
    if (/error|virhe/i.test(await page.locator("main").innerText())) problems.push(`${lang} ${hash}: error text`);
    await page.screenshot({ path: `/out/${hash}-${lang}.png`, fullPage: true });
  }

  // Opt-out page: saved in the settings, linked at the bottom of the front page.
  await page.locator("main input[type=url]").fill("https://shop.example/looku-off");
  await page.locator("main button.primary").first().click();
  await page.waitForTimeout(800);
  await page.locator('header nav a[href^="#/"]').first().click();
  await page.waitForSelector("main .optout a", { timeout: 20000 });
  const optOut = await page.locator("main .optout a").first().getAttribute("href");
  if (optOut !== "https://shop.example/looku-off") problems.push(`${lang}: opt-out link ${optOut}`);
  console.log(`${lang} opt-out: ${await page.locator("main .optout").innerText()}`);
  await page.screenshot({ path: `/out/optout-${lang}.png`, fullPage: true });
  await context.close();
}
await browser.close();
server.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "OK: no problems");
