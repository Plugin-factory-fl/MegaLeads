/**
 * MegaLeads enrich API — Render-friendly Express service.
 * Auth: Authorization: Bearer <MEGALEADS_API_KEY>
 */

import express from 'express';
import pg from 'pg';
import { pickBestEmail, normalizeEmailCandidate, EMAIL_RE } from '../scripts/email-quality.js';
import {
  attachStripeWebhookRoute,
  handleStripeCheckoutSession,
  handleStripeCheckoutReturn,
  handleStripeSubscriptionStatus,
  handleStripeManageSubscriptionSession,
  listPaidSubscriberEmails,
} from './stripe.js';

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MEGALEADS_API_KEY = (process.env.MEGALEADS_API_KEY || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const MAX_LEADS = Math.min(
  200,
  Math.max(1, Number(process.env.LEADFLOW_MAX_LEADS_PER_REQUEST) || 75),
);
const LOG_LEVEL = (process.env.LEADFLOW_LOG_LEVEL || 'info').toLowerCase();
const EMAIL_VERIFICATION_API_KEY = (process.env.EMAIL_VERIFICATION_API_KEY || '').trim();
const EMAIL_VERIFICATION_PROVIDER = (process.env.EMAIL_VERIFICATION_PROVIDER || '').trim().toLowerCase();
/** Max `toolRound` before new browser fetches stop (client increments `toolRound` after each fetch burst). */
const FETCH_TOOL_MAX_ROUNDS = Math.min(24, Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_ROUNDS) || 6));
/** Max URLs sent to the extension per needs_fetch response. */
const FETCH_TOOL_MAX_URLS = Math.min(12, Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_URLS_PER_ROUND) || 5));
/** Max completed browser fetches per lead (username) per enrich request, across all tool rounds. */
const FETCH_TOOL_MAX_FETCHES_PER_LEAD = Math.min(
  8,
  Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_PER_LEAD) || 2),
);
/** Max chars per fetch tool body sent to OpenAI after HTML stripping (API copy only; full HTML stays in `messages` for evidence). */
const FETCH_TOOL_MAX_OPENAI_TOOL_CHARS = Math.min(
  100000,
  Math.max(6000, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_OPENAI_TOOL_CHARS) || 26000),
);
/** Most recent N tool results use the full OpenAI char budget; older tool rounds are condensed for the API. */
const FETCH_TOOL_OPENAI_FULL_DETAIL_LAST_TOOLS = Math.min(
  8,
  Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_OPENAI_FULL_DETAIL_LAST_TOOLS) || 2),
);
const FREE_EMAIL_EXTRACTION_CAP = 500;
const ADMIN_EMAIL = 'admin@megaleadsai.com';
const ADMIN_PASSWORD = 'Shakeybob3';
/** @type {Map<string, Set<string>>} accountEmail -> Set("username\\u0000email") */
const FREE_TIER_USAGE_LEDGER = new Map();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const { Pool } = pg;
/** @type {import('pg').Pool | null} */
const usagePool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl:
        DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
    })
  : null;
let usageTableReady = false;

function logInfo(msg, extra) {
  if (LOG_LEVEL === 'error' || LOG_LEVEL === 'warn') return;
  if (extra) console.info(`[leadflow] ${msg}`, extra);
  else console.info(`[leadflow] ${msg}`);
}

function logWarn(msg, extra) {
  if (LOG_LEVEL === 'error') return;
  if (extra) console.warn(`[leadflow] ${msg}`, extra);
  else console.warn(`[leadflow] ${msg}`);
}

/** @param {string} email */
function redactEmail(email) {
  const s = String(email || '');
  if (!s.includes('@')) return '(empty)';
  const [l, h] = s.split('@');
  if (!h) return '(invalid)';
  const safeL = l.length <= 2 ? '**' : `${l.slice(0, 2)}…${l.slice(-1)}`;
  return `${safeL}@${h}`;
}

function requireBearer(req, res, next) {
  const want = MEGALEADS_API_KEY;
  if (!want) {
    logWarn('MEGALEADS_API_KEY is not set');
    const message = OPENAI_API_KEY
      ? 'MEGALEADS_API_KEY is missing. It is not the same as OPENAI_API_KEY: set MEGALEADS_API_KEY (any long random string) for extension Bearer auth; OPENAI_API_KEY is only for OpenAI on the server.'
      : 'Set MEGALEADS_API_KEY (any long random string). The Chrome extension sends Authorization: Bearer with that value; it must match scripts/leadflow-remote-config.js apiKey.';
    return res.status(503).json({ error: 'server_misconfigured', message });
  }
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  const got = m ? m[1].trim() : '';
  if (got !== want) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing bearer token' });
  }
  next();
}

/** @param {string} email */
function normalizeAccountEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * @param {string} email
 * @returns {Set<string>}
 */
function usageSetForAccount(email) {
  const key = normalizeAccountEmail(email);
  let set = FREE_TIER_USAGE_LEDGER.get(key);
  if (!set) {
    set = new Set();
    FREE_TIER_USAGE_LEDGER.set(key, set);
  }
  return set;
}

async function ensureUsageTable() {
  if (!usagePool || usageTableReady) return;
  await usagePool.query(`
    CREATE TABLE IF NOT EXISTS account_email_usage (
      account_email TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_email, username, email)
    )
  `);
  usageTableReady = true;
}

/**
 * @param {string} email
 * @param {unknown} pairs
 */
function mergeUsagePairs(email, pairs) {
  const key = normalizeAccountEmail(email);
  if (!key || !Array.isArray(pairs)) return;
  const set = usageSetForAccount(key);
  for (const p of pairs) {
    if (!p || typeof p !== 'object') continue;
    const u = String(p.username || '').trim().toLowerCase();
    const em = normalizeEmailCandidate(String(p.email || ''));
    if (!u || !em) continue;
    set.add(`${u}\u0000${em}`);
  }
}

/**
 * @param {string} email
 * @param {unknown} pairs
 */
async function mergeUsagePairsDb(email, pairs) {
  const key = normalizeAccountEmail(email);
  if (!usagePool || !key || !Array.isArray(pairs) || !pairs.length) return;
  await ensureUsageTable();
  /** @type {Array<[string, string, string]>} */
  const rows = [];
  for (const p of pairs) {
    if (!p || typeof p !== 'object') continue;
    const u = String(p.username || '').trim().toLowerCase();
    const em = normalizeEmailCandidate(String(p.email || ''));
    if (!u || !em) continue;
    rows.push([key, u, em]);
  }
  if (!rows.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    values.push(`($${i}, $${i + 1}, $${i + 2})`);
    params.push(r[0], r[1], r[2]);
    i += 3;
  }
  await usagePool.query(
    `INSERT INTO account_email_usage (account_email, username, email)
     VALUES ${values.join(',')}
     ON CONFLICT (account_email, username, email) DO NOTHING`,
    params,
  );
}

/**
 * @param {string} email
 */
function freeTierStatusForEmail(email) {
  const set = usageSetForAccount(email);
  const used = set.size;
  const cap = FREE_EMAIL_EXTRACTION_CAP;
  const remaining = Math.max(0, cap - used);
  const atCap = used >= cap;
  return { used, cap, remaining, atCap };
}

/**
 * @param {string} email
 */
async function freeTierStatusForEmailDb(email) {
  const key = normalizeAccountEmail(email);
  if (!usagePool || !key) return null;
  await ensureUsageTable();
  const r = await usagePool.query('SELECT COUNT(*)::int AS used FROM account_email_usage WHERE account_email = $1', [key]);
  const used = Number(r.rows?.[0]?.used) || 0;
  const cap = FREE_EMAIL_EXTRACTION_CAP;
  const remaining = Math.max(0, cap - used);
  const atCap = used >= cap;
  return { used, cap, remaining, atCap };
}

