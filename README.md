# salsa-pos

A phone-friendly point-of-sale page for the S.A.L.S.A. pipeline. Each sale is
appended as one row to the ETL pipeline's source CSV
(`etl-pipeline-microservice-setup/data/transactions.csv`). The ETL extractor
picks new rows up on its next run, every 30 seconds by default.

The page is published to your tailnet with Tailscale Serve, so any device
signed in to your Tailscale account can open it over HTTPS. Nothing is exposed
to the LAN or the public internet.

```
phone (tailnet) ──HTTPS──▶ tailscale serve ──▶ salsa-pos 127.0.0.1:3100 ──append──▶ transactions.csv ──▶ ETL extractor
```

No npm dependencies. Needs Node.js 22 or newer.

## Setup

salsa-pos must run on the same machine as the ETL, because it writes to the
ETL's CSV file.

```bash
cp .env.example .env    # CSV_PATH points at the sibling ETL project by default
npm test
npm start               # salsa-pos listening on http://127.0.0.1:3100
```

Open http://127.0.0.1:3100 to check it locally.

## Publish it on your tailnet

```bash
npm run serve:on        # tailscale serve --bg 3100
npm run serve:status    # shows the https://<machine>.<tailnet>.ts.net URL
```

Open that URL on your phone (with the Tailscale app connected). The setting
survives reboots. To stop publishing: `npm run serve:off`.

If Tailscale says you need operator access, run once:
`sudo tailscale set --operator=$USER`.

Do not use `tailscale funnel` for this. Funnel makes the page public, and the
page has no login.

## Keep it running

`npm start` stops when the terminal closes. To run it as a background service
that restarts on failure and on login:

```bash
mkdir -p ~/.config/systemd/user
cp salsa-pos.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now salsa-pos
journalctl --user -u salsa-pos -f     # logs
```

To keep it running while you are logged out, enable lingering once:
`sudo loginctl enable-linger $USER`.

## Using the page

1. Pick the store and cashier. The page remembers them on that phone.
2. Tap **+** on each item sold.
3. Pick the payment method and enter a discount in pesos if there is one.
4. Tap **Add sale**. The page shows the new id (for example `SALSA-TX-00121`)
   and the sale appears under **Recent sales**.

## What gets written

One row per sale, in the CSV's own column order:

| Column | Value |
|---|---|
| `id` | Next number after the highest `SALSA-TX-` id in the file |
| `timestamp` | Server time, ISO 8601 UTC |
| `amount` | Σ(qty × unit price) − discount, computed on the server |
| `currency` | `PHP` |
| `store_id`, `cashier_id`, `payment_method` | From the page, checked against `src/catalog.js` |
| `discount` | Pesos, 2 decimals |
| `items` | JSON array of `{ sku, name, qty, unit_price }` |

Prices come from `src/catalog.js`; the page sends only SKUs and quantities.
Edit that file to change products, prices, stores or cashiers, then restart.

## Checks

The server applies the same rules as the ETL transformer, so a saved sale is
never rejected by the pipeline. `npm test` includes a test that runs saved
rows through the ETL's own extractor and transformer when the ETL project is
next to this one.

- Store, cashier and payment method must be in the catalog.
- 1–50 item lines, each a known SKU with a whole-number quantity of 1–999.
  Repeated SKUs are merged into one line.
- The request can't include prices or amounts.
- The discount must be a peso amount with at most 2 decimals, not more than
  the subtotal.
- The CSV must exist with the ETL's header. salsa-pos never creates it, so a
  wrong `CSV_PATH` fails instead of writing somewhere the ETL doesn't read.
- salsa-pos stops adding sales when the CSV reaches 5,000 rows, the most the
  ETL accepts. Move older rows to another file to continue.
- Sales are written one at a time, each as a single append, so ids never
  collide and the ETL never reads half a row.

## API

| Method | Path | Body / query | Response |
|---|---|---|---|
| `GET` | `/` | | The POS page |
| `GET` | `/api/catalog` | | Products, stores, cashiers, payment methods |
| `GET` | `/api/sales` | `?limit=1-50` (default 10) | `{ sales: [...] }`, newest first |
| `POST` | `/api/sales` | `{ store_id, cashier_id, payment_method, discount?, items: [{ sku, qty }] }` | `201 { sale }` |
| `GET` | `/health` | | `{ status: "ok", csv_rows }` |

Errors: `{ "error": { "code", "message" } }`, with status 400 (bad input), 413
(body over 16 KB), 404, 405, or 503 (CSV missing or unreadable).
