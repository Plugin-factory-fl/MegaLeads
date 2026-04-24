/**
 * MegaLeads content script - instagram.com only (chunk 1 of 5).
 * Loaded as classic scripts in order (see manifest.json); shared global scope, no `import`.
 * Chunks: (1) constants + DOM + contacts, (2) state + hashtag grid/API, (3) top_serp/graphql/friendships/queue,
 * (4) enrich + merge + session + waits, (5) runScrape + onMessage.
 * Keep in sync with scripts/constants.js + scripts/selectors.js where mirrored.
 * Email helpers: `content/chunk-00b-email-quality-global.js` → `globalThis.__LF_EMAIL_QUALITY__`.
 */

// --- email quality (from chunk-00b bridge; aligned with scripts/email-quality.js) ---
const LFEQ =
  typeof globalThis !== 'undefined' && globalThis.__LF_EMAIL_QUALITY__
    ? globalThis.__LF_EMAIL_QUALITY__
    : null;
if (!LFEQ) {
  throw new Error('[MegaLeads] __LF_EMAIL_QUALITY__ missing - chunk-00b-email-quality-global.js must load first.');
}
const EMAIL_RE = LFEQ.EMAIL_RE;
function normalizeEmailCandidate(raw) {
  return LFEQ.normalizeEmailCandidate(raw);
}
function pickBestEmail(candidates) {
  return LFEQ.pickBestEmail(candidates);
}

// --- constants (mirror scripts/constants.js) ---
const MSG = {
  START_SCRAPE: 'LF_START_SCRAPE',
  STOP_SCRAPE: 'LF_STOP_SCRAPE',
  PING: 'LF_PING',
  PONG: 'LF_PONG',
  PROGRESS: 'LF_PROGRESS',
  ERROR: 'LF_ERROR',
  COMPLETE: 'LF_COMPLETE',
  LOG: 'LF_LOG',
  SYNC_IG_DNR: 'LF_SYNC_IG_DNR',
  /** Service worker fetch to Instagram (Growman-style: i.instagram.com from extension, not page CORS). */
  IG_FETCH: 'LF_IG_FETCH',
  /** Optional-permission SW fetch for bio / link-in-bio HTML (Linktree, etc.). */
  HTTP_TEXT_FETCH: 'LF_HTTP_TEXT_FETCH',
  GET_PAGE_CONTEXT: 'LF_GET_PAGE_CONTEXT',
  OPEN_POPUP: 'LF_OPEN_POPUP',
};

const STORAGE_KEYS = {
  LEADS: 'leadflow_leads',
  RUN_STATE: 'leadflow_runState',
  UI_PREFS: 'leadflow_ui_prefs',
  SCRAPE_SOURCE_TAB: 'leadflow_scrape_source_tab',
  SESSION_HISTORY: 'leadflow_session_history',
};

/** Set to `false` to silence DevTools `[MegaLeads]` logs. */
const LEADFLOW_DEBUG = true;

function lfDebug(...args) {
  if (LEADFLOW_DEBUG) console.info('[MegaLeads]', ...args);
}

function lfWarn(...args) {
  console.warn('[MegaLeads]', ...args);
}

function lfError(...args) {
  console.error('[MegaLeads]', ...args);
}

const MAX_PROFILES_PER_SESSION = 600;
const SESSION_HISTORY_LIMIT = 30;
const STAGNATION_LIMIT = 6;
/** Large hashtags return many duplicate edges before new authors — keep each source alive longer. */
const STAGNATION_LIMIT_HASHTAG_TOP_SERP = 90;
const STAGNATION_LIMIT_HASHTAG_GRAPHQL = 160;
const STAGNATION_LIMIT_HASHTAG_DOM = 200;
const TOP_SERP_CURSOR_REPEAT_LIMIT = 8;
const TOP_SERP_TRANSIENT_ERROR_LIMIT = 5;
const TOP_SERP_DUPLICATE_PIVOT_MIN_PAGES = 68;
const TOP_SERP_DUPLICATE_PIVOT_WINDOW = 14;
const TOP_SERP_DUPLICATE_PIVOT_RATIO = 0.993;
const TOP_SERP_DUPLICATE_PIVOT_MAX_NEW = 14;
const TOP_SERP_LOW_ABS_PIVOT_MIN_PAGES = 72;
const TOP_SERP_LOW_ABS_PIVOT_WINDOW = 12;
const TOP_SERP_LOW_ABS_PIVOT_MAX_NEW = 12;
const TOP_SERP_ZERO_ADD_STREAK_LIMIT = 22;
/**
 * Legacy hashtag GraphQL `first`. Values above ~50 often return media nodes without
 * `owner.username` (sparse fieldsets), which made us parse 100+ edges but store 0 leads.
 */
