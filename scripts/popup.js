/**
 * MegaLeads - toolbar popup: scrape controls + open/focus dashboard tab.
 */

import {
  MSG,
  STORAGE_KEYS,
  DELAY_SLIDER_MIN,
  DELAY_SLIDER_MAX,
  DELAY_SLIDER_DEFAULT,
  delaySliderToMinMax,
  clampProfileLimit,
  PROFILE_LIMIT_SLIDER_MIN,
  PROFILE_LIMIT_SLIDER_MAX,
  PROFILE_LIMIT_DEFAULT,
  PROFILE_LIMIT_ENABLED_DEFAULT,
} from './constants.js';
import { buildScrapePayloadFromUiPrefs } from './scrape-payload.js';
import { t, tf, uiLocaleFromUiPrefs } from './i18n.js';
import {
  openStripeCheckoutInNewTab,
  readUserSession,
  canStartExtractionForFreeTier,
  writeUserSession,
  FREE_EMAIL_EXTRACTION_CAP,
  countUniqueEmailsExtracted,
  readEffectiveUsageCount,
  readSubscriptionUnlimited,
  clearUserSession,
  flushPendingAccountRegisters,
  notifyServerAccountRegistered,
  syncSubscriptionFromServer,
  openManageSubscriptionInNewTab,
  ADMIN_EMAIL,
  isAdminCredentials,
} from './account-shared.js';

/** @typedef {'en'} Locale */

/** @type {Locale} */
let uiLocale = 'en';

/** @param {{ email?: string } | null | undefined} session */
function sessionIsMegaleadsAdminEmail(session) {
  const a = String(session?.email || '')
    .trim()
    .toLowerCase();
  const b = String(ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  return Boolean(a && b && a === b);
}

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

/** @param {number} n @param {number} lo @param {number} hi */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

const MODES = /** @type {const} */ (['followers', 'following', 'hashtag']);

const els = {
  modeFollowers: null,
  modeFollowing: null,
  modeHashtag: null,
  query: null,
  queryLabel: null,
  minFollowers: null,
  profileLimitSlider: null,
  profileLimitEnabled: null,
  profileLimitEnabledLabel: null,
  profileLimitReadout: null,
  delaySlider: null,
  delayReadout: null,
  start: null,
  stop: null,
  themeToggle: null,
  langToggle: null,
  status: null,
};

let statusClearTimer = 0;

function setPopupStatus(text, isError) {
  if (!els.status) return;
  window.clearTimeout(statusClearTimer);
  if (!text) {
    els.status.hidden = true;
    els.status.textContent = '';
    return;
  }
  els.status.hidden = false;
  els.status.textContent = text;
  els.status.classList.toggle('lf-popup-status-error', Boolean(isError));
  statusClearTimer = window.setTimeout(() => {
    els.status.hidden = true;
    els.status.textContent = '';
  }, 8000);
}

let running = false;
/** When true, Start stays disabled (no account or free email cap reached). */
let popupStartBlocked = false;

function bindEls() {
  els.modeFollowers = $('lfModeFollowers');
  els.modeFollowing = $('lfModeFollowing');
  els.modeHashtag = $('lfModeHashtag');
  els.query = $('lfQuery');
  els.queryLabel = $('lfQueryLabel');
  els.minFollowers = $('lfMinFollowers');
  els.profileLimitSlider = $('lfProfileLimitSlider');
  els.profileLimitEnabled = $('lfProfileLimitEnabled');
  els.profileLimitEnabledLabel = $('lfProfileLimitEnabledLabel');
  els.profileLimitReadout = $('lfProfileLimitReadout');
  els.delaySlider = $('lfDelaySlider');
  els.delayReadout = $('lfDelayReadout');
  els.start = $('lfStart');
  els.stop = $('lfStop');
  els.themeToggle = $('lfThemeToggle');
  els.langToggle = document.getElementById('lfLangToggle');
  els.status = document.getElementById('lfPopupStatus');
}

/** @param {Record<string, unknown> | null | undefined} p */
function isDelayEffectivelyCustomized(p) {
  if (p?.delaySliderCustomized === true) return true;
  if (p?.delaySlider == null || p.delaySlider === '') return false;
  const v = Math.round(Number(p.delaySlider));
  return Number.isFinite(v) && v !== DELAY_SLIDER_DEFAULT;
}

function applyPopupLocale() {
  const L = uiLocale;
  document.documentElement.lang = 'en';
  if (els.langToggle) {
    els.langToggle.textContent = t(L, 'popup.langSwitch');
    els.langToggle.setAttribute('title', t(L, 'popup.langSwitchToEn'));
    els.langToggle.setAttribute('aria-label', t(L, 'popup.langSwitchToEn'));
  }
  const modeLabel = document.getElementById('lfModeLabel');
  if (modeLabel) modeLabel.textContent = t(L, 'popup.modeLabel');
  const modeMap = [
    ['lfModeFollowers', 'popup.modeFollowers'],
    ['lfModeFollowing', 'popup.modeFollowing'],
    ['lfModeHashtag', 'popup.modeHashtag'],
  ];
  for (const [id, key] of modeMap) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const span = btn.querySelector('.lf-mode-text');
    const label = t(L, key);
    if (span) span.textContent = label;
    btn.setAttribute('title', label);
  }
  updateQueryLabel();
  const minLab = document.getElementById('lfMinFollowersLabel');
  if (minLab) minLab.textContent = t(L, 'popup.minFollowers');
  const profLab = document.getElementById('lfProfileLimitLabel');
  if (profLab) profLab.textContent = t(L, 'popup.profileLimit');
  if (els.profileLimitEnabledLabel) {
    els.profileLimitEnabledLabel.textContent = t(L, 'popup.profileLimitToggle');
  }
  const delayLab = document.getElementById('lfDelayLabel');
  if (delayLab) delayLab.textContent = t(L, 'popup.delayLabel');
  const hint = document.querySelector('.lf-popup-hint');
  if (hint) hint.textContent = t(L, 'popup.hint');
  els.start.textContent = t(L, 'popup.start');
  els.stop.textContent = t(L, 'popup.stop');
  const riskOk = document.getElementById('lfRiskToastOk');
  if (riskOk) riskOk.textContent = t(L, 'popup.riskOk');
  const up = document.getElementById('lfUpgrade');
  if (up) {
    up.setAttribute('title', t(L, 'popup.upgrade'));
    up.setAttribute('aria-label', t(L, 'popup.ariaUpgrade'));
    const lab = up.querySelector('.lf-upgrade-label');
    if (lab) lab.textContent = t(L, 'popup.upgrade');
  }
  const acc = document.getElementById('lfAccountBtn');
  if (acc) {
    acc.setAttribute('title', t(L, 'popup.account'));
    acc.setAttribute('aria-label', t(L, 'popup.ariaAccount'));
  }
  const authTitle = document.getElementById('lfPopupAuthTitle');
  if (authTitle) authTitle.textContent = t(L, 'popup.authBannerTitle');
  const authBody = document.getElementById('lfPopupAuthBody');
  if (authBody) authBody.textContent = t(L, 'popup.authBannerBody');
  const authCta = document.getElementById('lfPopupAuthCta');
  if (authCta) authCta.textContent = t(L, 'popup.authBannerCta');
  const capTitle = document.getElementById('lfPopupCapTitle');
  if (capTitle) capTitle.textContent = t(L, 'popup.atCapBannerTitle');
  const capBody = document.getElementById('lfPopupCapBody');
  if (capBody) capBody.textContent = t(L, 'popup.atCapBannerBody');
  const capBtn = document.getElementById('lfPopupCapUpgrade');
  if (capBtn) capBtn.textContent = t(L, 'popup.atCapBannerCta');
  syncPopupAccountUsageModalLocale();
  const freeLab = document.getElementById('lfPopupFreeTierLabel');
  if (freeLab) freeLab.textContent = t(L, 'popup.freeTierEmailsLabel');
  const paidTitle = document.getElementById('lfPopupPaidTitle');
  if (paidTitle) paidTitle.textContent = t(L, 'popup.unlimitedIgEmailExtraction');
  const dismiss = document.getElementById('lfLoginToastDismiss');
  if (dismiss) dismiss.setAttribute('aria-label', t(L, 'popup.loginToastDismissAria'));
  syncPopupAuthModalLocale();
  const riskText = document.getElementById('lfRiskToastText');
  if (riskText) riskText.textContent = t(L, 'popup.riskToast');
  const hMin = document.getElementById('lfHelpMinFollowers');
  if (hMin) hMin.textContent = t(L, 'popup.minFollowersHelp');
  const hProf = document.getElementById('lfHelpProfileLimit');
  if (hProf) hProf.textContent = t(L, 'popup.profileLimitHelp');
  const iMin = document.getElementById('lfInfoMinFollowers');
  if (iMin) iMin.setAttribute('title', t(L, 'popup.infoMinFollowers'));
  const iProf = document.getElementById('lfInfoProfileLimit');
  if (iProf) iProf.setAttribute('title', t(L, 'popup.infoProfileLimit'));
  syncThemeToggleUi();
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('lf-dark', dark);
  syncThemeToggleUi();
}

