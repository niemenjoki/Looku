// Looku documentation and home page. Built to GitHub Pages; `npm run dev` for a local preview.
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://niemenjoki.github.io",
  base: "/looku",
  redirects: {
    "/guides/try-locally": "/looku/tutorials/try-it/",
    "/fi/guides/try-locally": "/looku/fi/tutorials/try-it/",
  },
  integrations: [
    starlight({
      title: "Looku",
      description: "Cookieless, server-side web analytics that you host yourself.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/looku.css"],
      components: { Footer: "./src/components/Footer.astro" },
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        fi: { label: "Suomi", lang: "fi" },
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/niemenjoki/Looku" }],
      editLink: { baseUrl: "https://github.com/niemenjoki/Looku/edit/master/website/" },
      lastUpdated: true,
      sidebar: [
        {
          label: "Start here",
          translations: { fi: "Aloita tästä" },
          items: ["start-here", "use-cases", "concepts", "comparison"],
        },
        {
          label: "Tutorials",
          translations: { fi: "Oppaat" },
          items: ["tutorials/try-it", "tutorials/home-server", "tutorials/connect-your-site"],
        },
        {
          label: "Install",
          translations: { fi: "Asennus" },
          items: [
            "guides/home-server-cloudflare",
            "guides/vps-caddy",
            "guides/tailscale",
            "guides/without-docker",
          ],
        },
        {
          label: "Connect a site",
          translations: { fi: "Sivuston liittäminen" },
          items: [
            "guides/connect-nextjs",
            "guides/connect-other",
            "guides/consent-and-browser",
            "guides/shop-orders",
            "guides/moving-from-another",
          ],
        },
        {
          label: "Run it",
          translations: { fi: "Ylläpito" },
          items: ["operate/backup-and-update", "operate/troubleshooting"],
        },
        {
          label: "Use the numbers",
          translations: { fi: "Lukujen käyttö" },
          items: ["guides/home-assistant"],
        },
        {
          label: "Reference",
          translations: { fi: "Viite" },
          items: ["reference/settings", "reference/cli", "reference/api", "reference/security"],
        },
        { label: "Privacy and the law", translations: { fi: "Tietosuoja ja laki" }, link: "/privacy/" },
      ],
    }),
  ],
});