const HASHTAG_GRAPHQL_PAGE_FIRST = 50;
/**
 * Sparse hashtag GraphQL often has `shortcode` but no `owner.username`. Resolve a bounded number
 * of posts per page via `?__a=1&__d=dis` / `web_info` (sequential + delay — same session cookies).
 */
const HASHTAG_SHORTCODE_RESOLVE_MAX_PER_PAGE = 24;
const HASHTAG_SHORTCODE_RESOLVE_DELAY_MS = 450;
/** If HTML/JSON shortcode resolution fails this many times in a row, skip the rest (IG layout/CORS churn). */
const HASHTAG_SHORTCODE_CONSEC_FAIL_ABORT = 10;
/** Sparse media has `owner.id` but no `owner.username` — resolve via mobile `users/{id}/info/` (SW fetch). */
const HASHTAG_OWNER_PK_RESOLVE_MAX_PER_PAGE = 24;

/** Mirror scripts/constants.js — delay bounds for gather + enrich (seconds). */
const MIN_DELAY_SEC = 3;
const MAX_DELAY_SEC = 30;
const DEFAULT_DELAY_MIN_SEC = 15;
const ENRICH_429_BACKOFF_MS = 100000;
const ENRICH_429_BACKOFF_MAX_MS = 5 * 60 * 1000;
const ENRICH_MAX_ATTEMPTS_PER_USER = 3;
const GATHER_429_BACKOFF_MULTIPLIER = 3;
/** Min wall time for enrichment when gather ends near session cap (see MIN_ENRICH_GRACE_MS). */
const MIN_ENRICH_GRACE_MS = 5 * 60 * 1000;
const ENRICH_RESERVE_PER_USER_MS = 2600;
const ENRICH_RESERVE_BASE_MS = 60 * 1000;
const ENRICH_RESERVE_MAX_MS = 10 * 60 * 1000;
/** Sequential enrich: one `web_profile_info` completion per lead before continuing gather (see `detailEnrichDone`). */

/**
 * @param {unknown} minSec
 * @param {unknown} maxSec
 * @returns {{ delayMinSec: number, delayMaxSec: number }}
 */
function clampDelaySecondsPair(minSec, maxSec) {
  let a = Math.round(Number(minSec));
  let b = Math.round(Number(maxSec));
  if (!Number.isFinite(a)) a = DEFAULT_DELAY_MIN_SEC;
  if (!Number.isFinite(b)) b = a + 2;
  a = Math.min(MAX_DELAY_SEC, Math.max(MIN_DELAY_SEC, a));
  b = Math.min(MAX_DELAY_SEC, Math.max(MIN_DELAY_SEC, b));
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  return { delayMinSec: a, delayMaxSec: b };
}

/** Emergency failsafe only; practical stopping is cursor exhaustion/time/cap. */
const HASHTAG_API_HARD_FAILSAFE_PAGES = 10000;

/**
 * Hashtag media GraphQL hashes — IG rotates these; try several (Growman hash often returns empty edges now).
 */
const HASHTAG_MEDIA_QUERY_HASHES = [
  '174a5243287c5f3a7de741089750ab3b',
  '1780c1b186e2c37de9f7da95ce41bb67',
  'ded47faa9a1aaded10161a2ff32abb6b',
];

/** Official / suggested accounts that appear in API edges but are not post authors. */
const HASHTAG_SKIP_USERNAMES = new Set([
  'blog',
  'instagram',
  'creators',
  'meta',
  'about',
  'help',
  'press',
  'developer',
]);
const DEFAULT_MAX_SESSION_MINUTES = 30;
const UNCAPPED_SESSION_MINUTES = 165;
const MIN_SESSION_MINUTES = 5;
const MAX_SESSION_MINUTES = 180;