function syncThemeToggleUi() {
  const dark = document.documentElement.classList.contains('lf-dark');
  const L = uiLocale;
  const icon = els.themeToggle.querySelector('.lf-theme-toggle-icon');
  if (icon) icon.textContent = dark ? '☼' : '☾';
  els.themeToggle.title = dark ? t(L, 'popup.themeLight') : t(L, 'popup.themeDark');
  els.themeToggle.setAttribute(
    'aria-label',
    dark ? t(L, 'popup.ariaThemeToLight') : t(L, 'popup.ariaThemeToDark'),
  );
  const logo = document.querySelector('.lf-logo-theme');
  if (logo instanceof HTMLImageElement) {
    const light = logo.getAttribute('data-logo-light') || logo.src;
    const darkSrc = logo.getAttribute('data-logo-dark') || light;
    logo.src = dark ? darkSrc : light;
  }
}

/** @returns {'followers' | 'following' | 'hashtag'} */
function getSelectedMode() {
  for (const m of MODES) {
    const btn = document.querySelector(`.lf-mode-btn[data-mode="${m}"]`);
    if (btn?.classList.contains('lf-mode-btn-active')) return m;
  }
  return 'followers';
}

/** @param {'followers' | 'following' | 'hashtag'} mode */
function setSelectedMode(mode) {
  const valid = MODES.includes(mode) ? mode : 'followers';
  document.querySelectorAll('.lf-mode-btn').forEach((btn) => {
    const m = btn.getAttribute('data-mode');
    const on = m === valid;
    btn.classList.toggle('lf-mode-btn-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function updateQueryLabel() {
  const m = getSelectedMode();
  const L = uiLocale;
  if (m === 'hashtag') {
    els.queryLabel.textContent = t(L, 'popup.queryHashtag');
    els.query.placeholder = t(L, 'popup.phHashtag');
  } else {
    els.queryLabel.textContent = t(L, 'popup.queryUsername');
    els.query.placeholder = t(L, 'popup.phUser');
  }
}

function updateProfileLimitReadout() {
  const v = clampProfileLimit(Number(els.profileLimitSlider.value));
  els.profileLimitReadout.textContent = String(v);
  els.profileLimitSlider.setAttribute('aria-valuenow', String(v));
}

function syncProfileLimitEnabledState() {
  const on = Boolean(els.profileLimitEnabled?.checked);
  els.profileLimitSlider.disabled = !on;
  els.profileLimitReadout.style.opacity = on ? '1' : '0.55';
}

function updateDelayReadout() {
  const { delayMinSec, delayMaxSec } = delaySliderToMinMax(Number(els.delaySlider.value));
  els.delayReadout.textContent = tf(uiLocale, 'popup.delayRange', {
    min: delayMinSec,
    max: delayMaxSec,
  });
  els.delaySlider.setAttribute('aria-valuenow', String(delayMinSec));
}

function hideDelayRiskToast() {
  const wrap = document.getElementById('lfRiskToast');
  if (!wrap) return;
  wrap.hidden = true;
  const textEl = document.getElementById('lfRiskToastText');
  if (textEl) textEl.textContent = '';
}

async function delayRiskToastSnoozeActive() {
  const { [STORAGE_KEYS.DELAY_RISK_SNOOZE_UNTIL]: raw } = await chrome.storage.local.get(
    STORAGE_KEYS.DELAY_RISK_SNOOZE_UNTIL,
  );
  const until = Number(raw) || 0;
  return Date.now() < until;
}

async function showDelayRiskToast() {
  if (await delayRiskToastSnoozeActive()) return;
  const wrap = document.getElementById('lfRiskToast');
  const textEl = document.getElementById('lfRiskToastText');
  if (!wrap || !textEl) return;
  textEl.textContent = t(uiLocale, 'popup.riskToast');
  wrap.hidden = false;
}

async function dismissDelayRiskToastFor10Minutes() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.DELAY_RISK_SNOOZE_UNTIL]: Date.now() + 10 * 60 * 1000,
  });
  hideDelayRiskToast();
}

