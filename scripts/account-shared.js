/**
 * Account UI helpers: session stub, email usage estimate, Stripe checkout URL.
 */

import { STORAGE_KEYS } from './constants.js';
import { apiBaseUrl, apiKey, stripeCheckoutUrl } from './leadflow-remote-config.js';

/** Free tier cap shown in the account modal (server may enforce separately later). */
export const FREE_EMAIL_EXTRACTION_CAP = 500;

/**
 * @returns {Promise<{ email: string, loggedInAt: number, registeredAt: number } | null>}
 */
export async function readUserSession() {
  const { [STORAGE_KEYS.USER_SESSION]: raw } = await chrome.storage.local.get(STORAGE_KEYS.USER_SESSION);
  if (!raw || typeof raw !== 'object') return null;
  const email = String(raw.email || '').trim();
  if (!email) return null;
  const registeredAt = Number(raw.registeredAt) || 0;
  if (!registeredAt) return null;
  return { email, loggedInAt: Number(raw.loggedInAt) || 0, registeredAt };
}

/**
 * Create or update the signed-in MegaLeads account (signup or sign-in on signup.html).
 * @param {string} email
 */
export async function writeUserSession(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) return;
  const now = Date.now();
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_SESSION]: { email: trimmed, loggedInAt: now, registeredAt: now },
  });
}

/** @returns {Promise<boolean>} */
export async function readSubscriptionUnlimited() {
  const { [STORAGE_KEYS.SUBSCRIPTION]: raw } = await chrome.storage.local.get(STORAGE_KEYS.SUBSCRIPTION);
  if (!raw || typeof raw !== 'object') return false;
  const sub = /** @type {Record<string, unknown>} */ (raw);
  if (sub.unlimited === true) return true;
  if (sub.active === true) return true;
  if (sub.isPaid === true) return true;
  if (sub.plan === 'plus' || sub.plan === 'pro' || sub.plan === 'paid') return true;
  const status = String(sub.status || '').toLowerCase();
  if (status === 'active' || status === 'trialing' || status === 'paid') return true;
  const expiresAt = Number(sub.expiresAt || sub.expires_at || 0);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
  return false;
}

/**
 * Refresh paid status from server for current signed-in email.
 * Stores result in STORAGE_KEYS.SUBSCRIPTION.
 * @returns {Promise<boolean>} latest unlimited flag
 */
export async function syncSubscriptionFromServer() {
  const session = await readUserSession();
  if (!session?.email) {
    await chrome.storage.local.remove(STORAGE_KEYS.SUBSCRIPTION);
    return false;
  }
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/$/, '') : '';
  const bearer = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!base || !bearer) return readSubscriptionUnlimited();
  try {
    const r = await fetch(`${base}/v1/stripe/subscription-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: session.email }),
    });
    if (!r.ok) return readSubscriptionUnlimited();
    const data = await r.json().catch(() => ({}));
    const sub = {
      unlimited: Boolean(data?.unlimited),
      status: typeof data?.status === 'string' ? data.status : '',
      email: session.email,
      checkedAt: Date.now(),
      source: 'server',
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.SUBSCRIPTION]: sub });
    return Boolean(sub.unlimited);
  } catch {
    return readSubscriptionUnlimited();
  }
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'needs_account' | 'at_cap' }>}
 */
export async function canStartExtractionForFreeTier() {
  const session = await readUserSession();
  if (!session) return { ok: false, reason: 'needs_account' };
  if (await readSubscriptionUnlimited()) return { ok: true };
  const st = await syncFreeTierStatusFromServer();
  const n = Number(st?.used);
  if (n >= FREE_EMAIL_EXTRACTION_CAP) return { ok: false, reason: 'at_cap' };
  return { ok: true };
}

export function getSignupPageUrl() {
  return chrome.runtime.getURL('signup.html');
}

/**
 * Opens the signup tab. Pass a payload to store as `SIGNUP_RETURN` until signup succeeds.
 * @param {Record<string, unknown> | null | undefined} signupReturnPayload
 */
export async function openSignupPageTab(signupReturnPayload) {
  if (signupReturnPayload != null && typeof signupReturnPayload === 'object') {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SIGNUP_RETURN]: signupReturnPayload,
    });
  }
  chrome.tabs.create({ url: getSignupPageUrl(), active: true });
}

export async function clearUserSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.USER_SESSION);
}

/** @param {unknown} row */
function rowHasExtractedEmail(row) {
  const em = String(row?.email || '').trim();
  return em.includes('@');
}

/** @param {string} raw */
function normalizeEmailCandidate(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s.includes('@') || s.startsWith('@') || s.endsWith('@')) return '';
  return s;
}

/**
 * Counts unique (username, email) pairs across current leads and all session snapshots.
 * @returns {Promise<number>}
 */
export async function countUniqueEmailsExtracted() {
  const bag = await chrome.storage.local.get([STORAGE_KEYS.LEADS, STORAGE_KEYS.SESSION_HISTORY]);
  const set = new Set();
  /** @param {unknown[] | undefined} rows */
  const take = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!rowHasExtractedEmail(r)) continue;
      const u = String(r.username || '').trim().toLowerCase();
      const em = String(r.email || '').trim().toLowerCase();
      set.add(`${u}\u0000${em}`);
    }
  };
  take(bag[STORAGE_KEYS.LEADS]);
  const sessions = bag[STORAGE_KEYS.SESSION_HISTORY];
  if (Array.isArray(sessions)) {
    for (const s of sessions) take(s.leads);
  }
  return set.size;
}

/**
 * @returns {Promise<Array<{ username: string, email: string }>>}
 */
async function localUniqueEmailPairs() {
  const bag = await chrome.storage.local.get([STORAGE_KEYS.LEADS, STORAGE_KEYS.SESSION_HISTORY]);
  /** @type {Map<string, { username: string, email: string }>} */
  const map = new Map();
  /** @param {unknown[] | undefined} rows */
  const take = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!rowHasExtractedEmail(r)) continue;
      const username = String(r?.username || '').trim().toLowerCase();
      const email = normalizeEmailCandidate(String(r?.email || ''));
      if (!username || !email) continue;
      const k = `${username}\u0000${email}`;
      map.set(k, { username, email });
    }
  };
  take(bag[STORAGE_KEYS.LEADS]);
  const sessions = bag[STORAGE_KEYS.SESSION_HISTORY];
  if (Array.isArray(sessions)) {
    for (const s of sessions) take(s?.leads);
  }
  return Array.from(map.values());
}

/**
 * Sync account-level free-tier status from server ledger.
 * @returns {Promise<{ used: number, cap: number, remaining: number, atCap: boolean } | null>}
 */
export async function syncFreeTierStatusFromServer() {
  const session = await readUserSession();
  if (!session?.email) return null;
  if (await readSubscriptionUnlimited()) return null;
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/$/, '') : '';
  const bearer = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!base || !bearer) return null;
  try {
    const pairs = await localUniqueEmailPairs();
    const r = await fetch(`${base}/v1/free-tier/status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: session.email, pairs }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => ({}));
    const out = {
      used: Math.max(0, Number(data?.used) || 0),
      cap: Math.max(1, Number(data?.cap) || FREE_EMAIL_EXTRACTION_CAP),
      remaining: Math.max(0, Number(data?.remaining) || 0),
      atCap: Boolean(data?.atCap),
    };
    await chrome.storage.local.set({
      [STORAGE_KEYS.FREE_TIER_STATUS]: {
        ...out,
        checkedAt: Date.now(),
        source: 'server_ledger',
      },
    });
    return out;
  } catch {
    return null;
  }
}

