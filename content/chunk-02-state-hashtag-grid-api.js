/** @file chunk 2 of 5 — runtime state, caps, hashtag explore drain + GraphQL helpers through top_serp fetch. */

// --- main content script ---

let stopRequested = false;
/** Non-null while a hidden-tab sleep is in flight — invoke to clear timeout (STOP must call `abortPendingWait`). */
let cancelPendingWait = null;
let isRunning = false;
/** True while a hashtag extraction run is active — capture `discover/web/explore_grid` without `query=` in URL. */
let hashtagScrapeActive = false;

/** Username (lower) → fields from intercepted Instagram JSON (GraphQL). */
let graphHints = new Map();
let currentSessionId = '';

/** Post author usernames from intercepted `explore_grid` / `top_serp` JSON (keyword hashtag SERP). */
const interceptedMediaOwners = new Set();

function hasProfileCap(maxProfiles) {
  return Number.isFinite(maxProfiles) && Number(maxProfiles) > 0;
}

/**
 * Hashtag GraphQL often returns `GraphImage` / `GraphSidecar` with `owner` but **no** `owner.username`
 * (sparse fieldset). IG `accessibility_caption` usually puts the **display name** after "Photo by …",
 * not the handle — only trust explicit `@handle` or "Name (@handle)" patterns (never bare first word).
 * @param {string} s
 * @returns {string}
 */