/** Fix Start disabled when storage says running but no scrape is active (e.g. stale state). */
async function reconcileRunningStateFromStorage() {
  const { [STORAGE_KEYS.RUN_STATE]: rs, [STORAGE_KEYS.SCRAPE_SOURCE_TAB]: sid } =
    await chrome.storage.local.get([STORAGE_KEYS.RUN_STATE, STORAGE_KEYS.SCRAPE_SOURCE_TAB]);

  if (!rs?.running) {
    running = false;
    syncRunButtons();
    return;
  }

  const tabId = sid != null ? Number(sid) : null;
  const base = rs && typeof rs === 'object' ? { ...rs } : {};

  if (tabId == null || Number.isNaN(tabId)) {
    running = false;
    syncRunButtons();
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: { ...base, running: false },
    });
    return;
  }

  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
    if (pong && pong.scraping === true) {
      running = true;
    } else {
      running = false;
      await chrome.storage.local.set({
        [STORAGE_KEYS.RUN_STATE]: { ...base, running: false },
      });
    }
  } catch {
    running = false;
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUN_STATE]: { ...base, running: false },
    });
  }
  syncRunButtons();
}

function syncRunButtons() {
  els.start.disabled = running || popupStartBlocked;
  els.stop.disabled = !running;
}

async function savePrefs() {
  const { [STORAGE_KEYS.UI_PREFS]: prev } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  const delayTouched = els.delaySlider.dataset.touched === '1';
  const delayCustomized = delayTouched || base.delaySliderCustomized === true;
  await chrome.storage.local.set({
    [STORAGE_KEYS.UI_PREFS]: {
      ...base,
      locale: uiLocale,
      preferEnglish: true,
      mode: getSelectedMode(),
      query: els.query.value,
      minFollowers: els.minFollowers.value,
      profileLimitSlider: els.profileLimitSlider.value,
      profileLimitEnabled: Boolean(els.profileLimitEnabled.checked),
      delaySlider: els.delaySlider.value,
      delaySliderCustomized: delayCustomized,
      theme: document.documentElement.classList.contains('lf-dark') ? 'dark' : 'light',
    },
  });
}

function profileLimitFromPrefs(p) {
  if (p?.profileLimitSlider != null && p.profileLimitSlider !== '') {
    const v = Math.round(Number(p.profileLimitSlider));
    if (Number.isFinite(v)) return clamp(v, PROFILE_LIMIT_SLIDER_MIN, PROFILE_LIMIT_SLIDER_MAX);
  }
  return PROFILE_LIMIT_DEFAULT;
}

function profileLimitEnabledFromPrefs(p) {
  if (typeof p?.profileLimitEnabled === 'boolean') return p.profileLimitEnabled;
  return PROFILE_LIMIT_ENABLED_DEFAULT;
}

function delaySliderFromPrefs(p) {
  if (p?.delaySlider != null && p.delaySlider !== '') {
    const v = Math.round(Number(p.delaySlider));
    if (Number.isFinite(v)) return clamp(v, DELAY_SLIDER_MIN, DELAY_SLIDER_MAX);
  }
  if (p?.delayMinSec != null) {
    const v = Math.round(Number(p.delayMinSec));
    if (Number.isFinite(v)) return clamp(v, DELAY_SLIDER_MIN, DELAY_SLIDER_MAX);
  }
  return DELAY_SLIDER_DEFAULT;
}

async function loadPrefs() {
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  uiLocale = uiLocaleFromUiPrefs(p);
  els.delaySlider.dataset.touched = '';
  if (!p) {
    els.profileLimitSlider.min = String(PROFILE_LIMIT_SLIDER_MIN);
    els.profileLimitSlider.max = String(PROFILE_LIMIT_SLIDER_MAX);
    els.profileLimitSlider.value = String(PROFILE_LIMIT_DEFAULT);
    els.profileLimitEnabled.checked = PROFILE_LIMIT_ENABLED_DEFAULT;
    updateProfileLimitReadout();
    syncProfileLimitEnabledState();
    els.delaySlider.min = String(DELAY_SLIDER_MIN);
    els.delaySlider.max = String(DELAY_SLIDER_MAX);
    els.delaySlider.value = String(DELAY_SLIDER_DEFAULT);
    updateDelayReadout();
    applyTheme(false);
    applyPopupLocale();
    return;
  }
  els.profileLimitSlider.min = String(PROFILE_LIMIT_SLIDER_MIN);
  els.profileLimitSlider.max = String(PROFILE_LIMIT_SLIDER_MAX);
  els.profileLimitSlider.value = String(profileLimitFromPrefs(p));
  els.profileLimitEnabled.checked = profileLimitEnabledFromPrefs(p);
  updateProfileLimitReadout();
  syncProfileLimitEnabledState();
  if (p.mode && MODES.includes(p.mode)) setSelectedMode(p.mode);
  if (p.query != null) els.query.value = p.query;
  if (p.minFollowers != null) els.minFollowers.value = String(p.minFollowers);
  els.delaySlider.min = String(DELAY_SLIDER_MIN);
  els.delaySlider.max = String(DELAY_SLIDER_MAX);
  els.delaySlider.value = String(
    isDelayEffectivelyCustomized(p) ? delaySliderFromPrefs(p) : DELAY_SLIDER_DEFAULT,
  );
  if (isDelayEffectivelyCustomized(p)) els.delaySlider.dataset.touched = '1';
  updateDelayReadout();
  applyTheme(p.theme === 'dark');
  applyPopupLocale();
}

