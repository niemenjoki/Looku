# Looku demo site

A small Next.js site for trying Looku end to end before using it on a real site.

1. Start Looku (see the main README or `deploy/compose.yaml`) and add the site:
   `looku site:add demo --domain <your domain>`, then `looku site:modules demo content`.
2. Copy `.env.example` to `.env.local` and fill in the endpoint, site id and the signing key.
3. `npm install`, `npm run build` and `npm start` (page views are sent in production mode only).
4. Browse the site, accept measurement in the footer, scroll the guide page, and open the Looku dashboard.

What to check: page views and the campaign link appear in the dashboard; reading time appears only after "Salli";
nothing is stored in the browser by Looku (the consent choice is the demo site's own).
