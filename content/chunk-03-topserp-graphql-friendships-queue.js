/** @file chunk 3 of 5 — collectHashtagViaTopSerpApi, GraphQL collector, friendships API, row mapping, enrich queue builders. */

/**
 * Direct top_serp API (matches Network tab on /explore/search/keyword/?q=%23tag).
 * @returns {Promise<{ added: number, pages: number, parsed: number, duplicates: number, stopReason: string, switchedByDuplicateRatio: boolean }>}
 */
async function collectHashtagViaTopSerpApi(doc, tagName, ctx) {
  const {
    minFollowers,
    delayMinSec,
    delayMaxSec,
    sessionStartMs,
    maxSessionMs,
    usernamesToEnrich,
    maxProfiles = null,
    topSerpSeen = null,
    onInterleaveEnrich = null,
    enrichDrainCtx = null,
  } = ctx;
  await appendLog(lfLog('top_serp_start', { tag: tagName }));

  let nextMaxId = '';
  let rankToken = newIgRankToken();
  let searchSessionId = '';
  let sessionAdded = 0;
  let pages = 0;
  let stagnation = 0;
  let zeroAddStreak = 0;
  let cursorRepeat = 0;
  let lastNextMaxId = '';
  let transientErrors = 0;
  let parsedTotal = 0;
  let duplicateTotal = 0;
  /** @type {number[]} */
  const recentAdds = [];
  /** @type {number[]} */
  const recentDuplicateRatios = [];
  let stopReason = 'top_serp_exhausted';
  const seenMap = topSerpSeen instanceof Set ? topSerpSeen : new Set();

  while (!stopRequested && pages < HASHTAG_API_HARD_FAILSAFE_PAGES) {
    if (Date.now() - sessionStartMs >= maxSessionMs) {
      stopReason = 'session_timeout';
      break;
    }
    const reserve = await shouldPauseGatherForEnrich(sessionStartMs, maxSessionMs, maxProfiles);
    if (reserve.shouldReserve) {
      stopReason = 'reserved_for_enrichment';
      const pq = await countLeadsPendingWebProfileEnrich();
      await appendLog(
        lfLog('top_serp_reserve', {
          sec: Math.ceil(reserve.reserveMs / 1000),
          n: pq,
        }),
      );
      break;
    }

    const { total: totalStored } = await mergeLeads([]);
    if (hasProfileCap(maxProfiles) && totalStored >= maxProfiles) {
      await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
      stopReason = 'profile_cap_reached';
      break;
    }

    let json;
    try {
      const res = await fetchHashtagTopSerpJson(
        doc,
        tagName,
        nextMaxId,
        rankToken,
        searchSessionId,
      );
      if (!res.ok) {
        if (res.status >= 500 || res.status === 0) {
          transientErrors += 1;
          await appendLog(
            lfLog('top_serp_transient', {
              status: res.status,
              cur: transientErrors,
              lim: TOP_SERP_TRANSIENT_ERROR_LIMIT,
            }),
          );
          if (transientErrors >= TOP_SERP_TRANSIENT_ERROR_LIMIT) {
            stopReason = 'top_serp_error';
            break;
          }
          await waitWithStop(Math.min(7000 + transientErrors * 1500, 20000));
          continue;
        }
        await appendLog(lfLog('top_serp_http', { status: res.status }));
        stopReason = res.status === 429 ? 'top_serp_rate_limited' : 'top_serp_error';
        break;
      }
      json = res.json;
      if (!json || typeof json !== 'object') {
        transientErrors += 1;
        await appendLog(
          lfLog('top_serp_empty_json', {
            cur: transientErrors,
            lim: TOP_SERP_TRANSIENT_ERROR_LIMIT,
          }),
        );
        if (transientErrors >= TOP_SERP_TRANSIENT_ERROR_LIMIT) {
          stopReason = 'top_serp_error';
          break;
        }
        await waitWithStop(Math.min(5000 + transientErrors * 1200, 16000));
        continue;
      }
      if (json.status === 'fail') {
        await appendLog(lfLog('top_serp_fail_msg', { msg: json.message || lfLog('word_fail', {}) }));
        stopReason = 'top_serp_error';
        break;
      }
    } catch (e) {
      transientErrors += 1;
      await appendLog(
        lfLog('top_serp_transient_err', {
          msg: (e && e.message) || e,
          cur: transientErrors,
          lim: TOP_SERP_TRANSIENT_ERROR_LIMIT,
        }),
      );
      const msg = String((e && e.message) || e || '');
      const isTransportError =
        /NETWORK_CHANGED|QUIC|Failed to fetch|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(msg);
      if (isTransportError && transientErrors >= 2 && pages >= 20) {
        stopReason = 'top_serp_error';
        await appendLog(lfLog('top_serp_transport', {}));
        break;
      }
      if (transientErrors >= TOP_SERP_TRANSIENT_ERROR_LIMIT) {
        stopReason = 'top_serp_error';
        break;
      }
      await waitWithStop(Math.min(7000 + transientErrors * 1500, 20000));
      continue;
    }
    transientErrors = 0;

    const pageInfo = topSerpPaginationFromJson(json);
    if (pageInfo.rankToken) rankToken = pageInfo.rankToken;
    if (pageInfo.searchSessionId) searchSessionId = pageInfo.searchSessionId;

    const names = extractPostOwnerUsernamesFromJson(json);
    let afterTotal = totalStored;
    let pageNewAdded = 0;
    for (let i = 0; i < names.length; i++) {
      const u = names[i];
      if (isHashtagOwnerSkipped(u)) continue;
      const seenKey = u.toLowerCase();
      if (seenMap.has(seenKey)) continue;
      seenMap.add(seenKey);
      const row = {
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
      usernamesToEnrich.add(u);
      const r = enrichDrainCtx
        ? await mergeLeadsThenDrainPending([row], enrichDrainCtx)
        : await mergeLeads([row]);
      pageNewAdded += r.newAdded;
      afterTotal = r.total;
      if (r.newAdded > 0) {
        broadcast({
          type: MSG.PROGRESS,
          phase: 'gather',
          extracted: afterTotal,
          batchAdded: r.newAdded,
            logLine: lfLog('progress_top_serp_user', { u }),
        });
      }
      if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) break;
    }

    const newAdded = pageNewAdded;
    sessionAdded += newAdded;
    pages += 1;
    parsedTotal += names.length;
    const pageDuplicates = Math.max(0, names.length - newAdded);
    duplicateTotal += pageDuplicates;
    recentAdds.push(newAdded);
    recentDuplicateRatios.push(names.length > 0 ? pageDuplicates / names.length : 1);
    if (recentAdds.length > TOP_SERP_DUPLICATE_PIVOT_WINDOW) recentAdds.shift();
    if (recentDuplicateRatios.length > TOP_SERP_DUPLICATE_PIVOT_WINDOW) recentDuplicateRatios.shift();
    if (newAdded > 0) {
      stagnation = 0;
      zeroAddStreak = 0;
    } else {
      stagnation += 1;
      zeroAddStreak += 1;
    }

    await appendLog(
      lfLog('top_serp_page', {
        p: pages,
        add: newAdded,
        tot: afterTotal,
        parsed: names.length,
        dup: pageDuplicates,
        more: pageInfo.hasMore,
      }),
    );
    if (pages === 1 || pages % 10 === 0) {
      await appendLog(
        lfLog('top_serp_cursor_dbg', {
          nid: pageInfo.nextMaxId ? lfLog('set', {}) : lfLog('empty', {}),
          rt: pageInfo.rankToken ? lfLog('set', {}) : lfLog('empty', {}),
          sid: pageInfo.searchSessionId ? lfLog('set', {}) : lfLog('empty', {}),
        }),
      );
    }
    broadcast({
      type: MSG.PROGRESS,
      phase: 'gather',
      extracted: afterTotal,
      batchAdded: newAdded,
      logLine: lfLog('progress_top_serp_page', { p: pages }),
    });

    if (typeof onInterleaveEnrich === 'function') {
      try {
        await onInterleaveEnrich();
      } catch (e) {
        lfError('top_serp: onInterleaveEnrich', e);
      }
    }

    if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) {
      await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
      stopReason = 'profile_cap_reached';
      break;
    }

    if (!pageInfo.hasMore || !pageInfo.nextMaxId) {
      stopReason = 'top_serp_exhausted';
      break;
    }
    if (pageInfo.nextMaxId === lastNextMaxId) {
      cursorRepeat += 1;
    } else {
      cursorRepeat = 0;
    }
    if (cursorRepeat >= TOP_SERP_CURSOR_REPEAT_LIMIT) {
      stopReason = 'top_serp_exhausted';
      await appendLog(lfLog('top_serp_cursor_stall', { n: cursorRepeat + 1 }));
      break;
    }
    if (pages >= TOP_SERP_DUPLICATE_PIVOT_MIN_PAGES && recentAdds.length >= TOP_SERP_DUPLICATE_PIVOT_WINDOW) {
      const windowNew = recentAdds.reduce((sum, n) => sum + n, 0);
      const avgDupRatio =
        recentDuplicateRatios.reduce((sum, v) => sum + v, 0) / recentDuplicateRatios.length;
      if (avgDupRatio >= TOP_SERP_DUPLICATE_PIVOT_RATIO && windowNew <= TOP_SERP_DUPLICATE_PIVOT_MAX_NEW) {
        stopReason = 'top_serp_duplicate_pivot';
        await appendLog(
          lfLog('top_serp_dup_tail', {
            pct: (avgDupRatio * 100).toFixed(1),
            w: windowNew,
            win: TOP_SERP_DUPLICATE_PIVOT_WINDOW,
          }),
        );
        break;
      }
    }
    if (pages >= TOP_SERP_LOW_ABS_PIVOT_MIN_PAGES && recentAdds.length >= TOP_SERP_LOW_ABS_PIVOT_WINDOW) {
      const windowNew = recentAdds.reduce((sum, n) => sum + n, 0);
      if (windowNew <= TOP_SERP_LOW_ABS_PIVOT_MAX_NEW) {
        stopReason = 'top_serp_duplicate_pivot';
        await appendLog(
          lfLog('top_serp_low_yield', { w: windowNew, win: TOP_SERP_LOW_ABS_PIVOT_WINDOW }),
        );
        break;
      }
    }
    if (zeroAddStreak >= TOP_SERP_ZERO_ADD_STREAK_LIMIT) {
      stopReason = 'top_serp_duplicate_pivot';
      await appendLog(lfLog('top_serp_zero_streak', { z: TOP_SERP_ZERO_ADD_STREAK_LIMIT }));
      break;
    }
    if (stagnation >= STAGNATION_LIMIT_HASHTAG_TOP_SERP) {
      await appendLog(lfLog('top_serp_stagnation', { lim: STAGNATION_LIMIT_HASHTAG_TOP_SERP }));
      stopReason = 'top_serp_exhausted';
      break;
    }

    lastNextMaxId = nextMaxId;
    nextMaxId = pageInfo.nextMaxId;
    const elapsed = Date.now() - sessionStartMs;
    const remainingMs = maxSessionMs - elapsed;
    if (remainingMs <= 0) break;
    let delayMs = computeHashtagApiGatherDelayMs();
    delayMs = Math.min(delayMs, remainingMs);
    await waitWithStop(delayMs);
  }

  await setSourceMetrics('topSerp', {
    pages,
    parsed: parsedTotal,
    newAdded: sessionAdded,
    duplicates: duplicateTotal,
    stopReason,
  });
  return {
    added: sessionAdded,
    pages,
    parsed: parsedTotal,
    duplicates: duplicateTotal,
    stopReason,
    switchedByDuplicateRatio: false,
  };
}