/**
 * @param {string} [tag]
 * @param {string} [user]
 */
function formatQueryForMode(mode, tag, user) {
  if (mode === 'hashtag' && tag) {
    const t = String(tag).trim().replace(/^#+/, '');
    return t ? `#${t}` : '';
  }
  if ((mode === 'followers' || mode === 'following' || mode === 'profile') && user) {
    return String(user).trim().replace(/^@+/, '');
  }
  return '';
}

async function refreshPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const url = tab.url || '';
    if (!url.includes('instagram.com')) return;

    const resp = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_CONTEXT });
    if (!resp || resp.ok !== true) return;

    const pm = resp.pageMode;
    if (pm === 'hashtag' && resp.tag) {
      setSelectedMode('hashtag');
      els.query.value = formatQueryForMode('hashtag', resp.tag, undefined);
    } else if (pm === 'followers' && resp.user) {
      setSelectedMode('followers');
      els.query.value = formatQueryForMode('followers', undefined, resp.user);
    } else if (pm === 'following' && resp.user) {
      setSelectedMode('following');
      els.query.value = formatQueryForMode('following', undefined, resp.user);
    } else if (pm === 'profile' && resp.user) {
      setSelectedMode('followers');
      els.query.value = formatQueryForMode('profile', undefined, resp.user);
    } else {
      return;
    }
    updateQueryLabel();
    void savePrefs();
  } catch {
    /* content script not injected or not IG */
  }
}

function syncPopupAccountUsageModalLocale() {
  const L = uiLocale;
  const q = (id) => document.getElementById(id);
  const setText = (id, path) => {
    const el = q(id);
    if (el) el.textContent = t(L, path);
  };
  setText('lfPopupAccountUsageTitle', 'dashboard.accountUsageTitle');
  const diamond = q('lfPopupAccountStripeDiamond');
  if (diamond) diamond.setAttribute('aria-label', t(L, 'dashboard.ariaCheckoutDiamond'));
  const dlab = q('lfPopupAccountStripeDiamondLabel');
  if (dlab) dlab.textContent = t(L, 'dashboard.accountCheckoutDiamond');
  const lo = q('lfPopupAccountUsageLogout');
  if (lo) lo.textContent = t(L, 'dashboard.accountLogout');
  const manage = q('lfPopupManageSubscription');
  if (manage) manage.textContent = t(L, 'dashboard.manageSubscription');
  const ucls = q('lfPopupAccountUsageClose');
  if (ucls) ucls.textContent = t(L, 'dashboard.accountClose');
}

function syncPopupAuthModalLocale() {
  const L = uiLocale;
  const q = (id) => document.getElementById(id);
  const setText = (id, path) => {
    const el = q(id);
    if (el) el.textContent = t(L, path);
  };
  setText('lfPopupAuthSignupTitle', 'popup.authBannerTitle');
  const suLead = q('lfPopupAuthSignupLead');
  if (suLead) suLead.textContent = t(L, 'popup.authBannerBody');
  setText('lfPopupAuthSignupEmailLabel', 'signup.email');
  setText('lfPopupAuthSignupPasswordLabel', 'signup.password');
  setText('lfPopupAuthSignupConfirmLabel', 'signup.confirmPassword');
  setText('lfPopupAuthSignupSubmit', 'signup.createSubmit');
  const suLog = q('lfPopupAuthSignupSwitchLogin');
  if (suLog) suLog.textContent = t(L, 'popup.authModalLogInBtn');
  const suCls = q('lfPopupAuthSignupClose');
  if (suCls) suCls.textContent = t(L, 'dashboard.accountClose');
  setText('lfPopupAuthLoginTitle', 'signup.signinTitle');
  const liLead = q('lfPopupAuthLoginLead');
  if (liLead) liLead.textContent = t(L, 'signup.signinDesc');
  setText('lfPopupAuthLoginEmailLabel', 'signup.email');
  setText('lfPopupAuthLoginPasswordLabel', 'signup.password');
  setText('lfPopupAuthLoginSubmit', 'signup.signinSubmit');
  const liCr = q('lfPopupAuthLoginSwitchSignup');
  if (liCr) liCr.textContent = t(L, 'popup.authModalCreateAccountBtn');
  const liCls = q('lfPopupAuthLoginClose');
  if (liCls) liCls.textContent = t(L, 'dashboard.accountClose');
  const loginQuick = q('lfPopupAuthLoginCta');
  if (loginQuick) loginQuick.textContent = t(L, 'popup.authModalLogInBtn');
}