// --- selectors (mirror scripts/selectors.js) ---
const RESERVED_SEGMENTS = new Set([
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

function usernameFromProfilePath(pathname) {
  const p = pathname.replace(/\/$/, '');
  const m = p.match(/^\/([^/]+)\/?$/);
  if (!m) return null;
  const u = m[1];
  if (RESERVED_SEGMENTS.has(u.toLowerCase())) return null;
  return u;
}

/** Explore / hashtag grids link to posts; profile link is usually a sibling under a shared parent. */
const IG_MEDIA_POST_PATH_RE = /^\/(p|reel|reels|tv)\/[^/]+\/?$/i;

function pathnameFromAnchor(a, baseOrigin) {
  try {
    const href = a.getAttribute('href') || a.href || '';
    return new URL(href, baseOrigin).pathname;
  } catch {
    return a.pathname || '';
  }
}

/**
 * From a /p/ or /reel/ tile link, find a nearby /username/ link (same card / row).
 * @param {HTMLAnchorElement} mediaAnchor
 * @param {Document} doc
 * @returns {HTMLAnchorElement|null}
 */
/**
 * Explore tiles often use aria-label like "Photo by username" with no profile <a> in the subtree.
 * @param {HTMLElement} el
 * @returns {string|null}
 */
function usernameFromExploreTileAria(el) {
  let hop = el;
  for (let d = 0; d < 14 && hop; d++) {
    const al = hop.getAttribute?.('aria-label') || '';
    if (al.length > 3) {
      const m = al.match(
        /\b(?:photo|clip|reel|carousel|video)\s+(?:shared\s+)?by\s+(@?)([\w.]+)\b/i,
      );
      if (m && m[2]) {
        const cand = m[2];
        if (!RESERVED_SEGMENTS.has(cand.toLowerCase())) return cand;
      }
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

/** Decode `q` from /explore/search/keyword?q=%23food → tag without # */
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

/** e.g. `/en/username/followers` → `/username/followers` (IG locale-prefixed paths). */
function stripLeadingLocalePath(pathname) {
  const p = (pathname || '/').replace(/\/$/, '') || '/';
  const m = p.match(/^\/([a-z]{2}|[a-z]{2}-[a-z]{2})\/(.+)$/i);
  if (m && m[2]) return `/${m[2]}`;
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * Resolve Followers/Following stat links: IG often sets `href` to a full https:// URL, so
 * `a[href="/user/followers/"]` misses. Match on parsed pathname.
 * @param {'followers' | 'following'} listKind
 */
function findProfileListStatLink(doc, userRaw, listKind) {
  const origin = doc.location.origin || 'https://www.instagram.com';
  const userKey = String(userRaw || '').toLowerCase();
  if (!userKey) return null;
  const leaf = listKind === 'following' ? 'following' : 'followers';
  const expected = `/${userKey}/${leaf}`;
  const hint = leaf;
  const nodes = doc.querySelectorAll(`a[href*="${hint}"]`);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!(el instanceof HTMLElement)) continue;
    const href = el.getAttribute('href');
    if (!href) continue;
    try {
      const path = new URL(href, origin).pathname.replace(/\/$/, '').toLowerCase();
      if (path === expected) return el;
    } catch {
      const low = href.toLowerCase();
      if (low.includes(`/${userKey}/${leaf}`)) return el;
    }
  }
  return null;
}

function detectPageMode(loc) {
  const path = stripLeadingLocalePath(loc.pathname);
  const tagMatch = path.match(/^\/explore\/tags\/([^/]+)\/?$/i);
  if (tagMatch) return { mode: 'hashtag', tag: decodeURIComponent(tagMatch[1]) };

  // Instagram often redirects hashtag navigation to keyword search, e.g.
  // /explore/search/keyword/?q=%23food (sometimes with extra path segments).
  if (path === '/explore/search/keyword' || path.startsWith('/explore/search/keyword/')) {
    try {
      const sp = new URLSearchParams(loc.search || '');
      const tag = hashtagFromExploreSearchQuery(sp.get('q'));
      if (tag) return { mode: 'hashtag', tag };
    } catch {
      /* ignore */
    }
  }
  // Profile "tabs" (/user/reels, /user/tagged, …) must count as profile so Followers/Following
  // validation passes; the old /^\/user\/?$/ check missed those and returned unknown.
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

function getListModalRoot(doc) {
  return doc.querySelector('[role="dialog"]') || doc.querySelector('[aria-modal="true"]');
}

function findScrollRoot(doc) {
  const dialog = getListModalRoot(doc);
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

function dispatchScrollLikeUserInput(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  try {
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new win.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        view: win,
        deltaY: 180 + Math.random() * 120,
        clientX: rect.left + Math.min(Math.max(24, rect.width * 0.35), rect.width - 8),
        clientY: rect.top + rect.height * 0.55,
      }),
    );
  } catch {
    /* ignore */
  }
}

function humanScrollStep(el) {
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
  dispatchScrollLikeUserInput(el);
}

/**
 * DOM list scroll without stealing focus from the dashboard tab (hashtag fallback).
 * Uses extra steps when the document is hidden; does not activate the Instagram tab.
 */
async function scrollListStepBackground(doc, scrollRoot, collectionRoot) {
  if (!scrollRoot) return;
  const rounds = doc.hidden ? 4 : 1;
  for (let r = 0; r < rounds; r++) {
    humanScrollStep(scrollRoot);
    if (doc.hidden && r + 1 < rounds) await waitMs(150);
  }
  if (collectionRoot) {
    try {
      const anchors = collectProfileAnchors(doc, collectionRoot);
      const last = anchors[anchors.length - 1];
      if (last && last.isConnected) {
        last.scrollIntoView({ block: 'end', behavior: 'instant' });
        dispatchScrollLikeUserInput(scrollRoot);
      }
    } catch {
      /* ignore */
    }
  }
}

const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,9}\b/g;
/** Mirror `scripts/email-quality.js` — used by `normalizePhoneCandidate` below. */
const EMAIL_TRAIL_RE = /[),.;:!?]+$/;

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

/** True when the string is only an optional leading `+` followed by digits (no grouping). */
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

function looksLikeBrokenOneDigitAreaNanp(raw, digits) {
  if (digits.length !== 9) return false;
  const t = String(raw || '').trim().replace(/\s+/g, '');
  return /^\d[-.]?\d{4}[-.]?\d{4}$/.test(t);
}

/** Float / internal id like `91.1278708001772` — not a dialable grouped number. */
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

/** `2.20260420.01.00`-style release / build strings (≥4 dotted digit groups). */
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

function extractContacts(text) {
  if (!text) return { email: null, phone: null, contact: null };
  const normalized = String(text).replace(/mailto:/gi, '');
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
    const us = normalized.match(/\b(?:\(\d{3}\)\s*|\d{3}[-.\s])\d{3}[-.\s]?\d{4}\b/);
    if (us) phone = normalizePhoneCandidate(us[0]);
  }
  const contact = [email, phone].filter(Boolean).join(' · ') || null;
  return { email, phone, contact };
}