/**
 * Collect hashtag authors via GraphQL pagination (Growman-style), not DOM grid scraping.
 * @returns {Promise<{ added: number, pages: number, parsed: number, duplicates: number, stopReason: string }>}
 */
async function collectHashtagViaGraphql(doc, tagName, ctx) {
  const {
    minFollowers,
    delayMinSec,
    delayMaxSec,
    sessionStartMs,
    maxSessionMs,
    usernamesToEnrich,
    maxProfiles = null,
    onInterleaveEnrich = null,
    enrichDrainCtx = null,
  } = ctx;

  await syncIgSessionHeaders(doc, `/explore/tags/${encodeURIComponent(tagName)}/`);
  await appendLog(lfLog('graphql_start', { tag: tagName }));

  let pages = 0;
  let graphqlPathAdded = 0;
  let parsedTotal = 0;
  let duplicateTotal = 0;
  let stopReason = 'graphql_exhausted';
  const skipHashes = new Set();

  outer: for (;;) {
    let cursor = '';
    let stagnation = 0;
    let emptyGraphqlPages = 0;
    /** @type {string|null} */
    let hashtagGraphqlHash = null;

    while (!stopRequested && pages < HASHTAG_API_HARD_FAILSAFE_PAGES) {
      if (Date.now() - sessionStartMs >= maxSessionMs) {
        stopReason = 'session_timeout';
        break outer;
      }
      const reserve = await shouldPauseGatherForEnrich(sessionStartMs, maxSessionMs, maxProfiles);
      if (reserve.shouldReserve) {
        stopReason = 'reserved_for_enrichment';
        const pq = await countLeadsPendingWebProfileEnrich();
        await appendLog(
          lfLog('graphql_reserve', {
            sec: Math.ceil(reserve.reserveMs / 1000),
            n: pq,
          }),
        );
        break outer;
      }

      const { total: totalStored } = await mergeLeads([]);
      if (hasProfileCap(maxProfiles) && totalStored >= maxProfiles) {
        await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
        stopReason = 'profile_cap_reached';
        break outer;
      }

      let json;
      try {
        if (!hashtagGraphqlHash) {
          const picked = await pickWorkingHashtagGraphqlHash(
            doc,
            tagName,
            HASHTAG_GRAPHQL_PAGE_FIRST,
            skipHashes,
          );
          if (!picked) {
            if (skipHashes.size > 0) {
              await appendLog(lfLog('gql_no_more_hash', {}));
              break outer;
            }
            await appendLog(lfLog('gql_no_hash', {}));
            stopReason = 'graphql_error';
            break outer;
          }
          hashtagGraphqlHash = picked.hash;
          json = picked.json;
        } else {
          json = await fetchHashtagGraphqlRaw(doc, tagName, cursor, HASHTAG_GRAPHQL_PAGE_FIRST, hashtagGraphqlHash);
        }
      } catch (e) {
        await appendLog(lfLog('gql_err', { msg: (e && e.message) || e }));
        stopReason = 'graphql_error';
        break outer;
      }

      if (stopReason === 'graphql_error') break outer;
      const parsed = parseHashtagGraphqlResponse(json);
      if (!parsed.hasHashtagKey) {
        await appendLog(lfLog('gql_invalid_shape', {}));
        stopReason = 'graphql_error';
        break outer;
      }
      if (parsed.hashtagNull) {
        if (skipHashes.size > 0) {
          await appendLog(lfLog('gql_alt_no_tag', {}));
          break outer;
        }
        await appendLog(lfLog('gql_legacy_missing', { tag: tagName }));
        stopReason = 'graphql_exhausted';
        break outer;
      }

      pages += 1;

      let pageUsernames = parsed.usernames.filter((u) => !isHashtagOwnerSkipped(u));
      if (pageUsernames.length === 0 && parsed.rawEdgeCount > 0) {
        const tag = resolveHashtagObject(json);
        if (tag && typeof tag === 'object') {
          const ownerPks = collectHashtagSparseOwnerPksFromTag(
            tag,
            HASHTAG_OWNER_PK_RESOLVE_MAX_PER_PAGE,
          );
          if (ownerPks.length) {
            lfDebug('Hashtag GraphQL: resolving owners from numeric owner ids', {
              page: pages,
              count: ownerPks.length,
            });
            const fromPk = await resolveUsernamesFromOwnerPksList(
              doc,
              ownerPks,
              HASHTAG_SHORTCODE_RESOLVE_DELAY_MS,
            );
            pageUsernames = fromPk.filter((u) => u && !isHashtagOwnerSkipped(u));
            if (pageUsernames.length) {
              await appendLog(
                lfLog('gql_resolve_pk', { p: pages, n: pageUsernames.length }),
              );
            }
          }
          if (pageUsernames.length === 0) {
            const shortcodes = collectHashtagMediaShortcodesFromTag(
              tag,
              HASHTAG_SHORTCODE_RESOLVE_MAX_PER_PAGE,
            );
            if (shortcodes.length) {
              lfDebug('Hashtag GraphQL: resolving owners from shortcodes', {
                page: pages,
                count: shortcodes.length,
                sample: shortcodes.slice(0, 3),
              });
              const resolved = await resolveOwnerUsernamesFromShortcodesList(
                doc,
                shortcodes,
                HASHTAG_SHORTCODE_RESOLVE_DELAY_MS,
              );
              pageUsernames = resolved.filter((u) => u && !isHashtagOwnerSkipped(u));
              if (pageUsernames.length) {
                await appendLog(
                  lfLog('gql_resolve_sc', { p: pages, n: pageUsernames.length }),
                );
              }
            } else if (!ownerPks.length) {
              lfWarn('Hashtag GraphQL: media edges but no owner ids or shortcodes to recover handles.', {
                rawEdgeCount: parsed.rawEdgeCount,
              });
            }
          }
        }
      }

      if (parsed.rawEdgeCount === 0) {
        emptyGraphqlPages += 1;
        await appendLog(
          lfLog('gql_zero_edges', {
            p: pages,
            r: emptyGraphqlPages,
            more: parsed.hasNext,
          }),
        );
        if (parsed.hasNext && parsed.nextCursor && emptyGraphqlPages < 2) {
          cursor = parsed.nextCursor;
          await waitWithStop(computeDelayMs(delayMinSec, delayMaxSec));
          continue;
        }
        stopReason = 'graphql_exhausted';
        break outer;
      }
      emptyGraphqlPages = 0;
      let afterTotal = totalStored;
      let pageNewAdded = 0;
      for (let i = 0; i < pageUsernames.length; i++) {
        const u = pageUsernames[i];
        if (isHashtagOwnerSkipped(u)) continue;
        const row = {
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
        usernamesToEnrich.add(u);
        const r = enrichDrainCtx
          ? await mergeLeadsThenDrainPending([row], enrichDrainCtx)
          : await mergeLeads([row]);
        pageNewAdded += r.newAdded;
        afterTotal = r.total;
        if (r.newAdded > 0) {
          broadcast({
            type: MSG.PROGRESS,
            phase: 'gather',
            extracted: afterTotal,
            batchAdded: r.newAdded,
            logLine: lfLog('progress_gql_user', { u }),
          });
        }
        if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) break;
      }

      const newAdded = pageNewAdded;
      parsedTotal += parsed.rawEdgeCount;
      const pageDuplicates = Math.max(0, pageUsernames.length - newAdded);
      duplicateTotal += pageDuplicates;
      graphqlPathAdded += newAdded;

      if (newAdded > 0) stagnation = 0;
      else stagnation += 1;

      await appendLog(
        lfLog('gql_page_summary', {
          p: pages,
          add: newAdded,
          tot: afterTotal,
          edges: parsed.rawEdgeCount,
          dup: pageDuplicates,
          more: parsed.hasNext,
        }),
      );
      broadcast({
        type: MSG.PROGRESS,
        phase: 'gather',
        extracted: afterTotal,
        batchAdded: newAdded,
        logLine: lfLog('progress_gql_page', { p: pages }),
      });

      if (typeof onInterleaveEnrich === 'function') {
        try {
          await onInterleaveEnrich();
        } catch (e) {
          lfError('graphql: onInterleaveEnrich', e);
        }
      }

      if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) {
        await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
        stopReason = 'profile_cap_reached';
        break outer;
      }

      if (!parsed.hasNext || !parsed.nextCursor) {
        stopReason = 'graphql_exhausted';
        if (hashtagGraphqlHash) skipHashes.add(hashtagGraphqlHash);
        if (skipHashes.size < HASHTAG_MEDIA_QUERY_HASHES.length) {
          await appendLog(lfLog('gql_try_other_hash', {}));
          continue outer;
        }
        break outer;
      }
      if (stagnation >= STAGNATION_LIMIT_HASHTAG_GRAPHQL) {
        await appendLog(lfLog('gql_stagnation', { lim: STAGNATION_LIMIT_HASHTAG_GRAPHQL }));
        stopReason = 'graphql_exhausted';
        break outer;
      }

      cursor = parsed.nextCursor;
      const elapsed = Date.now() - sessionStartMs;
      const remainingMs = maxSessionMs - elapsed;
      if (remainingMs <= 0) break outer;
      let delayMs = computeHashtagApiGatherDelayMs();
      delayMs = Math.min(delayMs, remainingMs);
      await waitWithStop(delayMs);
    }

    if (pages >= HASHTAG_API_HARD_FAILSAFE_PAGES) {
      stopReason = 'graphql_exhausted';
      await appendLog(lfLog('gql_failsafe', {}));
    }
    break outer;
  }

  await setSourceMetrics('graphql', {
    pages,
    parsed: parsedTotal,
    newAdded: graphqlPathAdded,
    duplicates: duplicateTotal,
    stopReason,
  });
  return {
    added: graphqlPathAdded,
    pages,
    parsed: parsedTotal,
    duplicates: duplicateTotal,
    stopReason,
  };
}

