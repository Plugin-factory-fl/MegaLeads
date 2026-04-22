/** @file chunk 4 of 5 — web_profile_info enrich, merge/storage, session history, logging, waits, validatePage, passesMinFollowers. */

/**
 * Per-username `GET /api/v1/users/web_profile_info/?username=` (same endpoint as Growman's getUserByUsernameV2).
 */
async function enrichLeadsWebProfileInfo(options) {
  const {
    usernames,
    delayMinSec,
    delayMaxSec,
    sessionStartMs,
    maxSessionMs,
    origin,
    interleavedBatch = false,
  } = options;
  const enrichStartedAt = Date.now();
  const sessionWallEndMs = sessionStartMs + maxSessionMs;
  const adaptiveMinEnrichMs = Math.max(
    MIN_ENRICH_GRACE_MS,
    Math.min(20 * 60 * 1000, ENRICH_RESERVE_BASE_MS + usernames.length * ENRICH_RESERVE_PER_USER_MS),
  );
  const minEnrichEndMs = enrichStartedAt + adaptiveMinEnrichMs;
  /** Interleaved bursts use session wall only so gather can keep the rest of the session. */
  const enrichStopAtMs = interleavedBatch ? sessionWallEndMs : Math.max(sessionWallEndMs, minEnrichEndMs);
  lfDebug('enrich: deadline', {
    enrichStopAtMs,
    sessionWallEndMs,
    minEnrichEndMs: interleavedBatch ? '(interleaved: wall only)' : minEnrichEndMs,
    delayMinSec,
    delayMaxSec,
    interleavedBatch,
  });
  lfDebug('enrichLeadsWebProfileInfo: enter', {
    count: usernames?.length ?? 0,
    sample: (usernames || []).slice(0, 5),
    origin,
    hidden: typeof document !== 'undefined' ? document.hidden : '?',
    interleavedBatch,
  });
  if (!usernames.length) {
    lfWarn('enrichLeadsWebProfileInfo: empty usernames — skipping enrichment');
    await appendLog(lfLog('enrich_empty_users', {}));
    return;
  }
  lfDebug('enrichLeadsWebProfileInfo: calling appendLog (enrich start line)…');
  await appendLog(
    interleavedBatch && usernames.length === 1
      ? lfLog('enrich_start_seq', { u: usernames[0] })
      : interleavedBatch
        ? lfLog('enrich_start_inter', { n: usernames.length })
        : lfLog('enrich_start_bulk', { n: usernames.length }),
  );
  lfDebug('enrichLeadsWebProfileInfo: appendLog returned');
  const enrichTotal = usernames.length;
  let consecutive429 = 0;
  let throttleStreak = 0;
  const { total: storedAfterGather } = await mergeLeads([]);
  lfDebug('enrichLeadsWebProfileInfo: broadcasting enrich phase 0', {
    enrichTotal,
    storedAfterGather,
  });
  broadcast({
    type: MSG.PROGRESS,
    phase: 'enrich',
    enrichCurrent: 0,
    enrichTotal,
    extracted: storedAfterGather,
    batchAdded: 0,
    logLine: lfLog('progress_enrich', { cur: 0, tot: enrichTotal }),
  });

  /**
   * @param {string} uname
   * @param {number} i
   * @param {number} total
   * @param {number} delayMinSecUsed
   * @param {number} delayMaxSecUsed
   * @returns {Promise<{ storedNow: number, success: boolean, shouldStop: boolean }>}
   */
  const enrichOne = async (uname, i, total, delayMinSecUsed, delayMaxSecUsed) => {
    if (stopRequested) return { storedNow: 0, success: false, shouldStop: true };
    if (Date.now() >= enrichStopAtMs) {
      lfWarn('enrichLeadsWebProfileInfo: enrich time limit', { atIndex: i });
      await appendLog(lfLog('enrich_time_api', {}));
      return { storedNow: 0, success: false, shouldStop: true };
    }
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
      uname,
    )}`;
    lfDebug(`enrich fetch [${i + 1}/${total}]`, { uname, url: url.slice(0, 80) + '…' });
    /** @type {number} */
    let storedNow = 0;
    let success = false;
    /** Last HTTP status from web_profile_info (used to skip pointless retries / fallbacks). */
    let lastHttpStatus = 0;
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 28000);
      let res;
      try {
        res = await fetch(url, { credentials: 'include', signal: ac.signal });
      } finally {
        clearTimeout(tid);
      }
      lastHttpStatus = res.status;
      lfDebug(`enrich fetch response [${i + 1}/${total}]`, {
        uname,
        ok: res.ok,
        status: res.status,
      });
      let body = await res.json().catch(() => null);
      let row = null;
      /** Last Instagram `user` object used to build `row` (for outbound bio-link mining). */
      let lastProfileUser = null;
      for (let attempt = 1; attempt <= ENRICH_MAX_ATTEMPTS_PER_USER; attempt++) {
        if (!res.ok) {
          if (res.status !== 404) {
            await appendLog(
              lfLog('api_http_attempt', {
                u: uname,
                status: res.status,
                a: attempt,
                max: ENRICH_MAX_ATTEMPTS_PER_USER,
              }),
            );
          }
          if (res.status === 404) {
            consecutive429 = 0;
            throttleStreak = 0;
            break;
          }
          if (res.status === 429) {
            consecutive429 += 1;
            throttleStreak += 1;
            const backoffMs = Math.min(
              ENRICH_429_BACKOFF_MAX_MS,
              Math.round(ENRICH_429_BACKOFF_MS * Math.pow(1.6, Math.max(0, throttleStreak - 1))),
            );
            await appendLog(
              lfLog('api_rate_cool', {
                sec: Math.ceil(backoffMs / 1000),
                a: attempt,
                max: ENRICH_MAX_ATTEMPTS_PER_USER,
              }),
            );
            await syncIgSessionHeaders(document);
            await waitWithStop(backoffMs);
            if (attempt < ENRICH_MAX_ATTEMPTS_PER_USER && !stopRequested && Date.now() < enrichStopAtMs) {
              const acRetry = new AbortController();
              const tidRetry = setTimeout(() => acRetry.abort(), 28000);
              try {
                res = await fetch(url, { credentials: 'include', signal: acRetry.signal });
              } finally {
                clearTimeout(tidRetry);
              }
              lastHttpStatus = res.status;
              body = await res.json().catch(() => null);
              continue;
            }
          } else {
            consecutive429 = 0;
            throttleStreak = 0;
          }
          break;
        }

        if (body?.status === 'fail') {
          await appendLog(
            lfLog('api_fail_attempt', {
              u: uname,
              msg: body.message || lfLog('word_fail', {}),
              a: attempt,
              max: ENRICH_MAX_ATTEMPTS_PER_USER,
            }),
          );
          if (attempt < ENRICH_MAX_ATTEMPTS_PER_USER && !stopRequested && Date.now() < enrichStopAtMs) {
            await waitWithStop(Math.min(45000, Math.max(5000, computeDelayMs(delayMinSecUsed, delayMaxSecUsed))));
            const acRetry = new AbortController();
            const tidRetry = setTimeout(() => acRetry.abort(), 28000);
            try {
              res = await fetch(url, { credentials: 'include', signal: acRetry.signal });
            } finally {
              clearTimeout(tidRetry);
            }
            lastHttpStatus = res.status;
            body = await res.json().catch(() => null);
            continue;
          }
          break;
        }

        const user = body?.data?.user;
        row = rowFromWebProfileUser(user, uname, origin);
        if (row) {
          lastProfileUser = user;
          break;
        }
        if (attempt < ENRICH_MAX_ATTEMPTS_PER_USER && !stopRequested && Date.now() < enrichStopAtMs) {
          await waitWithStop(Math.min(30000, Math.max(4000, computeDelayMs(delayMinSecUsed, delayMaxSecUsed))));
          const acRetry = new AbortController();
          const tidRetry = setTimeout(() => acRetry.abort(), 28000);
          try {
            res = await fetch(url, { credentials: 'include', signal: acRetry.signal });
          } finally {
            clearTimeout(tidRetry);
          }
          lastHttpStatus = res.status;
          body = await res.json().catch(() => null);
          continue;
        }
        break;
      }

      if (!row && !stopRequested && Date.now() < enrichStopAtMs && lastHttpStatus !== 404) {
        const fb = await fetchUserViaProfilePageFallback(document, uname).catch(() => null);
        if (fb?.ok && fb.user) {
          row = rowFromWebProfileUser(fb.user, uname, origin);
          if (row) {
            lastProfileUser = fb.user;
            await appendLog(lfLog('api_fallback_ok', { u: uname }));
          }
        }
      }

      if (row) {
        if (!stopRequested && lastProfileUser) {
          try {
            const extra = await harvestContactsFromBioLinkPages(lastProfileUser);
            if ((extra.email || '').trim() || (extra.phone || '').trim()) {
              const ep = mergeEmailPhoneFromParts([
                row.email,
                row.phone,
                extra.email,
                extra.phone,
              ]);
              row = { ...row, email: ep.email || row.email, phone: ep.phone || row.phone };
            }
          } catch (e) {
            lfDebug('bio link harvest failed', { uname, err: e?.message || String(e) });
          }
        }
        consecutive429 = 0;
        throttleStreak = 0;
        const { total: storedTotal } = await mergeLeads([row]);
        storedNow = storedTotal;
        success = true;
        const fcStr = row.followerCount != null ? String(row.followerCount) : '—';
        await appendLog(lfLog('api_followers_line', { u: uname, fc: fcStr, i: i + 1, tot: total }));
      } else if (lastHttpStatus === 404 && !stopRequested) {
        await mergeLeads([
          {
            username: uname,
            webProfileUnavailable: true,
            detailEnrichDone: true,
            scrapedAt: new Date().toISOString(),
          },
        ]);
        lfDebug(`enrich: 404 — marked webProfileUnavailable`, { uname });
        await appendLog(lfLog('api_404_kept', { u: uname }));
        const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
        storedNow = (data[STORAGE_KEYS.LEADS] || []).length;
        success = true;
      } else {
        if (!stopRequested) {
          await mergeLeads([
            {
              username: uname,
              detailEnrichDone: true,
              scrapedAt: new Date().toISOString(),
            },
          ]);
          await appendLog(lfLog('api_no_payload', { u: uname }));
          success = true;
        }
        const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
        storedNow = (data[STORAGE_KEYS.LEADS] || []).length;
      }
    } catch (e) {
      lfError(`enrich fetch exception @${uname}`, e);
      await appendLog(lfLog('api_exception', { u: uname, msg: (e && e.message) || e }));
      consecutive429 = 0;
      if (!stopRequested) {
        await mergeLeads([
          {
            username: uname,
            detailEnrichDone: true,
            scrapedAt: new Date().toISOString(),
          },
        ]);
        success = true;
      }
      const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
      storedNow = (data[STORAGE_KEYS.LEADS] || []).length;
    }
    if (i < total - 1 && !stopRequested) {
      const remainingMs = enrichStopAtMs - Date.now();
      if (remainingMs <= 0) return { storedNow, success, shouldStop: true };
      let delayMs = computeDelayMs(delayMinSecUsed, delayMaxSecUsed);
      const cadenceBand = consecutive429 === 0 && throttleStreak === 0 ? 'normal' : 'throttled';
      delayMs = Math.min(delayMs, remainingMs);
      lfDebug(`enrich delay before next profile`, {
        delayMs,
        cadenceBand,
        nextIndex: i + 2,
        remainingMs,
      });
      await patchRunState({
        enrichCadenceBand: cadenceBand,
      });
      await waitWithStop(delayMs);
    }
    return { storedNow, success, shouldStop: false };
  };

  /** @type {string[]} */
  const failedFirstPass = [];
  for (let i = 0; i < enrichTotal; i++) {
    const uname = usernames[i];
    const result = await enrichOne(uname, i, enrichTotal, delayMinSec, delayMaxSec);
    if (!result.success) failedFirstPass.push(uname);
    broadcast({
      type: MSG.PROGRESS,
      phase: 'enrich',
      enrichCurrent: i + 1,
      enrichTotal,
      extracted: result.storedNow,
      batchAdded: 0,
      logLine: lfLog('progress_enrich', { cur: i + 1, tot: enrichTotal }),
    });
    if (result.shouldStop) break;
  }

  const retryList = [...new Set(failedFirstPass)];
  if (!interleavedBatch && !stopRequested && retryList.length && Date.now() < enrichStopAtMs) {
    await appendLog(lfLog('enrich_second_pass', { n: retryList.length }));
    const retryDelayMin = Math.min(MAX_DELAY_SEC, Math.max(MIN_DELAY_SEC, delayMinSec + 2));
    const retryDelayMax = Math.min(MAX_DELAY_SEC, Math.max(retryDelayMin, delayMaxSec + 4));
    for (let i = 0; i < retryList.length; i++) {
      if (stopRequested || Date.now() >= enrichStopAtMs) break;
      const uname = retryList[i];
      const result = await enrichOne(uname, i, retryList.length, retryDelayMin, retryDelayMax);
      if (result.success) {
        await appendLog(lfLog('enrich_second_ok', { u: uname }));
      }
      if (result.shouldStop) break;
    }
  }
  await setSourceMetrics('enrich', {
    totalQueued: enrichTotal,
    firstPassFailed: failedFirstPass.length,
    secondPassRetried: retryList.length,
    cadenceBand: throttleStreak > 0 ? 'throttled' : 'normal',
  });
  lfDebug('enrichLeadsWebProfileInfo: loop finished', { enrichTotal, stopRequested });
}

/**
 * After API enrichment, drop rows that are strictly below min followers (when count is known).
 */
async function pruneLeadsBelowMin(minFollowers) {
  if (minFollowers <= 0) return;
  const key = STORAGE_KEYS.LEADS;
  const data = await chrome.storage.local.get(key);
  const leads = data[key] || [];
  const kept = leads.filter(
    (r) => r.followerCount == null || r.followerCount >= minFollowers,
  );
  if (kept.length === leads.length) return;
  await chrome.storage.local.set({ [key]: kept });
  await appendLog(
    lfLog('prune_below', { n: leads.length - kept.length, min: minFollowers }),
  );
}

function wireGraphQlBridge() {
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'LEADFLOW_IG' || d.kind !== 'fetch_json' || !d.json) return;
    ingestGraphqlHints(d.json);
    if (typeof d.url === 'string' && isExploreKeywordSerpFetchUrl(d.url)) {
      const names = extractPostOwnerUsernamesFromJson(d.json);
      for (let i = 0; i < names.length; i++) interceptedMediaOwners.add(names[i]);
    }
  });
}
wireGraphQlBridge();

function mergeLeadRows(existing, incoming) {
  const pickBio =
    (incoming.bio || '').length > (existing.bio || '').length ? incoming.bio : existing.bio;
  const fc =
    existing.followerCount != null ? existing.followerCount : incoming.followerCount != null
      ? incoming.followerCount
      : null;
  const mergedEp = mergeEmailPhoneFromParts([
    existing.email,
    existing.phone,
    incoming.email,
    incoming.phone,
    existing.contact,
    incoming.contact,
    existing.bio,
    incoming.bio,
  ]);
  const pickWebsite =
    (incoming.websiteUrl || '').length > (existing.websiteUrl || '').length
      ? incoming.websiteUrl || ''
      : existing.websiteUrl || '';
  return {
    ...existing,
    followerCount: fc,
    bio: (pickBio || '').slice(0, 500),
    email: mergedEp.email,
    phone: mergedEp.phone,
    websiteUrl: pickWebsite,
    webProfileUnavailable: Boolean(existing.webProfileUnavailable || incoming.webProfileUnavailable),
    detailEnrichDone: Boolean(existing.detailEnrichDone || incoming.detailEnrichDone),
  };
}

function makeSessionId() {
  return `lf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readCurrentLeadsSnapshot() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  const rows = Array.isArray(data[STORAGE_KEYS.LEADS]) ? data[STORAGE_KEYS.LEADS] : [];
  return rows.map((r) => ({
    username: String(r.username || ''),
    followerCount: r.followerCount == null ? null : Number(r.followerCount),
    bio: String(r.bio || ''),
    email: String(r.email || ''),
    phone: String(r.phone || ''),
    websiteUrl: String(r.websiteUrl || ''),
    scrapedAt: r.scrapedAt ? String(r.scrapedAt) : '',
  }));
}

