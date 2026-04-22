import { EMAIL_RE, pickBestEmail } from './email-quality.js';

/**
 * Instagram DOM helpers — centralized fallbacks for scroll roots, links, and text parsing.
 * Update here when Instagram changes layout.
 */

/** Path segments that are not profile usernames */
export const RESERVED_SEGMENTS = new Set([
  'explore',
  'accounts',
  'reels',
  'p',
  'stories',
  'direct',
  'legal',
  'about',
  'static',
  'developer',
  'privacy',
  'terms',
  'directory',
  'download',
  'tv',
]);

/**
 * @param {string} pathname
 * @returns {string|null} username or null
 */
export function usernameFromProfilePath(pathname) {
  const p = pathname.replace(/\/$/, '');
  const m = p.match(/^\/([^/]+)\/?$/);
  if (!m) return null;
  const u = m[1];
  if (RESERVED_SEGMENTS.has(u.toLowerCase())) return null;
  return u;
}

const IG_MEDIA_POST_PATH_RE = /^\/(p|reel|reels|tv)\/[^/]+\/?$/i;

function pathnameFromAnchor(a, baseOrigin) {
  try {
    const href = a.getAttribute('href') || a.href || '';
    return new URL(href, baseOrigin).pathname;
  } catch {
    return a.pathname || '';
  }
}

function usernameFromExploreTileAria(el) {
  let hop = el;
  for (let d = 0; d < 14 && hop; d++) {
    const al = hop.getAttribute?.('aria-label') || '';
    if (al.length > 3) {
      const m = al.match(
        /\b(?:photo|clip|reel|carousel|video)\s+(?:shared\s+)?by\s+(@?)([\w.]+)\b/i,
      );
      if (m && m[2] && !RESERVED_SEGMENTS.has(m[2].toLowerCase())) return m[2];
    }
    hop = hop.parentElement;
  }
  return null;
}

function syntheticAnchorForUsername(doc, username) {
  const a = doc.createElement('a');
  a.href = `/${username}/`;
  return a;
}

function findExistingProfileAnchorForUsername(doc, username, origin) {
  const want = `/${username}`.toLowerCase();
  const all = doc.querySelectorAll('a[href]');
  for (let i = 0; i < all.length; i++) {
    const link = all[i];
    if (!(link instanceof HTMLAnchorElement)) continue;
    const p = pathnameFromAnchor(link, origin).replace(/\/$/, '').toLowerCase();
    if (p === want) return link;
  }
  return null;
}

function findProfileAnchorNearMediaTile(mediaAnchor, doc) {
  const origin = doc.defaultView?.location?.origin || 'https://www.instagram.com';
  const mediaPath = pathnameFromAnchor(mediaAnchor, origin).replace(/\/$/, '');
  if (!IG_MEDIA_POST_PATH_RE.test(mediaPath)) return null;
  let hop = mediaAnchor.parentElement;
  for (let d = 0; d < 22 && hop; d++) {
    const links = hop.querySelectorAll('a[href]');
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!(link instanceof HTMLAnchorElement)) continue;
      const p = pathnameFromAnchor(link, origin).replace(/\/$/, '');
      if (IG_MEDIA_POST_PATH_RE.test(p)) continue;
      const u = usernameFromProfilePath(pathnameFromAnchor(link, origin));
      if (u) return link;
    }
    hop = hop.parentElement;
  }
  const fromAria = usernameFromExploreTileAria(mediaAnchor);
  if (fromAria) {
    const found = findExistingProfileAnchorForUsername(doc, fromAria, origin);
    if (found) return found;
    return syntheticAnchorForUsername(doc, fromAria);
  }
  return null;
}

