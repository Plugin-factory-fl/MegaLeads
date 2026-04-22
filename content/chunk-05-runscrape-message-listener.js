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
    await appendLog(lfLog('nav_list_reload', {}));
    broadcast({
      type: MSG.ERROR,
      message: lfLog('nav_list_reload', {}),
    });
    isRunning = false;
    finalSessionStatus = 'stopped';
    const rsNav = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: {
        ...(rsNav[STORAGE_KEYS.RUN_STATE] || {}),
        running: false,
        mode,
        sessionTarget: '',
        sessionModeLabel: '',
        sessionPageUrl: '',
        sessionMaxProfiles: null,
        sessionMinFollowers: null,
        stopReason: 'navigation_required',
        lastExportSlug: listUser || (rsNav[STORAGE_KEYS.RUN_STATE] || {}).lastExportSlug || '',
        lastExportMode: mode,
      },
    });
    await chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
    await finalizeSessionHistoryRecord(finalSessionStatus, 'navigation_required');
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
    await chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
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
