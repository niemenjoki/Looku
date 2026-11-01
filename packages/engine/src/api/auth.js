import crypto from "node:crypto";

// API keys, the dashboard password and dashboard login sessions.

const TOKEN_PREFIX = "lk_";
const TOKEN_PATTERN = /^lk_[A-Za-z0-9_-]{43}$/;
const PASSWORD_KEY = "admin_password";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createToken(db, { name, scope = "read", siteId = null }) {
  if (!name) {
    throw new Error("A key needs a name.");
  }
  if (!["read", "admin"].includes(scope)) {
    throw new Error("scope must be read or admin.");
  }
  if (siteId && !db.prepare("SELECT 1 FROM sites WHERE site_id = ?").get(siteId)) {
    throw new Error(`Unknown site: ${siteId}`);
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO api_tokens (name, token_hash, scope, site_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(String(name).slice(0, 100), sha256(token), scope, siteId || null, new Date().toISOString());
  return { id: Number(lastInsertRowid), token };
}

export function listTokens(db) {
  return db
    .prepare("SELECT id, name, scope, site_id, created_at, last_used_day FROM api_tokens ORDER BY id")
    .all();
}

export function revokeToken(db, id) {
  return db.prepare("DELETE FROM api_tokens WHERE id = ?").run(Number(id)).changes > 0;
}

// Returns { id, scope, site_id } or null. The lookup is by hash, so the time
// taken does not depend on how much of a guessed key is right.
export function findToken(db, token) {
  if (!TOKEN_PATTERN.test(String(token || ""))) {
    return null;
  }
  return (
    db.prepare("SELECT id, scope, site_id FROM api_tokens WHERE token_hash = ?").get(sha256(token)) ||
    null
  );
}

export function setPassword(db, password) {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("The password must be at least 10 characters.");
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  const value = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(PASSWORD_KEY, value);
}

export function hasPassword(db) {
  return Boolean(db.prepare("SELECT 1 FROM meta WHERE key = ?").get(PASSWORD_KEY));
}

export function checkPassword(db, password) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(PASSWORD_KEY);
  if (!row || typeof password !== "string" || password.length > 1024) {
    return false;
  }
  const [kind, N, r, p, salt, hash] = row.value.split("$");
  if (kind !== "scrypt") {
    return false;
  }
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Login sessions live in memory: a restart logs everyone out.
export function createSessionStore({ ttlMs = 7 * 24 * 3600 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map();

  function prune() {
    const time = now();
    for (const [id, expires] of sessions) {
      if (expires <= time) {
        sessions.delete(id);
      }
    }
  }

  return {
    ttlMs,
    create() {
      prune();
      const id = crypto.randomBytes(32).toString("base64url");
      sessions.set(id, now() + ttlMs);
      return id;
    },
    valid(id) {
      const expires = sessions.get(String(id || ""));
      return Boolean(expires && expires > now());
    },
    destroy(id) {
      sessions.delete(String(id || ""));
    },
  };
}

// Failed logins per client address: at most `limit` in `windowMs`, and at
// most `globalLimit` from all addresses together, so rotating addresses does
// not help and the map stays bounded.
export function createLoginLimiter({ limit = 10, globalLimit = 200, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const failures = new Map();
  let all = [];

  function recentAll() {
    const time = now();
    all = all.filter((t) => t > time - windowMs);
    return all;
  }

  function recent(key) {
    const time = now();
    const list = (failures.get(key) || []).filter((t) => t > time - windowMs);
    if (list.length) {
      failures.set(key, list);
    } else {
      failures.delete(key);
    }
    return list;
  }

  return {
    blocked: (key) => recent(key).length >= limit || recentAll().length >= globalLimit,
    fail(key) {
      recentAll().push(now());
      if (failures.size >= globalLimit && !failures.has(key)) {
        return;
      }
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
    reset: (key) => failures.delete(key),
  };
}
