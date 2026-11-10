#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { createToken, listTokens, revokeToken, setPassword } from "./api/auth.js";
import { createApiServer } from "./api/server.js";
import { openDatabase } from "./db.js";
import { importHistory } from "./history.js";
import { runMaintenance } from "./maintenance.js";
import { createOrderIngest } from "./orders.js";
import { buildMonthlyReview, renderReviewEmail, sendMonthlyReports, smtpSettings } from "./report-email.js";
import { runMaintenanceInWorker } from "./maintenance-worker.js";
import { createScheduler } from "./scheduler.js";
import { createIngestServer } from "./server.js";
import { addSite, getSite, listSites, rotateSigningKey, setModules, setRetention, setStoreCountry, setTimezone, setVisitors } from "./sites.js";
import { dayKey } from "./time.js";

const USAGE = `Usage: looku <command>

  site:add <site-id> --domain <domain> [--name <name>] [--timezone <tz>]
  site:list
  site:rotate-key <site-id>
  site:modules <site-id> <module,...>   Enable modules (perus, shop, campaigns, content)
  site:country <site-id> on|off         Store the visitor's country (default on)
  site:visitors <site-id> daily-hash|off   Count visitors with the daily hash (default) or not at all
  site:retention <site-id> <months>       Keep single page views this long (default 25), then daily totals
  site:timezone <site-id> <tz>            Change the time zone of the site's days, e.g. Europe/Helsinki
  ingest                 Start the receiver (POST /ingest, POST /orders)
  maintain               Nightly job: salts, rollups, retention
  orders:import <site-id> <file>        Import orders (JSON lines, same format as POST /orders)
  history:import <site-id> <file> [--before <time>]
                         Import page views, events and engagement from an earlier system (JSON lines)
  report:send [--month YYYY-MM] [--site <site-id>] [--dry-run]
                         Monthly email (default: last month)
  serve                  Start the read API and dashboard
  all                    Receiver and dashboard in one process and port (small installs)
  backup <file>          Consistent copy of the database while Looku runs (without the daily salt)
  admin:password         Set the dashboard password (read from stdin)
  token:create <name> [--scope read|admin] [--site <site-id>]
  token:list
  token:revoke <id>

Environment:
  LOOKU_DB               Database file (default ./data/looku.db)
  LOOKU_INGEST_HOST      Receiver address (default 127.0.0.1)
  LOOKU_INGEST_PORT      Receiver port (default 8787)
  LOOKU_API_HOST         Read API and dashboard address (default 127.0.0.1)
  LOOKU_API_PORT         Read API and dashboard port (default 8788)
  LOOKU_API_CORS         Origins allowed to call the API, comma separated
  LOOKU_COOKIE_SECURE    1 = login cookie only over HTTPS
  LOOKU_PUBLIC_ORIGIN    Dashboard address behind a reverse proxy, e.g. https://looku.lan
  LOOKU_API_HOSTS        Accepted Host headers, comma separated (DNS rebinding guard)
  LOOKU_API_ALLOW        Client addresses or CIDR ranges allowed to open the dashboard, comma separated
  LOOKU_TRUST_PROXY      Number of reverse proxies in front of the dashboard (reads X-Forwarded-For)
  LOOKU_PORT             Port of \`looku all\` (default 8788)
  LOOKU_UI_DIR           Dashboard files (default: the @looku/ui package)
  LOOKU_SCHEDULER        0 = the receiver does not run the nightly job and monthly email
  LOOKU_TIMEZONE         Time zone of the scheduled jobs (default Europe/Helsinki)
  LOOKU_SMTP_URL         Mail server, e.g. smtps://user:password@smtp.example.com:465
  LOOKU_REPORT_FROM      Sender of the monthly email
  LOOKU_REPORT_TO        Recipients, comma separated
  LOOKU_REPORT_LANG      fi (default) or en
`;

function readSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      rl._writeToOutput = () => {};
    }
    // close() emits "close" synchronously, so the answer is resolved there and not before it.
    let answer = "";
    rl.once("line", (line) => {
      answer = line;
      rl.close();
    });
    rl.once("close", () => {
      if (process.stdin.isTTY) {
        process.stdout.write("\n");
      }
      resolve(answer);
    });
  });
}

function defaultUiDir() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.resolve("@looku/ui/package.json"))), "public");
  } catch {
    return null;
  }
}

function shiftMonthBack(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7);
}

const list = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

