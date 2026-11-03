// Looku browser collector: reading time, scroll depth and named events from
// visitors who consented. Call start() only after consent. It stores nothing
// in the browser and sends no identifier: the site's own route
// (createCollectHandler in @looku/next) signs the data and forwards it to
// Looku without the IP address, so the data cannot be linked to a visitor.

let endpoint = "/api/looku";
let on = false;
let path = "";
let shown = null;
let visible = 0;
let scroll = 0;
let sent = false;
let original;
let wrapper = null;

function post(data) {
  const body = JSON.stringify(data);
  try {
    if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) return;
  } catch {}
  fetch(endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
}

function measureScroll() {
  const doc = document.documentElement;
  const height = doc.scrollHeight - innerHeight;
  const pct = height > 0 ? Math.round(((scrollY || doc.scrollTop) / height) * 100) : 100;
  if (pct > scroll) scroll = Math.min(pct, 100);
}

function begin() {
  path = location.pathname;
  visible = 0;
  scroll = 0;
  sent = false;
  shown = document.visibilityState === "visible" ? Date.now() : null;
  measureScroll();
}

// One measurement per page view: it ends when the page is hidden or left.
function finish() {
  if (sent || !on) return;
  if (shown !== null) visible += Date.now() - shown;
  shown = null;
  sent = true;
  post({ type: "engagement", path, dwell_ms: visible, max_scroll_pct: scroll });
}

function onVisibility() {
  if (document.visibilityState === "hidden") finish();
  // A page opened in a background tab starts timing when first shown.
  else if (!sent && shown === null) shown = Date.now();
}

function onNavigate() {
  if (location.pathname === path) return;
  finish();
  begin();
}

export function start(options = {}) {
  if (on || typeof window === "undefined") return;
  if (options.endpoint) endpoint = options.endpoint;
  on = true;
  begin();
  addEventListener("scroll", measureScroll, { passive: true });
  addEventListener("visibilitychange", onVisibility);
  addEventListener("pagehide", finish);
  addEventListener("popstate", onNavigate);
  // Client-side navigation in single-page apps (Next.js, React Router).
  // Each wrapper calls the function it replaced and measures only while it is
  // the current one, so a wrapper left in another script's chain does nothing.
  const previous = history.pushState;
  original = previous;
  wrapper = function pushState(...args) {
    const result = previous.apply(this, args);
    if (wrapper === pushState) onNavigate();
    return result;
  };
  history.pushState = wrapper;
}

// Ends the current measurement and stops, e.g. when consent is withdrawn.
export function stop() {
  if (!on) return;
  finish();
  on = false;
  removeEventListener("scroll", measureScroll);
  removeEventListener("visibilitychange", onVisibility);
  removeEventListener("pagehide", finish);
  removeEventListener("popstate", onNavigate);
  // Another script (e.g. the Next.js router) may have wrapped pushState after
  // us; restoring the original would drop its wrapper, so ours stays inactive.
  if (history.pushState === wrapper) history.pushState = original;
  wrapper = null;
}

// Named event, e.g. event("add_to_cart", { items: [{ sku: "A1", quantity: 1 }] }).
export function event(name, { target, value, items, props } = {}) {
  if (!on) return;
  post({ type: "event", name, path: location.pathname, target, value, items, props });
}