function mergeEmailPhoneFromParts(parts) {
  const blob = parts.filter((p) => p && String(p).trim()).join('\n');
  const ex = extractContacts(blob);
  return {
    email: (ex.email || '').trim(),
    phone: (ex.phone || '').trim(),
  };
}

/**
 * Instagram link shims (`l.instagram.com/?u=…`) → real destination URL.
 * @param {string} raw
 */
function resolveBioLinkUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let u = raw.trim();
  if (!u) return '';
  try {
    const parsed = new URL(u, 'https://www.instagram.com');
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('instagram.com') || host === 'instagr.am') {
      const jump = parsed.searchParams.get('u') || parsed.searchParams.get('url');
      if (jump) {
        try {
          return new URL(decodeURIComponent(jump)).href;
        } catch {
          return decodeURIComponent(jump);
        }
      }
    }
    return parsed.href;
  } catch {
    return u;
  }
}

/**
 * Outbound profile links (Linktree, shop, etc.) — excludes instagram.com hosts.
 * @param {object} igUser
 * @param {number} [max]
 * @returns {string[]}
 */
function collectProfileLinkTargetsFromIgUser(igUser, max = 5) {
  if (!igUser || typeof igUser !== 'object') return [];
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const r = resolveBioLinkUrl(String(raw || '').trim());
    if (!r || !/^https?:\/\//i.test(r)) return;
    if (/^mailto:/i.test(r)) return;
    let host = '';
    try {
      host = new URL(r).hostname.toLowerCase();
    } catch {
      return;
    }
    if (host.endsWith('instagram.com') || host === 'instagr.am') return;
    const k = r.replace(/#.*$/, '').toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  if (typeof igUser.external_url === 'string') add(igUser.external_url);
  if (Array.isArray(igUser.bio_links)) {
    const urlishKeys = [
      'url',
      'lynx_url',
      'open_external_url_with_base_url',
      'link_url',
      'web_uri',
      'uri',
      'navigation_url',
    ];
    for (let bi = 0; bi < igUser.bio_links.length; bi++) {
      const bl = igUser.bio_links[bi];
      if (typeof bl === 'string') {
        add(bl);
        if (out.length >= max) break;
        continue;
      }
      if (!bl || typeof bl !== 'object') continue;
      for (let ki = 0; ki < urlishKeys.length; ki++) {
        const k = urlishKeys[ki];
        if (typeof bl[k] === 'string') add(bl[k]);
        if (out.length >= max) break;
      }
      if (out.length >= max) break;
      const nested = bl.link;
      if (nested && typeof nested === 'object') {
        for (let ki = 0; ki < urlishKeys.length; ki++) {
          const k = urlishKeys[ki];
          if (typeof nested[k] === 'string') add(nested[k]);
          if (out.length >= max) break;
        }
      }
      if (out.length >= max) break;
    }
  }
  return out.slice(0, max);
}

function stripHtmlToContactText(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 200000);
}

function harvestLdJsonContactStrings(html) {
  if (!html || typeof html !== 'string') return '';
  const parts = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i]);
        return;
      }
      if (typeof node.email === 'string' && node.email.includes('@')) parts.push(node.email);
      if (typeof node.telephone === 'string') parts.push(node.telephone);
      for (const k of Object.keys(node)) walk(node[k]);
    };
    walk(data);
  }
  return parts.join('\n');
}