async function upsertSessionHistory(sessionPatch) {
  if (!sessionPatch || !sessionPatch.id) return;
  const key = STORAGE_KEYS.SESSION_HISTORY;
  const bag = await chrome.storage.local.get(key);
  const current = Array.isArray(bag[key]) ? bag[key] : [];
  const idx = current.findIndex((x) => x && x.id === sessionPatch.id);
  const prev = idx >= 0 ? current[idx] : null;
  const merged = {
    ...(prev || {}),
    ...sessionPatch,
    updatedAt: Date.now(),
  };
  const next = idx >= 0 ? [...current.slice(0, idx), merged, ...current.slice(idx + 1)] : [merged, ...current];
  next.sort((a, b) => Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0));
  await chrome.storage.local.set({ [key]: next.slice(0, SESSION_HISTORY_LIMIT) });
}

async function startSessionHistoryRecord(mode, query, payload, sessionPageUrl) {
  currentSessionId = makeSessionId();
  await upsertSessionHistory({
    id: currentSessionId,
    startedAt: Date.now(),
    endedAt: null,
    mode: mode || '',
    query: normalizeQuery(query || ''),
    targetLabel: formatSessionTargetForUi(mode, query),
    sessionPageUrl: sessionPageUrl || '',
    status: 'running',
    maxProfiles: Number(payload?.maxProfiles) || null,
    minFollowers: Number(payload?.minFollowers) || 0,
    totals: { gathered: 0 },
    leads: [],
    lastStatusLine: '',
  });
}