/**
 * Account-level free-tier usage status.
 * Optional `pairs` payload lets the extension sync locally observed unique (username,email) pairs.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleFreeTierStatus(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = normalizeAccountEmail(typeof body.email === 'string' ? body.email : '');
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'bad_request', message: 'Valid email is required.' });
  }
  try {
    if (usagePool) {
      await mergeUsagePairsDb(email, body.pairs);
      const statusDb = await freeTierStatusForEmailDb(email);
      if (statusDb) return res.json({ ...statusDb, source: 'postgres' });
    }
  } catch (e) {
    logWarn('free_tier_status_db_failed', { err: String(e?.message || e) });
  }
  mergeUsagePairs(email, body.pairs);
  const status = freeTierStatusForEmail(email);
  return res.json({ ...status, source: 'server_ledger' });
}

/**
 * Admin-only subscriber overview.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleAdminSubscribers(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = normalizeAccountEmail(typeof body.email === 'string' ? body.email : '');
  const password = String(body.password || '');
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'forbidden', message: 'Invalid admin credentials.' });
  }

  /** @type {Map<string, number>} */
  const freeUsedByEmail = new Map();
  if (usagePool) {
    await ensureUsageTable();
    const r = await usagePool.query(
      'SELECT account_email, COUNT(*)::int AS used FROM account_email_usage GROUP BY account_email',
    );
    for (const row of r.rows || []) {
      const em = normalizeAccountEmail(row.account_email);
      const used = Number(row.used) || 0;
      if (em) freeUsedByEmail.set(em, used);
    }
  } else {
    for (const [em, set] of FREE_TIER_USAGE_LEDGER.entries()) {
      freeUsedByEmail.set(normalizeAccountEmail(em), set.size);
    }
  }

  const paid = await listPaidSubscriberEmails();
  /** @type {Array<{ email: string, type: 'paid' | 'free', remaining: number|null }>} */
  const rows = [];
  for (const em of paid) rows.push({ email: em, type: 'paid', remaining: null });
  for (const [em, used] of freeUsedByEmail.entries()) {
    if (paid.has(em)) continue;
    rows.push({ email: em, type: 'free', remaining: Math.max(0, FREE_EMAIL_EXTRACTION_CAP - used) });
  }
  rows.sort((a, b) => a.email.localeCompare(b.email));
  return res.json({ rows, cap: FREE_EMAIL_EXTRACTION_CAP });
}

/**
 * Pull loose emails from text for deterministic rescoring.
 * @param {string} text
 * @returns {string[]}
 */
function emailsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
  return text.match(re) || [];
}

/**
 * @param {object} row
 * @returns {string[]} candidates for pickBestEmail
 */
function emailCandidatesForRow(row) {
  const parts = [];
  if (row.email) parts.push(String(row.email));
  if (row.bio) parts.push(...emailsFromText(String(row.bio)));
  if (row.websiteUrl) parts.push(...emailsFromText(String(row.websiteUrl)));
  return parts;
}

const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,9}\b/g;
const PHONE_TRAIL_RE = /[),.;:!?]+$/;

/** @param {string} text */
function phonesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const re = new RegExp(PHONE_RE.source, PHONE_RE.flags);
  return text.match(re) || [];
}

/** @param {string} raw */
function looksLikeDateLikePhone(raw) {
  const t = String(raw || '').trim();
  return (
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.test(t) ||
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.test(t) ||
    /^\d{4}\s*[-–—]\s*\d{4}$/.test(t)
  );
}

/** @param {string} raw */
function looksLikeDatePlusDecimalNoise(raw) {
  const t = String(raw || '').trim();
  return /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(t) && /\b\d+\.\d+\b/.test(t);
}

/** @param {string} raw */
function looksLikeCoordinateNoise(raw) {
  const t = String(raw || '').trim();
  return /^[-+]?\d{1,3}\.\d{3,}\s+[-+]?\d{1,3}\.\d{3,}(?:\s+[-+]?\d+(?:\.\d+)?)?$/.test(t);
}

/** @param {string} raw */
function looksLikeDottedNumericNoise(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, '');
  if (!/^[+\d.]+$/.test(t)) return false;
  const dots = (t.match(/\./g) || []).length;
  if (dots < 2) return false;
  return t.length >= 10;
}

/** @param {string} raw */
function normalizePhoneCandidate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const base = String(raw).trim().replace(PHONE_TRAIL_RE, '');
  if (!base || base.includes('@')) return '';
  if (looksLikeDateLikePhone(base)) return '';
  if (looksLikeDatePlusDecimalNoise(base)) return '';
  if (looksLikeCoordinateNoise(base)) return '';
  if (looksLikeDottedNumericNoise(base)) return '';
  const digits = base.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  const hasPlus = base.trim().startsWith('+');
  if (!hasPlus && digits.length > 11) return '';
  if (!hasPlus && digits.length === 11 && !digits.startsWith('1')) return '';
  if (/\d{4}[-.\s]\d{4}[-.\s]\d{4}/.test(base)) return '';
  if (/^\+?\d+$/.test(base.replace(/\s+/g, ''))) {
    if (!base.trim().startsWith('+')) {
      if (digits.length < 10 || digits.length > 11) return '';
      if (digits.length === 11 && !digits.startsWith('1')) return '';
    }
  }
  if (!/[()\s.\-+]/.test(base) && digits.length >= 12) return '';
  return base;
}

/**
 * @param {string[]} candidates
 * @returns {string}
 */
