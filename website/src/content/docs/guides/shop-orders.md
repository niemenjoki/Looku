---
title: Shop orders
description: Send orders from your shop to Looku for revenue, best sellers, campaign results and the purchase path.
sidebar:
  order: 4
---

The shop module shows orders, revenue, best sellers and which campaigns brought sales, and a purchase path (how many
visitors went from a product page to the cart and to checkout). Orders come from your shop's server, after payment.

**You need:** a connected site and the `shop` module:

```bash
docker compose run --rm ingest site:modules myblog shop
```

(List every module the site should have, for example `content,shop`.)

## Send an order

In a Next.js or Node.js shop, use `sendOrder` from the connector you copied (`lib/looku.js`), where your order system
confirms a payment. Adjust the import path to where the file is, as in the other guides:

```js
import { sendOrder } from "./lib/looku.js";

await sendOrder({
  id: "1001",
  ts: new Date().toISOString(),
  total: 34.9,
  utm_campaign: "autumn",
  items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }],
});
```

| Field | Required | What |
|---|---|---|
| `id` | yes | your order number |
| `ts` | yes | order time (ISO 8601) |
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

## Earlier orders

Import order history from a file with one order per line (JSON lines), in the same format:

```bash
docker compose run --rm -v "$PWD/orders.jsonl:/tmp/orders.jsonl:ro" ingest orders:import myblog /tmp/orders.jsonl
```

Copy the file to the server's `deploy` folder first, from your own computer:
`scp orders.jsonl you@192.168.1.10:looku/deploy/`. The `-v` part makes the file visible inside the container. You should see
`120 orders imported to myblog.` with your count. If one line is invalid, nothing is imported and the message says
which line.

## Purchase path

In the dashboard, open **Settings** and set the shop's paths: where product pages, the cart and the checkout are (for
example `/products/`, `/cart`, `/checkout`). The purchase path counts visitors who reached each step on the same day.
It does not work if visitors are turned off for the site (`site:visitors <site> off`), because then page views
cannot be linked into visits.