// The dashboard server from the environment. Settings and keys are written
// through their own connection; reports read through a read-only one.
function dashboardServer(dbFile) {
  const writeDb = openDatabase(dbFile);
  const db = openDatabase(dbFile, { readonly: true });
  const uiDir = process.env.LOOKU_UI_DIR || defaultUiDir();
  const server = createApiServer(db, {
    writeDb,
    uiDir,
    allowedOrigins: list(process.env.LOOKU_API_CORS),
    secureCookie: process.env.LOOKU_COOKIE_SECURE === "1",
    publicOrigin: process.env.LOOKU_PUBLIC_ORIGIN || null,
    allowedHosts: list(process.env.LOOKU_API_HOSTS),
    allowedClients: list(process.env.LOOKU_API_ALLOW),
    trustProxy: Number(process.env.LOOKU_TRUST_PROXY) || 0,
  });
  return { server, uiDir, close: () => { db.close(); writeDb.close(); } };
}

// The receiver and its scheduled jobs (unless LOOKU_SCHEDULER=0).
function receiver(dbFile) {
  const db = openDatabase(dbFile);
  const server = createIngestServer(db);
  const scheduler =
    process.env.LOOKU_SCHEDULER === "0"
      ? null
      : createScheduler(db, {
          timeZone: process.env.LOOKU_TIMEZONE || "Europe/Helsinki",
          settings: smtpSettings(),
          maintain: (now) => runMaintenanceInWorker(dbFile, now),
        });
  return { server, scheduler, close: () => { scheduler?.stop(); db.close(); } };
}