function hashtagFromExploreSearchQuery(qRaw) {
  if (qRaw == null || typeof qRaw !== 'string') return null;
  let s = qRaw.trim();
  if (!s) return null;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  s = s.trim().replace(/^#+/, '').trim();
  if (!s || s.length > 200) return null;
  return s;
}

/** `/en/username/followers` → `/username/followers` — keep in sync with content/chunk-01-constants-dom-contacts.js */
function stripLeadingLocalePath(pathname) {
  const p = (pathname || '/').replace(/\/$/, '') || '/';
  const m = p.match(/^\/([a-z]{2}|[a-z]{2}-[a-z]{2})\/(.+)$/i);
  if (m && m[2]) return `/${m[2]}`;
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * @param {Location | { pathname: string, search?: string }} loc
 */
export function detectPageMode(loc) {
  const path = stripLeadingLocalePath(loc.pathname);
  const tagMatch = path.match(/^\/explore\/tags\/([^/]+)\/?$/i);
  if (tagMatch) return { mode: 'hashtag', tag: decodeURIComponent(tagMatch[1]) };

  if (path === '/explore/search/keyword' || path.startsWith('/explore/search/keyword/')) {
    try {
      const sp = new URLSearchParams(loc.search || '');
      const tag = hashtagFromExploreSearchQuery(sp.get('q'));
      if (tag) return { mode: 'hashtag', tag };
    } catch {
      /* ignore */
    }
  }
  const um = path.match(/^\/([^/]+)(\/.*)?$/);
  if (um && !RESERVED_SEGMENTS.has(um[1].toLowerCase())) {
    const user = um[1];
    const rest = um[2] ? um[2].replace(/\/$/, '') : '';
    const tail = rest.replace(/^\//, '');
    if (!tail) return { mode: 'profile', user };
    const head = tail.split('/')[0].toLowerCase();
    if (head === 'followers') return { mode: 'followers', user };
    if (head === 'following') return { mode: 'following', user };
    return { mode: 'profile', user };
  }
  return { mode: 'unknown' };
}

/**
 * Find best scrollable element for list / feed.
 * @param {Document} doc
 * @returns {HTMLElement}
 */
export function findScrollRoot(doc) {
  const dialog = doc.querySelector('[role="dialog"]');
  if (dialog) {
    const scrollables = dialog.querySelectorAll('*');
    let best = null;
    let bestArea = 0;
    for (const el of scrollables) {
      if (!(el instanceof HTMLElement)) continue;
      const st = doc.defaultView.getComputedStyle(el);
      const oy = st.overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    if (best) return best;
  }

  const main = doc.querySelector('main') || doc.querySelector('[role="main"]');
  if (main) {
    const cand = findLargestScrollableChild(main, doc.defaultView);
    if (cand) return cand;
    if (main.scrollHeight > main.clientHeight + 2) return main;
  }

  const body = doc.body;
  const docEl = doc.documentElement;
  if (body && body.scrollHeight > body.clientHeight + 2) return body;
  return docEl;
}

/**
 * @param {Element} root
 * @param {Window} win
 * @returns {HTMLElement|null}
 */
function findLargestScrollableChild(root, win) {
  let best = null;
  let bestArea = 0;
  const walk = root.querySelectorAll('*');
  for (const el of walk) {
    if (!(el instanceof HTMLElement)) continue;
    const st = win.getComputedStyle(el);
    if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 2) continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best;
}

/**
 * Human-like scroll: variable chunk, occasional small scroll back.
 * @param {HTMLElement} el
 */
export function humanScrollStep(el) {
  const win = el.ownerDocument.defaultView;
  const viewH = el === el.ownerDocument.documentElement || el === el.ownerDocument.body
    ? win.innerHeight
    : el.clientHeight;
  const chunk = viewH * (0.35 + Math.random() * 0.85);
  let delta = chunk * (0.85 + Math.random() * 0.35);
  if (Math.random() < 0.12) delta = -Math.min(delta * 0.35, el.scrollTop);

  const maxScroll = el.scrollHeight - el.clientHeight;
  const next = Math.max(0, Math.min(maxScroll, el.scrollTop + delta));
  el.scrollTop = next;
}

/** Loose phone: +, digits, spaces, dashes, parens */
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,9}\b/g;

/**
 * @param {string} text
 * @returns {{ email: string|null, phone: string|null, contact: string|null }}
 */
export function extractContacts(text) {
  if (!text) return { email: null, phone: null, contact: null };
  let normalized = String(text).replace(/mailto:/gi, '');
  const emails = normalized.match(EMAIL_RE);
  const email = pickBestEmail(emails || []);
  let phone = null;
  const phones = normalized.match(PHONE_RE);
  if (phones) {
    phone = pickBestPhoneCandidate(phones);
  }
  if (!phone) {
    const wa = normalized.match(/(?:wa\.me|api\.whatsapp\.com\/send)\/(?:phone=)?(\d{8,15})/i);
    if (wa) phone = normalizePhoneCandidate(`+${wa[1]}`);
  }
  if (!phone) {
    const tel = normalized.match(/\btel:\s*([+\d][\d\s().-]{6,20}\d)/i);
    if (tel) phone = normalizePhoneCandidate(tel[1]);
  }
  if (!phone) {
    const intl = normalized.match(/\+[1-9]\d{9,14}\b/);
    if (intl) phone = normalizePhoneCandidate(intl[0]);
  }
  if (!phone) {
    const us = normalized.match(
      /\b(?:\(\d{3}\)\s*|\d{3}[-.\s])\d{3}[-.\s]?\d{4}\b/,
    );
    if (us) phone = normalizePhoneCandidate(us[0]);
  }
  const contact = [email, phone].filter(Boolean).join(' · ') || null;
  return { email, phone, contact };
}

function looksLikeDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return false;
  if (a < 1 || a > 31 || b < 1 || b > 12) return false;
  return m[3].length === 2 || (y >= 1900 && y <= 2099);
}

/** ISO `YYYY-MM-DD` / `YYYY/MM/DD` (not a phone). */
function looksLikeIsoCalendarDate(raw) {
  const t = String(raw || '').trim();
  const m = t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (y < 1900 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return true;
}

/** Year span like `1999-2006`, `1999–2006`, optional whitespace/tabs. */
function looksLikeYearSpan(raw) {
  const collapsed = String(raw || '')
    .trim()
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ');
  return /^\d{4}\s*[-–—]\s*\d{4}$/.test(collapsed);
}

function hasPhoneFormattingChars(raw) {
  return /[\s().\-]/.test(raw) || raw.trim().startsWith('+');
}

function isBarePlusOrDigits(raw) {
  const t = raw.trim().replace(/\s+/g, '');
  return /^\+?\d+$/.test(t);
}

function digitRunLowEntropy(digits) {
  if (digits.length < 10) return false;
  const set = new Set(digits.split(''));
  if (set.size <= 3) return true;
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] === digits[i - 1]) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 1;
    }
  }
  return maxRun >= Math.max(7, Math.floor(digits.length * 0.42));
}

