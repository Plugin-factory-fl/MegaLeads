/** @file chunk 5 of 5 — runScrape pipeline + chrome.runtime.onMessage listener. */

async function runScrape(payload) {
  const doc = document;
  lfSetScrapeLocale(payload && payload.locale);
  const { mode, query, minFollowers } = payload;
  const { delayMinSec, delayMaxSec } = clampDelaySecondsPair(
    payload.delayMinSec,
    payload.delayMaxSec,
  );
  const rawMin = Number(payload.maxSessionMinutes);
  const sessionMinutes = Number.isFinite(rawMin)
    ? Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(rawMin)))
    : DEFAULT_MAX_SESSION_MINUTES;

  const rawMp = payload?.maxProfiles;
  const parsedMaxProfiles = rawMp == null ? NaN : Number(rawMp);
  const maxProfiles = Number.isFinite(parsedMaxProfiles)
    ? Math.max(10, Math.round(parsedMaxProfiles))
    : null;
  const effectiveSessionMinutes = hasProfileCap(maxProfiles)
    ? sessionMinutes
    : Math.max(sessionMinutes, UNCAPPED_SESSION_MINUTES);
  const maxSessionMs = effectiveSessionMinutes * 60 * 1000;

  lfDebug('runScrape: start', {
    mode,
    maxProfiles,
    sessionMinutes,
    effectiveSessionMinutes,
    url: doc.location?.href,
  });

  const v = validatePage(doc, mode, query);
  if (!v.ok) {
    await appendLog(lfLog('run_error', { msg: v.message }));
    broadcast({ type: MSG.ERROR, message: v.message });
    const rsE = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: {
        ...(rsE[STORAGE_KEYS.RUN_STATE] || {}),
        running: false,
        mode,
        sessionMaxProfiles: null,
        stopReason: 'validation_error',
      },
    });
    await chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
    return;
  }

  const resumable = await findResumableScrapeSession(payload);
  const resumed = Boolean(resumable);
  if (!resumed) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LEADS]: [] });
  }

  stopRequested = false;
  isRunning = true;
  lfResumePendingLock = false;
  graphHints = new Map();
  let finalSessionStatus = 'completed';
  let finalStopReason = '';

  const rs0 = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  const prevRs = rs0[STORAGE_KEYS.RUN_STATE] || {};
  const sessionMinFollowers = Math.max(0, Number(minFollowers) || 0);
  await chrome.storage.local.set({
    [STORAGE_KEYS.RUN_STATE]: {
      ...prevRs,
      running: true,
      mode,
      startedAt: Date.now(),
      lastLog: [],
      sessionTarget: formatSessionTargetForUi(mode, query),
      sessionModeLabel: sessionModeLabel(mode),
      sessionPageUrl: doc.location.href,
      sessionMaxProfiles: hasProfileCap(maxProfiles) ? maxProfiles : null,
      /** Dashboard: align “emails” count with post-run `pruneLeadsBelowMin` (same threshold). */
      sessionMinFollowers,
      stopReason: '',
      sessionMetrics: {},
      currentPhase: 'gather',
    },
  });
  if (resumed && resumable?.id) {
    currentSessionId = resumable.id;
    await upsertSessionHistory({
      id: currentSessionId,
      status: 'running',
      endedAt: null,
      lastStatusLine: '',
    });
    await appendLog(lfLog('resume_run', {}));
  } else {
    await startSessionHistoryRecord(mode, query, payload, doc.location.href);
    await appendLog(lfLog('start_run', {}));
  }

  const listUser = normalizeQuery(query);
  const opened = await ensureListModalOpen(doc, mode, listUser);
  if (!opened) {
    const navLine = lfLog('nav_list_reload', {});
    await appendLog(navLine);
    broadcast({ type: MSG.LOG, line: navLine });
    isRunning = false;
    const rsNav = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
    const prev = rsNav[STORAGE_KEYS.RUN_STATE] || {};
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: {
        ...prev,
        running: true,
        mode,
        startedFromPopup: prev.startedFromPopup === true,
        sessionTarget: formatSessionTargetForUi(mode, query),
        sessionModeLabel: sessionModeLabel(mode),
        sessionPageUrl: doc.location.href,
        sessionMaxProfiles: hasProfileCap(maxProfiles) ? maxProfiles : prev.sessionMaxProfiles ?? null,
        sessionMinFollowers: sessionMinFollowers,
        stopReason: 'navigation_required',
        currentPhase: 'navigate',
        lastExportSlug: listUser || prev.lastExportSlug || '',
        lastExportMode: mode,
      },
      [STORAGE_KEYS.PENDING_SCRAPE_RESUME]: { payload, at: Date.now() },
    });
    return;
  }

  const pageInfo = detectPageMode(doc.location);
  const listOwner =
    mode === 'followers' || mode === 'following' ? listUser.toLowerCase() : null;

  const fallbackScroll = findScrollRoot(doc);
  const parseRoot = getListCollectionRoot(doc, mode, fallbackScroll);
  const scrollRoot =
    mode === 'hashtag' ? fallbackScroll : getScrollTargetForList(doc, parseRoot, fallbackScroll);

  const processed = new Set();
  const ignored = new Set();
  let stagnation = 0;
  const sessionStartMs = Date.now();
  let endedByTimeout = false;
  /** Shared context for sequential `web_profile_info` enrichment after each gather merge. */
  const enrichDrainCtx = {
    delayMinSec,
    delayMaxSec,
    sessionStartMs,
    maxSessionMs,
    origin: doc.location.origin || 'https://www.instagram.com',
  };
  /** Usernames stored this run → Growman-style web_profile_info enrichment. */
  const usernamesToEnrich = new Set();
  /** Hashtag only: drain any leads still pending API enrichment (safety between sources / DOM). */
  let maybeInterleaveHashtagEnrich = null;
  if (mode === 'hashtag') {
    maybeInterleaveHashtagEnrich = async () => {
      if (stopRequested) return;
      if (Date.now() - sessionStartMs >= maxSessionMs) return;
      const pending = await countLeadsPendingWebProfileEnrich();
      if (pending <= 0) return;
      await patchRunState({ currentPhase: 'enrich' });
      await drainAllPendingEnrich(enrichDrainCtx);
      await patchRunState({ currentPhase: 'gather' });
    };
  }

  /** Hashtag: sync DNR for keyword SERP referer; other modes use default. */
  if (mode === 'hashtag') {
    hashtagScrapeActive = true;
    await syncIgSessionHeaders(
      doc,
      `/explore/search/keyword/?q=%23${encodeURIComponent(listUser)}`,
    );
  } else {
    await syncIgSessionHeaders(doc);
  }

  /** Hashtag: intercept cache → GraphQL (deep media, multi query_hash) → top_serp → DOM scroll. */
  let skipDomScroll = false;
  /** Filled after hashtag API phases — used in gather exit diagnostics. */
  let hashtagGatherSnapshot = null;
  if (mode === 'hashtag') {
    const topSerpSeen = new Set();
    const cacheDrain = await drainExploreGridCaptureIntoLeads({
      doc,
      minFollowers,
      listOwner,
      processed,
      ignored,
      usernamesToEnrich,
      label: lfLog('label_explore_grid_cached', {}),
      maxProfiles,
      enrichDrainCtx,
    });
    await setSourceMetrics('cached', {
      pages: 0,
      parsed: 0,
      newAdded: cacheDrain.newAdded,
      duplicates: 0,
      stopReason: 'cached_drain_complete',
    });
    await appendLog(lfLog('source_cached_drain', { n: cacheDrain.newAdded }));
    if (maybeInterleaveHashtagEnrich) {
      try {
        await maybeInterleaveHashtagEnrich();
      } catch (e) {
        lfError('hashtag: interleave after cached drain', e);
      }
    }
    /** GraphQL first (Growman-style deep hashtag media), then keyword top_serp for extra authors. */
    let graphqlResult = { added: 0, pages: 0, parsed: 0, duplicates: 0, stopReason: 'not_started' };
    if (!stopRequested) {
      graphqlResult = await collectHashtagViaGraphql(doc, listUser, {
        minFollowers,
        delayMinSec,
        delayMaxSec,
        sessionStartMs,
        maxSessionMs,
        usernamesToEnrich,
        maxProfiles,
        onInterleaveEnrich: maybeInterleaveHashtagEnrich,
        enrichDrainCtx,
      });
      await appendLog(lfLog('source_graphql_done', { reason: graphqlResult.stopReason }));
    }
    let topSerpResult = {
      added: 0,
      pages: 0,
      parsed: 0,
      duplicates: 0,
      stopReason: 'not_started',
      switchedByDuplicateRatio: false,
    };
    if (
      !stopRequested &&
      graphqlResult.stopReason !== 'profile_cap_reached' &&
      graphqlResult.stopReason !== 'session_timeout'
    ) {
      topSerpResult = await collectHashtagViaTopSerpApi(doc, listUser, {
        minFollowers,
        delayMinSec,
        delayMaxSec,
        sessionStartMs,
        maxSessionMs,
        usernamesToEnrich,
        maxProfiles,
        topSerpSeen,
        onInterleaveEnrich: maybeInterleaveHashtagEnrich,
        enrichDrainCtx,
      });
      await appendLog(lfLog('source_top_serp_done', { reason: topSerpResult.stopReason }));
    }
    const { total: afterApiSources } = await mergeLeads([]);
    const apiAdded = cacheDrain.newAdded + topSerpResult.added + graphqlResult.added;
    const apiDuplicates = topSerpResult.duplicates + graphqlResult.duplicates;
    await appendLog(
      lfLog('hashtag_source_summary', {
        c: cacheDrain.newAdded,
        g: graphqlResult.added,
        t: topSerpResult.added,
        d: apiDuplicates,
        tot: afterApiSources,
      }),
    );
    await patchRunState({
      sourceTransition: lfLog('source_transition_line', {
        g: graphqlResult.stopReason,
        t: topSerpResult.stopReason,
      }),
    });
    skipDomScroll =
      stopRequested ||
      topSerpResult.stopReason === 'profile_cap_reached' ||
      topSerpResult.stopReason === 'session_timeout' ||
      graphqlResult.stopReason === 'profile_cap_reached' ||
      graphqlResult.stopReason === 'session_timeout';
    if (topSerpResult.stopReason === 'profile_cap_reached' || graphqlResult.stopReason === 'profile_cap_reached') {
      finalStopReason = 'profile_cap_reached';
    } else if (
      topSerpResult.stopReason === 'session_timeout' ||
      graphqlResult.stopReason === 'session_timeout'
    ) {
      finalStopReason = 'session_timeout';
      endedByTimeout = true;
    }
    hashtagGatherSnapshot = {
      cacheDrainNew: cacheDrain.newAdded,
      topSerp: {
        added: topSerpResult.added,
        pages: topSerpResult.pages,
        dups: topSerpResult.duplicates,
        stop: topSerpResult.stopReason,
      },
      graphql: {
        added: graphqlResult.added,
        pages: graphqlResult.pages,
        dups: graphqlResult.duplicates,
        stop: graphqlResult.stopReason,
      },
      totalStoredAfterApi: afterApiSources,
      skipDomScroll,
    };
    if (!skipDomScroll) {
      await appendLog(lfLog('source_dom_fallback', { n: apiAdded }));
      await appendLog(lfLog('scroll_grid_hint', {}));
    }
  } else if (mode === 'followers' || mode === 'following') {
    skipDomScroll = await collectFollowersFollowingViaFriendshipApi(doc, listUser, mode, {
      minFollowers,
      maxProfiles,
      delayMinSec,
      delayMaxSec,
      sessionStartMs,
      maxSessionMs,
      usernamesToEnrich,
      enrichDrainCtx,
    });
  }

  try {
    let gatherLoopBreak = '';
    let domScrollIterations = 0;
    while (!skipDomScroll && !stopRequested) {
      domScrollIterations += 1;
      let gridDrainNew = 0;
      if (mode === 'hashtag') {
        const gridDrain = await drainExploreGridCaptureIntoLeads({
          doc,
          minFollowers,
          listOwner,
          processed,
          ignored,
          usernamesToEnrich,
          label: lfLog('label_explore_grid', {}),
          maxProfiles,
          enrichDrainCtx,
        });
        gridDrainNew = gridDrain.newAdded;
      }
      if (Date.now() - sessionStartMs >= maxSessionMs) {
        endedByTimeout = true;
        finalStopReason = 'session_timeout';
        gatherLoopBreak = 'session_timeout_top';
        await appendLog(lfLog('session_time_stop', { min: effectiveSessionMinutes }));
        break;
      }
      if (mode === 'hashtag') {
        const pqReserve = await countLeadsPendingWebProfileEnrich();
        if (pqReserve > 0) {
          const reserve = await shouldPauseGatherForEnrich(sessionStartMs, maxSessionMs, maxProfiles);
          if (reserve.shouldReserve) {
            gatherLoopBreak = 'reserved_for_enrichment';
            await appendLog(
              lfLog('reserve_enrich', {
                n: pqReserve,
                sec: Math.ceil(reserve.reserveMs / 1000),
              }),
            );
            finalStopReason = 'reserved_for_enrichment';
            lfDebug('gather: DOM reserve triggered', {
              pending: pqReserve,
              remainingMs: reserve.remainingMs,
              reserveMs: reserve.reserveMs,
            });
            break;
          }
        }
      }

      const { total: totalStored } = await mergeLeads([]);
      if (hasProfileCap(maxProfiles) && totalStored >= maxProfiles) {
        finalStopReason = 'profile_cap_reached';
        gatherLoopBreak = 'profile_cap_pre_batch';
        await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
        break;
      }

      const collectionRoot = mode === 'hashtag' ? doc.body : parseRoot;
      const anchors = collectProfileAnchors(doc, collectionRoot);
      let newAdded = 0;
      let afterTotal = totalStored;

      for (const a of anchors) {
        if (stopRequested) break;
        const u = usernameFromProfilePath(pathnameFromAnchor(a, doc.location.origin));
        if (!u) continue;
        const key = u.toLowerCase();
        if (ignored.has(key)) continue;
        if (processed.has(key)) continue;

        if (listOwner && key === listOwner) {
          ignored.add(key);
          continue;
        }
        if (isAnchorInGlobalChrome(a)) continue;

        const rowSnippet = anchorRowContextText(a);
        if (isLikelyProfileHeroBlurb(rowSnippet)) {
          ignored.add(key);
          continue;
        }

        processed.add(key);

        let row;
        try {
          if (a.isConnected) {
            row = extractLeadFromProfileAnchor(a, u);
          } else {
            row = {
              username: u,
              bio: '',
              followerCount: null,
              email: '',
              phone: '',
              websiteUrl: '',
              detailEnrichDone: false,
            };
          }
        } catch (e) {
          await appendLog(lfLog('parse_skip', { u, err: (e && e.message) || e }));
          continue;
        }

        if (isLikelyProfileHeroBlurb(row.bio) || isLikelyProfileHeroBlurb(rowSnippet)) continue;

        row = mergeHintsIntoRow(row);

        if (!passesMinFollowers(minFollowers, row, mode)) continue;

        const rowObj = {
          username: row.username,
          followerCount: row.followerCount,
          bio: row.bio,
          email: row.email || '',
          phone: row.phone || '',
          websiteUrl: row.websiteUrl || '',
          scrapedAt: new Date().toISOString(),
          detailEnrichDone: false,
        };
        usernamesToEnrich.add(row.username);

        const mergeRes = enrichDrainCtx
          ? await mergeLeadsThenDrainPending([rowObj], enrichDrainCtx)
          : await mergeLeads([rowObj]);
        newAdded += mergeRes.newAdded;
        afterTotal = mergeRes.total;
        if (mergeRes.newAdded > 0) {
          broadcast({
            type: MSG.PROGRESS,
            phase: 'gather',
            extracted: afterTotal,
            batchAdded: mergeRes.newAdded,
            logLine: lfLog(mode === 'hashtag' ? 'progress_hashtag_dom' : 'progress_list_dom', {
              u: rowObj.username,
            }),
          });
        }

        if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) break;
      }

      if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) {
        finalStopReason = 'profile_cap_reached';
        gatherLoopBreak = 'profile_cap_post_merge';
        await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
        broadcast({
          type: MSG.PROGRESS,
          phase: 'gather',
          extracted: afterTotal,
          batchAdded: newAdded,
          logLine: lfLog('progress_cap', { max: maxProfiles }),
        });
        break;
      }

      await scrollListStepBackground(doc, scrollRoot, collectionRoot);

      // Count consecutive batches with zero *new* stored profiles only.
      // Do not reset on scroll position / “not at bottom” — IG lists often keep
      // accepting scroll deltas while no new rows appear, which made STAGNATION_LIMIT
      // effectively never trigger.
      // Hashtag: also count grid intercept drain — DOM tiles often duplicate API phase
      // while explore_grid XHRs still deliver new owners; ignoring drain caused false
      // stagnation exits (~150–200 profile “ceilings”).
      if (newAdded > 0 || gridDrainNew > 0) stagnation = 0;
      else stagnation += 1;

      const logLine = lfLog('scroll_status', {
        tot: afterTotal,
        new: newAdded,
        extra:
          mode === 'hashtag' && gridDrainNew
            ? lfLog('scroll_extra_grid', { n: gridDrainNew })
            : '',
      });
      await appendLog(logLine);
      if (mode === 'hashtag') {
        await setSourceMetrics('domFallback', {
          extracted: afterTotal,
          lastBatchAdded: newAdded,
          stagnation,
        });
      }
      broadcast({
        type: MSG.PROGRESS,
        phase: 'gather',
        extracted: afterTotal,
        batchAdded: newAdded,
        logLine,
      });

      if (mode === 'hashtag' && maybeInterleaveHashtagEnrich) {
        try {
          await maybeInterleaveHashtagEnrich();
        } catch (e) {
          lfError('gather DOM: maybeInterleaveHashtagEnrich', e);
        }
      }

      const stagnationLimit =
        mode === 'hashtag' ? STAGNATION_LIMIT_HASHTAG_DOM : STAGNATION_LIMIT;
      if (stagnation >= stagnationLimit) {
        finalStopReason = 'source_exhausted';
        gatherLoopBreak = 'dom_stagnation';
        await appendLog(lfLog('dom_stagnation', { lim: stagnationLimit }));
        lfDebug('gather: dom stagnation stop', {
          stagnation,
          stagnationLimit,
          domScrollIterations,
          anchorBatchNew: newAdded,
          lastGridDrainNew: gridDrainNew,
          processedSize: processed.size,
        });
        break;
      }

      const elapsed = Date.now() - sessionStartMs;
      const remainingMs = maxSessionMs - elapsed;
      if (remainingMs <= 0) {
        endedByTimeout = true;
        finalStopReason = 'session_timeout';
        gatherLoopBreak = 'session_timeout_tail';
        await appendLog(lfLog('session_time_stop', { min: effectiveSessionMinutes }));
        break;
      }
      let delayMs = computeDelayMs(delayMinSec, delayMaxSec);
      delayMs = Math.min(delayMs, remainingMs);
      await waitWithStop(delayMs);
    }

    if (!gatherLoopBreak) {
      gatherLoopBreak = stopRequested
        ? 'user_stop_while_condition'
        : skipDomScroll
          ? 'skip_dom_scroll_no_loop'
          : 'while_condition_false_unknown';
    }
    lfDebug('gather: while loop exited', {
      mode,
      skipDomScroll,
      stopRequested,
      endedByTimeout,
      usernamesToEnrichSize: usernamesToEnrich.size,
      gatherLoopBreak,
      finalStopReason: finalStopReason || '(unset)',
      domScrollIterations,
      stagnation,
      processedSize: processed.size,
      hashtagApi: hashtagGatherSnapshot,
      maxProfiles: hasProfileCap(maxProfiles) ? maxProfiles : null,
      effectiveSessionMinutes,
    });
    lfDebug('gather: about to appendLog (phase finished → enrich)');
    await patchRunState({ currentPhase: 'enrich' });
    await appendLog(
      lfLog(mode === 'hashtag' ? 'gather_done_hashtag' : 'gather_done_list', {}),
    );
    lfDebug('gather: appendLog phase-finished returned');
    lfDebug('enrich: pre-sync syncIgSessionHeaders');
    await syncIgSessionHeaders(doc);
    lfDebug('enrich: post-sync syncIgSessionHeaders');
    const enrichUsernames = await listAllUsernamesPendingWebProfileEnrich(maxProfiles);
    lfDebug('enrich: username list for final pass', {
      mode,
      length: enrichUsernames.length,
      sample: enrichUsernames.slice(0, 5),
    });
    if (enrichUsernames.length) {
      await enrichLeadsWebProfileInfo({
        usernames: enrichUsernames,
        delayMinSec,
        delayMaxSec,
        sessionStartMs,
        maxSessionMs,
        origin: doc.location.origin,
      });
    } else if (mode === 'hashtag') {
      await appendLog(lfLog('enrich_none_pending', {}));
    }
    await pruneLeadsBelowMin(minFollowers);

    const finalData = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
    const total = (finalData[STORAGE_KEYS.LEADS] || []).length;
    if (stopRequested) {
      finalSessionStatus = 'stopped';
      finalStopReason = 'user_stopped';
      await appendLog(lfLog('stopped_user', {}));
    } else if (endedByTimeout) {
      finalSessionStatus = 'timed_out';
      finalStopReason = finalStopReason || 'session_timeout';
      await appendLog(lfLog('session_limit_done', { min: effectiveSessionMinutes, total }));
    } else {
      finalSessionStatus = 'completed';
      finalStopReason = finalStopReason || 'completed';
      await appendLog(lfLog('complete_run', { total }));
    }
    broadcast({
      type: MSG.COMPLETE,
      total,
      stopped: stopRequested || endedByTimeout,
      timedOut: endedByTimeout,
    });
  } catch (e) {
    finalSessionStatus = 'error';
    finalStopReason = 'runtime_error';
    lfError('runScrape: try/catch', e?.message || e, e?.stack);
    const msg = (e && e.message) || String(e);
    await appendLog(lfLog('run_error', { msg }));
    broadcast({ type: MSG.ERROR, message: msg });
  } finally {
    hashtagScrapeActive = false;
    interceptedMediaOwners.clear();
    isRunning = false;
    stopRequested = false;
    const rs = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
    const cur = rs[STORAGE_KEYS.RUN_STATE] || {};
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: {
        ...cur,
        running: false,
        sessionTarget: '',
        sessionModeLabel: '',
        sessionPageUrl: '',
        sessionMaxProfiles: null,
        sessionMinFollowers: null,
        stopReason: finalStopReason || 'completed',
        /** Normalized hashtag or profile username — for dashboard export filenames after the run. */
        lastExportSlug: listUser || cur.lastExportSlug || '',
        lastExportMode: mode,
      },
    });
    await chrome.storage.local.remove([
      STORAGE_KEYS.SCRAPE_SOURCE_TAB,
      STORAGE_KEYS.PENDING_SCRAPE_RESUME,
      STORAGE_KEYS.POPUP_ARMED_EXTRACT,
    ]);
    await finalizeSessionHistoryRecord(finalSessionStatus, finalStopReason || 'completed');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.PING) {
    sendResponse({ type: MSG.PONG, instagram: true, scraping: Boolean(isRunning) });
    return false;
  }

  if (message?.type === MSG.GET_PAGE_CONTEXT) {
    try {
      const info = detectPageMode(document.location);
      sendResponse({ ok: true, pageMode: info.mode, tag: info.tag, user: info.user });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
    return false;
  }

  if (message?.type === MSG.STOP_SCRAPE) {
    stopRequested = true;
    abortPendingWait();
    sendResponse({ ok: true, stopping: true });
    return false;
  }

  if (message?.type === MSG.START_SCRAPE) {
    const payload = message.payload;
    lfSetScrapeLocale(payload && payload.locale);
    if (isRunning) {
      sendResponse({ ok: false, error: lfLog('err_already_running', {}) });
      return false;
    }
    lfDebug('START_SCRAPE', { mode: payload?.mode, maxProfiles: payload?.maxProfiles });
    runScrape(payload).catch(async (e) => {
      lfError('runScrape: unhandled rejection', e?.message || e, e?.stack);
      try {
        await appendLog(lfLog('run_fatal', { msg: e?.message || e }));
      } catch {
        /* ignore if extension context already invalidated */
      }
      broadcast({ type: MSG.ERROR, message: e?.message || String(e) });
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  return false;
});

// --- Floating Instagram CTA: "Extract Leads Now" ---
let lfOverlayBtn = null;
let lfOverlayDrag = null;
let lfOverlayLastPath = '';
let lfOverlaySparkleTimer = 0;

function lfEnsureOverlayStyles() {
  if (document.getElementById('lfOverlayCtaStyle')) return;
  const style = document.createElement('style');
  style.id = 'lfOverlayCtaStyle';
  style.textContent = `
    .lf-overlay-cta {
      position: fixed;
      top: 50px;
      left: calc(50vw + 200px);
      z-index: 2147483640;
      border: 1px solid rgba(167, 139, 250, 0.6);
      border-radius: 999px;
      background: linear-gradient(135deg, #7c3aed, #8b5cf6 55%, #a78bfa);
      color: #fff;
      font: 700 13px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      letter-spacing: 0.01em;
      padding: 0.55rem 1rem 0.55rem 0.6rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      text-align: left;
      box-shadow:
        0 8px 24px rgba(0, 0, 0, 0.28),
        0 0 14px rgba(124, 58, 237, 0.7),
        0 0 26px rgba(124, 58, 237, 0.45);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: transform 120ms ease, filter 120ms ease, box-shadow 180ms ease;
      animation: lf-overlay-float 3.8s ease-in-out infinite;
    }
    .lf-overlay-cta:hover {
      transform: translateY(-1px);
      filter: brightness(1.06);
      box-shadow:
        0 10px 28px rgba(0, 0, 0, 0.32),
        0 0 16px rgba(124, 58, 237, 0.78),
        0 0 32px rgba(124, 58, 237, 0.52);
    }
    .lf-overlay-cta:active {
      transform: translateY(0) scale(0.99);
    }
    .lf-overlay-cta[hidden] {
      display: none !important;
    }
    .lf-overlay-cta-logo {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.58);
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.18);
      flex: 0 0 auto;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 35% 30%, #a78bfa, #6d28d9 60%, #4c1d95);
      overflow: hidden;
    }
    .lf-overlay-cta-logo svg {
      width: 18px;
      height: 18px;
      display: block;
    }
    .lf-overlay-cta-text {
      white-space: pre-line;
      color: #fff;
      font: inherit;
      letter-spacing: inherit;
      pointer-events: none;
    }
    .lf-overlay-sparkle {
      position: fixed;
      z-index: 2147483639;
      border-radius: 999px;
      background: radial-gradient(circle, #c084fc 0%, #a855f7 60%, rgba(168, 85, 247, 0.1) 100%);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.68);
      pointer-events: none;
      animation: lf-overlay-sparkle-fall 1.8s linear forwards;
    }
    @keyframes lf-overlay-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    @keyframes lf-overlay-sparkle-fall {
      0% { transform: translateY(0) scale(1); opacity: 0.95; }
      100% { transform: translateY(180px) scale(0.5); opacity: 0; }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function lfEligibleOverlayPage() {
  const info = detectPageMode(document.location);
  return (
    info.mode === 'profile' ||
    info.mode === 'hashtag' ||
    info.mode === 'followers' ||
    info.mode === 'following'
  );
}

function lfEnsureOverlayButton() {
  lfEnsureOverlayStyles();
  if (lfOverlayBtn && lfOverlayBtn.isConnected) return lfOverlayBtn;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lf-overlay-cta';
  const logo = document.createElement('span');
  logo.className = 'lf-overlay-cta-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="16.8" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="14.6" font-weight="900" fill="#facc15">ML</text></svg>';
  const label = document.createElement('span');
  label.className = 'lf-overlay-cta-text';
  label.textContent = 'MegaLeads AI\nExtract Leads Now';
  btn.append(logo, label);
  btn.setAttribute('aria-label', 'Extract leads now');
  btn.addEventListener('click', () => {
    if (lfOverlayDrag && lfOverlayDrag.moved) return;
    try {
      if (!chrome.runtime?.id) return;
      const info = detectPageMode(document.location);
      if (info.mode === 'followers' || info.mode === 'following') {
        const user = String(info.user || '').trim();
        if (!user) return;
        const origin = document.location.origin || 'https://www.instagram.com';
        const profileUrl = `${origin}/${encodeURIComponent(user)}/`;
        const listMode = info.mode;
        chrome.storage.local.set(
          {
            [STORAGE_KEYS.OVERLAY_PENDING_START]: {
              username: user,
              mode: listMode,
              at: Date.now(),
            },
          },
          () => {
            document.location.assign(profileUrl);
          },
        );
        return;
      }
      chrome.runtime.sendMessage({ type: MSG.OPEN_POPUP }, () => void chrome.runtime.lastError);
    } catch {
      /* Extension context invalidated — user should refresh Instagram tab */
    }
  });
  btn.addEventListener('pointerdown', (ev) => {
    lfOverlayDrag = {
      id: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      wasRightAnchored: !btn.style.left,
    };
    try {
      btn.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  });
  btn.addEventListener('pointermove', (ev) => {
    if (!lfOverlayDrag || lfOverlayDrag.id !== ev.pointerId) return;
    const dx = ev.clientX - lfOverlayDrag.startX;
    const dy = ev.clientY - lfOverlayDrag.startY;
    if (!lfOverlayDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    lfOverlayDrag.moved = true;
    const rect = btn.getBoundingClientRect();
    const nextLeft = Math.min(Math.max(8, rect.left + dx), Math.max(8, window.innerWidth - rect.width - 8));
    const nextTop = Math.min(Math.max(8, rect.top + dy), Math.max(8, window.innerHeight - rect.height - 8));
    btn.style.left = `${nextLeft}px`;
    btn.style.top = `${nextTop}px`;
    btn.style.right = 'auto';
    lfOverlayDrag.startX = ev.clientX;
    lfOverlayDrag.startY = ev.clientY;
  });
  btn.addEventListener('pointerup', (ev) => {
    if (!lfOverlayDrag || lfOverlayDrag.id !== ev.pointerId) return;
    try {
      btn.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      lfOverlayDrag = null;
    }, 0);
  });
  document.documentElement.appendChild(btn);
  lfOverlayBtn = btn;
  return btn;
}

function lfRefreshOverlayButton() {
  const btn = lfEnsureOverlayButton();
  if (!btn) return;
  const show = lfEligibleOverlayPage();
  btn.hidden = !show;
  if (show && !btn.style.left) {
    btn.style.top = '50px';
    btn.style.left = 'calc(50vw + 200px)';
    btn.style.right = 'auto';
  }
}

function lfSpawnOverlaySparkle() {
  const btn = lfOverlayBtn;
  if (!btn || btn.hidden) return;
  const r = btn.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'lf-overlay-sparkle';
  const size = 4 + Math.random() * 7;
  const startX = r.left + r.width * (0.18 + Math.random() * 0.64);
  const startY = r.bottom - 2 + Math.random() * 8;
  el.style.left = `${startX}px`;
  el.style.top = `${startY}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.animationDuration = `${1.35 + Math.random() * 1.1}s`;
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function lfStartOverlaySparkles() {
  if (lfOverlaySparkleTimer) return;
  lfOverlaySparkleTimer = window.setInterval(() => {
    if (!lfOverlayBtn || lfOverlayBtn.hidden) return;
    lfSpawnOverlaySparkle();
    if (Math.random() > 0.42) lfSpawnOverlaySparkle();
  }, 160);
}

let lfResumePendingLock = false;

async function lfTryResumePendingScrape() {
  if (lfResumePendingLock || isRunning) return;
  try {
    if (!chrome.runtime?.id) return;
    const bag = await chrome.storage.local.get([
      STORAGE_KEYS.PENDING_SCRAPE_RESUME,
      STORAGE_KEYS.RUN_STATE,
    ]);
    const pending = bag[STORAGE_KEYS.PENDING_SCRAPE_RESUME];
    if (!pending?.payload || typeof pending.payload !== 'object') return;
    if (Date.now() - (Number(pending.at) || 0) > 180000) {
      await chrome.storage.local.remove(STORAGE_KEYS.PENDING_SCRAPE_RESUME);
      return;
    }
    const rs = bag[STORAGE_KEYS.RUN_STATE] || {};
    if (!rs.running) return;

    const payload = pending.payload;
    const mode = String(payload.mode || '');
    const listUser = normalizeQuery(payload.query || '');
    const v = validatePage(document, mode, listUser);
    if (!v.ok) return;

    const info = detectPageMode(document.location);
    if (mode === 'followers') {
      if (info.mode !== 'followers' || info.user.toLowerCase() !== listUser) return;
    } else if (mode === 'following') {
      if (info.mode !== 'following' || info.user.toLowerCase() !== listUser) return;
    } else {
      return;
    }

    lfResumePendingLock = true;
    await chrome.storage.local.remove(STORAGE_KEYS.PENDING_SCRAPE_RESUME);
    await patchRunState({ stopReason: '', currentPhase: 'gather' });
    void runScrape(payload).catch(async (e) => {
      lfError('runScrape resume: unhandled rejection', e?.message || e, e?.stack);
      try {
        await appendLog(lfLog('run_fatal', { msg: e?.message || e }));
      } catch {
        /* ignore */
      }
      broadcast({ type: MSG.ERROR, message: e?.message || String(e) });
    });
  } catch {
    lfResumePendingLock = false;
  }
}

async function lfTryConsumeOverlayPending() {
  try {
    if (!chrome.runtime?.id) return;
    const bag = await chrome.storage.local.get(STORAGE_KEYS.OVERLAY_PENDING_START);
    const pending = bag[STORAGE_KEYS.OVERLAY_PENDING_START];
    if (!pending || typeof pending !== 'object') return;
    if (Date.now() - (Number(pending.at) || 0) > 120000) {
      await chrome.storage.local.remove(STORAGE_KEYS.OVERLAY_PENDING_START);
      return;
    }
    const info = detectPageMode(document.location);
    if (info.mode !== 'profile') return;
    const want = String(pending.username || '').trim().toLowerCase();
    if (!want || info.user.toLowerCase() !== want) return;
    chrome.runtime.sendMessage({ type: MSG.OPEN_POPUP }, () => void chrome.runtime.lastError);
  } catch {
    /* ignore */
  }
}

function lfInitOverlayButton() {
  lfRefreshOverlayButton();
  lfStartOverlaySparkles();
  void lfTryResumePendingScrape();
  void lfTryConsumeOverlayPending();
  setInterval(() => {
    const key = `${document.location.pathname}|${document.location.search}`;
    if (key !== lfOverlayLastPath) {
      lfOverlayLastPath = key;
      lfRefreshOverlayButton();
      void lfTryResumePendingScrape();
      void lfTryConsumeOverlayPending();
    }
  }, 700);
}

lfInitOverlayButton();