function usernameFromInstagramAccessibilityCaption(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();

  const view = t.match(/View @?([A-Za-z0-9._]{1,30})['\u2019]s profile/i);
  if (view && view[1]) return view[1];

  const shared = t.match(/\b(?:shared|posted)\s+by\s+@([A-Za-z0-9._]{1,30})\b/i);
  if (shared && shared[1]) return shared[1];

  const segM = t.match(
    /\b(?:photo|carousel|video|reel)(?:\s+shared)?\s+by\s+(.+?)(?:\s+on\b|\s+in\b|\s+\u00b7\b|\s+·\s)/i,
  );
  const head = segM ? segM[1].trim() : '';
  if (head) {
    const paren = head.match(/\(\s*@([A-Za-z0-9._]{1,30})\s*\)/);
    if (paren && paren[1]) return paren[1];
    const atStart = head.match(/^\s*@([A-Za-z0-9._]{1,30})\b/);
    if (atStart && atStart[1]) return atStart[1];
    const atWord = head.match(/@([A-Za-z0-9._]{1,30})\b/);
    if (atWord && atWord[1]) return atWord[1];
  }

  const endAt = t.match(
    /\b(?:photo|carousel|video|reel)(?:\s+shared)?\s+by\s+@([A-Za-z0-9._]{1,30})\s*\.?\s*$/i,
  );
  if (endAt && endAt[1]) return endAt[1];

  return '';
}

/**
 * Best-effort post author username when `owner.username` is missing (hashtag GraphQL, etc.).
 * @param {object} node
 * @returns {string}
 */
function inferUsernameFromSparseMediaNode(node) {
  if (!node || typeof node !== 'object') return '';
  const ow = node.owner;
  if (ow && typeof ow === 'object' && typeof ow.username === 'string' && ow.username.trim()) {
    return ow.username.trim();
  }
  const usr = node.user;
  if (usr && typeof usr === 'object' && typeof usr.username === 'string' && usr.username.trim()) {
    return usr.username.trim();
  }
  if (typeof node.username === 'string' && node.username.trim()) return node.username.trim();
  const ac = node.accessibility_caption;
  if (typeof ac === 'string') {
    const u = usernameFromInstagramAccessibilityCaption(ac);
    if (u && !isHashtagOwnerSkipped(u)) return u;
  }
  return '';
}

/**
 * Pull usernames from IG JSON where a media item has an owner (explore_grid, top_serp, etc.).
 * @param {object} json
 * @returns {string[]}
 */
function extractPostOwnerUsernamesFromJson(json) {
  const out = [];
  const seen = new Set();
  const seenObj = new WeakSet();
  function pushUsername(raw) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) return;
    if (isHashtagOwnerSkipped(t)) return;
    const lower = t.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(t);
  }

  function isLikelyMediaNode(o) {
    if (!o || typeof o !== 'object') return false;
    const tn = o.__typename;
    if (typeof tn === 'string') {
      if (/^Graph(Image|Video|Sidecar)/.test(tn)) return true;
      if (/^XDT(ClipsMedia|FeedMedia|Media)/i.test(tn)) return true;
    }
    if (typeof o.shortcode === 'string' && o.shortcode.length >= 5) return true;
    if (typeof o.code === 'string' && o.code.length >= 5) return true;
    if (typeof o.shortCode === 'string' && o.shortCode.length >= 5) return true;
    if (o.media_type != null && (o.pk != null || o.id != null)) return true;
    if (
      o.taken_at != null &&
      o.pk != null &&
      (o.like_count != null || o.comment_count != null || o.play_count != null)
    )
      return true;
    return false;
  }

  function isLikelyTopSerpUserNode(o) {
    if (!o || typeof o !== 'object') return false;
    if (typeof o.username !== 'string' || !o.username.trim()) return false;
    const hasIdentity = o.pk != null || o.id != null || typeof o.account_badges === 'object';
    const hasProfileSignals =
      typeof o.full_name === 'string' ||
      typeof o.profile_pic_url === 'string' ||
      typeof o.profile_pic_url_hd === 'string' ||
      typeof o.is_private === 'boolean' ||
      typeof o.is_verified === 'boolean';
    return hasIdentity || hasProfileSignals;
  }

  function walk(o, depth) {
    if (depth > 34 || !o || typeof o !== 'object') return;
    if (seenObj.has(o)) return;
    seenObj.add(o);
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }
    if (isLikelyMediaNode(o)) {
      const ow = o.owner || o.user;
      let ownerU =
        (ow && typeof ow === 'object' && typeof ow.username === 'string' && ow.username) || '';
      if (!ownerU && typeof o.username === 'string') ownerU = o.username;
      if (!ownerU) ownerU = inferUsernameFromSparseMediaNode(o);
      pushUsername(ownerU);
    }
    const nestedMedia = o.media;
    if (nestedMedia && typeof nestedMedia === 'object' && !Array.isArray(nestedMedia)) {
      const ow = nestedMedia.owner || nestedMedia.user;
      let ownerU =
        (ow && typeof ow === 'object' && typeof ow.username === 'string' && ow.username) || '';
      if (!ownerU) ownerU = inferUsernameFromSparseMediaNode(nestedMedia);
      pushUsername(ownerU);
    }
    // top_serp carries rich user nodes that are not always nested under media.owner/user.
    if (isLikelyTopSerpUserNode(o)) {
      pushUsername(o.username);
    }
    const keys = Object.keys(o);
    for (let j = 0; j < keys.length; j++) walk(o[keys[j]], depth + 1);
  }

  try {
    walk(json, 0);
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Merge owners seen in explore_grid / top_serp responses (same-tab fetch hook).
 * @returns {Promise<{ total: number, newAdded: number }>}
 */
async function drainExploreGridCaptureIntoLeads(options) {
  const {
    doc,
    minFollowers,
    listOwner,
    processed,
    ignored,
    usernamesToEnrich,
    label,
    maxProfiles = null,
    enrichDrainCtx = null,
  } = options;
  const origin = doc.location.origin || 'https://www.instagram.com';
  const { total: capTotal } = await mergeLeads([]);
  if (hasProfileCap(maxProfiles) && capTotal >= maxProfiles) return { total: capTotal, newAdded: 0 };
  if (interceptedMediaOwners.size === 0) return { total: capTotal, newAdded: 0 };

  let total = capTotal;
  let newAdded = 0;
  for (const u of interceptedMediaOwners) {
    const key = u.toLowerCase();
    if (processed.has(key) || ignored.has(key)) continue;
    if (listOwner && key === listOwner) continue;
    if (isHashtagOwnerSkipped(u)) {
      ignored.add(key);
      continue;
    }

    let row = {
      username: u,
      bio: '',
      followerCount: null,
      email: '',
      phone: '',
      websiteUrl: '',
      scrapedAt: new Date().toISOString(),
      detailEnrichDone: false,
    };
    if (!passesMinFollowers(minFollowers, row, 'hashtag')) continue;
    processed.add(key);
    row = mergeHintsIntoRow(row);
    usernamesToEnrich.add(u);
    const r = enrichDrainCtx
      ? await mergeLeadsThenDrainPending([row], enrichDrainCtx)
      : await mergeLeads([row]);
    newAdded += r.newAdded;
    total = r.total;
    if (r.newAdded > 0) {
      broadcast({
        type: MSG.PROGRESS,
        phase: 'gather',
        extracted: total,
        batchAdded: r.newAdded,
        logLine: `${label}: @${u}`,
      });
    }
    if (hasProfileCap(maxProfiles) && total >= maxProfiles) break;
  }

  if (newAdded > 0) {
    await appendLog(lfLog('grid_drain_log', { label, new: newAdded, total }));
  }
  for (const u of [...interceptedMediaOwners]) {
    const k = u.toLowerCase();
    if (processed.has(k) || ignored.has(k)) interceptedMediaOwners.delete(u);
  }
  return { total, newAdded };
}

/**
 * Matches keyword SERP XHR: `api/v1/fbsearch/web/top_serp` and `discover/web/explore_grid`
 * (see Network while on /explore/search/keyword/?q=%23tag).
 */
function isExploreKeywordSerpFetchUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/fbsearch\/web\/top_serp|\/top_serp[/?]/i.test(url)) return true;
  if (/discover\/web\/explore_grid/i.test(url)) {
    if (hashtagScrapeActive) return true;
    return (
      /(?:^|[?&])query=/i.test(url) ||
      /q=%23/i.test(url) ||
      /search_surface=/i.test(url) ||
      /module=[^&]*serp/i.test(url)
    );
  }
  if (!/explore_grid/i.test(url)) return false;
  return (
    /(?:^|[?&])query=/i.test(url) ||
    /q=%23/i.test(url) ||
    /search_surface=/i.test(url) ||
    /module=[^&]*serp/i.test(url)
  );
}