function setPopupAuthSignupError(msg) {
  const el = document.getElementById('lfPopupAuthSignupError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function setPopupAuthLoginError(msg) {
  const el = document.getElementById('lfPopupAuthLoginError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function closePopupAuthModals() {
  const su = document.getElementById('lfPopupAuthSignupWrap');
  const li = document.getElementById('lfPopupAuthLoginWrap');
  if (su) su.hidden = true;
  if (li) li.hidden = true;
  setPopupAuthSignupError('');
  setPopupAuthLoginError('');
}

function openPopupLoginModal() {
  syncPopupAuthModalLocale();
  const su = document.getElementById('lfPopupAuthSignupWrap');
  const li = document.getElementById('lfPopupAuthLoginWrap');
  if (su) su.hidden = true;
  if (li) li.hidden = false;
  setPopupAuthSignupError('');
  setPopupAuthLoginError('');
  const em = document.getElementById('lfPopupAuthLoginEmail');
  window.setTimeout(() => em?.focus(), 0);
}

function openPopupSignupModal() {
  syncPopupAuthModalLocale();
  const su = document.getElementById('lfPopupAuthSignupWrap');
  const li = document.getElementById('lfPopupAuthLoginWrap');
  if (li) li.hidden = true;
  if (su) su.hidden = false;
  setPopupAuthSignupError('');
  setPopupAuthLoginError('');
  const f = document.getElementById('lfPopupAuthSignupForm');
  if (f instanceof HTMLFormElement) f.reset();
  const lf = document.getElementById('lfPopupAuthLoginForm');
  if (lf instanceof HTMLFormElement) lf.reset();
  const em = document.getElementById('lfPopupAuthSignupEmail');
  window.setTimeout(() => em?.focus(), 0);
}

async function completePopupAuthSuccess(email, password) {
  const trimmed = String(email || '').trim();
  if (!trimmed || !trimmed.includes('@')) {
    return t(uiLocale, 'signup.errSignin');
  }
  const isAdmin = trimmed.toLowerCase() === ADMIN_EMAIL;
  if (isAdmin && !isAdminCredentials(trimmed, password)) {
    return 'Invalid admin credentials.';
  }
  try {
    await writeUserSession(trimmed, { isAdmin });
  } catch (e) {
    return String(e?.message || e || 'Error');
  }
  closePopupAuthModals();
  await chrome.storage.local.set({
    [STORAGE_KEYS.LOGIN_TOAST]: {
      text: t(uiLocale, 'popup.loggedInToast'),
      at: Date.now(),
    },
  });
  await syncSubscriptionFromServer();
  const session = await readUserSession();
  if (sessionIsMegaleadsAdminEmail(session)) {
    await showPopupAdminMode();
    return null;
  }
  await refreshPopupGates();
  await refreshPopupHeaderProgress();
  void maybeShowLoginToast();
  return null;
}

async function showPopupAdminMode() {
  document.body.classList.add('lf-admin-mode');
  const wrap = document.getElementById('lfPopupAdminWrap');
  if (wrap) wrap.hidden = false;
}

function closePopupAccountUsageModal() {
  const w = document.getElementById('lfPopupAccountUsageWrap');
  if (w) w.hidden = true;
}

async function openPopupAccountUsageModal() {
  const w = document.getElementById('lfPopupAccountUsageWrap');
  if (!w) return;
  const session = await readUserSession();
  if (!session) {
    openPopupSignupModal();
    return;
  }
  syncPopupAccountUsageModalLocale();
  const L = uiLocale;
  const unlimited = await readSubscriptionUnlimited();
  const titleEl = document.getElementById('lfPopupAccountUsageTitle');
  const signed = document.getElementById('lfPopupAccountUsageSignedIn');
  const cntEl = document.getElementById('lfPopupAccountUsageCount');
  const note = document.getElementById('lfPopupAccountUsageCapNote');
  const atCap = document.getElementById('lfPopupAccountUsageAtCap');
  const barWrap = document.getElementById('lfPopupAccountUsageBarWrap');
  const ctaRow = w.querySelector('.lf-account-usage-cta-row');
  const manageBtn = document.getElementById('lfPopupManageSubscription');

  if (signed) signed.textContent = tf(L, 'dashboard.accountUsageSignedInAs', { email: session.email });

  if (unlimited) {
    if (titleEl) titleEl.textContent = t(L, 'dashboard.accountUsageTitle');
    if (cntEl) cntEl.hidden = true;
    if (barWrap) {
      barWrap.hidden = true;
      if (barWrap instanceof HTMLElement) barWrap.style.display = 'none';
      barWrap.classList.remove('is-at-cap');
    }
    if (note) {
      note.hidden = false;
      note.textContent = t(L, 'dashboard.accountUsagePlusRoyalty');
    }
    if (atCap) atCap.hidden = true;
    if (ctaRow instanceof HTMLElement) {
      ctaRow.hidden = true;
      ctaRow.style.display = 'none';
    }
    if (manageBtn instanceof HTMLElement) manageBtn.hidden = false;
    w.hidden = false;
    return;
  }

  if (titleEl) titleEl.textContent = t(L, 'dashboard.accountUsageTitle');
  if (cntEl) {
    cntEl.hidden = false;
    const count = await readEffectiveUsageCount();
    const cap = FREE_EMAIL_EXTRACTION_CAP;
    const pct = Math.min(100, (count / cap) * 100);
    cntEl.textContent = tf(L, 'dashboard.accountUsageCount', { count });
    const barFill = document.getElementById('lfPopupAccountUsageBarFill');
    if (barFill) barFill.style.width = `${pct}%`;
    const barLab = document.getElementById('lfPopupAccountUsageBarLabel');
    if (barLab) barLab.textContent = tf(L, 'dashboard.accountUsageProgress', { count, cap });
    if (note) {
      note.hidden = false;
      note.textContent = tf(L, 'dashboard.accountUsageCapNote', { cap });
    }
    const capped = count >= cap;
    if (atCap) {
      atCap.hidden = !capped;
      if (capped) atCap.textContent = t(L, 'dashboard.accountUsageAtCap');
    }
    if (barWrap) {
      barWrap.hidden = false;
      if (barWrap instanceof HTMLElement) barWrap.style.display = '';
      barWrap.classList.toggle('is-at-cap', capped);
    }
    if (ctaRow instanceof HTMLElement) {
      ctaRow.hidden = false;
      ctaRow.style.display = '';
    }
  }
  if (manageBtn instanceof HTMLElement) manageBtn.hidden = true;
  w.hidden = false;
}

async function onPopupAccountLogout() {
  await clearUserSession();
  closePopupAccountUsageModal();
  await refreshPopupGates();
  await refreshPopupHeaderProgress();
}

function wirePopupAccountUsageModal() {
  const wrap = document.getElementById('lfPopupAccountUsageWrap');
  if (wrap) {
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap) closePopupAccountUsageModal();
    });
    const card = wrap.querySelector('.lf-popup-account-usage-card');
    if (card) card.addEventListener('click', (ev) => ev.stopPropagation());
  }
  const closeB = document.getElementById('lfPopupAccountUsageClose');
  if (closeB) closeB.addEventListener('click', () => closePopupAccountUsageModal());
  const out = document.getElementById('lfPopupAccountUsageLogout');
  if (out) out.addEventListener('click', () => void onPopupAccountLogout());
  const manage = document.getElementById('lfPopupManageSubscription');
  if (manage) {
    manage.addEventListener('click', () => {
      void (async () => {
        const r = await openManageSubscriptionInNewTab();
        if (!r.ok) setPopupStatus(t(uiLocale, 'dashboard.manageSubscriptionMissing'), true);
      })();
    });
  }
  const diamond = document.getElementById('lfPopupAccountStripeDiamond');
  if (diamond) {
    diamond.addEventListener('click', () => {
      void (async () => {
        const r = await openStripeCheckoutInNewTab();
        if (!r.ok) setPopupStatus(t(uiLocale, 'popup.stripeMissing'), true);
      })();
    });
  }
}

