---
title: Shop orders
description: Send orders from your shop to Looku for revenue, best sellers, campaign results and the purchase path.
sidebar:
  order: 4
---

The shop module shows orders, revenue, best sellers and a purchase path (how many visitors went from a product page
to the cart and to checkout). With the campaigns module also on, it shows which campaigns brought sales. Orders come
from your shop's server, after payment.

**You need:** a connected site (see [Connect a Next.js site](/looku/guides/connect-nextjs/)) and the `shop` module.
`site:modules` sets the whole list of modules, so name every module the site should have. Check the current ones
first with `docker compose run --rm ingest site:list` (the `modules_json` column). For shop and campaign results:

```bash
docker compose run --rm ingest site:modules myblog shop,campaigns
```

You should see `Modules of myblog: perus, shop, campaigns`. `perus` is the basic module, shown as **Core** in the dashboard; it is always on.

## Send an order

Use `sendOrder` from the connector you copied (`lib/looku.js`) in your shop's server code, at the point where your
order system confirms a payment, for example in the route that receives your payment provider's webhook. It uses the
same three settings (`LOOKU_ENDPOINT`, `LOOKU_SITE_ID`, `LOOKU_SIGNING_KEY`) as page views, so you do not pass the
key yourself. It returns `true` when Looku accepted the order.

A complete example in Next.js: a route file `app/api/order-paid/route.js`. `@/` means the project root folder; it
works when your project has the import alias `@/*` (projects made with `create-next-app` have it). Without the alias,
write the path from this file to `lib`, here `../../../lib/looku.js`.

```js
import { sendOrder } from "@/lib/looku.js";

export async function POST(request) {
  // Check here that the request really comes from your payment provider,
  // as its documentation says, and read the order from it.
  const ok = await sendOrder({
    id: "1001",
    ts: new Date().toISOString(),
    total: 34.9,
    utm_campaign: "autumn",
    items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }],
  });
  return Response.json({ ok });
}
```

In a real shop, take the values from the order instead of the fixed ones above.

| Field | Required | What |
|---|---|---|
| `id` | yes | your order number |
| `ts` | yes | order time (ISO 8601), not in the future |
| `total` | yes | total in your currency |
| `items` | no | up to 100 products; each needs `sku` and a positive `quantity`, and may have `name` and `price` |
| `utm_campaign` | no | the campaign the customer came from, if your shop keeps it |
| `status` | no | `"cancelled"` removes the order; then only `id` is needed |

Looku stores only these fields and drops everything else, so personal data that your shop might pass along (names,
addresses, emails) is never stored. Orders are not linked to visitors.

- **Send the same id again** to replace an order, for example after a change.
- **Cancel:** `await sendOrder({ id: "1001", status: "cancelled" })` removes it.
- Like page views, orders are sent only in production. Another language: send `POST /orders` with the same
  signature as in [Your own connector](/looku/guides/connect-other/#your-own-connector).

**Check:** open the shop view in the dashboard, or ask the [read API](/looku/reference/api/) for
`reports/shop/summary`. The order appears within a few seconds.

## Earlier orders

Import order history from a file with one order per line (JSON lines), in the same format. For example
`orders.jsonl`:

```
{"id":"901","ts":"2026-09-14T10:20:00Z","total":25.5,"items":[{"sku":"A1","quantity":1}]}
{"id":"902","ts":"2026-09-20T15:05:00Z","total":51,"utm_campaign":"autumn"}
```

Copy the file to the server's `deploy` folder first, from your own computer (if Looku is somewhere else than
`~/looku`, change the path): `scp orders.jsonl you@192.168.1.10:looku/deploy/`. Then, in the `deploy` folder:

```bash
docker compose run --rm -v "$PWD/orders.jsonl:/tmp/orders.jsonl:ro" ingest orders:import myblog /tmp/orders.jsonl
```

The `-v` part makes the file visible inside the container. You should see `2 orders imported to myblog.` with your
count. If one line is invalid, nothing is imported and the message says which line, for example
`Line 2: ts must be an ISO 8601 time, not in the future.`

Imported orders have no visits, so the conversion rate (orders per visit) of those days looks too high.

## Purchase path

In the dashboard, open **Settings** and set the shop's paths: where product pages, the cart and the checkout are (for
example `/products/`, `/cart`, `/checkout`). The purchase path counts visitors who reached each step on the same day.
It does not work if visitors are turned off for the site (`site:visitors <site> off`), because then page views
cannot be linked into visits.

The same settings page has the shop's **Currency**, which the dashboard uses for sales. The **Conversion, 7-day
rolling** card shows conversion over time: at each day, the orders of the previous seven days divided by their
sessions. The window starts no earlier than the first day with sessions, so the first points use one day, then two,
up to seven, and orders imported from before Looku recorded sessions are not divided by sessions they never had. To put orders and conversion in the top row of the dashboard, choose the **Shop** view, or **Edit view**.
