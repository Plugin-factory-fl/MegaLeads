/**
 * LeadFlow — background service worker (MV3).
 *
 * Growman-style Instagram API access: session DeclarativeNetRequest rules inject
 * x-ig-app-id, x-asbd-id, and x-ig-www-claim on i.instagram.com/api/* and graphql,
 * matching the pattern extracted from Growman's dash bundle.
 */

const DNR_RULE_IDS = [1, 2, 3, 4, 5];
const DASHBOARD_TAB_STORAGE_KEY = 'leadflow_dashboard_tab_id';

/** Same app id as web; asbd id matches current www.instagram.com XHR (Network tab). */
const IG_ASBD_ID = '129477';
const IG_ASBD_ID_WWW = '359341';
const IG_APP_ID = '936619743392459';

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(DASHBOARD_TAB_STORAGE_KEY, (bag) => {
    if (bag[DASHBOARD_TAB_STORAGE_KEY] === tabId) {
      chrome.storage.local.remove(DASHBOARD_TAB_STORAGE_KEY);
    }
  });
});

/**
 * @param {string} wwwClaim sessionStorage `www-claim-v2` (may be empty)
 * @param {string} refererPath e.g. `/someuser/followers/` (leading slash, no domain)
 */
function buildInstagramSessionRules(wwwClaim, refererPath) {
  const claim = wwwClaim || '';
  const raw = refererPath && String(refererPath).startsWith('/')
    ? String(refererPath)
    : `/${String(refererPath || '')}`;
  const refererValue = new URL(raw, 'https://www.instagram.com').href;

  const igHeaders = [
    { header: 'x-asbd-id', operation: 'set', value: IG_ASBD_ID },
    { header: 'x-ig-app-id', operation: 'set', value: IG_APP_ID },
    { header: 'x-ig-www-claim', operation: 'set', value: claim },
  ];
  const igHeadersWww = [
    { header: 'x-asbd-id', operation: 'set', value: IG_ASBD_ID_WWW },
    { header: 'x-ig-app-id', operation: 'set', value: IG_APP_ID },
    { header: 'x-ig-www-claim', operation: 'set', value: claim },
  ];

  return [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: igHeaders,
      },
      condition: {
        urlFilter: 'https://i.instagram.com/api/*',
        resourceTypes: ['xmlhttprequest'],
      },
    },
    {
      id: 4,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: igHeadersWww,
      },
      condition: {
        urlFilter: 'https://www.instagram.com/api/v1/*',
        resourceTypes: ['xmlhttprequest'],
      },
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: igHeadersWww,
      },
      condition: {
        urlFilter: 'https://www.instagram.com/graphql/query',
        resourceTypes: ['xmlhttprequest'],
      },
    },
    {
      id: 5,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: igHeadersWww,
      },
      condition: {
        urlFilter: 'https://www.instagram.com/api/graphql',
        resourceTypes: ['xmlhttprequest'],
      },
    },
    {
      id: 3,
      priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'referer', operation: 'set', value: refererValue }],
      },
      condition: {
        urlFilter: 'https://www.instagram.com/graphql/query/?query_hash=*',
        resourceTypes: ['xmlhttprequest'],
      },
    },
  ];
}

async function applyInstagramSessionRules(wwwClaim, refererPath) {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  const addRules = buildInstagramSessionRules(wwwClaim, refererPath);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [...DNR_RULE_IDS],
    addRules,
  });
}

function isAllowedInstagramBackgroundFetchUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'i.instagram.com' && u.pathname.startsWith('/api/')) return true;
    if (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Generic HTTPS fetch for bio / link-in-bio pages (Linktree, etc.).
 * Uses manifest `host_permissions` (https/http wildcards) so no runtime permission prompt.
 */
function isAllowedThirdPartyTextFetchUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local')) return false;
    if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false;
    if (h.endsWith('instagram.com') || h === 'instagr.am') return false;
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LF_SYNC_IG_DNR') {
    const wwwClaim = typeof message.wwwClaim === 'string' ? message.wwwClaim : '';
    const refererPath = typeof message.refererPath === 'string' ? message.refererPath : '/';
    applyInstagramSessionRules(wwwClaim, refererPath)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (message?.type === 'LF_IG_FETCH') {
    const url = typeof message.url === 'string' ? message.url : '';
    if (!isAllowedInstagramBackgroundFetchUrl(url)) {
      sendResponse({ bridgeOk: false, error: 'URL not allowed for LF_IG_FETCH' });
      return false;
    }
    const hdr = message.headers && typeof message.headers === 'object' ? message.headers : {};
    fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        ...hdr,
      },
    })
      .then(async (res) => {
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* leave json null for HTML bodies */
        }
        sendResponse({
          bridgeOk: true,
          status: res.status,
          okHttp: res.ok,
          text: text.slice(0, 200000),
          json,
        });
      })
      .catch((e) => sendResponse({ bridgeOk: false, error: e?.message || String(e) }));
    return true;
  }

  if (message?.type === 'LF_HTTP_TEXT_FETCH') {
    const url = typeof message.url === 'string' ? message.url : '';
    if (!isAllowedThirdPartyTextFetchUrl(url)) {
      sendResponse({ bridgeOk: false, error: 'URL not allowed for LF_HTTP_TEXT_FETCH' });
      return false;
    }
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 14000);
    fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
      .then(async (res) => {
        const text = await res.text();
        sendResponse({
          bridgeOk: true,
          status: res.status,
          okHttp: res.ok,
          text: text.slice(0, 450000),
        });
      })
      .catch((e) => sendResponse({ bridgeOk: false, error: e?.message || String(e) }))
      .finally(() => clearTimeout(tid));
    return true;
  }

  if (message?.type === 'LF_LEADS_REMOTE_ENRICH') {
    void handleLeadsRemoteEnrich(message, sendResponse);
    return true;
  }

  return false;
});

/**
 * Proxy batched lead enrich requests to the Render API (avoids CORS from the dashboard page).
 * @param {{ leads?: unknown[], options?: Record<string, unknown> }} message
 * @param {(r: unknown) => void} sendResponse
 */
async function handleLeadsRemoteEnrich(message, sendResponse) {
  try {
    let mod;
    try {
      // Relative import() is unreliable in MV3 service workers; use extension URL.
      const configUrl = chrome.runtime.getURL('scripts/leadflow-remote-config.js');
      mod = await import(configUrl);
    } catch (e) {
      const detail = e && /** @type {Error} */ (e).message ? ` (${/** @type {Error} */ (e).message})` : '';
      sendResponse({
        ok: false,
        error: `Could not load leadflow-remote-config.js${detail}. Ensure the file exists under scripts/ and reload the extension (chrome://extensions → Reload). Copy from leadflow-remote-config.example.js if needed, then set apiBaseUrl + apiKey.`,
      });
      return;
    }
    const apiBaseUrl = String(mod.apiBaseUrl || '')
      .trim()
      .replace(/\/$/, '');
    const apiKey = String(mod.apiKey || '').trim();
    if (!apiBaseUrl || !apiKey) {
      sendResponse({
        ok: false,
        error: 'apiBaseUrl and apiKey must be set in scripts/leadflow-remote-config.js',
      });
      return;
    }

    const leads = Array.isArray(message.leads) ? message.leads : [];
    if (!leads.length) {
      sendResponse({ ok: false, error: 'No leads in message' });
      return;
    }

    const bodyObj = {
      leads,
      options: message.options && typeof message.options === 'object' ? message.options : {},
    };
    const body = JSON.stringify(bodyObj);
    if (body.length > 750000) {
      sendResponse({ ok: false, error: 'Batch payload too large; reduce batch size.' });
      return;
    }

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 60000);
    const url = `${apiBaseUrl}/v1/leads/enrich`;
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });
    clearTimeout(tid);

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* leave null */
    }

    if (!res.ok) {
      const msg =
        (json && (json.message || json.error)) ||
        (text && text.slice(0, 200)) ||
        `HTTP ${res.status}`;
      sendResponse({ ok: false, error: String(msg), status: res.status });
      return;
    }

    sendResponse({ ok: true, data: json });
  } catch (e) {
    const name = e && /** @type {Error} */ (e).name;
    const msg =
      name === 'AbortError'
        ? 'Request timed out (60s).'
        : String((e && /** @type {Error} */ (e).message) || e);
    sendResponse({
      ok: false,
      error: /Failed to fetch|NetworkError|Load failed/i.test(msg)
        ? 'Network error — check apiBaseUrl, your connection, and that the Render service is up.'
        : msg,
    });
  }
}