function pickBestPhone(candidates) {
  const uniq = [];
  const seen = new Set();
  for (const c of candidates || []) {
    const n = normalizePhoneCandidate(String(c || ''));
    if (!n) continue;
    const k = n.replace(/\D/g, '');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (!uniq.length) return '';
  uniq.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
  return uniq[0] || '';
}

/**
 * @param {object} row
 * @returns {string[]}
 */
function phoneCandidatesForRow(row) {
  const parts = [];
  if (row.phone) parts.push(String(row.phone));
  if (row.bio) parts.push(...phonesFromText(String(row.bio)));
  if (row.websiteUrl) parts.push(...phonesFromText(String(row.websiteUrl)));
  return parts;
}

/**
 * Optional deliverability — extend with real vendor HTTP calls.
 * @param {string} email
 * @returns {Promise<{ status: string, reason?: string }|null>}
 */
async function verifyEmailOptional(email) {
  if (!EMAIL_VERIFICATION_API_KEY || !EMAIL_VERIFICATION_PROVIDER) return null;
  if (!email || !normalizeEmailCandidate(email)) return { status: 'unknown', reason: 'invalid_syntax' };

  if (EMAIL_VERIFICATION_PROVIDER === 'zerobounce') {
    try {
      const url = new URL('https://api.zerobounce.net/v2/validate');
      url.searchParams.set('api_key', EMAIL_VERIFICATION_API_KEY);
      url.searchParams.set('email', email);
      const r = await fetch(url.href, { method: 'GET' });
      if (!r.ok) return { status: 'unknown', reason: `http_${r.status}` };
      const j = await r.json();
      const st = String(j.status || '').toLowerCase();
      if (st === 'valid') return { status: 'valid' };
      if (st === 'invalid' || st === 'do_not_mail') return { status: 'invalid' };
      if (st === 'catch-all' || st === 'unknown') return { status: 'risky', reason: st };
      return { status: 'unknown', reason: st || 'zerobounce' };
    } catch (e) {
      logWarn('zerobounce verify failed', { err: String(e?.message || e) });
      return { status: 'unknown', reason: 'request_error' };
    }
  }

  logInfo(`email verify skipped: unknown provider "${EMAIL_VERIFICATION_PROVIDER}"`);
  return { status: 'unknown', reason: 'provider_not_integrated' };
}

/** Same rules as extension `isAllowedThirdPartyTextFetchUrl` — extension performs the actual fetch. */
function isFetchUrlAllowedForTool(urlStr) {
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

function compactLeadsForLlm(leads) {
  return leads.map((r) => ({
    username: String(r.username || ''),
    followerCount: r.followerCount ?? null,
    bio: String(r.bio || '').slice(0, 1200),
    websiteUrl: String(r.websiteUrl || '').slice(0, 500),
    email: String(r.email || ''),
    phone: String(r.phone || '').slice(0, 80),
  }));
}

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** @param {string} raw */
function normalizeHost(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

/** @param {string} raw */
function hostFromMaybeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return normalizeHost(new URL(s).hostname);
  } catch {
    try {
      return normalizeHost(new URL(`https://${s}`).hostname);
    } catch {
      return '';
    }
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function urlsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  return text.match(URL_RE) || [];
}

/**
 * @param {string} a
 * @param {string} b
 */
function hostsMatch(a, b) {
  const x = normalizeHost(a);
  const y = normalizeHost(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * @param {object} row
 * @returns {Set<string>}
 */
function leadEvidenceHosts(row) {
  const out = new Set();
  const fromWebsite = hostFromMaybeUrl(String(row?.websiteUrl || ''));
  if (fromWebsite) out.add(fromWebsite);
  for (const u of urlsFromText(String(row?.bio || ''))) {
    const h = hostFromMaybeUrl(u);
    if (h) out.add(h);
  }
  return out;
}

/**
 * @param {object[]} messages
 * @returns {Map<string, Set<string>>} host -> normalized emails from fetched tool text
 */
function fetchedEmailsByHostFromMessages(messages) {
  /** @type {Map<string, Set<string>>} */
  const byHost = new Map();
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    const text = String(msg.content || '');
    let host = '';
    const first = text.match(/^\s*URL:\s*(https?:\/\/\S+)/i);
    if (first && first[1]) host = hostFromMaybeUrl(first[1]);
    if (!host) {
      const firstUrl = urlsFromText(text)[0] || '';
      host = hostFromMaybeUrl(firstUrl);
    }
    const found = emailsFromText(text);
    for (const raw of found) {
      const n = normalizeEmailCandidate(raw);
      if (!n) continue;
      const k = host || '__unknown_host__';
      if (!byHost.has(k)) byHost.set(k, new Set());
      byHost.get(k).add(n);
    }
  }
  return byHost;
}

/**
 * @param {object[]} messages
 * @returns {Map<string, Set<string>>} host -> normalized phones from fetched tool text
 */
function fetchedPhonesByHostFromMessages(messages) {
  /** @type {Map<string, Set<string>>} */
  const byHost = new Map();
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    const text = String(msg.content || '');
    let host = '';
    const first = text.match(/^\s*URL:\s*(https?:\/\/\S+)/im);
    if (first && first[1]) host = hostFromMaybeUrl(first[1]);
    if (!host) {
      const firstUrl = urlsFromText(text)[0] || '';
      host = hostFromMaybeUrl(firstUrl);
    }
    const found = phonesFromText(text);
    for (const raw of found) {
      const n = normalizePhoneCandidate(raw);
      if (!n) continue;
      const k = host || '__unknown_host__';
      if (!byHost.has(k)) byHost.set(k, new Set());
      byHost.get(k).add(n);
    }
  }
  return byHost;
}

/**
 * @param {object[]} messages
 * @returns {Map<string, Set<string>>} username(lowercase) -> normalized emails
 */
function fetchedEmailsByUsernameFromMessages(messages) {
  /** @type {Map<string, Set<string>>} */
  const byUser = new Map();
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    const text = String(msg.content || '');
    const m = text.match(/^\s*USERNAME:\s*([^\n\r]+)/i);
    const username = String(m?.[1] || '').trim().toLowerCase();
    if (!username) continue;
    const found = emailsFromText(text);
    for (const raw of found) {
      const n = normalizeEmailCandidate(raw);
      if (!n) continue;
      if (!byUser.has(username)) byUser.set(username, new Set());
      byUser.get(username).add(n);
    }
  }
  return byUser;
}

/**
 * @param {object[]} messages
 * @returns {Map<string, Set<string>>} username(lowercase) -> normalized phones
 */
function fetchedPhonesByUsernameFromMessages(messages) {
  /** @type {Map<string, Set<string>>} */
  const byUser = new Map();
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    const text = String(msg.content || '');
    const m = text.match(/^\s*USERNAME:\s*([^\n\r]+)/i);
    const username = String(m?.[1] || '').trim().toLowerCase();
    if (!username) continue;
    const found = phonesFromText(text);
    for (const raw of found) {
      const n = normalizePhoneCandidate(raw);
      if (!n) continue;
      if (!byUser.has(username)) byUser.set(username, new Set());
      byUser.get(username).add(n);
    }
  }
  return byUser;
}

/**
 * @param {object} row
 * @param {Map<string, Set<string>>} fetchedByHost
 * @returns {Set<string>}
 */
function extraEvidenceEmailsForLead(row, fetchedByHost) {
  const out = new Set();
  const hosts = leadEvidenceHosts(row);
  for (const h of hosts) {
    for (const [k, emails] of fetchedByHost.entries()) {
      if (k === '__unknown_host__') continue;
      if (!hostsMatch(h, k)) continue;
      for (const e of emails) out.add(e);
    }
  }
  return out;
}

/**
 * @param {object} row
 * @param {Map<string, Set<string>>} fetchedByHost
 * @returns {Set<string>}
 */
function extraEvidencePhonesForLead(row, fetchedByHost) {
  const out = new Set();
  const hosts = leadEvidenceHosts(row);
  for (const h of hosts) {
    for (const [k, phones] of fetchedByHost.entries()) {
      if (k === '__unknown_host__') continue;
      if (!hostsMatch(h, k)) continue;
      for (const p of phones) out.add(p);
    }
  }
  return out;
}

/**
 * Conservative filter for obvious placeholder/test addresses.
 * @param {string} email
 * @returns {boolean}
 */
function isLikelyPlaceholderEmail(email) {
  const n = normalizeEmailCandidate(email);
  if (!n) return false;
  const at = n.indexOf('@');
  if (at <= 0) return false;
  const local = n.slice(0, at);
  const host = n.slice(at + 1);

  const placeholderHosts = new Set([
    'example.com',
    'example.org',
    'example.net',
    'test.com',
    'domain.com',
    'yourdomain.com',
    'mailinator.com',
  ]);
  if (placeholderHosts.has(host)) return true;
  if (/\.(example|invalid|test|local)$/i.test(host)) return true;
  if (/^(test|example|sample|demo|fake|noemail|nobody)([._-]?\d+)?$/i.test(local)) return true;
  if (/^(yourname|firstname|lastname|fullname|username|email|user)([._-]?\d+)?$/i.test(local)) return true;
  return false;
}

