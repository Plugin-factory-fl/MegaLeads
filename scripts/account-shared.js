/**
 * Account UI helpers: session stub, email usage estimate, Stripe checkout URL.
 */

import { STORAGE_KEYS } from './constants.js';
import { apiBaseUrl, apiKey, stripeCheckoutUrl } from './leadflow-remote-config.js';

/** Free tier cap shown in the account modal (server may enforce separately later). */
export const FREE_EMAIL_EXTRACTION_CAP = 500;

/**
 * @returns {Promise<{ email: string, loggedInAt: number } | null>}
 */
export async function readUserSession() {
  const { [STORAGE_KEYS.USER_SESSION]: raw } = await chrome.storage.local.get(STORAGE_KEYS.USER_SESSION);
  if (!raw || typeof raw !== 'object') return null;
  const email = String(raw.email || '').trim();
  if (!email) return null;
  return { email, loggedInAt: Number(raw.loggedInAt) || 0 };
}

/**
 * @param {string} email
 */
export async function writeUserSession(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) return;
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_SESSION]: { email: trimmed, loggedInAt: Date.now() },
  });
}

export async function clearUserSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.USER_SESSION);
}

/** @param {unknown} row */
function rowHasExtractedEmail(row) {
  const em = String(row?.email || '').trim();
  return em.includes('@');
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

export function getStripeCheckoutUrl() {
  const u = typeof stripeCheckoutUrl === 'string' ? stripeCheckoutUrl.trim() : '';
  return u || '';
}

/**
 * Opens Stripe Checkout: prefers server `POST /v1/stripe/checkout-session` (Render + your Stripe env),
 * then falls back to `stripeCheckoutUrl` in leadflow-remote-config.js if the API does not return a URL.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing_url' }>}
 */
export async function openStripeCheckoutInNewTab() {
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/$/, '') : '';
  const bearer = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (base && bearer) {
    try {
      const session = await readUserSession();
      const customerEmail = session?.email && session.email.includes('@') ? session.email : undefined;
      const r = await fetch(`${base}/v1/stripe/checkout-session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(customerEmail ? { customerEmail } : {}),
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