async function touchSessionHistoryStatus(statusLine) {
  if (!currentSessionId) return;
  await upsertSessionHistory({
    id: currentSessionId,
    status: 'running',
    lastStatusLine: String(statusLine || ''),
  });
}

async function finalizeSessionHistoryRecord(status, stopReason = '') {
  if (!currentSessionId) return;
  const snapshot = await readCurrentLeadsSnapshot();
  await upsertSessionHistory({
    id: currentSessionId,
    status: status || 'completed',
    endedAt: Date.now(),
    totals: { gathered: snapshot.length },
    leads: snapshot,
    stopReason: stopReason || '',
  });
  currentSessionId = '';
}

/**
 * After a user stop, the next Start with the same mode + query keeps leads and reopens that session row.
 * @param {{ mode?: string, query?: string }} payload
 */
async function findResumableScrapeSession(payload) {
  const mode = payload?.mode;
  const q = normalizeQuery(payload?.query || '');
  if (!mode || !q) return null;
  const bag = await chrome.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  const sessions = Array.isArray(bag[STORAGE_KEYS.SESSION_HISTORY]) ? bag[STORAGE_KEYS.SESSION_HISTORY] : [];
  return (
    sessions.find(
      (s) =>
        s &&
        s.status === 'stopped' &&
        s.stopReason === 'user_stopped' &&
        String(s.mode || '') === String(mode) &&
        normalizeQuery(String(s.query || '')) === q,
    ) || null
  );
}

