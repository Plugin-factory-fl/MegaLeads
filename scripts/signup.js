/**
 * MegaLeadsAI — full-tab signup / sign-in (required before free tier use).
 */

import { STORAGE_KEYS } from './constants.js';
import { writeUserSession } from './account-shared.js';
import { t } from './i18n.js';

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

function applyTheme(dark) {
  document.documentElement.classList.toggle('lf-dark', dark);
  const icon = document.querySelector('.lf-signup-theme .lf-theme-toggle-icon');
  if (icon) icon.textContent = dark ? '☼' : '☾';
  const btn = $('lfSignupThemeToggle');
  btn.title = dark ? t('en', 'signup.themeLight') : t('en', 'signup.themeDark');
  btn.setAttribute('aria-label', dark ? t('en', 'signup.ariaThemeLight') : t('en', 'signup.ariaThemeDark'));
  const logo = document.querySelector('.lf-logo-theme');
  if (logo instanceof HTMLImageElement) {
    const light = logo.getAttribute('data-logo-light') || logo.src;
    const darkSrc = logo.getAttribute('data-logo-dark') || light;
    logo.src = dark ? darkSrc : light;
  }
}

function applyLocale() {
  $('lfSignupHeroTitle').textContent = t('en', 'signup.heroTitle');
  $('lfSignupHeroLead').textContent = t('en', 'signup.heroLead');
  $('lfSignupCreateTitle').textContent = t('en', 'signup.createTitle');
  $('lfSignupCreateDesc').textContent = t('en', 'signup.createDesc');
  $('lfSignupEmailLabel').textContent = t('en', 'signup.email');
  $('lfSignupPasswordLabel').textContent = t('en', 'signup.password');
  $('lfSignupConfirmLabel').textContent = t('en', 'signup.confirmPassword');
  $('lfSignupCreateSubmit').textContent = t('en', 'signup.createSubmit');
  $('lfSigninTitle').textContent = t('en', 'signup.signinTitle');
  $('lfSigninDesc').textContent = t('en', 'signup.signinDesc');
  $('lfSigninEmailLabel').textContent = t('en', 'signup.email');
  $('lfSigninPasswordLabel').textContent = t('en', 'signup.password');
  $('lfSigninSubmit').textContent = t('en', 'signup.signinSubmit');
  $('lfSignupOpenDashboard').textContent = t('en', 'signup.openDashboard');
  $('lfSignupFooterNote').textContent = t('en', 'signup.footerNote');
  document.title = t('en', 'signup.pageTitle');
}

async function saveThemePref(dark) {
  const { [STORAGE_KEYS.UI_PREFS]: prev } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.UI_PREFS]: { ...base, theme: dark ? 'dark' : 'light' },
  });
}

async function loadThemePref() {
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  applyTheme(p?.theme === 'dark');
}

function showCreateError(msg) {
  const el = $('lfSignupCreateError');
  el.textContent = msg;
  el.hidden = !msg;
}

function showSigninError(msg) {
  const el = $('lfSigninError');
  el.textContent = msg;
  el.hidden = !msg;
}

async function openDashboardTab() {
  const url = chrome.runtime.getURL('dashboard.html');
  const { [STORAGE_KEYS.DASHBOARD_TAB_ID]: stored } = await chrome.storage.local.get(STORAGE_KEYS.DASHBOARD_TAB_ID);
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

function showSuccess() {
  $('lfSignupSuccess').textContent = t('en', 'signup.success');
  $('lfSignupSuccess').hidden = false;
  $('lfSignupPostActions').hidden = false;
  $('lfSignupCreateForm').querySelectorAll('input').forEach((i) => {
    if (i instanceof HTMLInputElement) i.disabled = true;
  });
  $('lfSignupCreateSubmit').disabled = true;
  $('lfSigninForm').querySelectorAll('input').forEach((i) => {
    if (i instanceof HTMLInputElement) i.disabled = true;
  });
  $('lfSigninSubmit').disabled = true;
}

async function init() {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.USER_SESSION);
  const raw = existing[STORAGE_KEYS.USER_SESSION];
  const already =
    raw &&
    typeof raw === 'object' &&
    String(raw.email || '').trim() &&
    Number(raw.registeredAt) > 0;
  if (already) {
    window.location.replace(chrome.runtime.getURL('dashboard.html'));
    return;
  }

  applyLocale();
  await loadThemePref();

  const params = new URLSearchParams(window.location.search);
  if (params.get('signin') === '1') {
    $('lfSigninEmail').focus();
  }

  $('lfSignupThemeToggle').addEventListener('click', () => {
    const dark = !document.documentElement.classList.contains('lf-dark');
    applyTheme(dark);
    void saveThemePref(dark);
  });

  $('lfSignupCreateForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showCreateError('');
    const email = $('lfSignupEmail').value.trim();
    const pw = $('lfSignupPassword').value;
    const confirm = $('lfSignupConfirm').value;
    if (pw !== confirm) {
      showCreateError(t('en', 'signup.errPasswordMismatch'));
      return;
    }
    if (pw.length < 8) {
      showCreateError(t('en', 'signup.errPasswordShort'));
      return;
    }
    try {
      await writeUserSession(email);
      showSuccess();
    } catch (e) {
      showCreateError(String(e?.message || e || 'Error'));
    }
  });

  $('lfSigninForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showSigninError('');
    const email = $('lfSigninEmail').value.trim();
    const pw = $('lfSigninPassword').value;
    if (!email || pw.length < 8) {
      showSigninError(t('en', 'signup.errSignin'));
      return;
    }
    try {
      await writeUserSession(email);
      showSuccess();
    } catch (e) {
      showSigninError(String(e?.message || e || 'Error'));
    }
  });

  $('lfSignupOpenDashboard').addEventListener('click', () => void openDashboardTab());
}

void init();
