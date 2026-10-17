# Joomni for Google Sheets

Keep your Joomni **orders** and **enquiries** in a Google Sheet, updated every 15 minutes. No server, no code to host: it runs as an Apps Script inside your spreadsheet.

[![ci](https://github.com/joomni225/joomni-google-sheets/actions/workflows/ci.yml/badge.svg)](https://github.com/joomni225/joomni-google-sheets/actions/workflows/ci.yml)

- **Orders** tab: one row per order with status, payment, customer, phone, city, line items and totals
- **Leads** tab: one row per enquiry from your contact forms
- **Sync log** tab: what each run did
- New rows are added and existing rows updated in place, matched on the Joomni id, so nothing is ever duplicated
- Your own columns (notes, "called?", follow-up date) are never overwritten

## Install (5 minutes, no coding)

1. **Create an API key.** In your Joomni dashboard open **Settings › API & Webhooks › API keys** and create a key with the scopes `store:read`, `orders:read` and `leads:read`. Copy it; you'll see it only once.
2. **Open a new Google Sheet** and choose **Extensions › Apps Script**.
3. **Add the files.** In the Apps Script editor:
   - Replace the contents of `Code.gs` with [`src/Code.js`](src/Code.js).
   - Click **+ › Script** three times and create `Sync`, `Api` and `Mapping`; paste [`src/Sync.js`](src/Sync.js), [`src/Api.js`](src/Api.js) and [`src/Mapping.js`](src/Mapping.js).
   - Click **+ › HTML**, name it `Setup`, and paste [`src/Setup.html`](src/Setup.html).
   - Save (Ctrl/⌘ + S).
4. **Reload the spreadsheet.** A **Joomni** menu appears. Choose **Joomni › Connect store…**, paste your key and click **Connect**. Google asks you to authorise the script the first time; it needs to read the spreadsheet, call the Joomni API, and run on a schedule.
5. Choose **Joomni › Import full history** once, then **Joomni › Turn on auto-sync**.

### Install with clasp (developers)

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # paste your script's ID (Apps Script › Project settings)
clasp push
```

## The menu

| Item | What it does |
|---|---|
| **Connect store…** | Checks your key against Joomni and saves it |
| **Sync now** | Adds new and updates recent orders and enquiries (the newest 200 of each) |
| **Import full history** | Pages through everything. Big stores continue by themselves in the background; watch the Sync log |
| **Turn on auto-sync** | Runs **Sync now** every 15 minutes |
| **Turn off auto-sync** | Stops the schedule |
| **Disconnect** | Stops the schedule and removes the key. Rows stay |

## Columns

**Orders:** Order · Date · Status · Payment · Fulfilment · Channel · Customer · Email · Phone · City · Province · Items · Subtotal · Shipping · Discount · Total · Payment method · Discount codes · Note · Source · Updated · Order ID

**Leads:** Date · Name · Email · Phone · Subject · Message · Status · Priority · Source · Tags · Updated · Lead ID

- Columns are matched by their **header**, so you can reorder them. Don't rename them or the ID columns.
- Add your own columns anywhere. The sync never writes to them.
- Rows are sorted newest first after every sync, so put formulas that point at these tabs on a separate tab.
- To add or change a column, edit [`src/Mapping.js`](src/Mapping.js). The next sync adds new headers on the right.

## How it works, and why not webhooks

Every run asks the [Joomni REST API](https://joomni.com/documentation/developers/rest-api) for the newest pages of orders and leads and upserts them by id.

It pulls rather than receiving webhooks on purpose:

- Apps Script web apps **can't read request headers**, so they can't verify Joomni's webhook signature. An unverified endpoint would accept fake orders from anyone who found the URL.
- Webhooks aren't retried yet. A scheduled pull never loses an event, and it also catches status changes (paid, dispatched, cancelled) on recent orders.

If you need real-time rows, run a small verified webhook receiver from [joomni-api-examples](https://github.com/joomni225/joomni-api-examples) that writes to the sheet.

## Limits

- **Sync now** and auto-sync look at the newest 200 orders and 200 leads. A status change on an older order appears after **Import full history**.
- Line items come from a separate request per order. Each run fetches them for up to 60 new orders; the rest fill in on the next runs.
- The API allows 120 requests a minute per key. The script waits and retries when Joomni says to slow down.
- Apps Script stops a run after 6 minutes. The full import stops at 4½ minutes and continues a minute later.

## Security

- The API key is kept in **User Properties**: only the Google account that connected can read it. Other editors of the sheet can use the menu but can't see the key, and auto-sync runs as the account that turned it on.
- The key only needs read scopes. Revoke it any time in Joomni; the sync logs "key rejected" and stops.
- Text that starts with `=`, `+`, `-` or `@` is written as plain text, so a customer's name or message can never run as a formula.
- Anyone you share the spreadsheet with sees your customers' names, emails and phone numbers. Share it accordingly.

## Troubleshooting

| Sync log says | Fix |
|---|---|
| `key rejected (revoked or mistyped): reconnect` | Create a new key and use **Connect store…** again |
| `key lacks the orders:read scope` | Edit the key's scopes in Joomni, or create a new one |
| `Another sync is running` | A manual sync met auto-sync. It runs again on the next schedule |
| Items column blank on some rows | They fill in on the next runs (60 per run) |

## Development

```bash
npm test          # column mapping tests (Node 18+, no dependencies)
npm run check     # syntax check of every script file
```

`src/Mapping.js` holds only pure functions, so it runs in Node as well as Apps Script.

## Related

- [joomni-api-examples](https://github.com/joomni225/joomni-api-examples): API clients and webhook receivers in JavaScript, Python and PHP
- [joomni-nextjs-commerce](https://github.com/joomni225/joomni-nextjs-commerce): a headless Next.js storefront for Joomni

## License

MIT