function ingestGraphqlHints(json) {
  const seen = new WeakSet();
  function walk(o, depth) {
    if (depth > 28 || o == null) return;
    if (typeof o !== 'object') return;
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }
    const un = o.username;
    if (typeof un === 'string' && un.length >= 1 && un.length <= 64) {
      if (!usernameFromProfilePath('/' + un + '/')) {
        for (const k of Object.keys(o)) {
          try {
            walk(o[k], depth + 1);
          } catch (e) {
            /* ignore */
          }
        }
        return;
      }
      const key = un.toLowerCase();
      const prev = graphHints.get(key) || {};
      let fc = prev.followerCount ?? null;
      if (typeof o.edge_followed_by?.count === 'number') fc = o.edge_followed_by.count;
      else if (typeof o.follower_count === 'number') fc = o.follower_count;
      let bio = prev.bio || '';
      const rawBio = o.biography || o.biography_with_entities?.raw_text;
      if (typeof rawBio === 'string' && rawBio.length > bio.length) bio = rawBio;
      const fromShape = buildEmailPhoneFromIgUserShape(o);
      const mergedEp = mergeEmailPhoneFromParts([
        prev.email,
        prev.phone,
        prev.contact,
        fromShape.email,
        fromShape.phone,
      ]);
      const fullName = typeof o.full_name === 'string' ? o.full_name : prev.fullName || '';
      let websiteUrl = prev.websiteUrl || '';
      if (typeof o.external_url === 'string') {
        const ex = o.external_url.trim();
        if (ex.length > websiteUrl.length) websiteUrl = ex;
      }
      graphHints.set(key, {
        followerCount: fc,
        bio: bio || '',
        email: mergedEp.email,
        phone: mergedEp.phone,
        fullName: fullName || '',
        websiteUrl,
      });
    }
    for (const k of Object.keys(o)) {
      try {
        walk(o[k], depth + 1);
      } catch (e) {
        /* ignore */
      }
    }
  }
  try {
    walk(json, 0);
  } catch (e) {
    /* ignore */
  }
}

function mergeHintsIntoRow(row) {
  const h = graphHints.get(row.username.toLowerCase());
  if (!h) return row;
  const mergedEp = mergeEmailPhoneFromParts([
    row.email,
    row.phone,
    row.contact,
    h.email,
    h.phone,
    h.contact,
    h.bio,
    row.bio,
  ]);
  let bio = row.bio || '';
  if (h.fullName) {
    const fn = h.fullName.trim();
    if (fn && !bio.toLowerCase().includes(fn.toLowerCase().slice(0, 12)))
      bio = [fn, bio].filter(Boolean).join(' · ');
  }
  if ((h.bio || '').length > (bio || '').length) bio = h.bio || bio;
  bio = bio.replace(/\s+Follow\s*$/i, '').trim();
  const websiteUrl =
    (h.websiteUrl || '').length > (row.websiteUrl || '').length
      ? h.websiteUrl || ''
      : row.websiteUrl || '';
  return {
    ...row,
    followerCount: row.followerCount != null ? row.followerCount : h.followerCount,
    bio: bio.slice(0, 500),
    email: mergedEp.email || row.email || '',
    phone: mergedEp.phone || row.phone || '',
    websiteUrl: websiteUrl || '',
  };
}

function igCsrfToken(doc) {
  try {
    const m = doc.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1].trim()) : '';
  } catch {
    return '';
  }
}

/**
 * Instagram `fetch` from the MV3 **service worker** (same session cookies; not subject to www→i CORS).
 * Matches how Growman's `dash` bundle calls `i.instagram.com/.../web_profile_info` with absolute URLs.
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ bridgeOk: true, status: number, okHttp: boolean, text: string, json: object|null }>}
 */
function igFetchThroughBackground(url, headers = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: MSG.IG_FETCH,
        url,
        headers: headers && typeof headers === 'object' ? { ...headers } : {},
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.bridgeOk) {
          reject(new Error((resp && resp.error) || 'LF_IG_FETCH failed'));
          return;
        }
        resolve(resp);
      },
    );
  });
}

function isHashtagOwnerSkipped(username) {
  const k = String(username || '').toLowerCase();
  if (!k) return true;
  if (RESERVED_SEGMENTS.has(k)) return true;
  if (HASHTAG_SKIP_USERNAMES.has(k)) return true;
  return false;
}

function hashtagPayloadHasKey(data) {
  if (!data || typeof data !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(data, 'hashtag')) return true;
  if (data.graphql && Object.prototype.hasOwnProperty.call(data.graphql, 'hashtag')) return true;
  return false;
}

/** `data.hashtag` or legacy `data.graphql.hashtag` */
function resolveHashtagObject(json) {
  const d = json?.data;
  if (!d || typeof d !== 'object') return null;
  if (d.hashtag !== undefined) return d.hashtag;
  if (d.graphql && d.graphql.hashtag !== undefined) return d.graphql.hashtag;
  return null;
}

function countHashtagEdgeRows(tag) {
  if (!tag || typeof tag !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(tag)) {
    if (!/^edge_/i.test(k)) continue;
    const e = tag[k]?.edges;
    if (Array.isArray(e)) n += e.length;
  }
  return n;
}