async function appendLog(line) {
  try {
    const bag = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
    const rs = bag[STORAGE_KEYS.RUN_STATE];
    const prev = rs?.lastLog || [];
    const locStr = lfScrapeLocale === 'en' ? 'en-US' : 'it-IT';
    const lastLog = [...prev, `[${new Date().toLocaleTimeString(locStr)}] ${line}`].slice(-80);
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: {
        ...rs,
        lastLog,
        lastStatusLine: line,
      },
    });
  } catch (e) {
    const msg = (e && e.message) || String(e || '');
    if (!/Extension context invalidated/i.test(msg)) {
      throw e;
    }
    return;
  }
  try {
    await chrome.runtime.sendMessage({ type: MSG.LOG, line });
  } catch {
    /* no listener */
  }
  try {
    await touchSessionHistoryStatus(line);
  } catch {
    /* ignore if context is gone */
  }
}

function broadcast(msg) {
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && typeof p.then === 'function') p.catch(() => {});
  } catch {
    /* ignore */
  }
}

function computeEnrichReserveMs(queueSize) {
  const q = Number.isFinite(queueSize) ? Math.max(0, Math.floor(queueSize)) : 0;
  return Math.min(ENRICH_RESERVE_MAX_MS, ENRICH_RESERVE_BASE_MS + q * ENRICH_RESERVE_PER_USER_MS);
}