function wirePopupAuthModals() {
  const signupWrap = document.getElementById('lfPopupAuthSignupWrap');
  const loginWrap = document.getElementById('lfPopupAuthLoginWrap');
  if (signupWrap) {
    signupWrap.addEventListener('click', (ev) => {
      if (ev.target === signupWrap) closePopupAuthModals();
    });
    const card = signupWrap.querySelector('.lf-popup-auth-signup-card');
    if (card) card.addEventListener('click', (ev) => ev.stopPropagation());
  }
  if (loginWrap) {
    loginWrap.addEventListener('click', (ev) => {
      if (ev.target === loginWrap) closePopupAuthModals();
    });
    const card = loginWrap.querySelector('.lf-popup-auth-login-card');
    if (card) card.addEventListener('click', (ev) => ev.stopPropagation());
  }

  document.getElementById('lfPopupAuthSignupClose')?.addEventListener('click', () => closePopupAuthModals());
  document.getElementById('lfPopupAuthLoginClose')?.addEventListener('click', () => closePopupAuthModals());
  document.getElementById('lfPopupAuthSignupSwitchLogin')?.addEventListener('click', () => openPopupLoginModal());
  document.getElementById('lfPopupAuthLoginSwitchSignup')?.addEventListener('click', () => openPopupSignupModal());

  const signupForm = document.getElementById('lfPopupAuthSignupForm');
  if (signupForm instanceof HTMLFormElement) {
    signupForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      setPopupAuthSignupError('');
      const L = uiLocale;
      const emailEl = document.getElementById('lfPopupAuthSignupEmail');
      const pwEl = document.getElementById('lfPopupAuthSignupPassword');
      const cfEl = document.getElementById('lfPopupAuthSignupConfirm');
      const email = emailEl instanceof HTMLInputElement ? emailEl.value.trim() : '';
      const pw = pwEl instanceof HTMLInputElement ? pwEl.value : '';
      const confirm = cfEl instanceof HTMLInputElement ? cfEl.value : '';
      if (!email) {
        setPopupAuthSignupError(t(L, 'signup.errSignin'));
        return;
      }
      if (pw !== confirm) {
        setPopupAuthSignupError(t(L, 'signup.errPasswordMismatch'));
        return;
      }
      if (pw.length < 8) {
        setPopupAuthSignupError(t(L, 'signup.errPasswordShort'));
        return;
      }
      const err = await completePopupAuthSuccess(email, pw);
      if (err) setPopupAuthSignupError(err);
    });
  }

  const loginForm = document.getElementById('lfPopupAuthLoginForm');
  if (loginForm instanceof HTMLFormElement) {
    loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      setPopupAuthLoginError('');
      const L = uiLocale;
      const emailEl = document.getElementById('lfPopupAuthLoginEmail');
      const pwEl = document.getElementById('lfPopupAuthLoginPassword');
      const email = emailEl instanceof HTMLInputElement ? emailEl.value.trim() : '';
      const pw = pwEl instanceof HTMLInputElement ? pwEl.value : '';
      if (!email || pw.length < 8) {
        setPopupAuthLoginError(t(L, 'signup.errSignin'));
        return;
      }
      const err = await completePopupAuthSuccess(email, pw);
      if (err) setPopupAuthLoginError(err);
    });
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const su = document.getElementById('lfPopupAuthSignupWrap');
    const li = document.getElementById('lfPopupAuthLoginWrap');
    const authOpen = (su && !su.hidden) || (li && !li.hidden);
    if (!authOpen) return;
    closePopupAuthModals();
  });
}

async function refreshPopupHeaderProgress() {
  const wrap = document.getElementById('lfPopupHeaderProgressWrap');
  const paidTitle = document.getElementById('lfPopupPaidTitle');
  const label = document.getElementById('lfPopupFreeTierLabel');
  const countEl = document.getElementById('lfPopupHeaderProgressCount');
  const fill = document.getElementById('lfPopupHeaderProgressFill');
  const bar = document.getElementById('lfPopupHeaderProgressBar');
  const upgradeBtn = document.getElementById('lfUpgrade');
  const crown = document.getElementById('lfPopupAccountCrown');
  if (!wrap || !countEl || !fill || !bar) return;
  const unlimited = await readSubscriptionUnlimited();
  if (unlimited) {
    wrap.hidden = true;
    if (paidTitle) {
      paidTitle.hidden = false;
      paidTitle.textContent = t(uiLocale, 'popup.unlimitedIgEmailExtraction');
    }
    if (crown) crown.hidden = false;
    if (upgradeBtn instanceof HTMLElement) {
      upgradeBtn.hidden = true;
      upgradeBtn.style.display = 'none';
    }
    return;
  }
  const session = await readUserSession();
  if (!session) {
    wrap.hidden = true;
    if (paidTitle) paidTitle.hidden = true;
    if (crown) crown.hidden = true;
    if (upgradeBtn instanceof HTMLElement) {
      upgradeBtn.hidden = true;
      upgradeBtn.style.display = 'none';
    }
    return;
  }
  if (upgradeBtn instanceof HTMLElement) {
    upgradeBtn.hidden = false;
    upgradeBtn.style.display = '';
  }
  if (paidTitle) paidTitle.hidden = true;
  if (crown) crown.hidden = true;
  wrap.hidden = false;
  if (label) label.textContent = t(uiLocale, 'popup.freeTierEmailsLabel');
  wrap.setAttribute('aria-label', t(uiLocale, 'popup.headerProgressAria'));
  const count = await readEffectiveUsageCount();
  const cap = FREE_EMAIL_EXTRACTION_CAP;
  bar.classList.remove('is-at-cap', 'is-unlimited');
  const pct = Math.min(100, (count / cap) * 100);
  countEl.textContent = tf(uiLocale, 'popup.headerEmailsProgress', { count, cap });
  fill.style.width = `${pct}%`;
  if (count >= cap) bar.classList.add('is-at-cap');
}