function pageInfoFromHashtagTag(tag) {
  if (!tag || typeof tag !== 'object') return {};
  const preferred = [
    'edge_hashtag_to_media',
    'edge_hashtag_to_media_v2',
    'edge_hashtag_to_ranked_media',
    'edge_hashtag_to_top_posts',
    'edge_hashtag_to_reels_media',
    'edge_hashtag_to_content_stream',
    'edge_hashtag_to_media_stream',
  ];
  for (let i = 0; i < preferred.length; i++) {
    const pi = tag[preferred[i]]?.page_info;
    if (pi && typeof pi === 'object') return pi;
  }
  for (const k of Object.keys(tag)) {
    if (!/^edge_/i.test(k)) continue;
    const pi = tag[k]?.page_info;
    if (pi && typeof pi === 'object') return pi;
  }
  return {};
}

/**
 * Pull owner / co-owner usernames from one hashtag media node (incl. sidecar children, XDT shapes).
 * @param {object} node
 * @param {(u: string) => void} addU
 * @param {WeakSet<object>} seenObj
 * @param {number} depth
 */
function extractOwnerUsernamesFromHashtagMediaNode(node, addU, seenObj, depth) {
  if (depth > 16 || !node || typeof node !== 'object') return;
  if (seenObj.has(node)) return;
  seenObj.add(node);
  const inferred = inferUsernameFromSparseMediaNode(node);
  if (inferred) addU(inferred);
  const ow = node.owner;
  if (ow && typeof ow === 'object' && typeof ow.username === 'string' && ow.username.trim()) {
    addU(ow.username.trim());
  }
  const usr = node.user;
  if (usr && typeof usr === 'object' && typeof usr.username === 'string' && usr.username.trim()) {
    addU(usr.username.trim());
  }
  const side = node.edge_sidecar_to_children;
  if (side && Array.isArray(side.edges)) {
    for (let s = 0; s < side.edges.length; s++) {
      extractOwnerUsernamesFromHashtagMediaNode(side.edges[s]?.node, addU, seenObj, depth + 1);
    }
  }
  if (Array.isArray(node.carousel_media)) {
    for (let c = 0; c < node.carousel_media.length; c++) {
      extractOwnerUsernamesFromHashtagMediaNode(node.carousel_media[c], addU, seenObj, depth + 1);
    }
  }
  if (Array.isArray(node.items)) {
    for (let it = 0; it < node.items.length; it++) {
      extractOwnerUsernamesFromHashtagMediaNode(node.items[it], addU, seenObj, depth + 1);
    }
  }
  const nested = node.media;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    extractOwnerUsernamesFromHashtagMediaNode(nested, addU, seenObj, depth + 1);
  }
}

/** Hashtag GraphQL: these carry post authors; process first (Growman-style). */
const HASHTAG_MEDIA_EDGE_PRIORITY = [
  'edge_hashtag_to_media',
  'edge_hashtag_to_media_v2',
  'edge_hashtag_to_ranked_media',
  'edge_hashtag_to_recent_media',
  'edge_hashtag_to_popular_media',
  'edge_hashtag_to_top_posts',
  'edge_hashtag_to_reels_media',
  'edge_hashtag_to_content_stream',
  'edge_hashtag_to_media_stream',
];

/** Only skip `edge_*` keys we are confident are not post-author lists (avoid regex false-positives on “tab”, “user”, etc.). */
const HASHTAG_EDGE_KEY_DENY_PREFIXES = [
  'edge_hashtag_to_related',
  'edge_hashtag_to_chaining',
  'edge_hashtag_to_countdown',
  'edge_hashtag_to_similar',
  'edge_hashtag_to_discovery',
  'edge_hashtag_to_rules',
  'edge_hashtag_to_banner',
  'edge_hashtag_to_button',
  'edge_hashtag_to_info',
  'edge_hashtag_to_connected',
  'edge_hashtag_to_hq',
  'edge_hashtag_to_effect',
  'edge_hashtag_to_audio',
  'edge_hashtag_to_music',
];

function isHashtagNonMediaEdgeKey(key) {
  if (typeof key !== 'string' || !/^edge_/i.test(key)) return true;
  const kl = key.toLowerCase();
  for (let i = 0; i < HASHTAG_EDGE_KEY_DENY_PREFIXES.length; i++) {
    if (kl.startsWith(HASHTAG_EDGE_KEY_DENY_PREFIXES[i])) return true;
  }
  return false;
}

/**
 * Collect owner usernames from every `edge_*` connection on the hashtag object.
 * @param {object} tag
 */