/** `mailto:` lives in attributes; stripHtmlToContactText drops attributes, so we mine raw HTML. */
function harvestMailtoFromHtml(html) {
  if (!html || typeof html !== 'string' || !/mailto:/i.test(html)) return '';
  const parts = [];
  const re = /mailto:([^"'>\s]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    let frag = (m[1] || '').trim();
    if (!frag) continue;
    try {
      frag = decodeURIComponent(frag.replace(/\+/g, ' '));
    } catch {
      /* leave */
    }
    frag = frag.split('?')[0].split('&')[0];
    if (frag.includes('@')) parts.push(frag);
  }
  return [...new Set(parts)].join('\n');
}

/** SEO / no-JS fallbacks sometimes put contact copy only here. */
function harvestNoscriptInnerText(html) {
  if (!html || typeof html !== 'string') return '';
  const chunks = [];
  const re = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[1] || '';
    if (!inner.trim()) continue;
    const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) chunks.push(t.slice(0, 50000));
  }
  return chunks.join('\n');
}

/** Next.js / Squarespace / etc. often embed contact emails only inside non–ld+json script blobs. */
function harvestEmailsFromGenericScriptBodies(html) {
  if (!html || typeof html !== 'string' || !/@/.test(html)) return '';
  const parts = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = String(m[1] || '').toLowerCase();
    if (attrs.includes('application/ld+json')) continue;
    const body = m[2] || '';
    if (body.length < 12 || body.length > 450000) continue;
    if (!/@/.test(body)) continue;
    const hits = body.match(EMAIL_RE);
    if (!hits) continue;
    for (let hi = 0; hi < hits.length; hi++) parts.push(hits[hi]);
  }
  return [...new Set(parts)].join('\n');
}

function mergeHarvestSourcesFromHtml(html) {
  const mailto = harvestMailtoFromHtml(html);
  const noscript = harvestNoscriptInnerText(html);
  const scriptEmails = harvestEmailsFromGenericScriptBodies(html);
  const plain = stripHtmlToContactText(html);
  const ld = harvestLdJsonContactStrings(html);
  return [mailto, noscript, scriptEmails, plain, ld].filter(Boolean).join('\n');
}

function fetchThirdPartyPageText(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MSG.HTTP_TEXT_FETCH, url }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ bridgeOk: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp && typeof resp === 'object' ? resp : { bridgeOk: false });
    });
  });
}

/**
 * Fetch a few bio / link-in-bio pages (GrowMan-style) and mine mailto / tel / visible text.
 * Outbound fetches use the extension service worker (manifest host_permissions).
 * @param {object} igUser `web_profile_info.data.user`
 */
async function harvestContactsFromBioLinkPages(igUser) {
  if (!igUser || stopRequested) return { email: '', phone: '' };
  const urls = collectProfileLinkTargetsFromIgUser(igUser, 5);
  if (!urls.length) return { email: '', phone: '' };
  const blobs = [];
  for (let i = 0; i < urls.length && !stopRequested; i++) {
    const res = await fetchThirdPartyPageText(urls[i]);
    if (res.bridgeOk && res.text && typeof res.text === 'string') {
      blobs.push(mergeHarvestSourcesFromHtml(res.text));
    }
    if (i + 1 < urls.length) await waitMs(400);
  }
  return mergeEmailPhoneFromParts(blobs);
}

