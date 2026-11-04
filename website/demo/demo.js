// Turns the dashboard into the online demo. Loaded before app.js: requests to
// /api/v1 are answered in the browser by demo-api.js, links to /api/v1 (CSV
// export, OpenAPI) are made into files, and a ribbon says the data is invented.
(function () {
  const base = new URL(".", document.currentScript.src).href;
  const realFetch = window.fetch.bind(window);
  const ready = import(base + "demo-api.js").then((m) => m.createDemoApi({ initSqlJs: window.initSqlJs, base, fetch: realFetch }));

  const isApi = (url) => new URL(url, location.href).pathname.includes("/api/v1");

  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    if (!isApi(url)) return realFetch(input, init);
    const handle = await ready;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const answer = handle((init.method || "GET").toUpperCase(), url, body);
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  };

  document.addEventListener("click", async (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || !isApi(link.getAttribute("href"))) return;
    event.preventDefault();
    const handle = await ready;
    const answer = handle("GET", link.getAttribute("href"));
    const file = answer.body.csv !== undefined
      ? new Blob([answer.body.csv], { type: "text/csv" })
      : new Blob([JSON.stringify(answer.body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    if (answer.body.filename) {
      const save = document.createElement("a");
      save.href = url;
      save.download = answer.body.filename;
      save.click();
    } else {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  // ?lang=fi or ?lang=en picks the language. The first visit opens on the
  // last 28 days, where the campaigns and orders show.
  try {
    const lang = new URLSearchParams(location.search).get("lang");
    const saved = JSON.parse(localStorage.getItem("looku") || "{}");
    if (lang === "fi" || lang === "en") saved.lang = lang;
    // build.mjs replaces the version with app.js's DEFAULTS_VERSION.
    if (saved.defaults === undefined) Object.assign(saved, { range: "28d", compare: true, defaults: __DEFAULTS_VERSION__ });
    localStorage.setItem("looku", JSON.stringify(saved));
  } catch {
    // Storage blocked: the browser's language is used.
  }

  // The same order as the dashboard: chosen language, then the browser's.
  let chosen = "";
  try {
    chosen = JSON.parse(localStorage.getItem("looku") || "{}").lang || "";
  } catch {
    chosen = new URLSearchParams(location.search).get("lang") || "";
  }
  const fi = (chosen || navigator.language || "").startsWith("fi");
  document.addEventListener("DOMContentLoaded", () => {
    const docs = fi ? "https://niemenjoki.github.io/looku/fi/" : "https://niemenjoki.github.io/looku/";
    const ribbon = document.createElement("div");
    ribbon.className = "demo-ribbon";
    ribbon.append(
      fi ? "Demo keksityllä datalla. Muutokset häviävät, kun sivu ladataan uudelleen. " : "Demo with made-up data. Changes are gone when you reload. ",
      Object.assign(document.createElement("a"), { href: docs, textContent: fi ? "Asenna Looku" : "Install Looku" }),
    );
    document.body.prepend(ribbon);
  });
})();