/** @param {string} text */
function extractJsonObjectWithItems(text) {
  const t = String(text || '').trim();
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(t.slice(start, i + 1));
          if (parsed && Array.isArray(parsed.items)) return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** @param {unknown[]} items */
function itemsArrayToLlmMap(items) {
  /** @type {Map<string, object>} */
  const byUser = new Map();
  for (const it of items) {
    const u = String(it?.username || '').trim();
    if (u) byUser.set(u.toLowerCase(), it);
  }
  return byUser;
}

/**
 * Count prior extension HTML results in the conversation (USERNAME: prefix).
 * @param {object[]} messages
 * @returns {Map<string, number>}
 */
function completedFetchUrlCountByUsername(messages) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const msg of messages || []) {
    if (!msg || msg.role !== 'tool') continue;
    const text = String(msg.content || '');
    const m = text.match(/^\s*USERNAME:\s*([^\n\r]+)/i);
    const username = String(m?.[1] || '').trim().toLowerCase();
    if (!username) continue;
    counts.set(username, (counts.get(username) || 0) + 1);
  }
  return counts;
}

/**
 * Interleave fetch jobs so different usernames are mixed (breadth-first).
 * Preserves relative order within each username from the model output.
 * @param {{ toolCallId: string, url: string, username: string }[]} jobs
 */
function breadthFirstByUsername(jobs) {
  /** @type {Map<string, { toolCallId: string, url: string, username: string }[]>} */
  const byUser = new Map();
  /** @type {string[]} */
  const order = [];
  for (const j of jobs) {
    const u = String(j.username || '').trim().toLowerCase();
    if (!byUser.has(u)) {
      byUser.set(u, []);
      order.push(u);
    }
    byUser.get(u).push(j);
  }
  /** @type {typeof jobs} */
  const out = [];
  for (;;) {
    let progressed = false;
    for (const u of order) {
      const q = byUser.get(u);
      if (!q || !q.length) continue;
      out.push(q.shift());
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}

const FETCH_URL_TOOL_SYSTEM = `You enrich Instagram lead rows for a CRM export. You may call fetch_url with absolute http(s) URLs to load public HTML (contact pages, link-in-bio sites, about pages). Never use instagram.com or instagr.am. Use fetch only when extra page text would materially improve contact accuracy.

Critical email accuracy rules:
- Never invent an email.
- Only suggest email_suggested if the exact address appears in provided lead fields or fetched tool text.
- Prefer addresses that appear on the same site/domain as the lead's websiteUrl/bio links.
- If no trustworthy address is found, set email_action="keep" and email_suggested="".

Critical phone accuracy rules:
- Never invent a phone number.
- Only suggest phone_suggested if the exact number appears in provided lead fields or fetched tool text.
- Reject date-like strings, plain long numeric IDs, version numbers, and obvious non-phone patterns.
- If no trustworthy number is found, set phone_action="keep" and phone_suggested="".

fetch_url call rules:
- Always include BOTH username and url arguments.
- username must exactly match one username from the input leads list.
- Spread fetches across many different usernames in each round when several leads still lack good contact signals; avoid spending the whole round on one celebrity or brand homepage unless others are already covered.
- The server may cap how many URLs it runs per lead per request; prioritize one high-value URL per weak-contact lead before deep multi-page exploration on a single lead.
- Browser-agent style: after fetching a homepage, follow likely internal contact paths (contact/about/team/support/impressum/privacy/terms) before deciding.
- Prefer pages that include mailto:, tel:, "contact", "reach us", "get in touch", "support", or "call us".

When finished (with or without fetches), reply with ONE JSON object only (no markdown fences), shape: {"items":[...]} where each item has username, email_suggested, email_action (keep|replace|clear), email_confidence_0_1, phone_suggested, phone_action (keep|replace|clear), phone_confidence_0_1.`;

const FETCH_URL_FINALIZE_USER = `The server will not run any more fetch_url loads for this batch. Do not call fetch_url.
Reply with ONE JSON object only (no markdown fences), shape: {"items":[...]} with one item per lead username from the original list. Each item: username, email_suggested, email_action (keep|replace|clear), email_confidence_0_1, phone_suggested, phone_action (keep|replace|clear), phone_confidence_0_1. Use only evidence from the conversation and the initial lead JSON.`;

const FETCH_URL_FUNCTION = {
  type: 'function',
  function: {
    name: 'fetch_url',
    description:
      'Load public page HTML as text via the user browser extension. Use https when possible. One URL per call.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        username: { type: 'string', description: 'Exact lead username this URL belongs to' },
        url: { type: 'string', description: 'Absolute URL, e.g. https://example.com/contact' },
      },
      required: ['username', 'url'],
    },
  },
};

/**
 * Strip HTML/CSS/JS noise to shrink token count before sending to OpenAI.
 * @param {string} text
 * @param {number} [maxRawLen]
 * @returns {string}
 */
function shrinkFetchHtmlForLlm(text, maxRawLen = 120000) {
  let s = String(text || '');
  if (s.length > maxRawLen) s = s.slice(0, maxRawLen);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * @param {string} content Full tool message (USERNAME + page text)
 * @param {number} maxChars
 * @returns {string}
 */
function shrinkToolMessageContentForLlm(content, maxChars) {
  const raw = String(content || '');
  const um = raw.match(/^(\s*USERNAME:\s*[^\n\r]+\n)/i);
  const header = um ? um[1] : '';
  const rest = um ? raw.slice(um[0].length) : raw;
  const shrunk = shrinkFetchHtmlForLlm(rest, 100000);
  const cap = Math.max(2000, maxChars - header.length - 120);
  let body = shrunk;
  if (body.length > cap) body = `${shrunk.slice(0, cap)}\n...[truncated for LLM context]`;
  return header + body;
}

/**
 * Condense older fetch tool messages to a short fingerprint + text window.
 * @param {string} content
 * @returns {string}
 */
function collapseOldFetchToolContentForLlm(content) {
  const raw = String(content || '');
  const um = raw.match(/^\s*USERNAME:\s*([^\n\r]+)/im);
  const user = um ? um[1].trim() : '';
  const urlLine = raw.match(/^\s*URL:\s*(\S+)/im);
  const url = urlLine ? urlLine[1].trim() : '';
  const tailSrc = raw.slice(0, 90000);
  const shrunk = shrinkFetchHtmlForLlm(tailSrc, 90000);
  const tail = shrunk.slice(0, 1800);
  return (
    `USERNAME: ${user}\n` +
    (url ? `URL: ${url}\n` : '') +
    '[Earlier fetch condensed for model context; full HTML is still used server-side for evidence.]\n' +
    tail
  );
}

/**
 * Shallow-clone messages and shrink `role: tool` payloads for OpenAI only.
 * @param {object[]} messages
 * @returns {object[]}
 */
function cloneMessagesForOpenAiFetchTool(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const toolIdx = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.role === 'tool') toolIdx.push(i);
  }
  const fullDetailStart = Math.max(0, toolIdx.length - FETCH_TOOL_OPENAI_FULL_DETAIL_LAST_TOOLS);
  /** @type {Map<number, 'old'|'full'>} */
  const mode = new Map();
  for (let j = 0; j < toolIdx.length; j++) {
    mode.set(toolIdx[j], j < fullDetailStart ? 'old' : 'full');
  }
  return list.map((m, idx) => {
    if (!m || typeof m !== 'object') return m;
    const mo = mode.get(idx);
    if (!mo) return { ...m };
    const c = String(m.content != null ? m.content : '');
    const content =
      mo === 'old' ? collapseOldFetchToolContentForLlm(c) : shrinkToolMessageContentForLlm(c, FETCH_TOOL_MAX_OPENAI_TOOL_CHARS);
    return { ...m, content };
  });
}

/** Tail size for finalize-only OpenAI calls (full `messages` still used server-side for evidence). */
const FETCH_FINALIZE_API_MESSAGE_TAIL = 14;