function shouldReserveForEnrich(sessionStartMs, maxSessionMs, queueSize) {
  const elapsed = Date.now() - sessionStartMs;
  const remainingMs = maxSessionMs - elapsed;
  const reserveMs = computeEnrichReserveMs(queueSize);
  return { shouldReserve: remainingMs <= reserveMs, remainingMs, reserveMs };
}

async function shouldPauseGatherForEnrich(sessionStartMs, maxSessionMs, maxProfiles) {
  // Uncapped = no profile limit: never cut gather short to "reserve" wall time for enrichment.
  // Users expect as many leads as sources + session allow; enrich uses remaining time and can
  // extend past the nominal session end (see enrichLeadsWebProfileInfo enrichStopAtMs).
  if (!hasProfileCap(maxProfiles)) {
    return {
      shouldReserve: false,
      remainingMs: maxSessionMs - (Date.now() - sessionStartMs),
      reserveMs: 0,
    };
  }
  const pending = await countLeadsPendingWebProfileEnrich();
  return shouldReserveForEnrich(sessionStartMs, maxSessionMs, pending);
}

async function patchRunState(partial) {
  const bag = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  const prev = bag[STORAGE_KEYS.RUN_STATE] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.RUN_STATE]: {
      ...prev,
      ...partial,
    },
  });
}