async function refreshSubscriptionForSession() {
  const session = await readUserSession();
  if (!session) return;
  void syncSubscriptionFromServer();
}

function hideLoginToast() {
  const wrap = document.getElementById('lfLoginToast');
  if (wrap) wrap.hidden = true;
}

async function maybeShowLoginToast() {
  const { [STORAGE_KEYS.LOGIN_TOAST]: raw } = await chrome.storage.local.get(STORAGE_KEYS.LOGIN_TOAST);
  if (!raw || typeof raw !== 'object') return;
  const text = String(raw.text || '').trim();
  const at = Number(raw.at) || 0;
  if (!text || Date.now() - at > 120000) {
    await chrome.storage.local.remove(STORAGE_KEYS.LOGIN_TOAST);
    return;
  }
  await chrome.storage.local.remove(STORAGE_KEYS.LOGIN_TOAST);
  const wrap = document.getElementById('lfLoginToast');
  const te = document.getElementById('lfLoginToastText');
  if (!wrap || !te) return;
  te.textContent = text;
  wrap.hidden = false;
}

async function openOrFocusDashboard() {
  const url = chrome.runtime.getURL('dashboard.html');
  const { [STORAGE_KEYS.DASHBOARD_TAB_ID]: stored } = await chrome.storage.local.get(
    STORAGE_KEYS.DASHBOARD_TAB_ID,
  );
  if (stored != null) {
    try {
      const tab = await chrome.tabs.get(stored);
      if (tab.id != null) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return;
      }
    } catch {
      await chrome.storage.local.remove(STORAGE_KEYS.DASHBOARD_TAB_ID);
    }
  }
  const created = await chrome.tabs.create({ url, active: true });
  if (created?.id != null) {
    await chrome.storage.local.set({ [STORAGE_KEYS.DASHBOARD_TAB_ID]: created.id });
  }
}

async function openOrFocusAdminDashboard() {
  const url = chrome.runtime.getURL('dashboard.html?admin=1');
  const { [STORAGE_KEYS.DASHBOARD_TAB_ID]: stored } = await chrome.storage.local.get(
    STORAGE_KEYS.DASHBOARD_TAB_ID,
  );
  if (stored != null) {
    try {
      const tab = await chrome.tabs.get(stored);
      if (tab.id != null) {
        await chrome.tabs.update(tab.id, { url, active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    } catch {
      await chrome.storage.local.remove(STORAGE_KEYS.DASHBOARD_TAB_ID);
    }
  }
  const created = await chrome.tabs.create({ url, active: true });
  if (created?.id != null) {
    await chrome.storage.local.set({ [STORAGE_KEYS.DASHBOARD_TAB_ID]: created.id });
  }
}

/** Popup Account: signup tab if logged out; otherwise same usage modal as dashboard. */
async function openAccountEntryFromPopup() {
  const session = await readUserSession();
  if (!session) {
    openPopupSignupModal();
    return;
  }
  if (sessionIsMegaleadsAdminEmail(session)) {
    await clearUserSession();
    window.location.reload();
    return;
  }
  await openPopupAccountUsageModal();
}

async function refreshPopupGates() {
  const auth = document.getElementById('lfPopupAuthBanner');
  const cap = document.getElementById('lfPopupCapBanner');
  const session = await readUserSession();
  const gate = await canStartExtractionForFreeTier();

  if (!session) {
    popupStartBlocked = true;
    if (auth) auth.hidden = false;
    if (cap) cap.hidden = true;
  } else if (!gate.ok && gate.reason === 'at_cap') {
    popupStartBlocked = true;
    if (auth) auth.hidden = true;
    if (cap) cap.hidden = false;
  } else {
    popupStartBlocked = false;
    if (auth) auth.hidden = true;
    if (cap) cap.hidden = true;
  }
  syncRunButtons();
  void refreshPopupHeaderProgress();
}

async function startExtractionPipeline() {
  setPopupStatus('');
  const freeGate = await canStartExtractionForFreeTier();
  if (!freeGate.ok && freeGate.reason === 'needs_account') {
    setPopupStatus(t(uiLocale, 'popup.statusNeedsAccount'), true);
    return;
  }
  if (!freeGate.ok && freeGate.reason === 'at_cap') {
    setPopupStatus(t(uiLocale, 'popup.statusAtCap'), true);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setPopupStatus(t(uiLocale, 'popup.statusNoTab'), true);
    return;
  }
  const url = tab.url || '';
  if (!url.includes('instagram.com')) {
    setPopupStatus(t(uiLocale, 'popup.statusNoIg'), true);
    return;
  }

  await savePrefs();

  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const payload = buildScrapePayloadFromUiPrefs(p, uiLocale);
  await chrome.storage.local.set({ [STORAGE_KEYS.SCRAPE_SOURCE_TAB]: tab.id });

  /**
   * Open/focus the dashboard only after the content script accepts Start.
   * If we focus the dashboard first, the popup closes and this script can be
   * torn down before sendMessage runs — so extraction never starts.
   */
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: MSG.START_SCRAPE,
      payload,
    });
    if (resp && resp.ok === false) {
      void chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
      setPopupStatus(resp.error || t(uiLocale, 'popup.statusRejected'), true);
      return;
    }
    running = true;
    syncRunButtons();
  } catch {
    void chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
    setPopupStatus(t(uiLocale, 'popup.statusReload'), true);
    return;
  }

  await openOrFocusDashboard();
}