/**
 * Shorter message list for finalize OpenAI request — reduces latency vs sending the entire thread.
 * @param {object[]} messages
 * @param {object[]} leadsIn
 * @returns {object[]}
 */
function compactMessagesForFinalizeApi(messages, leadsIn) {
  const list = Array.isArray(messages) ? messages : [];
  const compact = compactLeadsForLlm(leadsIn);
  const system =
    list[0] && list[0].role === 'system'
      ? { ...list[0] }
      : { role: 'system', content: FETCH_URL_TOOL_SYSTEM };
  const afterSystem = list[0] && list[0].role === 'system' ? list.slice(1) : list;
  const tail = afterSystem.slice(-FETCH_FINALIZE_API_MESSAGE_TAIL);
  return [
    system,
    { role: 'user', content: `Leads JSON:\n${JSON.stringify(compact)}` },
    ...tail.map((m) => ({ ...m })),
  ];
}

/**
 * @param {object[]} messages OpenAI chat messages
 * @returns {Promise<object>} assistant message object (content and/or tool_calls)
 */
async function openAiChatWithFetchTool(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages,
      tools: [FETCH_URL_FUNCTION],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    logWarn('OpenAI fetch-tool error', { status: res.status, body: t.slice(0, 400) });
    let friendly = 'openai_http_error';
    try {
      const j = JSON.parse(t);
      const code = j?.error?.code;
      const m = String(j?.error?.message || '').trim();
      if (code === 'context_length_exceeded') {
        friendly = `openai_context_length_exceeded (${OPENAI_MODEL}): use fewer/lighter fetch rounds or a larger-context model.`;
      } else if (m) {
        friendly = `openai_http_error: ${m.slice(0, 400)}`;
      }
    } catch {
      /* leave generic */
    }
    throw Object.assign(new Error(friendly), { status: res.status, body: t.slice(0, 500) });
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') throw new Error('openai_empty_message');
  return msg;
}

/**
 * One chat completion without tools — used when fetch rounds are exhausted or the tool loop stalls.
 * @param {object[]} messages full conversation (evidence source for downstream enrichOne)
 * @param {object[]|null} [leadsIn] when set, OpenAI payload uses a trimmed tail + fresh lead JSON for speed
 * @returns {Promise<object>} assistant message (content string)
 */
async function openAiChatFetchFinalJsonOnly(messages, leadsIn = null) {
  const apiBase =
    leadsIn != null && Array.isArray(leadsIn) && leadsIn.length
      ? compactMessagesForFinalizeApi(messages, leadsIn)
      : messages;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [...cloneMessagesForOpenAiFetchTool(apiBase), { role: 'user', content: FETCH_URL_FINALIZE_USER }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    logWarn('OpenAI fetch-tool finalize error', { status: res.status, body: t.slice(0, 400) });
    let friendly = 'openai_http_error';
    try {
      const j = JSON.parse(t);
      const code = j?.error?.code;
      const m = String(j?.error?.message || '').trim();
      if (code === 'context_length_exceeded') {
        friendly = `openai_context_length_exceeded (${OPENAI_MODEL}): use fewer/lighter fetch rounds or a larger-context model.`;
      } else if (m) {
        friendly = `openai_http_error: ${m.slice(0, 400)}`;
      }
    } catch {
      /* leave generic */
    }
    throw Object.assign(new Error(friendly), { status: res.status, body: t.slice(0, 500) });
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') throw new Error('openai_empty_message');
  return msg;
}

/**
 * @param {string} content
 * @param {object[]} leadsIn
 * @param {object[]} messages conversation (for evidence extraction)
 * @param {object} options
 * @returns {Promise<object[]|null>}
 */
async function leadsOutFromFetchChoiceContent(content, leadsIn, messages, options) {
  const parsed = extractJsonObjectWithItems(content || '');
  if (!parsed) return null;
  const llmByUser = itemsArrayToLlmMap(parsed.items);
  const doVerify = false;
  const fetchedByHost = fetchedEmailsByHostFromMessages(messages);
  const fetchedByUsername = fetchedEmailsByUsernameFromMessages(messages);
  const fetchedPhonesByHost = fetchedPhonesByHostFromMessages(messages);
  const fetchedPhonesByUsername = fetchedPhonesByUsernameFromMessages(messages);
  const leadsOut = [];
  for (const row of leadsIn) {
    const rowUser = String(row?.username || '').trim().toLowerCase();
    const fromUser = fetchedByUsername.get(rowUser) || new Set();
    const fromHost = extraEvidenceEmailsForLead(row, fetchedByHost);
    const combined = new Set([...fromUser, ...fromHost]);
    const phonesFromUser = fetchedPhonesByUsername.get(rowUser) || new Set();
    const phonesFromHost = extraEvidencePhonesForLead(row, fetchedPhonesByHost);
    const combinedPhones = new Set([...phonesFromUser, ...phonesFromHost]);
    leadsOut.push(
      await enrichOne(row, llmByUser, doVerify, {
        extraEvidenceEmails: combined,
        extraEvidencePhones: combinedPhones,
        excludeFakeEmails: options.excludeFakeEmails !== false,
      }),
    );
  }
  return leadsOut;
}

/**
 * @param {object[]} leadsIn
 * @param {object} options
 * @param {object} body raw POST body
 * @returns {Promise<{ kind: 'needs_fetch'; messages: object[]; fetchJobs: object[]; prefilledToolResults: object[] } | { kind: 'done'; leadsOut: object[] }>}
 */
async function handleEnrichFetchUrlToolFlow(leadsIn, options, body) {
  if (!OPENAI_API_KEY) {
    throw Object.assign(new Error('OPENAI_API_KEY missing'), { code: 'openai_missing' });
  }
  const clientRound = Number(body.toolRound) || 0;
  /** New browser fetches are issued only while toolRound stays below this cap (then we prefill skips and/or finalize). */
  const allowNewFetchJobs = clientRound < FETCH_TOOL_MAX_ROUNDS;

  let messages =
    Array.isArray(body.messages) && body.messages.length > 0 ? [...body.messages] : null;
  const toolResultsIn = Array.isArray(body.toolResults) ? body.toolResults : [];

  if (!messages) {
    const compact = compactLeadsForLlm(leadsIn);
    messages = [
      { role: 'system', content: FETCH_URL_TOOL_SYSTEM },
      { role: 'user', content: `Leads JSON:\n${JSON.stringify(compact)}` },
    ];
  }
  const validUsernames = new Set(leadsIn.map((r) => String(r?.username || '').trim().toLowerCase()).filter(Boolean));

  for (const tr of toolResultsIn) {
    if (!tr || typeof tr !== 'object') continue;
    const id = String(tr.tool_call_id || '').trim();
    const content = String(tr.content != null ? tr.content : '').slice(0, 120000);
    if (!id) continue;
    messages.push({ role: 'tool', tool_call_id: id, content });
  }

  const priorFetchCounts = completedFetchUrlCountByUsername(messages);

  if (!allowNewFetchJobs) {
    logWarn('fetch_url round budget exhausted; one-shot finalize (skip tool model)', { toolRound: clientRound });
    const finalMsg = await openAiChatFetchFinalJsonOnly(messages, leadsIn);
    const budgetOut = await leadsOutFromFetchChoiceContent(finalMsg.content || '', leadsIn, messages, options);
    if (!budgetOut) throw new Error('openai_final_parse_failed_after_forced_finalize');
    return { kind: 'done', leadsOut: budgetOut };
  }

  const INNER_MAX = 6;
  for (let inner = 0; inner < INNER_MAX; inner++) {
    const choice = await openAiChatWithFetchTool(cloneMessagesForOpenAiFetchTool(messages));
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

    if (!toolCalls.length) {
      const leadsOut = await leadsOutFromFetchChoiceContent(choice.content, leadsIn, messages, options);
      if (!leadsOut) throw new Error('openai_final_parse_failed');
      return { kind: 'done', leadsOut };
    }

    const assistantMsg = {
      role: 'assistant',
      content: choice.content || null,
      tool_calls: toolCalls,
    };
    const messagesWithAssistant = [...messages, assistantMsg];

    /** @type {{ toolCallId: string, url: string, username: string }[]} */
    const validFetchCandidates = [];
    /** @type {{ tool_call_id: string, content: string }[]} */
    const prefilledToolResults = [];

    for (const tc of toolCalls) {
      const tcId = String(tc.id || '').trim();
      const fn = tc.function?.name;
      if (!tcId) continue;
      if (fn !== 'fetch_url') {
        prefilledToolResults.push({ tool_call_id: tcId, content: 'Only fetch_url is supported.' });
        continue;
      }
      let url = '';
      let username = '';
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        url = String(args.url || '').trim();
        username = String(args.username || '').trim();
      } catch {
        prefilledToolResults.push({ tool_call_id: tcId, content: 'Invalid JSON in fetch_url arguments.' });
        continue;
      }
      if (!validUsernames.has(username.toLowerCase())) {
        prefilledToolResults.push({
          tool_call_id: tcId,
          content: `Invalid username for fetch_url: ${username}`,
        });
        continue;
      }
      if (!isFetchUrlAllowedForTool(url)) {
        prefilledToolResults.push({
          tool_call_id: tcId,
          content: `URL not allowed (must be http(s), not Instagram, not localhost): ${url}`,
        });
        continue;
      }
      validFetchCandidates.push({ toolCallId: tcId, url, username });
    }

    const orderedCandidates = breadthFirstByUsername(validFetchCandidates);
    /** @type {typeof orderedCandidates} */
    const fetchJobs = [];
    /** @type {Map<string, number>} */
    const scheduledThisRound = new Map();
    for (const job of orderedCandidates) {
      const u = String(job.username || '').trim().toLowerCase();
      const prior = priorFetchCounts.get(u) || 0;
      const inThisRound = scheduledThisRound.get(u) || 0;
      if (prior + inThisRound >= FETCH_TOOL_MAX_FETCHES_PER_LEAD) {
        prefilledToolResults.push({
          tool_call_id: job.toolCallId,
          content: `Skipped: per-lead fetch budget reached (${FETCH_TOOL_MAX_FETCHES_PER_LEAD} URL(s) per username for this batch).`,
        });
        continue;
      }
      if (fetchJobs.length >= FETCH_TOOL_MAX_URLS) {
        prefilledToolResults.push({
          tool_call_id: job.toolCallId,
          content: 'Skipped: max fetch_url calls per round reached.',
        });
        continue;
      }
      fetchJobs.push(job);
      scheduledThisRound.set(u, inThisRound + 1);
    }

    if (fetchJobs.length) {
      return {
        kind: 'needs_fetch',
        messages: messagesWithAssistant,
        fetchJobs,
        prefilledToolResults,
      };
    }

    for (const p of prefilledToolResults) {
      messagesWithAssistant.push({
        role: 'tool',
        tool_call_id: p.tool_call_id,
        content: p.content,
      });
    }
    messages = messagesWithAssistant;
  }

  logWarn('fetch_url inner loop exhausted; forcing final JSON (no tools)', { toolRound: clientRound });
  const finalMsg = await openAiChatFetchFinalJsonOnly(messages, leadsIn);
  const forcedOut = await leadsOutFromFetchChoiceContent(finalMsg.content || '', leadsIn, messages, options);
  if (!forcedOut) throw new Error('openai_final_parse_failed_after_forced_finalize');
  return { kind: 'done', leadsOut: forcedOut };
}

