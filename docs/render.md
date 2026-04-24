# Deploy MegaLeadsAI enrich API on Render

This service lives in `server/`. It exposes a small JSON API used by the Chrome extension dashboard (via the MV3 background worker) to rescore emails deterministically, optionally call OpenAI for signal-based segments, and optionally verify addresses.

## 1. Create a Web Service

1. In [Render](https://render.com), create a **Web Service** connected to this repository (or deploy from your fork).
2. **Root directory**: `server`
3. **Runtime**: Node 20+
4. **Build command**: `npm install`
5. **Start command**: `npm start` (runs `node index.js`)
6. **Health check path**: `/health` (or `/` — both return the same JSON `200`)

## 2. Environment variables

You need **two different secrets** on Render (do not replace one with the other):

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | Set by Render | Listen port (defaults to `3000` locally). |
| `NODE_ENV` | Recommended | `production` on Render. |
| `MEGALEADS_API_KEY` | **Yes** | **Your own** random string (e.g. 32+ chars). The extension sends `Authorization: Bearer <this>`. Must match `apiKey` in `scripts/leadflow-remote-config.js`. **Not** the OpenAI key. |
| `OPENAI_API_KEY` | Yes if LLM on | OpenAI’s key (`sk-…` / `sk-proj-…`). Used **only** inside this service to call OpenAI. Never put this value in the extension. |
| `OPENAI_MODEL` | Optional | Default `gpt-4o-mini`. |
| `EMAIL_VERIFICATION_API_KEY` | Optional | Used when `options.verify === true`. |
| `EMAIL_VERIFICATION_PROVIDER` | Optional | `zerobounce` enables a basic ZeroBounce `v2/validate` integration; other values are ignored until wired. |
| `LEADFLOW_MAX_LEADS_PER_REQUEST` | Optional | Cap per request (default `75`, hard max `200`). |
| `LEADFLOW_LOG_LEVEL` | Optional | `info`, `warn`, or `error` (reduces console noise). |
| `MEGALEADS_FETCH_TOOL_MAX_ROUNDS` | Optional | When **FETCH_URL** is on, the server issues **new browser fetches** only while `toolRound <` this value (default `6`, cap `24`). When the cap is reached, the next request is finalized in **one** OpenAI call (no tool loop), then the batch returns. Raise this for deeper crawling (slower). |
| `MEGALEADS_FETCH_TOOL_MAX_URLS_PER_ROUND` | Optional | Max URLs the model may request per round before the rest are answered with “skipped” (default `5`, cap `12`). |
| `MEGALEADS_FETCH_TOOL_MAX_PER_LEAD` | Optional | Max browser fetches **per username** per enrich batch across all rounds (default `2`, cap `8`). Extra `fetch_url` calls are prefilled as skipped. |
| `MEGALEADS_FETCH_TOOL_MAX_OPENAI_TOOL_CHARS` | Optional | For **FETCH_URL**, max characters per **recent** tool result sent to OpenAI after HTML stripping (default `26000`, cap `100000`). Older tool rounds are condensed further. |
| `MEGALEADS_FETCH_TOOL_OPENAI_FULL_DETAIL_LAST_TOOLS` | Optional | How many **most recent** `fetch_url` tool messages use the full OpenAI char budget (default `2`, cap `8`). |

### Stripe (subscription checkout from the extension)

| Variable | Required | Purpose |
|----------|----------|---------|
| `STRIPE_SECRET_KEY` | For Checkout API | Server creates Checkout Sessions (`sk_live_…` / `sk_test_…`). |
| `STRIPE_PRICE_ID` | For Checkout API | Recurring **price** id for the unlimited plan (`price_…`). |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Verifies `POST /v1/stripe/webhook` (`whsec_…`). |
| `STRIPE_PRODUCT_ID` | Optional | Stored in Checkout `metadata` for your own bookkeeping (not required by Stripe for checkout). |
| `PUBLIC_BASE_URL` | Recommended | Public **https** origin with **no** trailing slash, e.g. `https://megaleads.onrender.com`. Used for success/cancel URLs. On Render you can often rely on **`RENDER_EXTERNAL_URL`** instead if you do not set `PUBLIC_BASE_URL`. |
| `DATABASE_URL` | Recommended | Postgres URL for persistent account-level free-tier usage ledger (`POST /v1/free-tier/status`) and the **free** column in `POST /v1/admin/subscribers`. |
| `MEGALEADS_DATABASE_URL` | Optional | **Takes precedence over `DATABASE_URL`.** Use this when your host already defines `DATABASE_URL` for another app (for example MegaMix) so MegaLeads reads and writes `account_email_usage` only on the **Mega Leads** database. |

**Paid** rows on the admin dashboard come from Stripe. If the same Stripe account also bills another product, set **`STRIPE_PRICE_ID`** to the Mega Leads subscription price: only subscriptions that include that price are listed as paid.

In the Stripe Dashboard, add a webhook endpoint: `https://<your-service-host>/v1/stripe/webhook` and subscribe at least to `checkout.session.completed`. Deploy after `npm install` in `server/` so the `stripe` package is installed.

The Chrome extension calls **`POST /v1/stripe/checkout-session`** with the same **`Authorization: Bearer`** as enrich (`MEGALEADS_API_KEY`). The JSON response contains `{ "url": "https://checkout.stripe.com/..." }`, which opens in a new tab. If that fails, the extension can still use a static Payment Link in `scripts/leadflow-remote-config.js` (`stripeCheckoutUrl`).

`MEGALEADS_DATABASE_URL` or `DATABASE_URL` powers persistent free-tier usage tracking (`account_email_usage` table). If neither is set, the server falls back to an in-memory ledger (resets on deploy/restart).

With **FETCH_URL**, the OpenAI path can return `status: "needs_fetch"`; the extension fetches those URLs in the browser context and POSTs tool results back until the model returns final `leads`.

## 3. Extension configuration

1. Open `scripts/leadflow-remote-config.js` in the extension tree.
2. Set `apiBaseUrl` to your Render URL (no trailing slash), e.g. `https://megaleads.onrender.com`.
3. Set `apiKey` to the **same value** as `MEGALEADS_API_KEY` on Render (this is your shared Bearer secret, not the OpenAI key).
4. Reload the extension on `chrome://extensions` (**Reload**) so the service worker picks up changes.

The background service worker is an **ES module** and **statically imports** `scripts/leadflow-remote-config.js` (dynamic `import()` is not allowed in workers). After editing that file, use **Reload** on `chrome://extensions` so the worker picks up changes.

## 4. Smoke test

```bash
curl -sS "$RENDER_URL/health"
curl -sS -X POST "$RENDER_URL/v1/leads/enrich" \
  -H "Authorization: Bearer $MEGALEADS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"leads":[{"username":"demo","bio":"contact@example.com","email":"","websiteUrl":"","phone":""}],"options":{"llm":false}}'
```

With `llm:false`, the server runs deterministic email rescoring only (no OpenAI).

## 5. Logs and privacy

Avoid pasting production bearer tokens or raw lead exports into public tickets. At `info` level the server logs redacted email samples only.