async function setSourceMetrics(sourceKey, metricPatch) {
  const bag = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  const prev = bag[STORAGE_KEYS.RUN_STATE] || {};
  const prevMetrics = prev.sessionMetrics && typeof prev.sessionMetrics === 'object' ? prev.sessionMetrics : {};
  const prevSource = prevMetrics[sourceKey] && typeof prevMetrics[sourceKey] === 'object' ? prevMetrics[sourceKey] : {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.RUN_STATE]: {
      ...prev,
      sessionMetrics: {
        ...prevMetrics,
        [sourceKey]: {
          ...prevSource,
          ...metricPatch,
        },
      },
    },
  });
}

async function mergeLeads(newRows) {
  const key = STORAGE_KEYS.LEADS;
  let data;
  try {
    data = await chrome.storage.local.get(key);
  } catch (e) {
    const msg = (e && e.message) || String(e || '');
    if (/Extension context invalidated/i.test(msg)) {
      stopRequested = true;
      throw new Error(lfLog('err_extension_reload_run', {}));
    }
    throw e;
  }
  const existing = data[key] || [];
  const map = new Map(existing.map((r) => [r.username.toLowerCase(), r]));
  const now = new Date().toISOString();
  let newAdded = 0;
  for (const row of newRows) {
    const k = row.username.toLowerCase();
    if (!map.has(k)) {
      map.set(k, {
        ...row,
        scrapedAt: row.scrapedAt || now,
        detailEnrichDone: row.detailEnrichDone === true,
      });
      newAdded += 1;
    } else {
      map.set(k, mergeLeadRows(map.get(k), row));
    }
  }
  await chrome.storage.local.set({ [key]: Array.from(map.values()) });
  return { total: map.size, newAdded };
}

/**
 * Enrich the oldest lead still pending `web_profile_info` (one username).
 * @param {{ delayMinSec: number, delayMaxSec: number, sessionStartMs: number, maxSessionMs: number, origin: string }} enrichCtx
 */
async function enrichOnePendingUsername(enrichCtx) {
  const batch = await listUsernamesPendingWebProfileEnrichBatch(1);
  if (!batch.length) return;
  await enrichLeadsWebProfileInfo({
    usernames: batch,
    delayMinSec: enrichCtx.delayMinSec,
    delayMaxSec: enrichCtx.delayMaxSec,
    sessionStartMs: enrichCtx.sessionStartMs,
    maxSessionMs: enrichCtx.maxSessionMs,
    origin: enrichCtx.origin,
    interleavedBatch: true,
  });
  if (!stopRequested) {
    await waitWithStop(computeDelayMs(enrichCtx.delayMinSec, enrichCtx.delayMaxSec));
  }
}

async function drainAllPendingEnrich(enrichCtx) {
  let guard = 0;
  const maxGuard = 50000;
  while (!stopRequested && guard < maxGuard) {
    guard += 1;
    if (Date.now() - enrichCtx.sessionStartMs >= enrichCtx.maxSessionMs) break;
    const pendingBefore = await countLeadsPendingWebProfileEnrich();
    if (pendingBefore <= 0) break;
    const headBefore = (await listUsernamesPendingWebProfileEnrichBatch(1))[0] || '';
    await enrichOnePendingUsername(enrichCtx);
    const pendingAfter = await countLeadsPendingWebProfileEnrich();
    const headAfter = (await listUsernamesPendingWebProfileEnrichBatch(1))[0] || '';

    const countDropped = pendingAfter < pendingBefore;
    const headAdvanced =
      Boolean(headBefore) &&
      Boolean(headAfter) &&
      headBefore.toLowerCase() !== headAfter.toLowerCase();

    if (countDropped || headAdvanced) continue;

    lfWarn(
      'drainAllPendingEnrich: no pending-queue progress after one enrich pass; breaking',
      `pending ${pendingBefore}→${pendingAfter}`,
      `head "${headBefore}"→"${headAfter}"`,
    );
    break;
  }
}