function usernamesFromHashtagTagObject(tag) {
  const users = [];
  const seen = new Set();
  function addU(u) {
    if (!u || typeof u !== 'string') return;
    const t = u.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    users.push(t);
  }
  if (!tag || typeof tag !== 'object') return users;

  /**
   * Same media-owner walk as explore_grid / top_serp (handles XDT*, nested `media`, etc.).
   * @param {object} node
   */
  function harvestOneEdgeNode(node) {
    if (!node || typeof node !== 'object') return;
    const sparse = inferUsernameFromSparseMediaNode(node);
    if (sparse) addU(sparse);
    const direct =
      (typeof node.owner?.username === 'string' && node.owner.username.trim()) ||
      (typeof node.user?.username === 'string' && node.user.username.trim()) ||
      (typeof node.username === 'string' && node.username.trim()) ||
      '';
    if (direct) addU(direct);
    const seenObj = new WeakSet();
    extractOwnerUsernamesFromHashtagMediaNode(node, addU, seenObj, 0);
    const walked = extractPostOwnerUsernamesFromJson(node);
    for (let w = 0; w < walked.length; w++) addU(walked[w]);
  }

  function harvestEdgesOfKey(key) {
    const edges = tag[key]?.edges;
    if (!Array.isArray(edges)) return;
    for (let i = 0; i < edges.length; i++) {
      harvestOneEdgeNode(edges[i]?.node);
    }
  }

  for (let p = 0; p < HASHTAG_MEDIA_EDGE_PRIORITY.length; p++) {
    const key = HASHTAG_MEDIA_EDGE_PRIORITY[p];
    if (tag[key]) harvestEdgesOfKey(key);
  }

  for (const key of Object.keys(tag)) {
    if (!/^edge_/i.test(key)) continue;
    if (HASHTAG_MEDIA_EDGE_PRIORITY.includes(key)) continue;
    if (isHashtagNonMediaEdgeKey(key)) continue;
    harvestEdgesOfKey(key);
  }

  if (users.length === 0) {
    for (const key of Object.keys(tag)) {
      if (!/^edge_/i.test(key)) continue;
      if (isHashtagNonMediaEdgeKey(key)) continue;
      harvestEdgesOfKey(key);
    }
  }

  if (users.length === 0) {
    const fallback = extractPostOwnerUsernamesFromJson(tag);
    for (let w = 0; w < fallback.length; w++) addU(fallback[w]);
  }

  return users;
}

/**
 * When `owner.username` is missing but `owner.id` / `owner.pk` is present (sparse hashtag GraphQL).
 * @param {object} tag
 * @param {number} [max]
 * @returns {string[]} numeric user ids as strings
 */