/**
 * Best-effort account usage count. Prefers server-ledger value, falls back to local device estimate.
 */
export async function readEffectiveUsageCount() {
  const st = await syncFreeTierStatusFromServer();
  if (st && Number.isFinite(st.used)) return st.used;
  return countUniqueEmailsExtracted();
}

export function getStripeCheckoutUrl() {
  const u = typeof stripeCheckoutUrl === 'string' ? stripeCheckoutUrl.trim() : '';
  return u || '';
}

/**
 * Opens Stripe Checkout: prefers server `POST /v1/stripe/checkout-session` (Render + your Stripe env),
 * then falls back to `stripeCheckoutUrl` in leadflow-remote-config.js if the API does not return a URL.
 * @param {{ promotionCode?: string }} [options] If `promotionCode` is set, the server pre-applies that
 *   Stripe **promotion** code on the session (case-sensitive). Omit to use Checkout’s “Add promotion code” field.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing_url' }>}
 */
export async function openStripeCheckoutInNewTab(options) {
  const promotionCode =
    options && typeof options === 'object' && typeof options.promotionCode === 'string'
      ? options.promotionCode.trim()
      : '';
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/$/, '') : '';
  const bearer = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (base && bearer) {
    try {
      const session = await readUserSession();
      const customerEmail = session?.email && session.email.includes('@') ? session.email : undefined;
      /** @type {Record<string, string>} */
      const bodyPayload = {};
      if (customerEmail) bodyPayload.customerEmail = customerEmail;
      if (promotionCode) bodyPayload.promotionCode = promotionCode;
      const r = await fetch(`${base}/v1/stripe/checkout-session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });
      const data = r.ok ? await r.json().catch(() => ({})) : {};
      if (data && typeof data.url === 'string' && data.url.startsWith('http')) {
        chrome.tabs.create({ url: data.url, active: true });
        return { ok: true };
      }
    } catch {
      /* fall through to static URL */
    }
  }

  const url = getStripeCheckoutUrl();
  if (!url) return { ok: false, reason: 'missing_url' };
  chrome.tabs.create({ url, active: true });
  return { ok: true };
}

/**
 * Opens Stripe Billing Portal in a new tab for the logged-in user.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing_url' }>}
 */
export async function openManageSubscriptionInNewTab() {
  const session = await readUserSession();
  const email = String(session?.email || '').trim();
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/$/, '') : '';
  const bearer = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (base && bearer && email.includes('@')) {
    try {
      const r = await fetch(`${base}/v1/stripe/manage-subscription-session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      const data = r.ok ? await r.json().catch(() => ({})) : {};
      if (data && typeof data.url === 'string' && data.url.startsWith('http')) {
        chrome.tabs.create({ url: data.url, active: true });
        return { ok: true };
      }
    } catch {
      /* no-op */
    }
  }
  return { ok: false, reason: 'missing_url' };
}
