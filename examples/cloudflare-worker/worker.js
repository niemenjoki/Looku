// Looku in front of a static site on Cloudflare (Workers or Pages
// Functions). The page view is sent only after a successful HTML response,
// in the background, so the page is never slowed down.
// Settings (wrangler secrets / variables): LOOKU_ENDPOINT, LOOKU_SITE_ID,
// LOOKU_SIGNING_KEY. Copy @looku/next's src/index.js next to this file.
import { buildPageview, sendToLooku } from "./looku-next.js";

export default {
  async fetch(request, env, ctx) {
    const response = await (env.ASSETS ? env.ASSETS.fetch(request) : fetch(request));
    const type = response.headers.get("content-type") || "";
    const revalidated = response.status === 304 && (request.headers.get("accept") || "").includes("text/html");
    if ((response.ok && type.includes("text/html")) || revalidated) {
      // Cloudflare sets cf-connecting-ip itself, so only that header is trusted.
      const payload = buildPageview(request, { ipHeaders: ["cf-connecting-ip"] });
      if (payload) {
        ctx.waitUntil(sendToLooku(payload, {
          endpoint: env.LOOKU_ENDPOINT,
          siteId: env.LOOKU_SITE_ID,
          signingKey: env.LOOKU_SIGNING_KEY,
        }));
      }
    }
    return response;
  },
};
