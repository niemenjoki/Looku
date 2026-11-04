import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import decodeStoredPaths from "./migrations/007_decoded_paths.js";
import removeBots from "./migrations/008_bot_rules.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// Migrations that need code instead of SQL, run in name order with the SQL files.
const CODE_MIGRATIONS = {
  "007_decoded_paths.js": decodeStoredPaths,
  "008_bot_rules.js": removeBots,
};

export function openDatabase(file, { readonly = false } = {}) {
  if (!readonly && file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const db = new Database(file, { readonly, fileMustExist: readonly });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    // Deleted rows (old salts) are overwritten, not left in free pages.
    db.pragma("secure_delete = ON");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

// Two processes may start on a new database at the same time, so each
// migration is checked again inside a write transaction.
export function migrate(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") || Object.hasOwn(CODE_MIGRATIONS, name))
    .sort();
  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");

  for (const name of files) {
    if (isApplied.get(name)) {
      continue;
    }
    db.transaction(() => {
      if (isApplied.get(name)) {
        return;
      }
      if (Object.hasOwn(CODE_MIGRATIONS, name)) {
        CODE_MIGRATIONS[name](db);
      } else {
        db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
      }
      db.prepare(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      ).run(name, new Date().toISOString());
    }).immediate();
  }
}