/**
 * Refresh DeclarativeNetRequest session rules (Growman pattern) so fetches to
 * i.instagram.com/api/* get x-ig-app-id, x-asbd-id, x-ig-www-claim.
 * @param {Document} doc
 * @param {string} [refererPathOverride] e.g. /explore/tags/food/ for hashtag GraphQL referer
 */
async function syncIgSessionHeaders(doc, refererPathOverride) {
  const refererPath = refererPathOverride || doc.location.pathname || '/';
  lfDebug('syncIgSessionHeaders: start', { refererPath });
  let claim = '';
  try {
    claim = doc.defaultView.sessionStorage.getItem('www-claim-v2') || '';
  } catch {
    /* ignore */
  }
  try {
    await Promise.race([
      chrome.runtime
        .sendMessage({
          type: MSG.SYNC_IG_DNR,
          wwwClaim: claim,
          refererPath,
        })
        .catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch {
    /* no receiver */
  }
  lfDebug('syncIgSessionHeaders: done (race finished or 5s timeout)', {
    refererPath,
    claimLen: claim.length,
  });
}

/** Numeric user id for friendships REST (from web_profile_info). */
async function fetchWebProfilePk(doc, username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
    username,
  )}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.status === 'fail' || !body.data?.user) return null;
    const u = body.data.user;
    if (u.pk != null) return String(u.pk);
    if (u.id != null) return String(u.id);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Instagram Web `GET /api/v1/friendships/{user_id}/followers|following/` (paginated).
 * Works while the tab is in the background — no focus switching.
 */
async function fetchFriendshipListPage(doc, userPk, listKind, maxId) {
  const path = listKind === 'following' ? 'following' : 'followers';
  const params = new URLSearchParams();
  params.set('count', '50');
  params.set('search_surface', 'follow_list_page');
  if (maxId) params.set('max_id', maxId);
  const url = `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(
    userPk,
  )}/${path}/?${params.toString()}`;
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

function friendshipUsersFromResponse(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json.users)) return json.users;
  if (Array.isArray(json.followers)) return json.followers;
  if (Array.isArray(json.following)) return json.following;
  return [];
}