function onStop(stop) {
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

function parseOptions(args) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      // A flag without a value (e.g. --dry-run) is true.
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        options[args[i].slice(2)] = true;
      } else {
        options[args[i].slice(2)] = value;
        i += 1;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { options, positional };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { options, positional } = parseOptions(rest);
  const dbFile = process.env.LOOKU_DB || "./data/looku.db";

  switch (command) {
    case "site:add": {
      const db = openDatabase(dbFile);
      const { siteId, signingKey } = addSite(db, {
        siteId: positional[0],
        domain: options.domain,
        name: options.name,
        timezone: options.timezone,
      });
      console.log(`Site ${siteId} added. Signing key (shown once):\n${signingKey}`);
      return;
    }
    case "site:list": {
      const db = openDatabase(dbFile);
      console.table(listSites(db));
      return;
    }
    case "site:rotate-key": {
      const db = openDatabase(dbFile);
      console.log(rotateSigningKey(db, positional[0]));
      return;
    }
    case "site:modules": {
      const db = openDatabase(dbFile);
      const modules = setModules(db, positional[0], String(positional[1] || "").split(",").map((m) => m.trim()).filter(Boolean));
      console.log(`Modules of ${positional[0]}: ${modules.join(", ")}`);
      db.close();
      return;
    }
    case "site:visitors": {
      const db = openDatabase(dbFile);
      setVisitors(db, positional[0], positional[1]);
      console.log(positional[1] === "off"
        ? `Visitors for ${positional[0]}: off. Reports stop showing visitors now; new page views get no hash.`
        : `Visitors for ${positional[0]}: ${positional[1]}. Applies to new page views.`);
      db.close();
      return;
    }
    case "site:retention": {
      const db = openDatabase(dbFile);
      setRetention(db, positional[0], positional[1]);
      console.log(`Retention for ${positional[0]}: ${positional[1]} months. Applies from the next nightly job.`);
      db.close();
      return;
    }
    case "site:timezone": {
      if (!positional[1]) {
        throw new Error("Usage: looku site:timezone <site-id> <tz>");
      }
      const db = openDatabase(dbFile);
      setTimezone(db, positional[0], positional[1]);
      console.log(`Time zone for ${positional[0]}: ${positional[1]}. Applies to new page views; days already recorded keep their dates.`);
      db.close();
      return;
    }
    case "backup": {
      if (!positional[0]) {
        throw new Error("Usage: looku backup <file>");
      }
      const db = openDatabase(dbFile, { readonly: true });
      await db.backup(positional[0]);
      db.close();
      // Without the salt, the day's visitor hashes in the copy cannot be
      // recomputed from an IP address.
      const copy = openDatabase(positional[0]);
      copy.prepare("DELETE FROM daily_salt").run();
      copy.exec("VACUUM");
      copy.close();
      console.log(`Backup written to ${positional[0]}.`);
      return;
    }
    case "site:country": {
      if (!["on", "off"].includes(positional[1])) {
        throw new Error("Usage: looku site:country <site-id> on|off");
      }
      const db = openDatabase(dbFile);
      setStoreCountry(db, positional[0], positional[1] === "on");
      console.log(`Country for ${positional[0]}: ${positional[1]}.`);
      db.close();
      return;
    }
    case "ingest": {
      const host = process.env.LOOKU_INGEST_HOST || "127.0.0.1";
      const port = Number(process.env.LOOKU_INGEST_PORT) || 8787;
      const r = receiver(dbFile);
      r.server.listen(port, host, () => {
        console.log(`Looku receiver listening on ${host}:${port}`);
        r.scheduler?.start();
      });
      onStop(() => r.server.close(r.close));
      return;
    }
    case "serve": {
      const host = process.env.LOOKU_API_HOST || "127.0.0.1";
      const port = Number(process.env.LOOKU_API_PORT) || 8788;
      const d = dashboardServer(dbFile);
      d.server.listen(port, host, () => {
        console.log(`Looku dashboard and API on http://${host}:${port}${d.uiDir ? "" : " (no dashboard files found)"}`);
      });
      onStop(() => d.server.close(d.close));
      return;
    }
    case "all": {
      // One port: /ingest, /orders and /healthz go to the receiver, the rest
      // to the dashboard. For small installs behind one reverse proxy.
      const host = process.env.LOOKU_API_HOST || "127.0.0.1";
      const port = Number(process.env.LOOKU_PORT) || 8788;
      const r = receiver(dbFile);
      const d = dashboardServer(dbFile);
      const server = http.createServer((req, res) => {
        const path = String(req.url || "").split("?")[0];
        const target = ["/ingest", "/orders", "/healthz"].includes(path) ? r.server : d.server;
        target.emit("request", req, res);
      });
      server.requestTimeout = 30_000;
      server.headersTimeout = 10_000;
      server.listen(port, host, () => {
        console.log(`Looku receiver and dashboard on http://${host}:${port}`);
        r.scheduler?.start();
      });
      onStop(() => server.close(() => { r.close(); d.close(); }));
      return;
    }
    case "admin:password": {
      const db = openDatabase(dbFile);
      setPassword(db, await readSecret("New dashboard password: "));
      console.log("Password set. Restart `looku serve` to end existing logins.");
      db.close();
      return;
    }
    case "token:create": {
      const db = openDatabase(dbFile);
      const { id, token } = createToken(db, { name: positional[0], scope: options.scope, siteId: options.site });
      console.log(`Key ${id} created. Key (shown once):\n${token}`);
      db.close();
      return;
    }
    case "token:list": {
      const db = openDatabase(dbFile);
      console.table(listTokens(db));
      db.close();
      return;
    }
    case "token:revoke": {
      const db = openDatabase(dbFile);
      console.log(revokeToken(db, positional[0]) ? "Key revoked." : "Unknown key.");
      db.close();
      return;
    }
    case "orders:import": {
      const db = openDatabase(dbFile);
      const site = getSite(db, positional[0]);
      if (!site) {
        throw new Error(`Unknown site: ${positional[0]}`);
      }
      const record = createOrderIngest(db);
      const lines = fs.readFileSync(positional[1], "utf8").split(/\r?\n/).filter((line) => line.trim());
      let count = 0;
      db.transaction(() => {
        lines.forEach((line, index) => {
          try {
            record(site, JSON.parse(line));
            count += 1;
          } catch (error) {
            throw new Error(`Line ${index + 1}: ${error.message}`);
          }
        });
      })();
      console.log(`${count} orders imported to ${site.site_id}.`);
      db.close();
      return;
    }
    case "history:import": {
      const db = openDatabase(dbFile);
      const site = getSite(db, positional[0]);
      if (!site) {
        throw new Error(`Unknown site: ${positional[0]}`);
      }
      const result = importHistory(db, site, fs.readFileSync(positional[1], "utf8"), {
        before: typeof options.before === "string" ? options.before : null,
      });
      console.log(
        `${result.pageview} page views, ${result.event} events, ${result.engagement} engagement rows imported to ` +
          `${site.site_id}; ${result.skippedBefore} skipped at or after --before, ${result.skippedRetention} older ` +
          `than the retention; ${result.daysRolledUp} days rolled up.`,
      );
      db.close();
      return;
    }
    case "report:send": {
      const db = openDatabase(dbFile);
      const settings = smtpSettings();
      if (options.month !== undefined && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(options.month))) {
        throw new Error("--month must be YYYY-MM.");
      }
      const month = options.month || dayKey(new Date(), process.env.LOOKU_TIMEZONE || "Europe/Helsinki").slice(0, 7);
      const target = options.month ? month : shiftMonthBack(month);
      if (options["dry-run"]) {
        for (const site of listSites(db).filter((row) => !options.site || row.site_id === options.site)) {
          const email = renderReviewEmail(site, buildMonthlyReview(db, site, target, { language: settings?.language || "fi" }));
          console.log(`Subject: ${email.subject}\n\n${email.text}\n`);
        }
      } else {
        const sent = await sendMonthlyReports(db, { month: target, siteId: options.site, settings });
        console.log(`Monthly report ${target} sent for ${sent.join(", ") || "no sites"}.`);
      }
      db.close();
      return;
    }
    case "maintain": {
      const db = openDatabase(dbFile);
      console.log(JSON.stringify(runMaintenance(db), null, 2));
      db.close();
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