/** `2-5350-6322` — nine digits with a fake 1-digit "area code"; never valid NANP. */
function looksLikeBrokenOneDigitAreaNanp(raw, digits) {
  if (digits.length !== 9) return false;
  const t = String(raw || '').trim().replace(/\s+/g, '');
  return /^\d[-.]?\d{4}[-.]?\d{4}$/.test(t);
}

/**
 * `91.1278708001772`-style float / build id: one dot, optional leading `+`, short integer part,
 * then 11+ subscriber digits with no real grouping. (Valid `91.XXXXXXXXXX` keeps ≤10 after the dot.)
 */
function looksLikeSingleDotLongFractionMantissa(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^\+/, '');
  if (!/^\d{1,4}\.\d+$/.test(s)) return false;
  const dot = s.indexOf('.');
  const fracDigits = s.slice(dot + 1).replace(/\D/g, '');
  return fracDigits.length >= 11;
}

/**
 * Dotted build / version ids like `2.20260420.01.00` (not a dial string; PHONE_RE still matches digit runs).
 * Keeps typical `206.555.1212` (three groups) untouched.
 */
function looksLikeDottedNumericBuildOrVersionId(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, '').replace(/^\+/, '');
  if (!/^[\d.]+$/.test(s)) return false;
  const parts = s.split('.');
  if (parts.length < 4 || !parts.every((p) => /^\d+$/.test(p))) return false;

  const head = parts[0];
  const second = parts[1];
  const tail = parts.slice(2);
  if (head.length > 3) return false;
  if (!tail.length || !tail.every((p) => p.length <= 4)) return false;

  if (second.length === 8) {
    const y = Number(second.slice(0, 4));
    const mo = Number(second.slice(4, 6));
    const d = Number(second.slice(6, 8));
    if (
      Number.isFinite(y) &&
      Number.isFinite(mo) &&
      Number.isFinite(d) &&
      y >= 1990 &&
      y <= 2099 &&
      mo >= 1 &&
      mo <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return true;
    }
  }

  return head.length <= 2 && second.length >= 6;
}