async function mergeLeadsThenDrainPending(newRows, enrichCtx) {
  const r = await mergeLeads(newRows);
  if (enrichCtx) await drainAllPendingEnrich(enrichCtx);
  return r;
}

function validatePage(doc, mode, queryRaw) {
  const q = normalizeQuery(queryRaw);
  const info = detectPageMode(doc.location);

  if (mode === 'hashtag') {
    if (info.mode !== 'hashtag')
      return {
        ok: false,
        message: lfLog('val_hashtag_wrong_page', {}),
      };
    if (info.tag.toLowerCase() !== q.toLowerCase())
      return {
        ok: false,
        message: lfLog('val_hashtag_mismatch', { tag: info.tag, q }),
      };
    return { ok: true };
  }

  if (mode === 'followers') {
    if (info.mode === 'followers') {
      if (info.user.toLowerCase() !== q.toLowerCase())
        return {
          ok: false,
          message: lfLog('val_followers_user_mismatch', { user: info.user, q }),
        };
      return { ok: true };
    }
    if (info.mode === 'profile') {
      if (info.user.toLowerCase() !== q.toLowerCase())
        return {
          ok: false,
          message: lfLog('val_profile_user_mismatch', { user: info.user, q }),
        };
      return { ok: true };
    }
    return {
      ok: false,
      message: lfLog('val_followers_wrong_page', {}),
    };
  }

  if (mode === 'following') {
    if (info.mode === 'following') {
      if (info.user.toLowerCase() !== q.toLowerCase())
        return {
          ok: false,
          message: lfLog('val_following_user_mismatch', { user: info.user, q }),
        };
      return { ok: true };
    }
    if (info.mode === 'profile') {
      if (info.user.toLowerCase() !== q.toLowerCase())
        return {
          ok: false,
          message: lfLog('val_profile_user_mismatch', { user: info.user, q }),
        };
      return { ok: true };
    }
    return {
      ok: false,
      message: lfLog('val_following_wrong_page', {}),
    };
  }

  return { ok: false, message: lfLog('val_unknown_mode', {}) };
}

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function abortPendingWait() {
  const fn = cancelPendingWait;
  cancelPendingWait = null;
  if (typeof fn === 'function') fn();
}

/**
 * One timer for the full duration — background tabs throttle 100ms timers to ~1s each, which
 * made inter-request delays minutes long when the dashboard tab was focused.
 */
function waitOneShotCancellable(ms) {
  const total = Math.max(0, Math.round(ms));
  if (total === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let tid = 0;
    const finish = () => {
      if (tid) clearTimeout(tid);
      tid = 0;
      if (cancelPendingWait === finish) cancelPendingWait = null;
      resolve();
    };
    cancelPendingWait = finish;
    tid = setTimeout(finish, total);
  });
}

function computeDelayMs(minSec, maxSec) {
  const minS = Math.round(Number(minSec));
  const maxS = Math.round(Number(maxSec));
  const lo = Math.min(minS, maxS) * 1000;
  const hi = Math.max(minS, maxS) * 1000;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= 0) return 2000;
  const span = Math.max(0, hi - lo);
  const base = lo + Math.random() * span;
  const jitter = Math.random() * 150;
  return Math.round(base + jitter);
}

/**
 * Hashtag API gather should stay materially faster than enrich defaults.
 * We still keep jitter and session-budget capping.
 */
function computeHashtagApiGatherDelayMs() {
  const lo = 900;
  const hi = 2600;
  return Math.round(lo + Math.random() * (hi - lo) + Math.random() * 100);
}

async function waitWithStop(ms) {
  let remaining = Math.max(0, Math.round(ms));
  while (remaining > 0 && !stopRequested) {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      await waitOneShotCancellable(remaining);
      return;
    }
    const chunk = Math.min(100, remaining);
    await waitMs(chunk);
    remaining -= chunk;
  }
}

/**
 * List / grid rows often hide follower counts until API enrichment — keep those rows.
 * (Explore hashtag search grids never show counts on tiles; min filter still applies after enrich via prune.)
 */
function passesMinFollowers(minFollowers, row, mode) {
  if (minFollowers <= 0) return true;
  if (row.followerCount == null) {
    if (mode === 'followers' || mode === 'following' || mode === 'hashtag') return true;
    return false;
  }
  return row.followerCount >= minFollowers;
}

