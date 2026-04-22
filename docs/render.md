# Deploy LeadFlow enrich API on Render

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
| `LEADFLOW_API_KEY` | **Yes** | **Your own** random string (e.g. 32+ chars). The extension sends `Authorization: Bearer <this>`. Must match `apiKey` in `scripts/leadflow-remote-config.js`. **Not** the OpenAI key. |
| `OPENAI_API_KEY` | Yes if LLM on | OpenAI’s key (`sk-…` / `sk-proj-…`). Used **only** inside this service to call OpenAI. Never put this value in the extension. |
| `OPENAI_MODEL` | Optional | Default `gpt-4o-mini`. |
| `EMAIL_VERIFICATION_API_KEY` | Optional | Used when `options.verify === true`. |
| `EMAIL_VERIFICATION_PROVIDER` | Optional | `zerobounce` enables a basic ZeroBounce `v2/validate` integration; other values are ignored until wired. |
| `LEADFLOW_MAX_LEADS_PER_REQUEST` | Optional | Cap per request (default `75`, hard max `200`). |
| `LEADFLOW_LOG_LEVEL` | Optional | `info`, `warn`, or `error` (reduces console noise). |

## 3. Extension configuration

1. Open `scripts/leadflow-remote-config.js` in the extension tree.
2. Set `apiBaseUrl` to your Render URL (no trailing slash), e.g. `https://megaleads.onrender.com`.
3. Set `apiKey` to the **same value** as `LEADFLOW_API_KEY` on Render (this is your shared Bearer secret, not the OpenAI key).
4. Reload the extension on `chrome://extensions` (**Reload**) so the service worker picks up changes.

The background worker loads this module with `chrome.runtime.getURL(...)`. If enrich fails with a load error, reload the extension after editing the file.

## 4. Smoke test

```bash
curl -sS "$RENDER_URL/health"
curl -sS -X POST "$RENDER_URL/v1/leads/enrich" \
  -H "Authorization: Bearer $LEADFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"leads":[{"username":"demo","bio":"contact@example.com","email":"","websiteUrl":"","phone":""}],"options":{"llm":false}}'
```

With `llm:false`, the server runs deterministic email rescoring only (no OpenAI).

## 5. Logs and privacy

Avoid pasting production bearer tokens or raw lead exports into public tickets. At `info` level the server logs redacted email samples only.