/** Strips a trailing ` 118`-style fragment after a full NANP block (`+1 904 690-1890 118`). */
function trimLooseDigitsAfterNanpStyle(base) {
  const s = String(base || '').trim();
  const m = s.match(
    /^((?:\+1|1)[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(\s+\d{1,5})$/i,
  );
  if (m && m[5]) return s.slice(0, s.length - m[5].length).trim();
  return s;
}

function normalizePhoneCandidate(raw, depth = 0) {
  if (!raw || typeof raw !== 'string') return '';
  let base = raw.trim().replace(EMAIL_TRAIL_RE, '');
  if (!base || base.includes('@')) return '';
  if (looksLikeDate(base) || looksLikeIsoCalendarDate(base) || looksLikeYearSpan(base)) return '';
  if (depth === 0) {
    const zipRest = base.match(/^(\d{5})[\s-]+(.+)$/);
    if (zipRest && /^\d{5}$/.test(zipRest[1]) && zipRest[2].trim()) {
      const rest = zipRest[2].trim();
      const inner = normalizePhoneCandidate(rest, 1);
      if (inner) return inner;
      base = rest;
    }
    base = trimLooseDigitsAfterNanpStyle(base);
  }
  const digits = base.replace(/\D/g, '');
  if (looksLikeBrokenOneDigitAreaNanp(base, digits)) return '';
  if (looksLikeSingleDotLongFractionMantissa(base)) return '';
  if (looksLikeDottedNumericBuildOrVersionId(base)) return '';
  if (digits.length < 8 || digits.length > 15) return '';
  if (digitRunLowEntropy(digits)) return '';
  if (isBarePlusOrDigits(base)) {
    const compact = base.trim().replace(/\s+/g, '');
    if (!compact.startsWith('+')) {
      if (digits.length < 10 || digits.length > 11) return '';
      if (digits.length === 11 && !digits.startsWith('1')) return '';
    } else if (digits.length < 10 || digits.length > 15) {
      return '';
    }
  } else if (!hasPhoneFormattingChars(base) && digits.length >= 12) {
    return '';
  }
  return base;
}

function pickBestPhoneCandidate(matches) {
  if (!matches || !matches.length) return null;
  const cands = [];
  for (let i = 0; i < matches.length; i++) {
    const n = normalizePhoneCandidate(matches[i]);
    if (n) cands.push(n);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => {
    const da = a.replace(/\D/g, '').length;
    const db = b.replace(/\D/g, '').length;
    if (da !== db) return db - da;
    const fa = hasPhoneFormattingChars(a) ? 0 : 1;
    const fb = hasPhoneFormattingChars(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return b.length - a.length;
  });
  return cands[0];
}

/**
 * Join text fragments and extract best email + phone (for merges / migration).
 * @param {(string|null|undefined)[]} parts
 * @returns {{ email: string, phone: string }}
 */
export function extractEmailPhoneFromParts(parts) {
  const blob = parts.filter((p) => p && String(p).trim()).join('\n');
  const ex = extractContacts(blob);
  return {
    email: (ex.email || '').trim(),
    phone: (ex.phone || '').trim(),
  };
}

/**
 * Parse "12.5K followers", "3M", "1,234" style counts from a blob of text.
 * @param {string} text
 * @returns {number|null}
 */
export function parseFollowerCountFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const near = lower.includes('follower')
    ? text
    : text;

  const m = near.match(/([\d.,]+)\s*([kmb])?\s*followers/i);
  if (m) return parseCompactNumber(m[1], m[2]);

  const m2 = near.match(/\b([\d.,]+)\s*([kmb])\b/i);
  if (m2) return parseCompactNumber(m2[1], m2[2]);

  const m3 = near.match(/(?:^|\s)([\d][\d.,]*)\s*followers/i);
  if (m3) return parseCompactNumber(m3[1], '');

  const m4 = text.match(/([\d.,]+[kmb]?)\s+followers?\b/i);
  if (m4) {
    const num = m4[1].replace(/[kmb]$/i, '');
    const suf = /[kmb]$/i.test(m4[1]) ? m4[1].slice(-1).toLowerCase() : '';
    return parseCompactNumber(num, suf);
  }

  return null;
}

/**
 * @param {string} numPart
 * @param {string} suffix
 */
function parseCompactNumber(numPart, suffix) {
  let n = parseFloat(numPart.replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  const s = (suffix || '').toLowerCase();
  if (s === 'k') n *= 1e3;
  else if (s === 'm') n *= 1e6;
  else if (s === 'b') n *= 1e9;
  return Math.round(n);
}

export function parseAccessibilityMetadata(anchor) {
  let fc = null;
  let el = anchor;
  for (let d = 0; d < 10 && el; d++) {
    if (el.getAttribute) {
      const al = el.getAttribute('aria-label') || '';
      const ti = el.getAttribute('title') || '';
      fc = fc ?? parseFollowerCountFromText(al) ?? parseFollowerCountFromText(ti);
    }
    el = el.parentElement;
  }
  return fc;
}

function cleanListRowBioLine(line, username) {
  let s = String(line)
    .replace(/\s+Follow\s*$/i, '')
    .replace(/\s+Following\s*$/i, '')
    .replace(/\s+Requested\s*$/i, '')
    .trim();
  if (!s) return '';
  if (/^(Follow|Following|Message|Requested)$/i.test(s)) return '';
  if (s.toLowerCase() === username.toLowerCase()) return '';
  return s;
}

/**
 * Full profile header (posts / followers / following), not a list row.
 */
export function isLikelyProfileHeroBlurb(text) {
  if (!text || text.length < 30) return false;
  const t = text.replace(/\s+/g, ' ');
  const hasPosts = /\b\d{1,4}\s*(posts?|post)\b/i.test(t);
  const hasFollowers = /\bfollowers?\b/i.test(t);
  const hasFollowing = /\bfollowing\b/i.test(t) || /\bseguit[oi]\b/i.test(t);
  return hasPosts && hasFollowers && hasFollowing;
}

/**
 * Collect profile anchors in subtree that look like /username/
 * @param {Document} doc
 * @param {Element} [root]
 * @returns {HTMLAnchorElement[]}
 */
export function collectProfileAnchors(doc, root) {
  const scope = root || doc.body;
  if (!scope) return [];
  const best = new Map();
  const origin = doc.defaultView?.location?.origin || 'https://www.instagram.com';

  function addProfileAnchor(a) {
    if (!(a instanceof HTMLAnchorElement)) return;
    const u = usernameFromProfilePath(pathnameFromAnchor(a, origin));
    if (!u) return;
    const k = u.toLowerCase();
    if (!best.has(k)) best.set(k, a);
  }

  for (const a of scope.querySelectorAll('a[href]')) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    addProfileAnchor(a);
  }

  for (const a of scope.querySelectorAll('a[href]')) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    const p = pathnameFromAnchor(a, origin).replace(/\/$/, '');
    if (!IG_MEDIA_POST_PATH_RE.test(p)) continue;
    const prof = findProfileAnchorNearMediaTile(a, doc);
    if (prof) addProfileAnchor(prof);
  }

  return [...best.values()];
}

/**
 * Walk up to find a row-like container and extract username, bio-ish text, follower count.
 * @param {HTMLAnchorElement} anchor
 * @param {string} username
 * @returns {{ username: string, bio: string, followerCount: number|null, email: string, phone: string, websiteUrl: string }}
 */
export function extractLeadFromProfileAnchor(anchor, username) {
  let el = anchor;
  for (let d = 0; d < 7; d++) {
    if (!el.parentElement) break;
    el = el.parentElement;
  }
  const container = el;
  const text = (container.innerText || '').replace(/\s+/g, ' ').trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  let bio = '';
  for (const line of lines) {
    if (/^follow(ed)? by\b/i.test(line)) continue;
    if (/^seguit[oa] da\b/i.test(line)) continue;
    if (isLikelyProfileHeroBlurb(line)) continue;
    const cleaned = cleanListRowBioLine(line, username);
    if (!cleaned) continue;
    if (cleaned.length > bio.length && cleaned.length < 500) bio = cleaned;
  }
  if (!bio && lines.length > 1) {
    const parts = lines
      .slice(1)
      .map((ln) => cleanListRowBioLine(ln, username))
      .filter(Boolean);
    const joined = parts.join(' ').slice(0, 400);
    bio = isLikelyProfileHeroBlurb(joined) ? '' : joined;
  }

  const fc = parseFollowerCountFromText(text) ?? parseAccessibilityMetadata(anchor);
  const { email, phone } = extractContacts(text);

  return {
    username,
    bio: bio.slice(0, 500),
    followerCount: fc,
    email: email || '',
    phone: phone || '',
    websiteUrl: '',
  };
}

/**
 * Normalize user query: strip @ # and trim
 * @param {string} q
 */
export function normalizeQuery(q) {
  return q.trim().replace(/^[@#]+/, '').trim();
}