function friendshipNextMaxId(json) {
  if (!json || typeof json !== 'object') return '';
  const n = json.next_max_id ?? json.nextMaxId;
  return n != null && String(n).length > 0 ? String(n) : '';
}

/**
 * Load followers/following via REST API so extraction runs with the dashboard focused.
 * @returns {Promise<boolean>} true if API path was used (skip DOM scroll), false to fall back to scrolling
 */
async function collectFollowersFollowingViaFriendshipApi(doc, listUser, mode, ctx) {
  const {
    minFollowers,
    maxProfiles,
    delayMinSec,
    delayMaxSec,
    sessionStartMs,
    maxSessionMs,
    usernamesToEnrich,
    enrichDrainCtx = null,
  } = ctx;
  const listKind = mode === 'following' ? 'following' : 'followers';
  const ownerKey = listUser.toLowerCase();

  const pk = await fetchWebProfilePk(doc, listUser);
  if (!pk) {
    lfWarn('collectFollowersFollowingViaFriendshipApi: no pk, DOM scroll fallback', {
      listUser,
    });
    await appendLog(lfLog('friendships_no_pk', {}));
    return false;
  }

  await appendLog(
    lfLog(listKind === 'following' ? 'friendships_load_following' : 'friendships_load_followers', {}),
  );

  let maxId = '';
  let pages = 0;
  let stagnation = 0;
  let anySuccess = false;

  while (!stopRequested && pages < 400) {
    if (Date.now() - sessionStartMs >= maxSessionMs) break;

    const { total: totalStored } = await mergeLeads([]);
    if (hasProfileCap(maxProfiles) && totalStored >= maxProfiles) {
      await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
      break;
    }

    const { ok, status, json } = await fetchFriendshipListPage(doc, pk, listKind, maxId);
    if (!ok || !json) {
      if (status === 429) {
        const coolOff = Math.max(
          15000,
          Math.round(computeDelayMs(delayMinSec, delayMaxSec) * GATHER_429_BACKOFF_MULTIPLIER),
        );
        await appendLog(lfLog('friendships_429', { sec: Math.ceil(coolOff / 1000) }));
        await waitWithStop(coolOff);
      }
      lfWarn('collectFollowersFollowingViaFriendshipApi: bad response, exiting API path', {
        ok,
        status,
        pages,
        anySuccess,
        usernamesToEnrichSize: usernamesToEnrich.size,
      });
      await appendLog(
        lfLog('friendships_bad', { status: status || lfLog('http_error_generic', {}) }),
      );
      return anySuccess;
    }
    if (json.status === 'fail') {
      lfWarn('collectFollowersFollowingViaFriendshipApi: json.status fail', {
        message: json.message,
        pages,
        anySuccess,
        usernamesToEnrichSize: usernamesToEnrich.size,
      });
      await appendLog(
        lfLog('friendships_fail', { msg: json.message || lfLog('word_fail', {}) }),
      );
      return anySuccess;
    }

    anySuccess = true;
    const users = friendshipUsersFromResponse(json);
    let pageNewAdded = 0;

    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const un = typeof u.username === 'string' ? u.username.trim() : '';
      if (!un) continue;
      if (un.toLowerCase() === ownerKey) continue;
      const fc =
        typeof u.follower_count === 'number'
          ? u.follower_count
          : typeof u.edge_followed_by?.count === 'number'
            ? u.edge_followed_by.count
            : null;
      const fn = typeof u.full_name === 'string' ? u.full_name.trim() : '';
      const row = {
        username: un,
        followerCount: fc,
        bio: fn.slice(0, 500),
        email: '',
        phone: '',
        websiteUrl: '',
        scrapedAt: new Date().toISOString(),
        detailEnrichDone: false,
      };
      if (!passesMinFollowers(minFollowers, row, mode)) continue;
      usernamesToEnrich.add(un);
      const r = enrichDrainCtx
        ? await mergeLeadsThenDrainPending([row], enrichDrainCtx)
        : await mergeLeads([row]);
      pageNewAdded += r.newAdded;
      if (r.newAdded > 0) {
        broadcast({
          type: MSG.PROGRESS,
          phase: 'gather',
          extracted: r.total,
          batchAdded: r.newAdded,
          logLine: lfLog('progress_friendships_user', { u: un }),
        });
      }
      if (hasProfileCap(maxProfiles) && r.total >= maxProfiles) break;
    }

    const { total: afterTotal } = await mergeLeads([]);
    const newAdded = pageNewAdded;
    pages += 1;
    if (newAdded > 0) stagnation = 0;
    else stagnation += 1;

    await appendLog(
      lfLog('friendships_page', {
        kind: lfLog(listKind === 'following' ? 'mode_following' : 'mode_followers', {}),
        p: pages,
        add: newAdded,
        tot: afterTotal,
        cap: maxProfiles,
      }),
    );
    broadcast({
      type: MSG.PROGRESS,
      phase: 'gather',
      extracted: afterTotal,
      batchAdded: newAdded,
      logLine: lfLog('progress_friendships_page', {
        kind: lfLog(listKind === 'following' ? 'mode_following' : 'mode_followers', {}),
        p: pages,
      }),
    });

    if (hasProfileCap(maxProfiles) && afterTotal >= maxProfiles) {
      await appendLog(lfLog('limit_profiles', { max: maxProfiles }));
      break;
    }

    const next = friendshipNextMaxId(json);
    if (!next || users.length === 0) break;
    if (stagnation >= STAGNATION_LIMIT) {
      await appendLog(lfLog('friendships_stagnation', { lim: STAGNATION_LIMIT }));
      break;
    }

    maxId = next;
    const elapsed = Date.now() - sessionStartMs;
    const remainingMs = maxSessionMs - elapsed;
    if (remainingMs <= 0) break;
    let delayMs = computeDelayMs(delayMinSec, delayMaxSec);
    delayMs = Math.min(delayMs, remainingMs);
    await waitWithStop(delayMs);
  }

  await appendLog(lfLog('friendships_done', { p: pages }));
  lfDebug('collectFollowersFollowingViaFriendshipApi: done', {
    pages,
    usernamesToEnrichSize: usernamesToEnrich.size,
    anySuccess,
  });
  return true;
}