function collectHashtagSparseOwnerPksFromTag(tag, max) {
  const out = [];
  const seen = new Set();
  const cap =
    Number.isFinite(max) && max > 0 ? Math.floor(max) : HASHTAG_OWNER_PK_RESOLVE_MAX_PER_PAGE;
  function pushPk(node) {
    if (!node || typeof node !== 'object' || out.length >= cap) return;
    const ow = node.owner;
    if (!ow || typeof ow !== 'object') return;
    if (typeof ow.username === 'string' && ow.username.trim()) return;
    const raw = ow.id != null ? ow.id : ow.pk;
    if (raw == null) return;
    const key = String(raw).trim();
    if (!/^\d{4,20}$/.test(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  }
  function walkMediaNode(node) {
    if (!node || typeof node !== 'object' || out.length >= cap) return;
    const tn = node.__typename;
    if (tn === 'GraphImage' || tn === 'GraphSidecar' || tn === 'GraphVideo') {
      pushPk(node);
      const side = node.edge_sidecar_to_children;
      if (side && Array.isArray(side.edges)) {
        for (let s = 0; s < side.edges.length && out.length < cap; s++) {
          walkMediaNode(side.edges[s]?.node);
        }
      }
      return;
    }
    const side2 = node.edge_sidecar_to_children;
    if (side2 && Array.isArray(side2.edges)) {
      for (let s = 0; s < side2.edges.length && out.length < cap; s++) walkMediaNode(side2.edges[s]?.node);
    }
    const nm = node.media;
    if (nm && typeof nm === 'object' && !Array.isArray(nm)) walkMediaNode(nm);
  }
  function harvestKey(key) {
    const edges = tag[key]?.edges;
    if (!Array.isArray(edges)) return;
    for (let i = 0; i < edges.length && out.length < cap; i++) walkMediaNode(edges[i]?.node);
  }
  if (!tag || typeof tag !== 'object') return out;
  for (let p = 0; p < HASHTAG_MEDIA_EDGE_PRIORITY.length; p++) {
    harvestKey(HASHTAG_MEDIA_EDGE_PRIORITY[p]);
  }
  for (const key of Object.keys(tag)) {
    if (!/^edge_/i.test(key)) continue;
    if (HASHTAG_MEDIA_EDGE_PRIORITY.includes(key)) continue;
    if (isHashtagNonMediaEdgeKey(key)) continue;
    harvestKey(key);
  }
  return out;
}

/**
 * @param {object|null} body
 * @returns {string}
 */
function usernameFromInstagramUserInfoJson(body) {
  if (!body || typeof body !== 'object') return '';
  const u = body.user?.username || body.username;
  if (typeof u === 'string' && u.trim()) return u.trim();
  return '';
}

/**
 * @param {Document} doc
 * @param {string[]} ownerPks numeric Instagram user ids
 * @param {number} delayMs
 * @returns {Promise<string[]>}
 */
async function resolveUsernamesFromOwnerPksList(doc, ownerPks, delayMs) {
  const out = [];
  const seen = new Set();
  const d = Math.max(120, Number(delayMs) || HASHTAG_SHORTCODE_RESOLVE_DELAY_MS);
  const csrftoken = igCsrfToken(doc);
  const hdr = {
    'x-requested-with': 'XMLHttpRequest',
    Accept: 'application/json,text/plain,*/*',
    ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
  };
  let consecFail = 0;
  for (let i = 0; i < ownerPks.length; i++) {
    if (stopRequested) break;
    const pk = ownerPks[i];
    let u = '';
    try {
      const url = `https://i.instagram.com/api/v1/users/${encodeURIComponent(pk)}/info/`;
      const resp = await igFetchThroughBackground(url, hdr);
      if (resp.status === 200 && resp.json) {
        u = usernameFromInstagramUserInfoJson(resp.json);
      }
    } catch (_) {
      /* ignore */
    }
    if (u && !isHashtagOwnerSkipped(u)) {
      consecFail = 0;
      const k = u.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(u);
      }
    } else {
      consecFail += 1;
      if (consecFail >= HASHTAG_SHORTCODE_CONSEC_FAIL_ABORT && out.length === 0) {
        lfWarn('Hashtag owner-id resolution: many consecutive failures — stopping this page batch.', {
          tried: i + 1,
          of: ownerPks.length,
        });
        break;
      }
    }
    if (i < ownerPks.length - 1 && !stopRequested) await waitWithStop(d);
  }
  return out;
}

/**
 * Collect unique media `shortcode` values from hashtag tag edges (for owner lookup when GraphQL omits username).
 * @param {object} tag
 * @param {number} [max]
 * @returns {string[]}
 */
function collectHashtagMediaShortcodesFromTag(tag, max) {
  const out = [];
  const seen = new Set();
  const cap =
    Number.isFinite(max) && max > 0 ? Math.floor(max) : HASHTAG_SHORTCODE_RESOLVE_MAX_PER_PAGE;
  function pushFromNode(node) {
    if (!node || typeof node !== 'object' || out.length >= cap) return;
    const sc = node.shortcode || node.code;
    if (typeof sc !== 'string' || sc.length < 5) return;
    const k = sc.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(sc);
  }
  function walkMediaNode(node) {
    if (!node || typeof node !== 'object' || out.length >= cap) return;
    const tn = node.__typename;
    if (tn === 'GraphImage' || tn === 'GraphSidecar' || tn === 'GraphVideo') {
      pushFromNode(node);
      const side = node.edge_sidecar_to_children;
      if (side && Array.isArray(side.edges)) {
        for (let s = 0; s < side.edges.length && out.length < cap; s++) {
          walkMediaNode(side.edges[s]?.node);
        }
      }
      return;
    }
    const side2 = node.edge_sidecar_to_children;
    if (side2 && Array.isArray(side2.edges)) {
      for (let s = 0; s < side2.edges.length && out.length < cap; s++) walkMediaNode(side2.edges[s]?.node);
    }
    const nm = node.media;
    if (nm && typeof nm === 'object' && !Array.isArray(nm)) walkMediaNode(nm);
  }
  function harvestKey(key) {
    const edges = tag[key]?.edges;
    if (!Array.isArray(edges)) return;
    for (let i = 0; i < edges.length && out.length < cap; i++) walkMediaNode(edges[i]?.node);
  }
  if (!tag || typeof tag !== 'object') return out;
  for (let p = 0; p < HASHTAG_MEDIA_EDGE_PRIORITY.length; p++) {
    harvestKey(HASHTAG_MEDIA_EDGE_PRIORITY[p]);
  }
  for (const key of Object.keys(tag)) {
    if (!/^edge_/i.test(key)) continue;
    if (HASHTAG_MEDIA_EDGE_PRIORITY.includes(key)) continue;
    if (isHashtagNonMediaEdgeKey(key)) continue;
    harvestKey(key);
  }
  return out;
}

/**
 * Pull post owner username from full post/reel HTML (same-origin on www — avoids CORS on i.instagram.com).
 * @param {string} html
 * @param {string} shortcode
 * @returns {string}
 */
function extractOwnerUsernameFromIgPostHtml(html, shortcode) {
  if (typeof html !== 'string' || html.length < 300) return '';
  const sc = String(shortcode || '').trim();
  if (sc.length < 5) return '';
  const esc = sc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idx = html.search(new RegExp(`"shortcode":"${esc}"`, 'i'));
  if (idx < 0) return '';
  const slice = html.slice(Math.max(0, idx - 500), idx + 120000);
  let pos = 0;
  for (;;) {
    const op = slice.indexOf('"owner"', pos);
    if (op < 0) break;
    const chunk = slice.slice(op, Math.min(op + 9000, slice.length));
    const um = chunk.match(/"username"\s*:\s*"([A-Za-z0-9._]{1,30})"/);
    if (um && um[1] && !isHashtagOwnerSkipped(um[1])) return um[1];
    pos = op + 7;
  }
  const loose = slice.match(
    /"is_private"\s*:\s*(?:true|false)\s*,\s*"username"\s*:\s*"([A-Za-z0-9._]{1,30})"/,
  );
  if (loose && loose[1] && !isHashtagOwnerSkipped(loose[1])) return loose[1];
  return '';
}

/**
 * Resolve post `shortcode` → owner username (browser session; may 404 for private/blocked posts).
 * Prefer same-origin HTML (reliable); `?__a=1` often 500; `web_info` uses **background** fetch (Growman-style).
 * @param {Document} doc
 * @param {string} shortcode
 * @returns {Promise<string>}
 */
async function fetchOwnerUsernameFromPostShortcode(doc, shortcode) {
  const sc = String(shortcode || '').trim();
  if (sc.length < 5) return '';
  const csrftoken = igCsrfToken(doc);
  const headers = {
    'x-requested-with': 'XMLHttpRequest',
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
  };
  const htmlUrls = [
    `https://www.instagram.com/p/${encodeURIComponent(sc)}/`,
    `https://www.instagram.com/reel/${encodeURIComponent(sc)}/`,
  ];
  for (let u = 0; u < htmlUrls.length; u++) {
    try {
      const res = await fetch(htmlUrls[u], { credentials: 'include', headers });
      const html = await res.text();
      if (!res.ok || typeof html !== 'string') continue;
      const name = extractOwnerUsernameFromIgPostHtml(html, sc);
      if (name) return name;
    } catch (_) {
      /* ignore */
    }
  }
  const jsonHeaders = {
    'x-requested-with': 'XMLHttpRequest',
    Accept: 'application/json,text/plain,*/*',
    ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
  };
  const pageUrls = [
    `https://www.instagram.com/p/${encodeURIComponent(sc)}/?__a=1&__d=dis`,
    `https://www.instagram.com/reel/${encodeURIComponent(sc)}/?__a=1&__d=dis`,
  ];
  for (let u = 0; u < pageUrls.length; u++) {
    try {
      const res = await fetch(pageUrls[u], { credentials: 'include', headers: jsonHeaders });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body !== 'object') continue;
      const sm =
        body.graphql?.shortcode_media ||
        body.data?.xdt_shortcode_media ||
        body.xdt_shortcode_media;
      const owner = sm?.owner;
      if (owner && typeof owner.username === 'string' && owner.username.trim()) {
        return owner.username.trim();
      }
      const items = body.items;
      if (Array.isArray(items) && items[0]) {
        const ou = items[0].user?.username || items[0].owner?.username;
        if (typeof ou === 'string' && ou.trim()) return ou.trim();
      }
    } catch (_) {
      /* ignore */
    }
  }
  try {
    const apiUrl = `https://i.instagram.com/api/v1/media/web_info/?shortcode=${encodeURIComponent(sc)}`;
    const resp = await igFetchThroughBackground(apiUrl, jsonHeaders);
    if (resp.status === 200 && resp.json) {
      const user =
        resp.json?.data?.items?.[0]?.user ||
        resp.json?.items?.[0]?.user ||
        resp.json?.user;
      if (user && typeof user.username === 'string' && user.username.trim()) {
        return user.username.trim();
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

/**
 * @param {Document} doc
 * @param {string[]} shortcodes
 * @param {number} delayMs
 * @returns {Promise<string[]>}
 */
async function resolveOwnerUsernamesFromShortcodesList(doc, shortcodes, delayMs) {
  const out = [];
  const seen = new Set();
  const d = Math.max(120, Number(delayMs) || HASHTAG_SHORTCODE_RESOLVE_DELAY_MS);
  let consecFail = 0;
  for (let i = 0; i < shortcodes.length; i++) {
    if (stopRequested) break;
    const u = await fetchOwnerUsernameFromPostShortcode(doc, shortcodes[i]);
    if (u) {
      consecFail = 0;
      const k = u.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(u);
      }
    } else {
      consecFail += 1;
      if (consecFail >= HASHTAG_SHORTCODE_CONSEC_FAIL_ABORT && out.length === 0) {
        lfWarn('Hashtag shortcode resolution: many consecutive failures — stopping this page batch (IG HTML/JSON changed or session gated).', {
          tried: i + 1,
          of: shortcodes.length,
        });
        break;
      }
    }
    if (i < shortcodes.length - 1 && !stopRequested) await waitWithStop(d);
  }
  return out;
}

/**
 * Parse hashtag media GraphQL — all edge_* connections + alternate data paths.
 * @param {object} json
 */
function parseHashtagGraphqlResponse(json) {
  const out = {
    hasHashtagKey: false,
    hashtagNull: true,
    usernames: [],
    hasNext: false,
    nextCursor: null,
    rawEdgeCount: 0,
  };
  if (!json || typeof json !== 'object' || !json.data || typeof json.data !== 'object') return out;
  if (!hashtagPayloadHasKey(json.data)) return out;
  out.hasHashtagKey = true;
  const tag = resolveHashtagObject(json);
  if (tag == null) {
    out.hashtagNull = true;
    return out;
  }
  out.hashtagNull = false;
  out.rawEdgeCount = countHashtagEdgeRows(tag);
  out.usernames = usernamesFromHashtagTagObject(tag).filter((u) => !isHashtagOwnerSkipped(u));
  if (out.rawEdgeCount > 0 && out.usernames.length === 0) {
    const edgeKeys = Object.keys(tag).filter((k) => /^edge_/i.test(k));
    let sample = null;
    for (let p = 0; p < HASHTAG_MEDIA_EDGE_PRIORITY.length; p++) {
      const k = HASHTAG_MEDIA_EDGE_PRIORITY[p];
      const n = tag[k]?.edges?.[0]?.node;
      if (n && typeof n === 'object') {
        sample = { connection: k, __typename: n.__typename, keys: Object.keys(n).slice(0, 25) };
        break;
      }
    }
    if (!sample) {
      for (let i = 0; i < edgeKeys.length; i++) {
        const n = tag[edgeKeys[i]]?.edges?.[0]?.node;
        if (n && typeof n === 'object') {
          sample = { connection: edgeKeys[i], __typename: n.__typename, keys: Object.keys(n).slice(0, 25) };
          break;
        }
      }
    }
    lfDebug('Hashtag GraphQL: edges but 0 in-stream usernames (shortcode fallback may apply):', {
      edgeKeys,
      sample,
    });
  }
  const pi = pageInfoFromHashtagTag(tag);
  out.hasNext = !!pi.has_next_page;
  out.nextCursor = typeof pi.end_cursor === 'string' ? pi.end_cursor : null;
  return out;
}

/**
 * Single GraphQL request for hashtag media.
 */
async function fetchHashtagGraphqlRaw(doc, tagName, after, first, hash) {
  const variables = JSON.stringify({
    tag_name: String(tagName).toLowerCase(),
    first,
    after: after || '',
  });
  const csrftoken = igCsrfToken(doc);
  const url = `https://www.instagram.com/graphql/query/?query_hash=${encodeURIComponent(
    hash,
  )}&variables=${encodeURIComponent(variables)}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json?.errors?.length) {
    throw new Error(json.errors.map((e) => e.message || 'error').join('; '));
  }
  if (!json || typeof json.data !== 'object' || !hashtagPayloadHasKey(json.data)) {
    throw new Error('missing hashtag payload');
  }
  return json;
}

/**
 * Pick a query_hash that returns non-empty media rows (first page only).
 * @param {Set<string>|null|undefined} skipHashes hashes already exhausted — try another stream (Growman-style depth).
 * @returns {Promise<{ hash: string, json: object }|null>}
 */
async function pickWorkingHashtagGraphqlHash(doc, tagName, first, skipHashes) {
  const pageFirst = Number.isFinite(first) && first > 0 ? Math.floor(first) : HASHTAG_GRAPHQL_PAGE_FIRST;
  const skip = skipHashes instanceof Set ? skipHashes : null;
  let lastErr = '';
  for (let h = 0; h < HASHTAG_MEDIA_QUERY_HASHES.length; h++) {
    const hash = HASHTAG_MEDIA_QUERY_HASHES[h];
    if (skip && skip.has(hash)) continue;
    try {
      const json = await fetchHashtagGraphqlRaw(doc, tagName, '', pageFirst, hash);
      const tag = resolveHashtagObject(json);
      if (tag == null) continue;
      const nEdge = countHashtagEdgeRows(tag);
      const parsed = parseHashtagGraphqlResponse(json);
      if (nEdge > 0 || parsed.usernames.length > 0) return { hash, json };
      lastErr = `hash ${hash.slice(0, 8)}… returned 0 media rows`;
    } catch (e) {
      lastErr = (e && e.message) || String(e);
    }
  }
  if (lastErr) await appendLog(lfLog('graphql_err_tail', { msg: lastErr }));
  return null;
}

function newIgRankToken() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Pagination fields from `GET /api/v1/fbsearch/web/top_serp/` (shape varies).
 * @param {object} json
 */
function topSerpPaginationFromJson(json) {
  if (!json || typeof json !== 'object') {
    return { nextMaxId: '', rankToken: '', searchSessionId: '', hasMore: false };
  }
  const mg = json.media_grid;
  const nextMaxId = String(
    json.next_max_id ?? json.nextMaxId ?? (mg && mg.next_max_id) ?? '',
  ).trim();
  const rankToken = String(
    json.rank_token ?? json.rankToken ?? (mg && mg.rank_token) ?? '',
  ).trim();
  const searchSessionId = String(
    json.search_session_id ?? json.searchSessionId ?? (mg && mg.search_session_id) ?? '',
  ).trim();
  const hasMore =
    nextMaxId.length > 0 ||
    json.has_more === true ||
    json.more_available === true ||
    json.has_more_available === true;
  return { nextMaxId, rankToken, searchSessionId, hasMore };
}

/**
 * Same endpoint as browser Network: `api/v1/fbsearch/web/top_serp/?query=%23…`
 * @param {string} searchSessionId
 */
async function fetchHashtagTopSerpJson(doc, tagName, nextMaxId, rankToken, searchSessionId) {
  const q = `#${String(tagName).replace(/^#+/, '')}`;
  const params = new URLSearchParams({
    enable_metadata: 'true',
    query: q,
    search_session_id: searchSessionId || '',
  });
  if (nextMaxId) params.set('next_max_id', nextMaxId);
  if (rankToken) params.set('rank_token', rankToken);
  const url = `https://www.instagram.com/api/v1/fbsearch/web/top_serp/?${params.toString()}`;
  const csrftoken = igCsrfToken(doc);
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
    },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}