/**
 * Instagram GraphQL / web_profile_info user nodes: explicit contact fields plus
 * biography, name, and external URL (many accounts only list email in bio).
 * @param {object} o
 * @returns {{ email: string, phone: string }}
 */
function buildEmailPhoneFromIgUserShape(o) {
  if (!o || typeof o !== 'object') return { email: '', phone: '' };
  const lines = [];
  const bio =
    (typeof o.biography === 'string' && o.biography) ||
    (typeof o.biography_with_entities?.raw_text === 'string' && o.biography_with_entities.raw_text) ||
    '';
  if (bio) lines.push(bio);
  const ents = o.biography_with_entities?.entities;
  if (Array.isArray(ents)) {
    for (let ei = 0; ei < ents.length; ei++) {
      const e = ents[ei];
      if (!e || typeof e !== 'object') continue;
      if (typeof e.url === 'string' && e.url.trim()) lines.push(e.url.trim());
      if (typeof e.hashtag?.name === 'string' && e.hashtag.name.trim())
        lines.push(`#${e.hashtag.name.trim()}`);
      if (typeof e.user?.username === 'string' && e.user.username.trim())
        lines.push(`@${e.user.username.trim()}`);
    }
  }
  if (typeof o.full_name === 'string' && o.full_name.trim()) lines.push(o.full_name.trim());
  if (typeof o.external_url === 'string' && o.external_url.trim()) lines.push(o.external_url.trim());
  if (typeof o.category_name === 'string' && o.category_name.trim()) lines.push(o.category_name.trim());
  if (typeof o.page_name === 'string' && o.page_name.trim()) lines.push(o.page_name.trim());
  if (Array.isArray(o.bio_links)) {
    for (let bi = 0; bi < o.bio_links.length; bi++) {
      const bl = o.bio_links[bi];
      if (!bl || typeof bl !== 'object') continue;
      for (const k of ['url', 'lynx_url', 'title']) {
        const v = bl[k];
        if (typeof v === 'string' && v.trim()) lines.push(v.trim());
      }
    }
  }
  if (typeof o.address_street === 'string' && o.address_street.trim()) lines.push(o.address_street.trim());
  if (typeof o.business_address_json === 'string' && o.business_address_json.trim())
    lines.push(o.business_address_json.trim());

  const structuredEmails = [];
  for (const em of [o.public_email, o.business_email, o.email]) {
    const normalizedEmail = normalizeEmailCandidate(em);
    if (normalizedEmail) structuredEmails.push(normalizedEmail);
  }
  const phoneCandidates = [];
  const addPhone = (v) => {
    const normalizedPhone = normalizePhoneCandidate(v);
    if (normalizedPhone) phoneCandidates.push(normalizedPhone);
  };
  addPhone(o.business_phone_number);
  addPhone(o.contact_phone_number);
  addPhone(o.phone_number);
  addPhone(o.whatsapp_number);
  const cc = o.public_phone_country_code;
  const ppn = o.public_phone_number;
  if (typeof ppn === 'string' && ppn.replace(/\D/g, '').length >= 8) {
    const c = typeof cc === 'string' ? String(cc).replace(/\D/g, '') : '';
    const normalizedPhone = normalizePhoneCandidate(c ? `+${c} ${ppn.trim()}` : ppn.trim());
    if (normalizedPhone) phoneCandidates.push(normalizedPhone);
  }
  if (structuredEmails.length) lines.push(structuredEmails.join(' · '));
  if (phoneCandidates.length) lines.push(phoneCandidates.join(' · '));

  const blob = lines.join('\n');
  const parsed = extractContacts(blob);
  const looseFromBlob = blob.match(EMAIL_RE) || [];
  const emailPick = pickBestEmail([...structuredEmails, ...looseFromBlob, ...(parsed.email ? [parsed.email] : [])]);
  let email = (emailPick || '').trim();
  let phone = (parsed.phone || '').trim();
  if (!phone && phoneCandidates.length) {
    phoneCandidates.sort(
      (a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length,
    );
    phone = phoneCandidates[0];
  }
  return { email, phone };
}

function parseCompactNumber(numPart, suffix) {
  let n = parseFloat(numPart.replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  const s = (suffix || '').toLowerCase();
  if (s === 'k') n *= 1e3;
  else if (s === 'm') n *= 1e6;
  else if (s === 'b') n *= 1e9;
  return Math.round(n);
}

function parseFollowerCountFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const near = lower.includes('follower') ? text : text;

  const m = near.match(/([\d.,]+)\s*([kmb])?\s*followers/i);
  if (m) return parseCompactNumber(m[1], m[2]);

  const m2 = near.match(/\b([\d.,]+)\s*([kmb])\b/i);
  if (m2) return parseCompactNumber(m2[1], m2[2]);

  const m3 = near.match(/(?:^|\s)([\d][\d.,]*)\s*followers/i);
  if (m3) return parseCompactNumber(m3[1], '');

  const m4 = text.match(/([\d.,]+[kmb]?)\s+followers?\b/i);
  if (m4) {
    const num = m4[1].replace(/[kmb]$/i, '');
    const suf = /[kmb]$/i.test(m4[1]) ? m4[1].slice(-1) : '';
    return parseCompactNumber(num, suf);
  }

  return null;
}

/** aria-label / title on row or ancestors (accessibility tree sometimes has counts). */
function parseAccessibilityMetadata(anchor) {
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

function collectProfileAnchors(doc, root) {
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

/** Site chrome — not follower/following rows */
function isAnchorInGlobalChrome(anchor) {
  return !!(
    anchor.closest('header') ||
    anchor.closest('nav') ||
    anchor.closest('[role="banner"]') ||
    anchor.closest('[role="navigation"]')
  );
}

/**
 * Full profile header (posts / followers / following) — not a list row.
 * EN + loose IT hints.
 */
function isLikelyProfileHeroBlurb(text) {
  if (!text || text.length < 30) return false;
  const t = text.replace(/\s+/g, ' ');
  const hasPosts = /\b\d{1,4}\s*(posts?|post)\b/i.test(t);
  const hasFollowers = /\bfollowers?\b/i.test(t);
  const hasFollowing = /\bfollowing\b/i.test(t) || /\bseguit[oi]\b/i.test(t);
  return hasPosts && hasFollowers && hasFollowing;
}

function countUniqueProfileLinks(el) {
  if (!(el instanceof HTMLElement)) return 0;
  const u = new Set();
  el.querySelectorAll('a[href^="/"]').forEach((a) => {
    if (!(a instanceof HTMLAnchorElement)) return;
    const name = usernameFromProfilePath(a.pathname);
    if (name) u.add(name.toLowerCase());
  });
  return u.size;
}

/**
 * Narrow DOM for followers/following: dialog first, else densest scrollable list under main.
 */
function getListCollectionRoot(doc, mode, fallbackScroll) {
  if (mode === 'hashtag') return doc.body;
  const dialog = getListModalRoot(doc);
  if (dialog) return dialog;
  const main = doc.querySelector('main') || doc.querySelector('[role="main"]');
  if (!main) return fallbackScroll;
  const win = doc.defaultView;
  /** @type {{ el: HTMLElement; count: number }[]} */
  const candidates = [];
  main.querySelectorAll('*').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const st = win.getComputedStyle(el);
    if (st.overflowY !== 'scroll' && st.overflowY !== 'auto') return;
    if (el.scrollHeight <= el.clientHeight + 8) return;
    const c = countUniqueProfileLinks(el);
    if (c >= 2) candidates.push({ el, count: c });
  });
  candidates.sort((a, b) => b.count - a.count);
  if (candidates.length > 0) {
    const inner = candidates.find((c) => c.el !== main) || candidates[0];
    return inner.el;
  }
  return fallbackScroll;
}

/** Scroll the same scrollable region that holds the list, when possible */
function getScrollTargetForList(doc, parseRoot, fallbackScroll) {
  let el = parseRoot;
  const win = doc.defaultView;
  for (let i = 0; i < 14 && el; i++) {
    if (!(el instanceof HTMLElement)) break;
    const st = win.getComputedStyle(el);
    const oy = st.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
    el = el.parentElement;
  }
  return fallbackScroll;
}

/**
 * Wait for followers/following modal or list rows (SPA / slow paint).
 * @param {Document} doc
 * @param {number} timeoutMs
 */
async function waitForDialogOrList(doc, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (stopRequested) return;
    const dlg = getListModalRoot(doc);
    if (dlg && countUniqueProfileLinks(dlg) >= 1) return;
    const main = doc.querySelector('main');
    if (main && countUniqueProfileLinks(main) >= 2) return;
    await waitMs(200);
  }
}

