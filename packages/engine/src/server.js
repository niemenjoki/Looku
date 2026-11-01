import http from "node:http";

import { createIngest, IngestError } from "./ingest.js";
import { createOrderIngest } from "./orders.js";
import {
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  SITE_HEADER,
  verifySignature,
} from "./signature.js";

// Orders carry up to 100 items, so they get a larger limit.
const MAX_BODY_BYTES = { "/ingest": 8 * 1024, "/orders": 64 * 1024 };
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REPLAY_ENTRIES = 100_000;

function send(res, status, message = "") {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Each signature is accepted once. Entries are kept for twice the timestamp
// tolerance, after which the timestamp check rejects the request anyway.
function createReplayGuard(now) {
  const seen = new Map();
  const ttlMs = 2 * SIGNATURE_TOLERANCE_SECONDS * 1000;

  function release(key) {
    seen.delete(key);
  }

  function firstUse(key) {
    const time = now().getTime();
    if (seen.size >= MAX_REPLAY_ENTRIES) {
      for (const [entry, expires] of seen) {
        if (expires <= time) {
          seen.delete(entry);
        }
      }
    }
    const expires = seen.get(key);
    if (expires && expires > time) {
      return false;
    }
    seen.set(key, time + ttlMs);
    return true;
  }

  return { firstUse, release };
}

// The internet-facing receiver: POST /ingest for page views, events and
// engagement, POST /orders for a shop adapter. It only writes: there are no read routes in
// this process, and request bodies (which carry IP addresses) are never logged.
export function createIngestServer(db, { now = () => new Date() } = {}) {
  const handlers = { "/ingest": createIngest(db), "/orders": createOrderIngest(db) };
  const getSite = db.prepare("SELECT * FROM sites WHERE site_id = ?");
  const replay = createReplayGuard(now);

  async function handle(req, res) {
    // The path is read without URL parsing: some request targets that Node's
    // HTTP parser accepts are rejected by the URL constructor.
    const path = String(req.url || "").split("?")[0];

    if (path === "/healthz" && req.method === "GET") {
      send(res, 200, "ok");
      return;
    }
    if (!Object.hasOwn(handlers, path)) {
      send(res, 404);
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      send(res, 405);
      return;
    }
    const maxBytes = MAX_BODY_BYTES[path];
    if (Number(req.headers["content-length"]) > maxBytes) {
      // The rest of the body is drained, bounded by the request timeout, so
      // the 413 response reaches the client.
      res.setHeader("Connection", "close");
      send(res, 413);
      req.resume();
      return;
    }

    let body;
    try {
      body = await readBody(req, maxBytes);
    } catch (error) {
      res.setHeader("Connection", "close");
      send(res, error.status || 400);
      return;
    }

    const signature = String(req.headers[SIGNATURE_HEADER] || "");
    const site = getSite.get(String(req.headers[SITE_HEADER] || ""));
    if (
      !site ||
      !verifySignature(site.signing_key, body, signature, now().getTime())
    ) {
      send(res, 401);
      return;
    }
    const replayKey = `${site.site_id}:${signature}`;
    if (!replay.firstUse(replayKey)) {
      send(res, 409);
      return;
    }

    try {
      handlers[path](site, JSON.parse(body), now());
      send(res, 202);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof IngestError) {
        send(res, 400, error instanceof IngestError ? error.message : "");
        return;
      }
      // A failed write may be retried with the same signature.
      replay.release(replayKey);
      console.error(`ingest failed for site ${site.site_id}: ${error.name}`);
      send(res, 500);
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(`request failed: ${error?.name || "Error"}`);
      send(res, 500);
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  return server;
}
