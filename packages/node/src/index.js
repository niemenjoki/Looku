// Looku connector for Node.js http servers and Express. It uses the same
// rules as the Next.js connector (bots, prefetch, Do Not Track, files) and
// records a page view only after a successful HTML response (or a 304 for a
// revalidated page), so missing pages (404) and errors are not counted.
import { buildPageview, sendToLooku } from "@looku/next";

const CLIENT_HEADER = "x-looku-client-ip";

// The visitor's address goes into one internal header that the connector
// reads; every client address header the visitor could forge is removed.
// trustProxy = N: the Nth X-Forwarded-For entry from the right (N reverse
// proxies, each appending the address it saw). Without it: the socket
// address. With your own ipHeaders (e.g. ["cf-connecting-ip"] behind
// Cloudflare) those are trusted as such.
function toRequest(req, options) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  if (!options.ipHeaders) {
    const hops = options.trustProxy === true ? 1 : Number(options.trustProxy) || 0;
    const forwarded = String(headers.get("x-forwarded-for") || "").split(",").map((e) => e.trim()).filter(Boolean);
    const ip = hops > 0 ? (forwarded.length >= hops ? forwarded[forwarded.length - hops] : "") : String(req.socket?.remoteAddress || "");
    for (const name of ["cf-connecting-ip", "x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) headers.delete(name);
    headers.set(CLIENT_HEADER, ip.replace(/^::ffff:(?=\d+\.)/, ""));
  }
  return { method: req.method, url: `http://${headers.get("host") || "localhost"}${req.originalUrl || req.url}`, headers };
}

// A page view is a successful HTML response, or 304 Not Modified for a
// conditional request (the browser revalidating a cached page).
function counts(req, res, contentType) {
  if (res.statusCode >= 200 && res.statusCode < 300) {
    return contentType.includes("text/html");
  }
  const conditional = req.headers["if-none-match"] || req.headers["if-modified-since"];
  return res.statusCode === 304 && Boolean(conditional) && String(req.headers.accept || "").includes("text/html");
}

/**
 * Express or Connect middleware:
 *
 *   app.use(lookuMiddleware({ trustProxy: true }));
 *
 * Options as in @looku/next (endpoint, siteId, signingKey, excludePaths,
 * ipHeaders, ...), plus trustProxy: the number of reverse proxies in front
 * (true = 1); only then is X-Forwarded-For read.
 */
export function lookuMiddleware(options = {}) {
  const env = options.env || process.env;
  const enabled = options.enabled ?? env.NODE_ENV === "production";
  const send = {
    endpoint: options.endpoint ?? env.LOOKU_ENDPOINT,
    siteId: options.siteId ?? env.LOOKU_SITE_ID,
    signingKey: options.signingKey ?? env.LOOKU_SIGNING_KEY,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  };
  return function looku(req, res, next) {
    if (enabled) {
      let payload = null;
      try {
        payload = buildPageview(toRequest(req, options), { ...options, ipHeaders: options.ipHeaders || [CLIENT_HEADER] });
      } catch {
        payload = null;
      }
      if (payload) {
        // Headers given to writeHead() are not visible through getHeader().
        let headType = "";
        const writeHead = res.writeHead;
        if (typeof writeHead === "function") {
          res.writeHead = function (status, ...args) {
            const headers = args.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
            for (const [name, value] of Object.entries(headers || {})) {
              if (name.toLowerCase() === "content-type") headType = String(value);
            }
            return writeHead.call(this, status, ...args);
          };
        }
        res.once("finish", () => {
          const type = String(res.getHeader("content-type") || headType || "");
          if (counts(req, res, type)) {
            sendToLooku(payload, send);
          }
        });
      }
    }
    next?.();
  };
}

/** For a plain http server: call at the start of the request handler. */
export function trackNodeRequest(req, res, options = {}) {
  lookuMiddleware(options)(req, res);
}