/**
 * Map `web_profile_info` JSON user object into a lead row (aligned with GraphQL hint fields).
 * @param {object} user
 * @param {string} fallbackUsername
 * @param {string} origin
 */
function rowFromWebProfileUser(user, fallbackUsername, origin) {
  if (!user || typeof user !== 'object') return null;
  const fb = String(fallbackUsername || '').trim();
  const apiU =
    typeof user.username === 'string' && user.username.trim() ? user.username.trim() : '';
  /**
   * Hashtag / SERP hints sometimes disagree with IG’s canonical handle (suffix, casing edge cases).
   * `mergeLeads` keys by `username`; enriching must update the same row we queued, or the pending
   * head never clears and `drainAllPendingEnrich` stalls.
   */
  let username = '';
  if (fb && apiU) {
    username = apiU.toLowerCase() === fb.toLowerCase() ? apiU : fb;
  } else {
    username = apiU || fb;
  }
  if (!username) return null;
  let fc = null;
  if (typeof user.edge_followed_by?.count === 'number') fc = user.edge_followed_by.count;
  else if (typeof user.follower_count === 'number') fc = user.follower_count;
  const bioRaw = typeof user.biography === 'string' ? user.biography : '';
  const fullName = typeof user.full_name === 'string' ? user.full_name.trim() : '';
  let bio = bioRaw;
  if (fullName && !bioRaw.toLowerCase().includes(fullName.toLowerCase().slice(0, 12)))
    bio = [fullName, bioRaw].filter(Boolean).join(' · ');
  const { email, phone } = buildEmailPhoneFromIgUserShape(user);
  let websiteUrl = '';
  if (typeof user.external_url === 'string' && user.external_url.trim())
    websiteUrl = user.external_url.trim();
  return {
    username,
    followerCount: fc,
    bio: bio.slice(0, 500),
    email,
    phone,
    websiteUrl,
    scrapedAt: new Date().toISOString(),
    detailEnrichDone: true,
  };
}