/**
 * @param {object[]} leads
 * @param {{ llm?: boolean, verify?: boolean }} options
 */
async function runLlmBatch(leads, options) {
  const useLlm = options.llm !== false;
  if (!useLlm) return new Map();

  if (!OPENAI_API_KEY) {
    throw Object.assign(new Error('OPENAI_API_KEY missing'), { code: 'openai_missing' });
  }

  const compact = compactLeadsForLlm(leads);

  const schema = {
    name: 'lead_enrich_batch',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              username: { type: 'string' },
              email_suggested: { type: 'string' },
              email_action: { type: 'string', enum: ['keep', 'replace', 'clear'] },
              email_confidence_0_1: { type: 'number' },
              phone_suggested: { type: 'string' },
              phone_action: { type: 'string', enum: ['keep', 'replace', 'clear'] },
              phone_confidence_0_1: { type: 'number' },
            },
            required: [
              'username',
              'email_suggested',
              'email_action',
              'email_confidence_0_1',
              'phone_suggested',
              'phone_action',
              'phone_confidence_0_1',
            ],
          },
        },
      },
      required: ['items'],
    },
  };

  const system = `You enrich Instagram lead rows for a CRM export. Only improve contact fields (email + phone), never segmentation. email_action: keep = keep current email; replace = use email_suggested (must be exact evidence); clear = remove email. phone_action: keep = keep current phone; replace = use phone_suggested (must be exact evidence); clear = remove phone. Respect username keys exactly.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify(compact),
        },
      ],
      response_format: { type: 'json_schema', json_schema: schema },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    logWarn('OpenAI error', { status: res.status, body: t.slice(0, 400) });
    throw Object.assign(new Error('openai_http_error'), { status: res.status, body: t.slice(0, 500) });
  }

  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt || typeof txt !== 'string') throw new Error('openai_empty_content');
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    throw new Error('openai_invalid_json');
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  /** @type {Map<string, object>} */
  const byUser = new Map();
  for (const it of items) {
    const u = String(it?.username || '').trim();
    if (u) byUser.set(u.toLowerCase(), it);
  }
  return byUser;
}

/**
 * @param {object} row
 * @param {Map<string, object>} llmByUser
 * @param {boolean} _doVerify kept for backward signature compatibility (unused)
 * @param {{ extraEvidenceEmails?: Set<string>, extraEvidencePhones?: Set<string>, excludeFakeEmails?: boolean }} [extras]
 */
async function enrichOne(row, llmByUser, _doVerify, extras) {
  const username = String(row.username || '').trim();
  const key = username.toLowerCase();
  const candidates = emailCandidatesForRow(row);
  const phoneCandidates = phoneCandidatesForRow(row);
  if (extras?.extraEvidenceEmails && extras.extraEvidenceEmails.size) {
    for (const em of extras.extraEvidenceEmails) candidates.push(em);
  }
  if (extras?.extraEvidencePhones && extras.extraEvidencePhones.size) {
    for (const ph of extras.extraEvidencePhones) phoneCandidates.push(ph);
  }
  const rescored = pickBestEmail(candidates) || '';
  const rescoredPhone = pickBestPhone(phoneCandidates) || '';
  const evidenceEmails = new Set(candidates.map((x) => normalizeEmailCandidate(String(x || ''))).filter(Boolean));
  const evidencePhones = new Set(phoneCandidates.map((x) => normalizePhoneCandidate(String(x || ''))).filter(Boolean));

  const out = {
    ...row,
    email_deterministic: rescored,
    email_quality_codes: [],
  };

  if (rescored && rescored !== String(row.email || '').trim().toLowerCase()) {
    out.email_quality_codes = [...(out.email_quality_codes || []), 'rescored_from_bio_or_url'];
  }

  out.phone = rescoredPhone || normalizePhoneCandidate(String(row.phone || '')) || '';

  const llm = llmByUser.get(key);
  if (llm) {
    out.email_confidence_0_1 = Math.max(0, Math.min(1, Number(llm.email_confidence_0_1) || 0));
    out.phone_confidence_0_1 = Math.max(0, Math.min(1, Number(llm.phone_confidence_0_1) || 0));

    const action = String(llm.email_action || 'keep');
    const suggested = normalizeEmailCandidate(String(llm.email_suggested || ''));
    const suggestedInEvidence = suggested ? evidenceEmails.has(suggested) : false;
    const phoneAction = String(llm.phone_action || 'keep');
    const phoneSuggested = normalizePhoneCandidate(String(llm.phone_suggested || ''));
    const phoneSuggestedInEvidence = phoneSuggested ? evidencePhones.has(phoneSuggested) : false;

    if (action === 'clear') {
      out.email = '';
      out.email_action = 'clear';
    } else if (action === 'replace' && suggested && !suggestedInEvidence) {
      out.email = rescored || row.email || '';
      out.email_action = 'keep';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'llm_replace_not_in_evidence'];
    } else if (action === 'replace' && suggested && out.email_confidence_0_1 >= 0.45) {
      out.email = suggested;
      out.email_action = 'replace';
    } else if (action === 'replace' && suggested) {
      out.email = rescored || row.email || '';
      out.email_action = 'keep';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'llm_replace_low_confidence'];
    } else {
      out.email = rescored || String(row.email || '').trim();
      out.email_action = 'keep';
    }
    if (phoneAction === 'clear') {
      out.phone = '';
      out.phone_action = 'clear';
    } else if (phoneAction === 'replace' && phoneSuggested && !phoneSuggestedInEvidence) {
      out.phone = rescoredPhone || normalizePhoneCandidate(String(row.phone || '')) || '';
      out.phone_action = 'keep';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'llm_phone_replace_not_in_evidence'];
    } else if (phoneAction === 'replace' && phoneSuggested && out.phone_confidence_0_1 >= 0.45) {
      out.phone = phoneSuggested;
      out.phone_action = 'replace';
    } else if (phoneAction === 'replace' && phoneSuggested) {
      out.phone = rescoredPhone || normalizePhoneCandidate(String(row.phone || '')) || '';
      out.phone_action = 'keep';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'llm_phone_replace_low_confidence'];
    } else {
      out.phone = rescoredPhone || normalizePhoneCandidate(String(row.phone || '')) || '';
      out.phone_action = 'keep';
    }
  } else {
    out.email = rescored || String(row.email || '').trim();
    out.phone = rescoredPhone || normalizePhoneCandidate(String(row.phone || '')) || '';
    out.email_action = out.email_action || 'keep';
    out.phone_action = out.phone_action || 'keep';
  }

  if (extras?.excludeFakeEmails !== false && out.email) {
    const normalizedFinal = normalizeEmailCandidate(String(out.email || ''));
    if (!normalizedFinal || isLikelyPlaceholderEmail(normalizedFinal)) {
      out.email = '';
      out.email_action = 'clear';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'placeholder_email_filtered'];
    } else {
      out.email = normalizedFinal;
    }
  }

  out.phone = normalizePhoneCandidate(String(out.phone || '')) || '';

  delete out.email_deterministic;
  return out;
}

async function handleEnrich(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const leadsIn = Array.isArray(body.leads) ? body.leads : [];
  const options = body.options && typeof body.options === 'object' ? body.options : {};

  if (leadsIn.length === 0) {
    return res.status(400).json({ error: 'validation', message: 'leads array required' });
  }
  if (leadsIn.length > MAX_LEADS) {
    return res.status(400).json({
      error: 'too_many_leads',
      message: `Max ${MAX_LEADS} leads per request`,
    });
  }

  for (const r of leadsIn) {
    if (!r || typeof r !== 'object' || !String(r.username || '').trim()) {
      return res.status(400).json({ error: 'validation', message: 'Each lead must have a username' });
    }
  }

  if (options.fetchUrlTool === true) {
    if (options.llm === false) {
      return res.status(400).json({
        error: 'validation',
        message: 'fetchUrlTool requires LLM to be enabled.',
      });
    }
    try {
      const out = await handleEnrichFetchUrlToolFlow(leadsIn, options, body);
      if (out.kind === 'needs_fetch') {
        return res.json({
          status: 'needs_fetch',
          messages: out.messages,
          fetchJobs: out.fetchJobs,
          prefilledToolResults: out.prefilledToolResults,
          toolRound: Number(body.toolRound) || 0,
          meta: { model: OPENAI_MODEL },
        });
      }
      const leadsOut = out.leadsOut;
      logInfo('enrich_ok', {
        count: leadsOut.length,
        llm: true,
        verify: options.verify === true,
        fetchUrlTool: true,
        sampleUser: leadsOut[0]?.username,
        sampleEmail: leadsOut[0]?.email ? redactEmail(leadsOut[0].email) : '(none)',
      });
      return res.json({
        leads: leadsOut,
        meta: { model: OPENAI_MODEL, count: leadsOut.length, fetchUrlTool: true },
      });
    } catch (e) {
      logWarn('fetchUrlTool enrich failed', { err: String(e?.message || e) });
      return res.status(502).json({
        error: 'llm_failed',
        message: String(e?.message || e),
      });
    }
  }

  let llmByUser = new Map();
  if (options.llm !== false) {
    try {
      llmByUser = await runLlmBatch(leadsIn, { llm: true });
    } catch (e) {
      logWarn('LLM batch failed', { err: String(e?.message || e) });
      return res.status(502).json({
        error: 'llm_failed',
        message: String(e?.message || e),
      });
    }
  }

  const doVerify = false;
  const leadsOut = [];
  for (const row of leadsIn) {
    leadsOut.push(
      await enrichOne(row, llmByUser, doVerify, {
        excludeFakeEmails: options.excludeFakeEmails !== false,
      }),
    );
  }

  logInfo('enrich_ok', {
    count: leadsOut.length,
    llm: options.llm !== false,
    verify: doVerify,
    sampleUser: leadsOut[0]?.username,
    sampleEmail: leadsOut[0]?.email ? redactEmail(leadsOut[0].email) : '(none)',
  });

  return res.json({ leads: leadsOut, meta: { model: OPENAI_MODEL, count: leadsOut.length } });
}

function compactLeadsForJosh(leads) {
  return leads.slice(0, 200).map((r) => ({
    username: String(r.username || ''),
    followerCount: r.followerCount ?? null,
    bio: String(r.bio || '').slice(0, 500),
    email: String(r.email || ''),
    phone: String(r.phone || ''),
    websiteUrl: String(r.websiteUrl || '').slice(0, 200),
    email_action: String(r.email_action || ''),
    phone_action: String(r.phone_action || ''),
  }));
}

const JOSH_CHAT_SCHEMA = {
  name: 'megaleads_josh_chat',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: { type: 'string' },
    },
    required: ['reply'],
  },
};

/**
 * Offline / degraded Josh: always returns something readable (no OpenAI or on failure).
 * Josh is Q&A only — never implies he can run exports, filters, or edits for the user.
 * @param {string} userMessage
 * @param {number} leadCount
 */
function joshFallbackReply(userMessage, leadCount) {
  const q = String(userMessage || '').toLowerCase();
  const n = Number.isFinite(leadCount) ? leadCount : 0;
  const rows = n === 1 ? '1 lead row' : `${n} lead rows`;

  if (
    (q.includes('what') && (q.includes('program') || q.includes('app') || q.includes('this'))) ||
    q.includes('what is megaleads') ||
    q.includes('what does this do')
  ) {
    return `MegaLeadsAI is a Chrome extension for Instagram lead gathering: you run extraction from the toolbar on a followers, following, or hashtag page, then review results on the dashboard (username, followers, bio, email when found, phone, website).

