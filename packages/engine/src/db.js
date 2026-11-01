import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export function openDatabase(file, { readonly = false } = {}) {
  if (!readonly && file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const db = new Database(file, { readonly, fileMustExist: readonly });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

export function migrate(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    if (applied.has(name)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      ).run(name, new Date().toISOString());
    })();
  }
}
