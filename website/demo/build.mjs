// Builds the online demo into dist/demo after `astro build`: the dashboard
// files, Looku's report code, sql.js and a database with invented data. Needs
// the repository's own packages installed (`npm install` in the root).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../packages/engine/src/db.js";
import { seedDemo } from "./seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../dist/demo");
const sqlJs = path.dirname(fileURLToPath(import.meta.resolve("sql.js/dist/sql-wasm.js")));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The dashboard and the report code, as they are in the repository.
fs.cpSync(path.join(root, "packages/ui/public"), out, { recursive: true });
fs.cpSync(path.join(root, "packages/engine/src"), path.join(out, "engine"), { recursive: true });
for (const file of ["sql-wasm.js", "sql-wasm.wasm"]) fs.copyFileSync(path.join(sqlJs, file), path.join(out, file));
for (const file of ["demo-api.js", "demo.css"]) fs.copyFileSync(path.join(here, file), path.join(out, file));

// demo.js opens on the last 28 days; for that, it must know app.js's version of the saved defaults.
const app = fs.readFileSync(path.join(out, "app.js"), "utf8");
const defaultsVersion = app.match(/const DEFAULTS_VERSION = (\d+);/)?.[1];
if (!defaultsVersion) throw new Error("app.js has changed: DEFAULTS_VERSION not found.");
fs.writeFileSync(path.join(out, "demo.js"), fs.readFileSync(path.join(here, "demo.js"), "utf8").replace("__DEFAULTS_VERSION__", defaultsVersion));

// The page: demo.js must run before app.js.
const index = fs.readFileSync(path.join(out, "index.html"), "utf8");
const marker = '<script type="module" src="app.js"></script>';
if (!index.includes(marker)) throw new Error("index.html has changed: app.js script tag not found.");
fs.writeFileSync(
  path.join(out, "index.html"),
  index
    .replace("<title>Looku</title>", "<title>Looku demo</title>")
    .replace(marker, `<link rel="stylesheet" href="demo.css">\n<script src="sql-wasm.js"></script>\n<script src="demo.js"></script>\n${marker}`),
);

// The data, made now (or at DEMO_NOW for a repeatable build).
const now = process.env.DEMO_NOW ? new Date(process.env.DEMO_NOW) : new Date();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "looku-demo-"));
const file = path.join(tmp, "demo.db");
const db = openDatabase(file);
const counts = seedDemo(db, now);
db.pragma("journal_mode = DELETE");
db.exec("VACUUM");
db.close();
fs.copyFileSync(file, path.join(out, "demo.db"));
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(out, "demo.json"), JSON.stringify({ now: now.toISOString() }));

const size = (fs.statSync(path.join(out, "demo.db")).size / 1048576).toFixed(1);
console.log(`demo: ${counts.visitors} visitors, ${counts.orders} orders, ${size} MB, data up to ${now.toISOString()}`);