This chat is **questions and answers only** — I do not change your list, export files, or run tools for you. Use the dashboard buttons for filter, export, clear, and AI enrich.

You have about ${rows} loaded right now. For live answers, set \`openAiApiKey\` in scripts/leadflow-remote-config.js (extension) or OPENAI_API_KEY on the Render service.`;
  }

  return `I'm Josh — I can explain MegaLeadsAI and how the dashboard works. This chat is **read-only help**: I can't filter, export, delete, or edit leads for you; use the controls on the page.

You have about ${rows} in the current view.

If you only see this canned text, add your OpenAI key: either \`openAiApiKey\` in leadflow-remote-config.js (Josh sends it with the chat request) or OPENAI_API_KEY on the server.`;
}

/**
 * OpenAI-backed Josh (Q&A only, strict JSON { reply }).
 * @param {string} userMessage
 * @param {unknown[]} leads
 * @param {Record<string, unknown>} uiState
 * @param {string} openAiBearerKey OpenAI sk-… from client body or server env
 */
async function runJoshChatOpenAI(userMessage, leads, uiState, openAiBearerKey) {
  const key = String(openAiBearerKey || '').trim();
  if (!key) {
    throw Object.assign(new Error('OPENAI_API_KEY missing'), { code: 'openai_missing' });
  }
  const system = `You are Josh, the in-app helper for MegaLeadsAI (Instagram lead extraction for marketers).

Product facts:
- Chrome extension: user starts extraction from the toolbar on Instagram (followers / following / hashtag).
- Dashboard shows columns: username, followerCount, bio, email, phone, websiteUrl, etc.
- Users filter, sort, export, clear, and run optional AI enrich using **dashboard UI**, not through you.

Your role (critical):
- You are a **chat-only Q&A assistant**. You answer questions, give tips, and clarify how features work.
- You **must not** imply you can perform actions on the user's lead list (no "I'll export that", "I filtered it", "I deleted those", "I'll run enrich for you").
- If they ask you to do something, politely tell them which **dashboard or toolbar control** to use instead.
- Keep replies concise (2–5 short sentences) unless they ask for detail.
- Never output JSON except what the API schema requires.

Return strict JSON: a single string field "reply" only.`;

  const payload = {
    userMessage: String(userMessage || ''),
    uiState: uiState && typeof uiState === 'object' ? uiState : {},
    leadsPreview: compactLeadsForJosh(Array.isArray(leads) ? leads : []),
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      response_format: { type: 'json_schema', json_schema: JOSH_CHAT_SCHEMA },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw Object.assign(new Error(`openai_http_${res.status}`), { body: t.slice(0, 500) });
  }
  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt || typeof txt !== 'string') throw new Error('openai_empty_content');
  const parsed = JSON.parse(txt);
  const reply = String(parsed?.reply || '').trim().slice(0, 2000);
  if (!reply) throw new Error('openai_empty_reply');
  return { reply, actions: [] };
}