async function fetchUserViaProfilePageFallback(doc, username) {
  const csrftoken = igCsrfToken(doc);
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      ...(csrftoken ? { 'x-csrftoken': csrftoken } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { ok: false, status: res.status, user: null };
  const user = body?.graphql?.user || body?.data?.user || body?.user || null;
  if (!user || typeof user !== 'object') return { ok: false, status: res.status, user: null };
  return { ok: true, status: res.status, user };
}

/**
 * Usernames to run through web_profile_info: in-memory set plus anything already in LEADS
 * (friendship API / DOM paths must stay in sync; storage is the source of truth).
 */
function leadNeedsWebProfileEnrich(row) {
  return Boolean(
    row &&
      String(row.username || '').trim() &&
      !row.webProfileUnavailable &&
      row.detailEnrichDone !== true,
  );
}

async function countLeadsPendingWebProfileEnrich() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  const leads = Array.isArray(data[STORAGE_KEYS.LEADS]) ? data[STORAGE_KEYS.LEADS] : [];
  let n = 0;
  for (let i = 0; i < leads.length; i++) {
    if (leadNeedsWebProfileEnrich(leads[i])) n += 1;
  }
  return n;
}

/**
 * Oldest scraped first — matches Growman-style queue drain.
 * @param {number} limit
 */
