/**
 * Shared message types and storage keys for MegaLeads.
 */

export const MSG = {
  START_SCRAPE: 'LF_START_SCRAPE',
  STOP_SCRAPE: 'LF_STOP_SCRAPE',
  PING: 'LF_PING',
  PONG: 'LF_PONG',
  PROGRESS: 'LF_PROGRESS',
  ERROR: 'LF_ERROR',
  COMPLETE: 'LF_COMPLETE',
  LOG: 'LF_LOG',
  /** Ask background to refresh DeclarativeNetRequest session rules (Growman-style IG headers). */
  SYNC_IG_DNR: 'LF_SYNC_IG_DNR',
  /** Service worker fetch for outbound bio / link-in-bio HTML (manifest host_permissions). */
  HTTP_TEXT_FETCH: 'LF_HTTP_TEXT_FETCH',
  /** Side panel / popup: read current Instagram URL context from the tab. */
  GET_PAGE_CONTEXT: 'LF_GET_PAGE_CONTEXT',
  /** Dashboard → background: POST leads to Render enrich API (see scripts/leadflow-remote-config.js). */
  LF_LEADS_REMOTE_ENRICH: 'LF_LEADS_REMOTE_ENRICH',
  /** Dashboard → background: Josh Q&A chat (proxied to Render). */
  LF_JOSH_CHAT: 'LF_JOSH_CHAT',
  /** Content overlay CTA → background: open extension popup (or fallback tab). */
  OPEN_POPUP: 'LF_OPEN_POPUP',
};

/** @type {const} */
export const STORAGE_KEYS = {
  LEADS: 'leadflow_leads',
  RUN_STATE: 'leadflow_runState',
  UI_PREFS: 'leadflow_ui_prefs',
  /** Last opened MegaLeads dashboard tab (reuse on Start). */
  DASHBOARD_TAB_ID: 'leadflow_dashboard_tab_id',
  /** Instagram tab that received Start (so Stop works while dashboard is focused). */
  SCRAPE_SOURCE_TAB: 'leadflow_scrape_source_tab',
  /** Popup: delay-slider risk toast dismissed until this timestamp (ms). */
  DELAY_RISK_SNOOZE_UNTIL: 'leadflow_delay_risk_snooze_until',
  /** Stored extraction sessions with lead snapshots (newest first). */
  SESSION_HISTORY: 'leadflow_session_history',
  /**
   * `{ email, loggedInAt, registeredAt }` after signup/sign-in on signup.html.
   * `registeredAt` is required for the app to treat the account as active.
   */
  USER_SESSION: 'leadflow_user_session',
  /** `{ unlimited: true }` when the user has an active paid plan (set by app / future server sync). */
  SUBSCRIPTION: 'leadflow_subscription',
  /** `{ used, cap, remaining, atCap, checkedAt, source }` from server account-level free-tier status. */
  FREE_TIER_STATUS: 'leadflow_free_tier_status',
  /** Popup → dashboard: show usage modal (`'usage'`); consumed when dashboard handles it. */
  DASHBOARD_PENDING_ACCOUNT: 'leadflow_dashboard_pending_account',
  /**
   * Signup completion routing. Shapes: `{ mode: 'popup_new_tab', returnTabId }` |
   * `{ mode: 'dashboard_same_tab' }` | legacy `{ url }`.
   */
  SIGNUP_RETURN: 'leadflow_signup_return',
  /** One-shot toast for toolbar popup after signup (`{ text, at }`). */
  LOGIN_TOAST: 'leadflow_login_toast',
};

/** Max profiles per session (hard safety cap; UI slider cannot exceed this). */
export const MAX_PROFILES_PER_SESSION = 600;

/** Popup slider: limit max extract count (Growman-style “Limit Max extract No.”). */
export const PROFILE_LIMIT_SLIDER_MIN = 10;
export const PROFILE_LIMIT_SLIDER_MAX = 600;
export const PROFILE_LIMIT_DEFAULT = 50;
export const PROFILE_LIMIT_ENABLED_DEFAULT = true;
export const SESSION_HISTORY_LIMIT = 30;

/**
 * @param {unknown} n
 * @returns {number}
 */
export function clampProfileLimit(n) {
  let v = Math.round(Number(n));
  if (!Number.isFinite(v)) v = PROFILE_LIMIT_DEFAULT;
  return Math.min(PROFILE_LIMIT_SLIDER_MAX, Math.max(PROFILE_LIMIT_SLIDER_MIN, v));
}

/** Stop if no new usernames after this many scroll batches. */
export const STAGNATION_LIMIT = 6;

/** Default hard cap on how long one extraction run may last (minutes). */
export const DEFAULT_MAX_SESSION_MINUTES = 30;

/** Allowed range for user-configurable session limit (minutes). */
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 180;

/** Scroll delay between batches (seconds). */
export const DEFAULT_DELAY_MIN_SEC = 15;
export const DEFAULT_DELAY_MAX_SEC = 17;

/** Allowed range for user-configurable delay (seconds); slider maps to min–max spread. */
export const MIN_DELAY_SEC = 3;
export const MAX_DELAY_SEC = 30;

/** Horizontal delay slider: base = min seconds; max = min(base + spread, MAX_DELAY_SEC). */
export const DELAY_SLIDER_MIN = 3;
export const DELAY_SLIDER_MAX = 30;
export const DELAY_SLIDER_DEFAULT = 15;
export const DELAY_SLIDER_SPREAD = 2;

/**
 * When gather ends near the session wall clock, still allow at least this much time for
 * web_profile_info enrichment (otherwise the first enrich + clamped delay exhausts budget).
 */
export const MIN_ENRICH_GRACE_MS = 5 * 60 * 1000;

/**
 * Dashboard safety cap for `toolRound` during remote FETCH_URL enrich.
 * Keep in sync with server `MEGALEADS_FETCH_TOOL_MAX_ROUNDS` (Render caps that value at 24).
 */
export const REMOTE_ENRICH_FETCH_TOOL_ROUND_HARD_CAP = 24;

/**
 * @param {number} sliderValue raw range input value
 * @returns {{ delayMinSec: number, delayMaxSec: number }}
 */
export function delaySliderToMinMax(sliderValue) {
  let base = Math.round(Number(sliderValue));
  if (!Number.isFinite(base)) base = DELAY_SLIDER_DEFAULT;
  base = Math.min(DELAY_SLIDER_MAX, Math.max(DELAY_SLIDER_MIN, base));
  return {
    delayMinSec: base,
    delayMaxSec: Math.min(base + DELAY_SLIDER_SPREAD, MAX_DELAY_SEC),
  };
}