/**
 * Josh chat: prefer OpenAI (client `openAiApiKey` in JSON body, else server OPENAI_API_KEY).
 * Always respond with { reply, actions: [] } (actions unused, kept for older clients).
 * @param {string} userMessage
 * @param {unknown[]} leads
 * @param {Record<string, unknown>} uiState
 * @param {string} [clientOpenAiKey] optional sk-… from extension leadflow-remote-config.js
 */
async function runJoshChatWithActions(userMessage, leads, uiState, clientOpenAiKey = '') {
  const leadCount = Array.isArray(leads) ? leads.length : 0;
  const fromClient = String(clientOpenAiKey || '').trim();
  const fromServer = OPENAI_API_KEY;
  const openAiBearer = fromClient || fromServer;
  if (!openAiBearer) {
    logInfo('josh_chat_fallback_no_openai_key', { leadCount });
    return { reply: joshFallbackReply(userMessage, leadCount), actions: [] };
  }
  try {
    return await runJoshChatOpenAI(userMessage, leads, uiState, openAiBearer);
  } catch (e) {
    logWarn('josh_chat_openai_failed', { err: String(e?.message || e) });
    return { reply: joshFallbackReply(userMessage, leadCount), actions: [] };
  }
}

async function handleJoshChat(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userMessage = String(body.userMessage || '').trim();
  const leads = Array.isArray(body.leads) ? body.leads : [];
  const uiState = body.uiState && typeof body.uiState === 'object' ? body.uiState : {};
  const clientOpenAiKey = String(body.openAiApiKey || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'validation', message: 'userMessage is required' });
  }
  try {
    const out = await runJoshChatWithActions(userMessage, leads, uiState, clientOpenAiKey);
    return res.json(out);
  } catch (e) {
    logWarn('josh_chat_failed', { err: String(e?.message || e) });
    return res.status(502).json({
      error: 'josh_failed',
      message: 'Something went wrong loading Josh. Try again in a moment.',
    });
  }
}

function main() {
  const app = express();
  app.disable('x-powered-by');
  attachStripeWebhookRoute(app);
  app.use(express.json({ limit: '3mb' }));

  const healthJson = { ok: true, service: 'leadflow-enrich', env: NODE_ENV };
  /** Root + `/health` both return 200 so Render (and other probes) work with default `/` checks. */
  app.get('/health', (_req, res) => {
    res.json(healthJson);
  });
  app.get('/', (_req, res) => {
    res.json(healthJson);
  });

  app.post('/v1/leads/enrich', requireBearer, (req, res, next) => {
    handleEnrich(req, res).catch(next);
  });
  app.post('/v1/free-tier/status', requireBearer, (req, res, next) => {
    handleFreeTierStatus(req, res).catch(next);
  });
  app.post('/v1/admin/subscribers', requireBearer, (req, res, next) => {
    handleAdminSubscribers(req, res).catch(next);
  });
  app.post('/v1/josh/chat', requireBearer, (req, res, next) => {
    handleJoshChat(req, res).catch(next);
  });
  app.get('/v1/stripe/checkout-return', handleStripeCheckoutReturn);
  app.post('/v1/stripe/checkout-session', requireBearer, (req, res, next) => {
    handleStripeCheckoutSession(req, res).catch(next);
  });
  app.post('/v1/stripe/subscription-status', requireBearer, (req, res, next) => {
    handleStripeSubscriptionStatus(req, res).catch(next);
  });
  app.post('/v1/stripe/manage-subscription-session', requireBearer, (req, res, next) => {
    handleStripeManageSubscriptionSession(req, res).catch(next);
  });

  app.use((err, _req, res, _next) => {
    logWarn('unhandled', { err: String(err?.message || err) });
    if (!res.headersSent) res.status(500).json({ error: 'internal', message: 'Server error' });
  });

  app.listen(PORT, () => {
    logInfo(`listening on ${PORT}`, {
      health: ['/', '/health'],
      enrich: 'POST /v1/leads/enrich',
      stripeCheckout: 'POST /v1/stripe/checkout-session',
      stripeManageSubscription: 'POST /v1/stripe/manage-subscription-session',
      stripeWebhook: 'POST /v1/stripe/webhook',
    });
  });
}

main();