async function stopExtraction() {
  const { [STORAGE_KEYS.SCRAPE_SOURCE_TAB]: storedId } = await chrome.storage.local.get(
    STORAGE_KEYS.SCRAPE_SOURCE_TAB,
  );
  let tabId = storedId != null ? Number(storedId) : null;
  if (tabId != null && Number.isNaN(tabId)) tabId = null;

  if (tabId == null) {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = t?.url || '';
    if (t?.id && url.includes('instagram.com')) tabId = t.id;
  }

  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: MSG.STOP_SCRAPE }, () => {
      void chrome.runtime.lastError;
    });
  }
  running = false;
  syncRunButtons();
}

function wireEvents() {
  document.querySelectorAll('.lf-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.getAttribute('data-mode');
      if (m && MODES.includes(m)) {
        setSelectedMode(m);
        updateQueryLabel();
        void savePrefs();
      }
    });
  });

  ['input', 'change'].forEach((ev) => {
    els.query.addEventListener(ev, () => void savePrefs());
    els.minFollowers.addEventListener(ev, () => void savePrefs());
  });

  els.profileLimitSlider.addEventListener('input', () => {
    updateProfileLimitReadout();
    void savePrefs();
  });
  els.profileLimitEnabled.addEventListener('change', () => {
    syncProfileLimitEnabledState();
    void savePrefs();
  });

  els.delaySlider.addEventListener('pointerdown', () => {
    void showDelayRiskToast();
  });
  els.delaySlider.addEventListener('focus', () => {
    void showDelayRiskToast();
  });

  const riskOk = document.getElementById('lfRiskToastOk');
  if (riskOk) {
    riskOk.addEventListener('click', () => void dismissDelayRiskToastFor10Minutes());
  }
  els.delaySlider.addEventListener('input', () => {
    els.delaySlider.dataset.touched = '1';
    updateDelayReadout();
    void savePrefs();
  });

  els.start.addEventListener('click', () => void startExtractionPipeline());
  els.stop.addEventListener('click', () => void stopExtraction());

  if (els.langToggle) {
    els.langToggle.hidden = true;
    els.langToggle.setAttribute('aria-hidden', 'true');
  }

  els.themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('lf-dark');
    syncThemeToggleUi();
    void savePrefs();
  });

  const upgradeBtn = document.getElementById('lfUpgrade');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
      void (async () => {
        const r = await openStripeCheckoutInNewTab();
        if (!r.ok) setPopupStatus(t(uiLocale, 'popup.stripeMissing'), true);
      })();
    });
  }
  const accountBtn = document.getElementById('lfAccountBtn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => void openAccountEntryFromPopup());
  }
  const authCta = document.getElementById('lfPopupAuthCta');
  if (authCta) authCta.addEventListener('click', () => openPopupSignupModal());
  const authLoginCta = document.getElementById('lfPopupAuthLoginCta');
  if (authLoginCta) authLoginCta.addEventListener('click', () => openPopupLoginModal());
  const capUp = document.getElementById('lfPopupCapUpgrade');
  if (capUp) {
    capUp.addEventListener('click', () => {
      void (async () => {
        const r = await openStripeCheckoutInNewTab();
        if (!r.ok) setPopupStatus(t(uiLocale, 'popup.stripeMissing'), true);
      })();
    });
  }

  wirePopupAccountUsageModal();
  wirePopupAuthModals();

  const loginDismiss = document.getElementById('lfLoginToastDismiss');
  if (loginDismiss) loginDismiss.addEventListener('click', () => hideLoginToast());
  const adminVisit = document.getElementById('lfPopupAdminVisit');
  if (adminVisit) adminVisit.addEventListener('click', () => void openOrFocusAdminDashboard());
  const adminSignOut = document.getElementById('lfPopupAdminSignOut');
  if (adminSignOut) {
    adminSignOut.addEventListener('click', async () => {
      await clearUserSession();
      window.location.reload();
    });
  }

  document.querySelectorAll('.lf-info-btn').forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const helpId = btn.getAttribute('aria-controls');
    if (!helpId) return;
    btn.addEventListener('click', () => {
      const help = document.getElementById(helpId);
      if (!help) return;
      const willOpen = help.hidden;
      document.querySelectorAll('.lf-field-help').forEach((el) => {
        el.hidden = true;
      });
      document.querySelectorAll('.lf-info-btn').forEach((b) => {
        b.setAttribute('aria-expanded', 'false');
      });
      if (willOpen) {
        help.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.RUN_STATE]) {
      const rs = changes[STORAGE_KEYS.RUN_STATE].newValue;
      running = Boolean(rs?.running);
      syncRunButtons();
      if (!rs?.running) void refreshPopupGates();
    }
    if (changes[STORAGE_KEYS.LOGIN_TOAST]) {
      void maybeShowLoginToast();
    }
    if (
      changes[STORAGE_KEYS.USER_SESSION] ||
      changes[STORAGE_KEYS.SUBSCRIPTION] ||
      changes[STORAGE_KEYS.LEADS] ||
      changes[STORAGE_KEYS.SESSION_HISTORY]
    ) {
      void refreshPopupGates();
      void refreshPopupHeaderProgress();
    }
    const uiNext = changes[STORAGE_KEYS.UI_PREFS]?.newValue;
    if (uiNext && typeof uiNext === 'object') {
      const next = uiLocaleFromUiPrefs(uiNext);
      if (next !== uiLocale) {
        uiLocale = next;
        applyPopupLocale();
      }
    }
  });
}

async function init() {
  bindEls();
  await loadPrefs();
  await refreshPageContext();
  wireEvents();

  const session = await readUserSession();
  if (sessionIsMegaleadsAdminEmail(session)) {
    await showPopupAdminMode();
    return;
  }

  await flushPendingAccountRegisters();
  if (session?.email) {
    await notifyServerAccountRegistered(session.email);
  }

  await reconcileRunningStateFromStorage();
  await refreshSubscriptionForSession();
  await refreshPopupGates();
  await refreshPopupHeaderProgress();
  await maybeShowLoginToast();
}

void init();
