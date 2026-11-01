# Privacy and the law

This page describes what Looku does technically, so that you can decide how to use it and what to tell your
visitors. **It is not legal advice.** You run Looku on your own server and you are the controller of the data it
collects. Whether your use needs consent, and what your privacy notice must say, depends on your country, your site
and your settings. Looku is provided without warranty (GNU AGPL 3.0, sections 15 and 16; for the connectors, the MIT License).

Every statement under "What Looku does" names the source file where it can be checked.

## What Looku does

**Server-side page views (all visitors).** The connector (`@looku/next`, `@looku/node` or your own) sends the
receiver one record per page request, from your server, not from the browser. The record holds the path, the
referrer, UTM parameters, the IP address, the user agent and, if your platform provides it, the country code.
(`packages/next/src/index.js`, `buildPageview`)

**Nothing is stored in the browser for page views.** No cookie is set and no script is used. The connector reads one
cookie only if you configure it: an opt-out cookie for the site owner (`optOutCookie`). (`packages/next/src/index.js`)

**The IP address and user agent are not stored.** The receiver uses them only to:
- classify the device type, browser family and operating system family, and
- compute the daily visitor hash: SHA-256 of a random salt, the site id, the IP address and the user agent,
  shortened to 16 bytes.
(`packages/engine/src/ingest.js`, `visitor.js`)

**The daily salt.** Each site has one random salt per local day. When the first page view of a new day arrives, the
previous day's salt is deleted. The nightly job also deletes it (after 03:00 in `LOOKU_TIMEZONE`). Deleted data is
overwritten in the database file (`secure_delete`). After that, a stored hash cannot be recomputed from an IP
address, so hashes from different days cannot be linked. Until the salt is deleted, the same day's hashes could be
recomputed by someone with access to the database. `looku backup` leaves the salt out of the copy. If you turn off
the scheduler (`LOOKU_SCHEDULER=0`), run `looku maintain` every night yourself.
(`packages/engine/src/visitor.js`, `maintenance.js`, `db.js`, `cli.js`)

**The visitor hash can be turned off** per site: `looku site:visitors <site> off`. The salt is deleted at once, no
hash is computed after that, and every page view stands alone. Looku then reports page views, referrers and
campaigns, but no visitors, sessions, entry or exit pages, purchase path or conversion. This applies in the
dashboard, the API and the monthly email. (`packages/engine/src/sites.js`, `visitor.js`, `modules/visitors.js`,
`report-email.js`)

**The country can be turned off** per site: `looku site:country <site> off`. (`packages/engine/src/ingest.js`)

**Do Not Track and Global Privacy Control are respected by default.** Page views, and data from the browser
collector, are not recorded from requests with `DNT: 1` or `Sec-GPC: 1`. Known bots (recognised by the user agent)
and prefetches are not recorded either. (`packages/next/src/index.js`)

**Retention.** Single page views, events and reading-time records are kept for 25 months by default
(`looku site:retention`). After that, only daily totals of page views per page and per dimension remain. No totals
are kept of events or reading time. Orders from the shop module are not deleted automatically.
(`packages/engine/src/maintenance.js`)

**Browser collector (`@looku/browser`, optional).** It records reading time, scroll depth and named events. Your site
starts it only after the visitor has consented; asking for consent is your site's job. It stores nothing in the
browser and sends no identifier. Your site's own route forwards the data without the IP address or user agent, and
Looku stores only the day, not the time of day. The records have the page path and, for events, the name and any
`target` and `props` values your site sends. Do not put personal data in them. (`packages/browser/src/index.js`,
`packages/next/src/index.js` `createCollectHandler`, `packages/engine/src/ingest.js`)

**Orders (shop module, optional).** Your shop sends the order id, time, total, products and campaign. Any other field
is dropped. Looku does not link orders to visitors or sessions. In your shop's own system the order id is linked to
the customer. (`packages/engine/src/orders.js`)

**Where the data goes.** Looku stores the data only on your server and sends nothing to its authors. The dashboard
loads no external files. Data passes through other services only if you set them up:
- a tunnel or proxy in front of the receiver (for example Cloudflare), which sees the page views with IP addresses
  on the way;
- a Cloudflare Worker connector;
- the mail server of the monthly email, which receives the monthly summary.
(`packages/ui/public/index.html`, Content-Security-Policy in `packages/engine/src/api/server.js`,
`report-email.js`)

## The open legal question

Two different rules can apply to web analytics in the EU:

1. **The ePrivacy rule on terminal equipment.** This is Directive 2002/58/EC article 5(3); in Finland, the Act on
   Electronic Communications Services 917/2014, section 205. It requires consent for storing information on, or
   gaining access to information in, the visitor's device, unless this is strictly necessary for a service the
   visitor asked for.
2. **The GDPR**, for any processing of personal data. An IP address is usually personal data.

**Server-side page views without the visitor hash** store nothing on the device and send no instruction to it. The
data is what the browser sends anyway to load the page. The European Data Protection Board's Guidelines 2/2023
(version 2, 7 October 2024, paragraphs 32 and 33) describe "gaining access" generally as the party instructing the
device to send information, for example with cookies or JavaScript. Our reading is that article 5(3) does not apply
to this mode. This is our reading, not a ruling, and authorities or courts may see it differently.

**The daily visitor hash** uses the IP address and user agent to recognise the same visitor for one day on one site.
Paragraphs 54 and 55 of the same guidelines say that tracking based only on the IP address can fall under article
5(3) when the IP address comes from the visitor's device. Looku's hash does not track across sites or across days,
but it is close to that description. **It is therefore uncertain whether the daily hash needs consent.** To avoid
that uncertainty, turn the hash off (`looku site:visitors <site> off`).

**The GDPR applies in any case**, because the IP address is processed for a moment. You decide the legal basis.
Sites often use legitimate interest for aggregate statistics, but that requires your own assessment. Your privacy
notice must also describe the processing; the template below can help.

**Changes in the law.** The EU's proposed Digital Omnibus includes an exception for first-party audience
measurement. On 21 October 2026 the Council agreed its negotiating position; the European Parliament had not. As
of that date nothing had changed in the law.

Sources (read 31 October 2026): [EDPB Guidelines 2/2023 v2](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf),
[Act on Electronic Communications Services 917/2014, Finlex](https://www.finlex.fi/fi/lainsaadanto/2014/917).
Check them yourself for changes.

## Privacy notice template

This is a starting point, not a finished text. Adapt it to your settings and your own legal assessment, and remove
the parts you do not use.

> **Visitor statistics.** We count visits to this site with Looku, which runs on our own server. For each page
> request our server records the page, the referring site, campaign parameters, the device type, the browser and
> operating system family [and the country]. Your IP address and browser identifier are used only for a moment to
> derive these [and a visitor code that changes daily and recognises repeat page views within one day] and are not
> stored. No cookies are used for this. Single page views are kept for [25 months], after which only daily totals
> remain. [The page requests pass through [service] on the way to our server.] Legal basis: [your legal basis].
> [With your consent we also measure reading time and scroll depth, without an identifier.] [Orders are recorded
> in the statistics without the customer's name or contact details.]

## Your choices as the site owner

| Setting | Effect |
|---|---|
| `looku site:visitors <site> off` | no visitor hash: no visitors or sessions in reports |
| `looku site:country <site> off` | the country is not stored |
| `looku site:retention <site> <months>` | single page views, events and reading time are deleted sooner |
| leave out `@looku/browser` | no reading time or scroll data |
| `respectDoNotTrack: false` in the connector | not recommended |