/**
 * From profile: click Followers/Following or navigate. Returns false if page navigates (rerun Start).
 * @param {Document} doc
 * @param {string} mode
 * @param {string} expectedUser normalized username
 */
async function ensureListModalOpen(doc, mode, expectedUser) {
  const q = expectedUser.toLowerCase();
  const info = detectPageMode(doc.location);

  if (mode === 'followers') {
    if (info.mode === 'followers' && info.user.toLowerCase() === q) {
      await waitForDialogOrList(doc, 8000);
      return true;
    }
    if (info.mode === 'profile' && info.user.toLowerCase() === q) {
      const user = info.user;
      let btn = findProfileListStatLink(doc, user, 'followers');
      if (!btn) {
        const sels = [
          `a[href="/${user}/followers/"]`,
          `a[href="/${user}/followers"]`,
          `a[href*="/${user}/followers"]`,
        ];
        for (let s = 0; s < sels.length; s++) {
          const el = doc.querySelector(sels[s]);
          if (el instanceof HTMLElement) {
            btn = el;
            break;
          }
        }
      }
      if (!btn) {
        doc.querySelectorAll('a[href*="followers"]').forEach((el) => {
          if (btn || !(el instanceof HTMLElement)) return;
          const h = el.getAttribute('href') || '';
          if (h.toLowerCase().includes(`/${user.toLowerCase()}/`)) btn = el;
        });
      }
      if (btn) {
        await appendLog(lfLog('nav_open_followers', {}));
        btn.click();
        await waitForDialogOrList(doc, 8000);
        return true;
      }
      await appendLog(lfLog('nav_followers', {}));
      doc.defaultView.location.assign(`${doc.location.origin}/${user}/followers/`);
      return false;
    }
    return false;
  }

  if (mode === 'following') {
    if (info.mode === 'following' && info.user.toLowerCase() === q) {
      await waitForDialogOrList(doc, 8000);
      return true;
    }
    if (info.mode === 'profile' && info.user.toLowerCase() === q) {
      const user = info.user;
      let btn = findProfileListStatLink(doc, user, 'following');
      if (!btn) {
        const sels = [
          `a[href="/${user}/following/"]`,
          `a[href="/${user}/following"]`,
          `a[href*="/${user}/following"]`,
        ];
        for (let s = 0; s < sels.length; s++) {
          const el = doc.querySelector(sels[s]);
          if (el instanceof HTMLElement) {
            btn = el;
            break;
          }
        }
      }
      if (!btn) {
        doc.querySelectorAll('a[href*="following"]').forEach((el) => {
          if (btn || !(el instanceof HTMLElement)) return;
          const h = el.getAttribute('href') || '';
          if (h.toLowerCase().includes(`/${user.toLowerCase()}/`)) btn = el;
        });
      }
      if (btn) {
        await appendLog(lfLog('nav_open_following', {}));
        btn.click();
        await waitForDialogOrList(doc, 8000);
        return true;
      }
      await appendLog(lfLog('nav_following', {}));
      doc.defaultView.location.assign(`${doc.location.origin}/${user}/following/`);
      return false;
    }
    return false;
  }

  return true;
}

function anchorRowContextText(anchor) {
  let el = anchor.parentElement;
  let best = '';
  for (let d = 0; d < 10 && el; d++) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (t.length > best.length) best = t;
    el = el.parentElement;
  }
  return best.slice(0, 700);
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

function extractLeadFromProfileAnchor(anchor, username) {
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

function normalizeQuery(q) {
  return q.trim().replace(/^[@#]+/, '').trim();
}

/** Dashboard / storage: short label for who or what is being scraped. */
function formatSessionTargetForUi(mode, queryRaw) {
  const q = normalizeQuery(queryRaw || '');
  if (mode === 'hashtag') return q ? `#${q}` : '';
  if (mode === 'followers' || mode === 'following') return q ? `@${q}` : '';
  return q || '';
}

function sessionModeLabel(mode) {
  if (mode === 'followers') return lfLog('mode_followers', {});
  if (mode === 'following') return lfLog('mode_following', {});
  if (mode === 'hashtag') return lfLog('mode_hashtag', {});
  return String(mode || '');
}