async function listUsernamesPendingWebProfileEnrichBatch(limit) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  const leads = Array.isArray(data[STORAGE_KEYS.LEADS]) ? data[STORAGE_KEYS.LEADS] : [];
  const pending = leads.filter((r) => leadNeedsWebProfileEnrich(r));
  pending.sort((a, b) => String(a.scrapedAt || '').localeCompare(String(b.scrapedAt || '')));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < pending.length && out.length < cap; i++) {
    const u = String(pending[i].username || '').trim();
    if (!u) continue;
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/**
 * All usernames still missing API profile data (for final enrich pass after gather).
 * @param {number|null} maxProfiles
 */
async function listAllUsernamesPendingWebProfileEnrich(maxProfiles) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  const leads = Array.isArray(data[STORAGE_KEYS.LEADS]) ? data[STORAGE_KEYS.LEADS] : [];
  const pending = leads.filter((r) => leadNeedsWebProfileEnrich(r));
  pending.sort((a, b) => String(a.scrapedAt || '').localeCompare(String(b.scrapedAt || '')));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < pending.length; i++) {
    const u = String(pending[i].username || '').trim();
    if (!u) continue;
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  if (Number.isFinite(maxProfiles) && maxProfiles > 0 && out.length > maxProfiles) {
    return out.slice(0, maxProfiles);
  }
  return out;
}

async function buildEnrichmentUsernameList(usernamesToEnrichSet, maxProfiles) {
  lfDebug('buildEnrichmentUsernameList: start', {
    setSize: usernamesToEnrichSet?.size,
    maxProfiles,
  });
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  const leads = data[STORAGE_KEYS.LEADS] || [];
  lfDebug('buildEnrichmentUsernameList: storage LEADS row count', leads.length);
  const byKey = new Map();
  for (const u of usernamesToEnrichSet) {
    const t = String(u || '').trim();
    if (t) byKey.set(t.toLowerCase(), t);
  }
  for (let i = 0; i < leads.length; i++) {
    const t = String(leads[i]?.username || '').trim();
    if (t && !byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t);
  }
  let out = [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  if (Number.isFinite(maxProfiles) && maxProfiles > 0 && out.length > maxProfiles) {
    out = out.slice(0, maxProfiles);
  }
  lfDebug('buildEnrichmentUsernameList: result', {
    mergedCount: out.length,
    sample: out.slice(0, 5),
  });
  return out;
}
