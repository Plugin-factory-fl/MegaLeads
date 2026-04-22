/**
 * Build START_SCRAPE payload from saved UI prefs (same shape as popup `getPayload`).
 */

import { normalizeLocale } from './i18n.js';

import {
  DEFAULT_MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
  delaySliderToMinMax,
  clampProfileLimit,
  PROFILE_LIMIT_DEFAULT,
  PROFILE_LIMIT_ENABLED_DEFAULT,
  DELAY_SLIDER_DEFAULT,
  DELAY_SLIDER_MIN,
  DELAY_SLIDER_MAX,
} from './constants.js';

const MODES = /** @type {const} */ (['followers', 'following', 'hashtag']);

/**
 * @param {Record<string, unknown> | null | undefined} raw
 * @param {unknown} [locale] UI locale so Instagram tab logs match the dashboard/popup language (`en` | `it`).
 */
export function buildScrapePayloadFromUiPrefs(raw, locale) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(p.mode) ? p.mode : 'followers';
  const query = p.query != null ? String(p.query) : '';
  const minFollowers = Math.max(0, Number(p.minFollowers) || 0);
  const profileLimitEnabled =
    typeof p.profileLimitEnabled === 'boolean' ? p.profileLimitEnabled : PROFILE_LIMIT_ENABLED_DEFAULT;

  let sliderVal = DELAY_SLIDER_DEFAULT;
  if (p.delaySlider != null && p.delaySlider !== '') {
    const v = Math.round(Number(p.delaySlider));
    if (Number.isFinite(v)) sliderVal = Math.min(DELAY_SLIDER_MAX, Math.max(DELAY_SLIDER_MIN, v));
  }
  const { delayMinSec, delayMaxSec } = delaySliderToMinMax(sliderVal);

  let maxProfiles = null;
  if (profileLimitEnabled) {
    let pl = PROFILE_LIMIT_DEFAULT;
    if (p.profileLimitSlider != null && p.profileLimitSlider !== '') {
      const v = Math.round(Number(p.profileLimitSlider));
      if (Number.isFinite(v)) pl = clampProfileLimit(v);
    }
    maxProfiles = pl;
  }

  const rawMin = Number(p.maxSessionMinutes);
  const sessionMinutes = Number.isFinite(rawMin)
    ? Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(rawMin)))
    : DEFAULT_MAX_SESSION_MINUTES;

  return {
    mode,
    query,
    minFollowers,
    maxProfiles,
    profileLimitEnabled,
    delayMinSec,
    delayMaxSec,
    maxSessionMinutes: sessionMinutes,
    locale: normalizeLocale(locale),
  };
}
