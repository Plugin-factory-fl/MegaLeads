/**
 * MegaLeads - full-tab dashboard: progress, log, results (controls in popup).
 */

import {
  MSG,
  STORAGE_KEYS,
  REMOTE_ENRICH_FETCH_TOOL_ROUND_HARD_CAP,
  SESSION_HISTORY_LIMIT,
} from './constants.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  FREE_EMAIL_EXTRACTION_CAP,
  isAdminCredentials,
  readUserSession,
  clearUserSession,
  countUniqueEmailsExtracted,
  readEffectiveUsageCount,
  openStripeCheckoutInNewTab,
  openManageSubscriptionInNewTab,
  canStartExtractionForFreeTier,
  readSubscriptionUnlimited,
  syncSubscriptionFromServer,
  notifyServerAccountRegistered,
} from './account-shared.js';
import { buildScrapePayloadFromUiPrefs } from './scrape-payload.js';
import { extractEmailPhoneFromParts } from './selectors.js';
import { t, tf, translateSessionMode, uiLocaleFromUiPrefs } from './i18n.js';

/** Max rows per POST to the enrich API (must be ≤ server cap). */
const ENRICH_BATCH_SIZE = 40;

async function redirectToSignupFromDashboard() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SIGNUP_RETURN]: { mode: 'dashboard_same_tab' },
  });
  window.location.replace(chrome.runtime.getURL('signup.html'));
}

function renderAdminSubscribers(rows) {
  const body = document.getElementById('lfAdminTableBody');
  if (!body) return;
  body.innerHTML = '';
  if (!Array.isArray(rows) || !rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3">No subscribers found yet.</td>';
    body.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    const email = String(row?.email || '');
    const type = String(row?.type || '');
    const remaining = type === 'paid' ? '—' : String(Number(row?.remaining) ?? 0);
    tr.innerHTML = `
      <td>${email}</td>
      <td>${
        type === 'paid'
          ? '<span class="lf-admin-paid-tag">PAID</span>'
          : '<span class="lf-admin-free-tag">FREE</span>'
      }</td>
      <td>${remaining}</td>
    `;
    body.appendChild(tr);
  }
}

async function initAdminDashboard(session) {
  if (!session?.isAdmin || !isAdminCredentials(session.email, ADMIN_PASSWORD)) {
    await redirectToSignupFromDashboard();
    return;
  }
  document.body.classList.add('lf-admin-mode');
  const panel = document.getElementById('lfAdminPanel');
  if (panel) panel.hidden = false;
  const resp = await sendMessageAsync({
    type: MSG.LF_ADMIN_SUBSCRIBERS,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  if (!resp?.ok) {
    renderAdminSubscribers([]);
    const body = document.getElementById('lfAdminTableBody');
    if (body) {
      body.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3">Failed to load: ${String(resp?.error || 'Unknown error')}</td>`;
      body.appendChild(tr);
    }
    return;
  }
  renderAdminSubscribers(resp?.data?.rows || []);
}

/** @typedef {{ username: string, followerCount: number|null, bio: string, email: string, phone: string, websiteUrl: string, scrapedAt?: string, contact?: string, email_confidence_0_1?: number, email_action?: string, phone_confidence_0_1?: number, phone_action?: string, email_quality_codes?: string[] }} Lead */

/** Server → stored lead fields (additive). */
const ENRICH_KEYS_FROM_API = [
  'email',
  'phone',
  'email_confidence_0_1',
  'email_action',
  'phone_confidence_0_1',
  'phone_action',
  'email_quality_codes',
];

/**
 * @param {Lead} cur
 * @param {Record<string, unknown>} incoming
 * @returns {Lead}
 */
function mergeLeadFromEnrich(cur, incoming) {
  const next = { ...cur };
  for (const k of ENRICH_KEYS_FROM_API) {
    if (Object.prototype.hasOwnProperty.call(incoming, k) && incoming[k] !== undefined) {
      next[/** @type {keyof Lead} */ (k)] = /** @type {any} */ (incoming[k]);
    }
  }
  return next;
}

/** @typedef {'en'} Locale */

/** @type {Locale} */
let uiLocale = 'en';

/** Last RUN_STATE passed to syncSessionBar (for locale refresh). */
let lastSessionRs = undefined;

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const els = {
  progressBar: null,
  progressFill: null,
  progressLabel: null,
  filter: null,
  tableBody: null,
  selectAll: null,
  copy: null,
  clear: null,
  exportProfiles: null,
  exportEmails: null,
  themeToggle: null,
  sessionBar: null,
  sessionTarget: null,
  sessionMode: null,
  sessionLink: null,
  sessionStop: null,
  sessionGoal: null,
  langToggle: null,
  progressStatus: null,
  historyList: null,
  historyClear: null,
  historyShell: null,
  historyToggle: null,
  historyBody: null,
  aiEnrich: null,
  aiLlm: null,
  aiVerify: null,
  aiStatus: null,
  aiPanelDesc: null,
  aiPanelTitle: null,
  aiLlmLabel: null,
  aiVerifyLabel: null,
  aiFetchUrl: null,
  aiFetchUrlLabel: null,
  aiExcludeFake: null,
  aiExcludeFakeLabel: null,
  aiSummaryWrap: null,
  aiSummaryTitle: null,
  aiSummaryScraped: null,
  aiSummaryAdded: null,
  aiSummaryImproved: null,
  aiSummaryOk: null,
  joshAvatar: null,
  joshThoughtWrap: null,
  joshThoughtSimple: null,
  joshAvatarThought: null,
  joshThoughtChat: null,
  joshThoughtClose: null,
  joshThoughtMessages: null,
  joshThoughtChatInput: null,
  joshThoughtChatSend: null,
  joshAvatarHelp: null,
  dashboardAccountBtn: null,
  dashboardUpgrade: null,
};

/** @type {Lead[]} */
let leads = [];
let sessions = [];
let selectedSessionId = '';
let sortKey = 'username';
let sortDir = 1;
let running = false;
/** @type {number|null} */
let sessionGoalMax = null;
let joshSending = false;
/** Josh hint bubble: 15s idle, ~15s visible (with fade), then alternate between two messages. */
const JOSH_BUBBLE_IDLE_MS = 15000;
const JOSH_BUBBLE_DISPLAY_MS = 15000;
const JOSH_BUBBLE_FADE_MS = 500;

let joshBubbleMessageIndex = 0;
/** @type {ReturnType<typeof setTimeout>[]} */
let joshBubbleTimers = [];

/** @type {'profiles' | 'emails' | null} */
let pendingExportKind = null;

function bindEls() {
  els.progressBar = $('lfProgressBar');
  els.progressFill = $('lfProgressFill');
  els.progressLabel = document.getElementById('lfProgressLabel');
  els.progressStatus = document.getElementById('lfProgressStatus');
  els.filter = $('lfFilter');
  els.tableBody = $('lfTableBody');
  els.selectAll = $('lfSelectAll');
  els.copy = $('lfCopy');
  els.clear = $('lfClear');
  els.exportProfiles = $('lfExportProfiles');
  els.exportEmails = $('lfExportEmails');
  els.themeToggle = $('lfThemeToggle');
  els.dashboardAccountBtn = $('lfDashboardAccountBtn');
  els.dashboardUpgrade = document.getElementById('lfDashboardUpgrade');
  els.sessionBar = document.getElementById('lfSessionBar');
  els.sessionTarget = document.getElementById('lfSessionTarget');
  els.sessionMode = document.getElementById('lfSessionMode');
  els.sessionLink = document.getElementById('lfSessionLink');
  els.sessionStop = document.getElementById('lfDashboardStop');
  els.sessionGoal = document.getElementById('lfSessionGoal');
  els.langToggle = document.getElementById('lfLangToggle');
  els.historyList = document.getElementById('lfHistoryList');
  els.historyClear = document.getElementById('lfHistoryClear');
  els.historyShell = document.getElementById('lfHistoryShell');
  els.historyToggle = document.getElementById('lfHistoryToggle');
  els.historyBody = document.getElementById('lfHistoryBody');
  els.aiEnrich = document.getElementById('lfAiEnrich');
  els.aiLlm = document.getElementById('lfAiLlm');
  els.aiVerify = document.getElementById('lfAiVerify');
  els.aiStatus = document.getElementById('lfAiStatus');
  els.aiPanelDesc = document.getElementById('lfAiPanelDesc');
  els.aiPanelTitle = document.getElementById('lfAiPanelTitle');
  els.aiLlmLabel = document.getElementById('lfAiLlmLabel');
  els.aiVerifyLabel = document.getElementById('lfAiVerifyLabel');
  els.aiFetchUrl = document.getElementById('lfAiFetchUrl');
  els.aiFetchUrlLabel = document.getElementById('lfAiFetchUrlLabel');
  els.aiExcludeFake = document.getElementById('lfAiExcludeFake');
  els.aiExcludeFakeLabel = document.getElementById('lfAiExcludeFakeLabel');
  els.aiSummaryWrap = document.getElementById('lfAiSummaryWrap');
  els.aiSummaryTitle = document.getElementById('lfAiSummaryTitle');
  els.aiSummaryScraped = document.getElementById('lfAiSummaryScraped');
  els.aiSummaryAdded = document.getElementById('lfAiSummaryAdded');
  els.aiSummaryImproved = document.getElementById('lfAiSummaryImproved');
  els.aiSummaryOk = document.getElementById('lfAiSummaryOk');
  els.joshAvatar = document.getElementById('lfJoshAvatar');
  els.joshThoughtWrap = document.getElementById('lfJoshThoughtWrap');
  els.joshThoughtSimple = document.getElementById('lfJoshThoughtSimple');
  els.joshAvatarThought = document.getElementById('lfJoshAvatarThought');
  els.joshThoughtChat = document.getElementById('lfJoshThoughtChat');
  els.joshThoughtClose = document.getElementById('lfJoshThoughtClose');
  els.joshThoughtMessages = document.getElementById('lfJoshThoughtMessages');
  els.joshThoughtChatInput = document.getElementById('lfJoshThoughtChatInput');
  els.joshThoughtChatSend = document.getElementById('lfJoshThoughtChatSend');
  els.joshAvatarHelp = document.getElementById('lfJoshAvatarHelp');
}

/** @param {'start' | 'continue' | 'stop'} which */
function setSessionRunToggleButton(which) {
  const L = uiLocale;
  if (!els.sessionStop) return;
  els.sessionStop.disabled = false;
  els.sessionStop.classList.remove('lf-session-complete');
  if (which === 'stop') {
    els.sessionStop.textContent = t(L, 'dashboard.sessionStop');
    els.sessionStop.classList.remove('lf-btn-primary');
    els.sessionStop.classList.add('lf-btn-danger');
  } else {
    els.sessionStop.textContent = t(L, which === 'continue' ? 'dashboard.sessionContinue' : 'dashboard.sessionStart');
    els.sessionStop.classList.remove('lf-btn-danger');
    els.sessionStop.classList.add('lf-btn-primary');
  }
  if (which !== 'stop') {
    void refreshDashboardCapBanner();
    void refreshDashboardHeaderProgress();
  }
}

/** @param {Record<string, unknown> | undefined} rs */
function syncSessionBar(rs) {
  lastSessionRs = rs;
  const L = uiLocale;
  const locStr = 'en-US';
  const sessionTitleEl = document.querySelector('.lf-session-title');
  if (sessionTitleEl) sessionTitleEl.textContent = t(L, 'dashboard.sessionTitle');
  if (els.sessionLink) els.sessionLink.textContent = t(L, 'dashboard.sessionLink');
  if (!els.sessionBar || !els.sessionStop) return;

  els.sessionBar.hidden = false;

  if (rs?.running) {
    if (els.sessionTarget) els.sessionTarget.textContent = (rs.sessionTarget && String(rs.sessionTarget)) || '—';
    if (els.sessionMode) {
      const raw = (rs.sessionModeLabel && String(rs.sessionModeLabel)) || '';
      els.sessionMode.textContent = translateSessionMode(L, raw);
    }
    const rawGoal = rs.sessionMaxProfiles;
    const g = rawGoal != null ? Number(rawGoal) : NaN;
    sessionGoalMax = Number.isFinite(g) && g > 0 ? g : null;
    if (els.sessionGoal) {
      if (sessionGoalMax != null) {
        els.sessionGoal.textContent = tf(L, 'dashboard.sessionGoal', {
          n: sessionGoalMax.toLocaleString(locStr),
        });
        els.sessionGoal.hidden = false;
      } else {
        els.sessionGoal.textContent = '';
        els.sessionGoal.hidden = true;
      }
    }
    const url = rs.sessionPageUrl && String(rs.sessionPageUrl);
    if (els.sessionLink) {
      if (url) {
        els.sessionLink.href = url;
        els.sessionLink.hidden = false;
      } else {
        els.sessionLink.hidden = true;
      }
    }
    setSessionRunToggleButton('stop');
    return;
  }

  sessionGoalMax = null;
  const latest = Array.isArray(sessions) && sessions.length ? sessions[0] : null;
  if (latest && latest.status === 'completed') {
    if (els.sessionTarget) {
      els.sessionTarget.textContent =
        (latest.targetLabel && String(latest.targetLabel)) || (latest.query && String(latest.query)) || '—';
    }
    if (els.sessionMode) {
      const mode = String(latest.mode || '');
      const modeLabel =
        mode === 'followers'
          ? t(L, 'dashboard.modeFollowers')
          : mode === 'following'
            ? t(L, 'dashboard.modeFollowing')
            : mode === 'hashtag'
              ? t(L, 'dashboard.modeHashtag')
              : '';
      els.sessionMode.textContent = translateSessionMode(L, modeLabel);
    }
    if (els.sessionGoal) {
      els.sessionGoal.textContent = '';
      els.sessionGoal.hidden = true;
    }
    if (els.sessionLink) {
      const url = latest.sessionPageUrl && String(latest.sessionPageUrl);
      if (url) {
        els.sessionLink.href = url;
        els.sessionLink.hidden = false;
      } else {
        els.sessionLink.hidden = true;
      }
    }
  } else {
    if (els.sessionTarget) els.sessionTarget.textContent = '—';
    if (els.sessionMode) els.sessionMode.textContent = '';
    if (els.sessionGoal) {
      els.sessionGoal.textContent = '';
      els.sessionGoal.hidden = true;
    }
    if (els.sessionLink) els.sessionLink.hidden = true;
  }
  const startKind =
    latest && latest.status === 'stopped' && latest.stopReason === 'user_stopped' ? 'continue' : 'start';
  setSessionRunToggleButton(startKind);
}

async function startExtractionFromDashboardPipeline() {
  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  if (rs?.running) {
    appendStatusLine(t(uiLocale, 'dashboard.alreadyRunning'));
    return;
  }
  const freeGate = await canStartExtractionForFreeTier();
  if (!freeGate.ok && freeGate.reason === 'at_cap') {
    appendStatusLine(t(uiLocale, 'dashboard.startBlockedAtCap'));
    void refreshDashboardCapBanner();
    return;
  }
  const tabs = await chrome.tabs.query({ url: ['https://www.instagram.com/*', 'https://instagram.com/*'] });
  if (!tabs.length) {
    appendStatusLine(t(uiLocale, 'popup.statusNoTab'));
    return;
  }
  let curWin;
  try {
    curWin = await chrome.windows.getCurrent();
  } catch {
    curWin = null;
  }
  const inWin = curWin?.id != null ? tabs.filter((x) => x.windowId === curWin.id) : [];
  const pool = inWin.length ? inWin : tabs;
  const tab = pool.find((x) => x.active && x.id != null) || pool.find((x) => x.id != null);
  if (!tab?.id) {
    appendStatusLine(t(uiLocale, 'popup.statusNoTab'));
    return;
  }
  const url = tab.url || '';
  if (!url.includes('instagram.com')) {
    appendStatusLine(t(uiLocale, 'popup.statusNoIg'));
    return;
  }
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const payload = buildScrapePayloadFromUiPrefs(p, uiLocale);
  await chrome.storage.local.set({ [STORAGE_KEYS.SCRAPE_SOURCE_TAB]: tab.id });
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: MSG.START_SCRAPE, payload });
    if (resp && resp.ok === false) {
      void chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
      appendStatusLine(resp.error || t(uiLocale, 'popup.statusRejected'));
      return;
    }
    setRunningUi(true);
  } catch {
    void chrome.storage.local.remove(STORAGE_KEYS.SCRAPE_SOURCE_TAB);
    appendStatusLine(t(uiLocale, 'popup.statusReload'));
  }
}

async function onDashboardRunToggleClick() {
  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  if (rs?.running) {
    await stopExtractionFromDashboard();
    return;
  }
  await startExtractionFromDashboardPipeline();
}

async function stopExtractionFromDashboard() {
  const { [STORAGE_KEYS.SCRAPE_SOURCE_TAB]: storedId } = await chrome.storage.local.get(
    STORAGE_KEYS.SCRAPE_SOURCE_TAB,
  );
  let tabId = storedId != null ? Number(storedId) : null;
  if (tabId != null && Number.isNaN(tabId)) tabId = null;

  if (tabId == null) {
    const tabs = await chrome.tabs.query({ url: ['https://www.instagram.com/*', 'https://instagram.com/*'] });
    const t = tabs.find((x) => x.id != null);
    if (t?.id) tabId = t.id;
  }

  if (tabId != null) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.STOP_SCRAPE });
    } catch {
      appendStatusLine(t(uiLocale, 'dashboard.stopSent'));
    }
  } else {
    appendStatusLine(t(uiLocale, 'dashboard.stopNoTab'));
  }
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('lf-dark', dark);
  syncThemeToggleUi();
}

function syncThemeToggleUi() {
  if (!els.themeToggle) return;
  const L = uiLocale;
  const dark = document.documentElement.classList.contains('lf-dark');
  const icon = els.themeToggle.querySelector('.lf-theme-toggle-icon');
  if (icon) {
    icon.textContent = dark ? '☼' : '☾';
  }
  els.themeToggle.title = dark ? t(L, 'dashboard.themeLight') : t(L, 'dashboard.themeDark');
  els.themeToggle.setAttribute(
    'aria-label',
    dark ? t(L, 'dashboard.ariaThemeToLight') : t(L, 'dashboard.ariaThemeToDark'),
  );
  const logo = document.querySelector('.lf-logo-theme');
  if (logo instanceof HTMLImageElement) {
    const light = logo.getAttribute('data-logo-light') || logo.src;
    const darkSrc = logo.getAttribute('data-logo-dark') || light;
    logo.src = dark ? darkSrc : light;
  }
}

async function savePrefsUi() {
  const { [STORAGE_KEYS.UI_PREFS]: prev } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.UI_PREFS]: {
      ...base,
      locale: 'en',
      preferEnglish: true,
      theme: document.documentElement.classList.contains('lf-dark') ? 'dark' : 'light',
    },
  });
}

function syncExportFormatModalStrings() {
  const L = uiLocale;
  const hint = document.getElementById('lfExportFormatHint');
  if (hint) hint.textContent = t(L, 'dashboard.exportFormatHint');
  const x = document.getElementById('lfExportFormatXlsx');
  if (x) x.textContent = t(L, 'dashboard.exportFormatXlsxBtn');
  const c = document.getElementById('lfExportFormatCsv');
  if (c) c.textContent = t(L, 'dashboard.exportFormatCsvBtn');
  const cancel = document.getElementById('lfExportFormatCancel');
  if (cancel) cancel.textContent = t(L, 'dashboard.exportFormatCancel');
  const title = document.getElementById('lfExportFormatTitle');
  if (title) {
    if (pendingExportKind === 'emails') title.textContent = t(L, 'dashboard.exportFormatTitleEmails');
    else if (pendingExportKind === 'profiles') title.textContent = t(L, 'dashboard.exportFormatTitleProfiles');
    else title.textContent = t(L, 'dashboard.exportFormatTitleProfiles');
  }
}

function tryOpenExportFormatModal(/** @type {'profiles'|'emails'} */ kind) {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  if (kind === 'profiles') {
    const target = rows.length ? rows : active;
    if (!target.length) {
      appendStatusLine(t(uiLocale, 'dashboard.nothingExport'));
      return;
    }
  } else {
    const base = rows.length ? rows : active;
    const target = base.filter((r) => String(r.email || '').trim().length > 0);
    if (!target.length) {
      appendStatusLine(t(uiLocale, 'dashboard.nothingExportEmails'));
      return;
    }
  }
  openExportFormatModal(kind);
}

function openExportFormatModal(/** @type {'profiles'|'emails'} */ kind) {
  pendingExportKind = kind;
  syncExportFormatModalStrings();
  const wrap = document.getElementById('lfExportFormatWrap');
  if (wrap) wrap.hidden = false;
}

function closeExportFormatModal() {
  pendingExportKind = null;
  const wrap = document.getElementById('lfExportFormatWrap');
  if (wrap) wrap.hidden = true;
}

async function runPendingExport(/** @type {'xlsx'|'csv'} */ format) {
  const kind = pendingExportKind;
  if (!kind) return;
  closeExportFormatModal();
  if (kind === 'emails') await doExportEmails(format);
  else await doExportProfiles(format);
}

function wireExportFormatModal() {
  const wrap = document.getElementById('lfExportFormatWrap');
  if (wrap) {
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap) closeExportFormatModal();
    });
    const card = wrap.querySelector('.lf-export-format-card');
    if (card) card.addEventListener('click', (ev) => ev.stopPropagation());
  }
  document.getElementById('lfExportFormatCancel')?.addEventListener('click', () => closeExportFormatModal());
  document.getElementById('lfExportFormatXlsx')?.addEventListener('click', () => void runPendingExport('xlsx'));
  document.getElementById('lfExportFormatCsv')?.addEventListener('click', () => void runPendingExport('csv'));
}

function applyDashboardLocale() {
  const L = uiLocale;
  document.documentElement.lang = 'en';
  document.title = t(L, 'dashboard.title');
  const ver = document.querySelector('.lf-version');
  if (ver) ver.textContent = t(L, 'dashboard.version');
  if (els.langToggle) {
    els.langToggle.textContent = t(L, 'dashboard.langSwitch');
    els.langToggle.setAttribute('title', t(L, 'dashboard.langSwitchToEn'));
    els.langToggle.setAttribute('aria-label', t(L, 'dashboard.langSwitchToEn'));
  }
  syncThemeToggleUi();
  const dashFree = document.getElementById('lfDashboardFreeTierLabel');
  if (dashFree) dashFree.textContent = t(L, 'dashboard.freeTierEmailsLabel');
  if (els.dashboardUpgrade) {
    els.dashboardUpgrade.setAttribute('title', t(L, 'dashboard.getInfiniteEmails'));
    els.dashboardUpgrade.setAttribute('aria-label', t(L, 'dashboard.ariaGetInfiniteEmails'));
    const lab = els.dashboardUpgrade.querySelector('.lf-upgrade-label');
    if (lab) lab.textContent = t(L, 'dashboard.getInfiniteEmails');
  }
  const hint = document.getElementById('lfDashboardHint');
  if (hint) hint.textContent = t(L, 'dashboard.hint');
  const historyLab = document.getElementById('lfHistoryLabel');
  if (historyLab) historyLab.textContent = t(L, 'dashboard.historyLabel');
  if (els.historyClear) els.historyClear.textContent = t(L, 'dashboard.historyClear');
  syncHistoryPanelAria();
  const results = document.querySelector('.lf-section-title');
  if (results) results.textContent = t(L, 'dashboard.results');
  els.filter.placeholder = t(L, 'dashboard.filterPh');
  els.copy.textContent = t(L, 'dashboard.copy');
  els.clear.textContent = t(L, 'dashboard.clear');
  if (els.aiPanelTitle) els.aiPanelTitle.textContent = t(L, 'dashboard.aiPanelTitle');
  if (els.aiPanelDesc) els.aiPanelDesc.textContent = t(L, 'dashboard.aiPanelDesc');
  if (els.aiLlmLabel) els.aiLlmLabel.textContent = t(L, 'dashboard.aiLlmToggle');
  if (els.aiVerifyLabel) els.aiVerifyLabel.textContent = t(L, 'dashboard.aiVerifyToggle');
  if (els.aiFetchUrlLabel) els.aiFetchUrlLabel.textContent = t(L, 'dashboard.aiFetchUrlToggle');
  if (els.aiExcludeFakeLabel) els.aiExcludeFakeLabel.textContent = t(L, 'dashboard.aiExcludeFakeToggle');
  if (els.aiEnrich) els.aiEnrich.textContent = t(L, 'dashboard.aiEnrichRun');
  syncExportFormatModalStrings();
  const runNote = document.getElementById('lfSessionRunningNote');
  if (runNote && running) runNote.textContent = t(L, 'dashboard.sessionRunningNote');

  const thMap = {
    username: 'dashboard.thUser',
    followerCount: 'dashboard.thFollowers',
    bio: 'dashboard.thBio',
    email: 'dashboard.thEmail',
    phone: 'dashboard.thPhone',
    websiteUrl: 'dashboard.thWebsite',
  };
  document.querySelectorAll('#lfTable th[data-sort]').forEach((th) => {
    const k = th.getAttribute('data-sort');
    const path = k && thMap[/** @type {keyof typeof thMap} */ (k)];
    if (path) th.textContent = t(L, path);
  });
  els.selectAll.title = t(L, 'dashboard.selectAll');
  const foot = document.querySelector('.lf-footer');
  if (foot) foot.textContent = t(L, 'dashboard.footer');
  syncSessionBar(lastSessionRs);
  renderHistory();
  renderTable();
  if (running) setRunningUi(true);
  syncAccountModalLocale();
  syncJoshBubbleLineIfVisible();
  void refreshDashboardHeaderProgress();
}

function syncJoshBubbleLineIfVisible() {
  if (!els.joshAvatarThought || !els.joshThoughtSimple) return;
  if (els.joshThoughtSimple.classList.contains('lf-josh-thought-bubble-hidden')) return;
  const lines = getJoshBubbleLines();
  const line = lines[joshBubbleMessageIndex % lines.length];
  if (line) els.joshAvatarThought.textContent = line;
}

async function loadPrefsUi() {
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  uiLocale = uiLocaleFromUiPrefs(p);
  applyTheme(p?.theme === 'dark');
  applyDashboardLocale();
}

function setRunningUi(on) {
  running = on;
  const L = uiLocale;
  els.progressBar.classList.toggle('lf-active', on);
  const runNote = document.getElementById('lfSessionRunningNote');
  if (runNote) {
    runNote.hidden = !on;
    if (on) runNote.textContent = t(L, 'dashboard.sessionRunningNote');
  }
  if (!on) {
    els.progressBar.classList.remove('lf-progress-determinate');
    els.progressFill.style.width = '100%';
    if (els.progressLabel) els.progressLabel.textContent = '';
  } else {
    els.progressBar.classList.remove('lf-progress-determinate');
    els.progressFill.style.width = '';
    if (els.progressLabel) {
      els.progressLabel.textContent = t(L, 'dashboard.progressGather');
    }
  }
}

/**
 * @param {object} msg runtime message (PROGRESS)
 */
function applyProgressFromMessage(msg) {
  if (!running) return;
  const L = uiLocale;
  const locStr = 'en-US';
  if (msg.phase === 'enrich' && msg.enrichTotal > 0) {
    const cur = Math.max(0, Number(msg.enrichCurrent) || 0);
    const tot = Number(msg.enrichTotal) || 1;
    els.progressBar.classList.add('lf-progress-determinate');
    /** Cap at 85% so the last 15% represents post-extraction AI enrichment on the dashboard. */
    const pct = Math.min(85, (100 * cur) / tot);
    els.progressFill.style.width = `${pct}%`;
    if (els.progressLabel) {
      els.progressLabel.textContent = tf(L, 'dashboard.progressEnrich', { cur, tot });
    }
    return;
  }
  els.progressBar.classList.remove('lf-progress-determinate');
  els.progressFill.style.width = '';
  if (els.progressLabel) {
    const n = typeof msg.extracted === 'number' ? msg.extracted : null;
    const goal = sessionGoalMax != null ? sessionGoalMax : null;
    if (goal != null && n != null) {
      els.progressLabel.textContent = tf(L, 'dashboard.progressGatherGoal', {
        cur: n.toLocaleString(locStr),
        goal: goal.toLocaleString(locStr),
      });
    } else if (n != null && n > 0) {
      els.progressLabel.textContent = tf(L, 'dashboard.progressGatherN', {
        n: n.toLocaleString(locStr),
      });
    } else {
      els.progressLabel.textContent = t(L, 'dashboard.progressGather');
    }
  }
}

/**
 * Progress bar for automated post-extraction AI (batches), maps into 85–100%.
 * @param {number} cur 1-based batch index
 * @param {number} tot batch count
 */
function applyPostExtractionAiBatchProgress(cur, tot) {
  if (!running) return;
  const L = uiLocale;
  els.progressBar.classList.add('lf-progress-determinate');
  const safeTot = Math.max(1, tot);
  const pct = Math.min(100, 85 + (15 * cur) / safeTot);
  els.progressFill.style.width = `${pct}%`;
  if (els.progressLabel) {
    els.progressLabel.textContent = tf(L, 'dashboard.progressAiEnrich', { cur, tot: safeTot });
  }
}

function appendStatusLine(line) {
  if (!els.progressStatus) return;
  els.progressStatus.textContent = line || '';
}

function stopReasonText(reason) {
  const map = {
    completed: 'dashboard.stopReasonCompleted',
    user_stopped: 'dashboard.stopReasonUserStopped',
    session_timeout: 'dashboard.stopReasonTimeout',
    profile_cap_reached: 'dashboard.stopReasonCap',
    source_exhausted: 'dashboard.stopReasonSourceExhausted',
    top_serp_exhausted: 'dashboard.stopReasonTopSerpExhausted',
    top_serp_error: 'dashboard.stopReasonTopSerpError',
    top_serp_rate_limited: 'dashboard.stopReasonTopSerpRateLimited',
    top_serp_duplicate_pivot: 'dashboard.stopReasonTopSerpDuplicatePivot',
    graphql_exhausted: 'dashboard.stopReasonGraphqlExhausted',
    graphql_error: 'dashboard.stopReasonGraphqlError',
    reserved_for_enrichment: 'dashboard.stopReasonReservedForEnrichment',
    navigation_required: 'dashboard.stopReasonNavigationRequired',
    runtime_error: 'dashboard.stopReasonRuntimeError',
    validation_error: 'dashboard.stopReasonValidationError',
  };
  const key = map[String(reason || '')];
  return key ? t(uiLocale, key) : '';
}

/** @param {Record<string, any> | undefined} rs */
function metricsStatusLine(rs) {
  const m = rs?.sessionMetrics;
  if (!m || typeof m !== 'object') return '';
  const top = m.topSerp || {};
  const gql = m.graphql || {};
  const enrich = m.enrich || {};
  const parts = [];
  if (top.pages || top.newAdded) parts.push(`top_serp p${top.pages || 0} +${top.newAdded || 0}`);
  if (gql.pages || gql.newAdded) parts.push(`graphql p${gql.pages || 0} +${gql.newAdded || 0}`);
  if (enrich.totalQueued) parts.push(`enrich ${enrich.totalQueued - (enrich.firstPassFailed || 0)}/${enrich.totalQueued}`);
  return parts.join(' | ');
}

/** Filesystem-safe base name for exports (hashtag or profile username). */
function sanitizeExportBasename(raw) {
  let s = String(raw || '').trim().replace(/^[@#]+/, '');
  s = s.replace(/[/\\:*?"<>|]+/g, '-');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) return 'leadflow';
  return s.slice(0, 80);
}

async function getExportBasename() {
  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  const slug = rs?.lastExportSlug;
  if (slug && String(slug).trim()) return sanitizeExportBasename(slug);
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);
  const pq = p && typeof p.query === 'string' ? p.query : '';
  if (pq.trim()) return sanitizeExportBasename(pq);
  if (leads.length && leads[0].username) return sanitizeExportBasename(leads[0].username);
  return 'leadflow';
}

/**
 * Hashtag: `{tag}[-profiles|-emails]-{date}.xlsx`.
 * Followers/Following: `{user}-{mode}[-profiles|-emails]-{date}.xlsx`.
 * @param {string} ext
 * @param {'' | 'profiles' | 'emails'} [kind]
 */
async function buildExportFilename(ext, kind = '') {
  const date = new Date().toISOString().slice(0, 10);
  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  const { [STORAGE_KEYS.UI_PREFS]: p } = await chrome.storage.local.get(STORAGE_KEYS.UI_PREFS);

  const base = await getExportBasename();

  let mode = rs?.lastExportMode;
  if (mode !== 'hashtag' && mode !== 'followers' && mode !== 'following') {
    const pm = p?.mode;
    mode = pm === 'hashtag' || pm === 'followers' || pm === 'following' ? pm : null;
  }

  const kindSeg = kind === 'profiles' ? '-profiles' : kind === 'emails' ? '-emails' : '';

  if (mode === 'hashtag') {
    return `${base}${kindSeg}-${date}.${ext}`;
  }
  if (mode === 'followers' || mode === 'following') {
    return `${base}-${mode}${kindSeg}-${date}.${ext}`;
  }
  return `${base}-export${kindSeg}-${date}.${ext}`;
}

/** @param {number|null|undefined} n */
function fmtFollowers(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} s */
function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function normalizeStoredLead(r) {
  if (!r || typeof r !== 'object') return r;
  const { email, phone } = extractEmailPhoneFromParts([
    r.email,
    r.phone,
    r.contact,
    r.bio,
  ]);
  const { contact: _c, profileUrl: _pu, ...rest } = r;
  const websiteUrl =
    typeof r.websiteUrl === 'string' && r.websiteUrl.trim()
      ? r.websiteUrl.trim()
      : '';
  let segment_tags = rest.segment_tags;
  if (!Array.isArray(segment_tags)) {
    if (typeof segment_tags === 'string' && segment_tags.trim().startsWith('[')) {
      try {
        const p = JSON.parse(segment_tags);
        segment_tags = Array.isArray(p) ? p.map(String) : [];
      } catch {
        segment_tags = [];
      }
    } else {
      segment_tags = [];
    }
  } else {
    segment_tags = segment_tags.map(String);
  }
  let email_quality_codes = rest.email_quality_codes;
  if (!Array.isArray(email_quality_codes)) email_quality_codes = [];
  return { ...rest, email, phone, websiteUrl, segment_tags, email_quality_codes };
}

async function loadLeads() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LEADS);
  leads = (data[STORAGE_KEYS.LEADS] || []).map(normalizeStoredLead);
  renderTable();
}

function getActiveLeads() {
  if (!selectedSessionId) return leads;
  const picked = sessions.find((s) => s.id === selectedSessionId);
  return Array.isArray(picked?.leads) ? picked.leads.map(normalizeStoredLead) : [];
}

/**
 * Same keep rule as `pruneLeadsBelowMin` in the content script: unknown follower count is kept
 * until API enrichment; known count below threshold is dropped at end of run.
 * @param {Lead} r
 * @param {number} minFollowers
 */
function leadSurvivesMinFollowersPrune(r, minFollowers) {
  const threshold = Math.max(0, Number(minFollowers) || 0);
  if (threshold <= 0) return true;
  const fc = r.followerCount;
  if (fc == null) return true;
  const n = Number(fc);
  if (!Number.isFinite(n)) return true;
  return n >= threshold;
}

/** Min-followers threshold for UI counts: live run uses snapshotted session value; history uses session row. */
function resolveMinFollowersForDisplayCounts() {
  if (selectedSessionId) {
    const s = sessions.find((x) => x.id === selectedSessionId);
    return Math.max(0, Number(s?.minFollowers) || 0);
  }
  if (lastSessionRs?.running) {
    return Math.max(0, Number(lastSessionRs.sessionMinFollowers) || 0);
  }
  return 0;
}

function syncExportButtonLabels() {
  const L = uiLocale;
  const list = getActiveLeads();
  const minF = resolveMinFollowersForDisplayCounts();
  const nProfiles = list.length;
  const nEmails = list.filter(
    (r) =>
      leadSurvivesMinFollowersPrune(r, minF) && String(r.email || '').trim().length > 0,
  ).length;
  if (els.exportProfiles) {
    const lab = tf(L, 'dashboard.exportProfilesCount', { n: nProfiles });
    els.exportProfiles.textContent = lab;
    els.exportProfiles.title = lab;
  }
  if (els.exportEmails) {
    const lab = tf(L, 'dashboard.exportEmailsCount', { n: nEmails });
    els.exportEmails.textContent = lab;
    els.exportEmails.title = lab;
  }
}

function historyModeLabel(mode) {
  if (mode === 'followers') return t(uiLocale, 'dashboard.modeFollowers');
  if (mode === 'following') return t(uiLocale, 'dashboard.modeFollowing');
  if (mode === 'hashtag') return t(uiLocale, 'dashboard.modeHashtag');
  return '';
}

function historyStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return t(uiLocale, 'dashboard.historyStatusCompleted');
  if (s === 'stopped') return t(uiLocale, 'dashboard.historyStatusStopped');
  if (s === 'running') return t(uiLocale, 'dashboard.historyStatusRunning');
  return t(uiLocale, 'dashboard.historyStatusUnknown');
}

function renderHistory() {
  if (!els.historyList) return;
  if (!sessions.length) {
    els.historyList.innerHTML = `<div class="lf-history-empty">${escapeHtml(
      t(uiLocale, 'dashboard.historyEmpty'),
    )}</div>`;
    return;
  }
  const locStr = 'en-US';
  const rows = sessions
    .map((s) => {
      const selected = s.id === selectedSessionId;
      const modeLabel = historyModeLabel(String(s.mode || ''));
      const baseTitle = s.targetLabel || s.query || t(uiLocale, 'dashboard.historyUntitled');
      const title = escapeHtml(modeLabel ? `${modeLabel} · ${baseTitle}` : baseTitle);
      const status = escapeHtml(historyStatusLabel(String(s.status || 'completed')));
      const count = Number(s?.totals?.gathered || 0);
      const when = s.startedAt ? new Date(Number(s.startedAt)).toLocaleString(locStr) : '';
      return `<button type="button" class="lf-history-item${selected ? ' is-active' : ''}" data-session-id="${escapeHtml(
        s.id,
      )}" role="option" aria-selected="${selected ? 'true' : 'false'}">
        <span class="lf-history-item-title">${title}</span>
        <span class="lf-history-item-meta">${escapeHtml(when)} · ${status} · ${count}</span>
      </button>`;
    })
    .join('');
  const liveActive = !selectedSessionId;
  els.historyList.innerHTML = `<button type="button" class="lf-history-item${liveActive ? ' is-active' : ''}" data-session-id="" role="option" aria-selected="${liveActive ? 'true' : 'false'}">${escapeHtml(
    t(uiLocale, 'dashboard.historyCurrent'),
  )}</button>${rows}`;
}

async function loadSessionHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SESSION_HISTORY);
  sessions = Array.isArray(data[STORAGE_KEYS.SESSION_HISTORY]) ? data[STORAGE_KEYS.SESSION_HISTORY] : [];
  if (selectedSessionId && !sessions.find((s) => s.id === selectedSessionId)) selectedSessionId = '';
  syncSessionBar(lastSessionRs);
  renderHistory();
  renderTable();
}

function renderTable() {
  syncExportButtonLabels();
  const sourceLeads = getActiveLeads();
  const q = els.filter.value.trim().toLowerCase();
  let rows = sourceLeads.slice();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.username && r.username.toLowerCase().includes(q)) ||
        (r.bio && r.bio.toLowerCase().includes(q)) ||
        (r.email && r.email.toLowerCase().includes(q)) ||
        (r.phone && r.phone.toLowerCase().includes(q)) ||
        (r.websiteUrl && r.websiteUrl.toLowerCase().includes(q)),
    );
  }

  rows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (sortKey === 'followerCount') {
      const an = av == null ? -1 : Number(av);
      const bn = bv == null ? -1 : Number(bv);
      return (an - bn) * sortDir;
    }
    const as = String(av ?? '').toLowerCase();
    const bs = String(bv ?? '').toLowerCase();
    if (as < bs) return -1 * sortDir;
    if (as > bs) return 1 * sortDir;
    return 0;
  });

  if (rows.length === 0) {
    const emptyEsc = escapeHtml(t(uiLocale, 'dashboard.emptyMsg'));
    els.tableBody.innerHTML = `<tr class="lf-empty-row"><td colspan="7" class="lf-empty-msg">${emptyEsc}</td></tr>`;
    els.selectAll.checked = false;
    els.selectAll.indeterminate = false;
    return;
  }

  els.tableBody.innerHTML = rows
    .map((r) => {
      const ig = `https://www.instagram.com/${encodeURIComponent(r.username)}/`;
      const bioFull = escapeHtml(r.bio || '');
      const bioShort = escapeHtml(truncate(r.bio || '', 120));
      const w = (r.websiteUrl || '').trim();
      const webCell = w
        ? `<a href="${escapeHtml(w)}" target="_blank" rel="noreferrer">${escapeHtml(
            truncate(w, 40),
          )}</a>`
        : '—';
      return `<tr data-user="${escapeHtml(r.username)}">
        <td><input type="checkbox" class="lf-row-check" /></td>
        <td><a href="${ig}" target="_blank" rel="noreferrer">${escapeHtml(r.username)}</a></td>
        <td>${escapeHtml(fmtFollowers(r.followerCount))}</td>
        <td class="lf-bio-cell" title="${bioFull}">${bioShort}</td>
        <td>${escapeHtml(r.email || '')}</td>
        <td>${escapeHtml(r.phone || '')}</td>
        <td>${webCell}</td>
      </tr>`;
    })
    .join('');

  els.selectAll.checked = false;
  els.selectAll.indeterminate = false;
}

function wireTableSort() {
  document.querySelectorAll('#lfTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (!key) return;
      if (sortKey === key) sortDir *= -1;
      else {
        sortKey = key;
        sortDir = 1;
      }
      renderTable();
    });
  });
}

function getSelectedRows() {
  /** @type {Lead[]} */
  const out = [];
  els.tableBody.querySelectorAll('tr').forEach((tr) => {
    const cb = tr.querySelector('.lf-row-check');
    if (!(cb instanceof HTMLInputElement) || !cb.checked) return;
    const u = tr.getAttribute('data-user');
    const lead = getActiveLeads().find((l) => l.username === u);
    if (lead) out.push(lead);
  });
  return out;
}

function setAiStatus(line) {
  if (els.aiStatus) els.aiStatus.textContent = line || '';
}

/**
 * Console trace for AI enrich pipeline (dashboard side).
 * @param {string} stage
 * @param {Record<string, unknown>} [data]
 */
function aiTrace(stage, data) {
  const ts = new Date().toISOString();
  const payload = data && Object.keys(data).length ? { ts, ...data } : { ts };
  console.info('[MegaLeads][AI Enrich]', stage, payload);
  try {
    console.info(`[MegaLeads][AI Enrich][json] ${stage} ${JSON.stringify(payload)}`);
  } catch {
    /* no-op */
  }
}

function getVisibleUsernames() {
  /** @type {string[]} */
  const out = [];
  els.tableBody.querySelectorAll('tr[data-user]').forEach((tr) => {
    const u = String(tr.getAttribute('data-user') || '').trim();
    if (u) out.push(u);
  });
  return out;
}

/** @param {string[]} usernames */
function setSelectedRowsByUsernames(usernames) {
  const set = new Set((usernames || []).map((x) => String(x || '').toLowerCase()));
  els.tableBody.querySelectorAll('tr[data-user]').forEach((tr) => {
    const cb = tr.querySelector('.lf-row-check');
    if (!(cb instanceof HTMLInputElement)) return;
    const u = String(tr.getAttribute('data-user') || '').toLowerCase();
    cb.checked = set.has(u);
  });
}

async function persistLeadsAndRender(nextLeads) {
  leads = nextLeads.map(normalizeStoredLead);
  await chrome.storage.local.set({ [STORAGE_KEYS.LEADS]: leads });
  renderTable();
}

/** @param {Lead[]} rows */
function countRowsWithEmail(rows) {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows) {
    const e = String(r?.email || '').trim();
    if (e && e.includes('@')) n += 1;
  }
  return n;
}

function closeAiSummaryModal() {
  if (els.aiSummaryWrap) els.aiSummaryWrap.hidden = true;
  if (els.aiSummaryScraped) els.aiSummaryScraped.hidden = false;
  if (els.aiSummaryAdded) els.aiSummaryAdded.hidden = false;
}

function showAiSummaryModal(scrapedCount, afterCount) {
  if (!els.aiSummaryWrap || !els.aiSummaryScraped || !els.aiSummaryAdded || !els.aiSummaryImproved) return;
  const L = uiLocale;
  if (els.aiSummaryTitle) els.aiSummaryTitle.textContent = t(L, 'dashboard.aiSummaryTitle');
  if (els.aiSummaryOk) els.aiSummaryOk.textContent = t(L, 'dashboard.extractionSummaryOk');
  els.aiSummaryScraped.hidden = false;
  els.aiSummaryAdded.hidden = false;
  els.aiSummaryImproved.hidden = false;
  const added = Math.max(0, Number(afterCount) - Number(scrapedCount));
  els.aiSummaryScraped.textContent = tf(L, 'dashboard.aiSummaryScrapedLine', { n: scrapedCount });
  els.aiSummaryAdded.textContent = tf(L, 'dashboard.aiSummaryAddedLine', { n: added });
  els.aiSummaryImproved.textContent = tf(L, 'dashboard.aiSummaryImprovedLine', { n: added });
  els.aiSummaryWrap.hidden = false;
}

/** @param {number} emailCount rows with a non-empty email address */
function showExtractionSummaryModal(emailCount) {
  if (!els.aiSummaryWrap || !els.aiSummaryImproved) return;
  const L = uiLocale;
  if (els.aiSummaryTitle) els.aiSummaryTitle.textContent = t(L, 'dashboard.extractionSummaryTitle');
  if (els.aiSummaryOk) els.aiSummaryOk.textContent = t(L, 'dashboard.extractionSummaryOk');
  if (els.aiSummaryScraped) els.aiSummaryScraped.hidden = true;
  if (els.aiSummaryAdded) els.aiSummaryAdded.hidden = true;
  els.aiSummaryImproved.hidden = false;
  els.aiSummaryImproved.textContent = tf(L, 'dashboard.extractionSummaryJoshLine', { n: emailCount });
  els.aiSummaryWrap.hidden = false;
}

/** @param {Lead[]} arr @param {number} size */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** @param {Lead} r */
function leadToEnrichDto(r) {
  return {
    username: r.username,
    followerCount: r.followerCount ?? null,
    bio: r.bio || '',
    websiteUrl: r.websiteUrl || '',
    email: r.email || '',
    phone: r.phone || '',
    scrapedAt: r.scrapedAt,
  };
}

/** @param {unknown} payload */
function sendMessageAsync(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

const CONTACT_LINK_HINT_RE = /(contact|about|team|support|help|customer|impressum|legal|privacy|terms|reach|connect)/i;
const BAD_ASSET_EXT_RE = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|json|pdf|zip|mp4|webm|woff2?|ttf)(\?.*)?$/i;
const PLATFORM_HOST_RE = /(^|\.)((youtube\.com|youtu\.be|twitch\.tv|x\.com|twitter\.com|tiktok\.com))$/i;

/** @param {string} url */
async function fetchHtmlViaBridge(url) {
  /** @type {{ bridgeOk?: boolean, text?: string, error?: string }} */
  const r = await sendMessageAsync({ type: MSG.HTTP_TEXT_FETCH, url });
  const ok = r?.bridgeOk === true && typeof r.text === 'string';
  return {
    ok,
    text: ok ? String(r.text || '') : `Fetch error: ${(r && r.error) || 'unknown'}`,
  };
}

/**
 * @param {string} baseUrl
 * @param {string} html
 * @returns {string[]}
 */
function extractLikelyContactUrls(baseUrl, html) {
  const out = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  const add = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('javascript:'))
      return;
    let u;
    try {
      u = new URL(s, base.href);
    } catch {
      return;
    }
    if (!/^https?:$/i.test(u.protocol)) return;
    if (u.hostname !== base.hostname) return;
    if (BAD_ASSET_EXT_RE.test(u.pathname)) return;
    const k = `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    if (seen.has(k)) return;
    const hint = `${u.pathname} ${u.search}`.toLowerCase();
    if (!CONTACT_LINK_HINT_RE.test(hint)) return;
    seen.add(k);
    out.push(u.href);
  };

  const sample = String(html || '').slice(0, 250000);
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(sample))) add(m[1] || '');

  const fallbackPaths = ['/contact', '/contact-us', '/about', '/about-us', '/support', '/impressum', '/team'];
  for (const p of fallbackPaths) add(p);
  return out.slice(0, 4);
}

/** @param {string} host */
function isPlatformHost(host) {
  return PLATFORM_HOST_RE.test(String(host || '').toLowerCase());
}

/**
 * Pull likely outbound non-platform URLs from a platform page.
 * @param {string} baseUrl
 * @param {string} html
 * @returns {string[]}
 */
function extractExternalCandidateUrls(baseUrl, html) {
  const out = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  const add = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    let u;
    try {
      u = new URL(raw, base.href);
    } catch {
      return;
    }
    if (!/^https?:$/i.test(u.protocol)) return;
    if (u.hostname === base.hostname) return;
    if (isPlatformHost(u.hostname)) return;
    if (BAD_ASSET_EXT_RE.test(u.pathname)) return;
    const k = `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(u.href);
  };
  const sample = String(html || '').slice(0, 250000);
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(sample))) add(m[1] || '');
  return out.slice(0, 3);
}

/**
 * Fetch primary page and likely contact/about pages on same host.
 * @param {string} url
 */
async function fetchExpandedContactText(url) {
  const first = await fetchHtmlViaBridge(url);
  const blocks = [`URL: ${url}\n${first.text.slice(0, 100000)}`];
  if (!first.ok) return { ok: false, mergedText: blocks.join('\n\n'), fetchedUrls: [url] };
  let extraUrls = extractLikelyContactUrls(url, first.text);
  try {
    const h = new URL(url).hostname;
    if (isPlatformHost(h)) {
      const ext = extractExternalCandidateUrls(url, first.text);
      extraUrls = [...extraUrls, ...ext];
    }
  } catch {
    /* ignore */
  }
  const dedup = [];
  const seen = new Set();
  for (const u of extraUrls) {
    const k = String(u).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(u);
  }
  const fetchedUrls = [url];
  for (const extra of dedup.slice(0, 4)) {
    const r = await fetchHtmlViaBridge(extra);
    fetchedUrls.push(extra);
    blocks.push(`URL: ${extra}\n${r.text.slice(0, 70000)}`);
  }
  return { ok: true, mergedText: blocks.join('\n\n'), fetchedUrls };
}

/** @param {string} raw */
function normalizePhoneForPrefetch(raw) {
  const base = String(raw || '').trim();
  if (!base) return '';
  const digits = base.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  const hasPlus = base.trim().startsWith('+');
  if (!hasPlus && digits.length > 11) return '';
  if (!hasPlus && digits.length === 11 && !digits.startsWith('1')) return '';
  if (/\d{4}[-.\s]\d{4}[-.\s]\d{4}/.test(base)) return '';
  if (/^\d{1,3}\.\d{3,}\s+\d{1,3}\.\d{3,}/.test(base)) return '';
  return base;
}

/**
 * Extract only high-confidence phone signals from fetched HTML/text.
 * @param {string} text
 * @returns {string}
 */
function extractHighConfidencePhone(text) {
  const src = String(text || '');
  /** @type {string[]} */
  const cands = [];
  let m;
  const telRe = /tel:\s*([+\d][\d\s().-]{7,24}\d)/gi;
  while ((m = telRe.exec(src))) {
    const p = normalizePhoneForPrefetch(m[1] || '');
    if (p) cands.push(p);
  }
  const waRe = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{8,15})/gi;
  while ((m = waRe.exec(src))) {
    const p = normalizePhoneForPrefetch(`+${m[1] || ''}`);
    if (p) cands.push(p);
  }
  const ldRe = /"telephone"\s*:\s*"([^"]+)"/gi;
  while ((m = ldRe.exec(src))) {
    const p = normalizePhoneForPrefetch(m[1] || '');
    if (p) cands.push(p);
  }
  if (!cands.length) return '';
  cands.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
  return cands[0] || '';
}

/**
 * Deterministic contact prefetch from lead website URLs.
 * This runs before LLM tool-calls so contact extraction does not depend solely on model fetch decisions.
 * @param {ReturnType<typeof leadToEnrichDto>[]} dtos
 */
async function prefetchContactsIntoDtos(dtos) {
  let visited = 0;
  let emailAdds = 0;
  let phoneAdds = 0;
  for (const dto of dtos) {
    const url = String(dto?.websiteUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (/instagram\.com|instagr\.am/i.test(url)) continue;
    visited += 1;
    const expanded = await fetchExpandedContactText(url);
    const parsed = extractEmailPhoneFromParts([dto.email || '', expanded.mergedText || '']);
    const hiPhone = extractHighConfidencePhone(expanded.mergedText || '');
    if (parsed.email && parsed.email !== String(dto.email || '').trim()) {
      dto.email = parsed.email;
      emailAdds += 1;
    }
    if (hiPhone && hiPhone !== String(dto.phone || '').trim()) {
      dto.phone = hiPhone;
      phoneAdds += 1;
    }
    aiTrace('prefetch_contact_done', {
      username: dto.username,
      url,
      ok: expanded.ok,
      fetchedUrls: expanded.fetchedUrls.length,
      email: parsed.email || '',
      phone: hiPhone || '',
    });
  }
  aiTrace('prefetch_contact_summary', { visited, emailAdds, phoneAdds });
}

/**
 * One enrich batch: optional multi-round fetch_url tool (extension fetches HTML).
 * @param {ReturnType<typeof leadToEnrichDto>[]} dtos
 * @param {{ llm?: boolean, verify?: boolean, fetchUrlTool?: boolean }} options
 */
async function processRemoteEnrichBatch(dtos, options) {
  aiTrace('batch_start', {
    batchSize: dtos.length,
    llm: options.llm !== false,
    verify: options.verify === true,
    fetchUrlTool: options.fetchUrlTool === true,
  });
  if (!options.fetchUrlTool) {
    /** @type {{ ok?: boolean, error?: string, data?: { leads?: unknown[] } }} */
    const resp = await sendMessageAsync({
      type: MSG.LF_LEADS_REMOTE_ENRICH,
      leads: dtos,
      options,
    });
    if (!resp?.ok) throw new Error(resp?.error || 'Request failed');
    const returned = resp.data?.leads;
    if (!Array.isArray(returned)) throw new Error('Invalid API response');
    aiTrace('batch_done_no_fetch', { returned: returned.length });
    return returned;
  }

  await prefetchContactsIntoDtos(dtos);

  /** @type {unknown[]|undefined} */
  let messages;
  /** @type {{ tool_call_id: string, content: string }[]|undefined} */
  let toolResults;
  let toolRound = 0;
  while (true) {
    aiTrace('fetch_round_request', {
      toolRound,
      hasMessages: Array.isArray(messages),
      toolResultsCount: Array.isArray(toolResults) ? toolResults.length : 0,
    });
    /** @type {{ ok?: boolean, error?: string, data?: Record<string, unknown> }} */
    const resp = await sendMessageAsync({
      type: MSG.LF_LEADS_REMOTE_ENRICH,
      leads: dtos,
      options,
      ...(messages != null ? { messages } : {}),
      ...(toolResults != null ? { toolResults } : {}),
      toolRound,
    });
    if (!resp?.ok) throw new Error(resp?.error || 'Request failed');
    const data = resp.data || {};
    if (data.status === 'needs_fetch') {
      aiTrace('fetch_round_needs_fetch', {
        toolRound,
        fetchJobs: Array.isArray(data.fetchJobs) ? data.fetchJobs.length : 0,
        prefilledToolResults: Array.isArray(data.prefilledToolResults) ? data.prefilledToolResults.length : 0,
      });
      messages = /** @type {unknown[]} */ (data.messages);
      const merged = [
        ...(Array.isArray(data.prefilledToolResults) ? data.prefilledToolResults : []),
      ];
      for (const job of data.fetchJobs || []) {
        if (!job || typeof job !== 'object') continue;
        const url = String(job.url || '');
        const username = String(job.username || '');
        const toolCallId = String(job.toolCallId || '');
        aiTrace('fetch_job_start', { toolRound, username, url, toolCallId });
        const expanded = await fetchExpandedContactText(url);
        const pageText = expanded.mergedText.slice(0, 180000);
        const content = `USERNAME: ${username}\n${pageText}`;
        merged.push({ tool_call_id: toolCallId, content, url, username });
        aiTrace('fetch_job_done', {
          toolRound,
          username,
          url,
          ok: expanded.ok,
          fetchedUrls: expanded.fetchedUrls.length,
          chars: pageText.length,
          preview: pageText.slice(0, 120),
        });
      }
      toolResults = merged;
      toolRound += 1;
      if (toolRound > REMOTE_ENRICH_FETCH_TOOL_ROUND_HARD_CAP) {
        throw new Error('Too many fetch_url rounds (raise MEGALEADS_FETCH_TOOL_MAX_ROUNDS on Render, max 24).');
      }
      setAiStatus(tf(uiLocale, 'dashboard.aiFetchRound', { n: toolRound }));
      continue;
    }
    const returned = data.leads;
    if (!Array.isArray(returned)) throw new Error('Invalid API response');
    aiTrace('batch_done_with_fetch', {
      returned: returned.length,
      roundsUsed: toolRound,
    });
    return returned;
  }
}

/**
 * Remote LLM + optional FETCH_URL enrich; merges into `leads` storage.
 * @param {Lead[]} list
 * @param {{ llm?: boolean, verify?: boolean, fetchUrlTool?: boolean, excludeFakeEmails?: boolean }} options
 * @param {boolean} [showPostExtractionProgress] advance dashboard bar 85→100% across batches
 * @returns {Promise<{ scrapedEmailCount: number, finalEmailCount: number }>}
 */
async function runRemoteEnrichOnList(list, options, showPostExtractionProgress = false) {
  const scrapedEmailCount = countRowsWithEmail(list);
  const batches = chunkArray(list, ENRICH_BATCH_SIZE);
  aiTrace('pipeline_config', {
    leads: list.length,
    batches: batches.length,
    scrapedEmailCount,
    options,
  });
  const byKey = new Map(list.map((r) => [r.username.toLowerCase(), { ...normalizeStoredLead(r) }]));
  for (let i = 0; i < batches.length; i++) {
    aiTrace('batch_loop_start', { batchIndex: i + 1, batchTotal: batches.length, size: batches[i].length });
    setAiStatus(tf(uiLocale, 'dashboard.aiEnriching', { cur: i + 1, tot: batches.length }));
    const dtos = batches[i].map(leadToEnrichDto);
    const returned = await processRemoteEnrichBatch(dtos, options);
    aiTrace('batch_loop_response', { batchIndex: i + 1, returned: returned.length });
    for (const row of returned) {
      if (!row || typeof row !== 'object') continue;
      const k = String(row.username || '').toLowerCase();
      if (!byKey.has(k)) continue;
      const cur = byKey.get(k);
      byKey.set(k, mergeLeadFromEnrich(cur, /** @type {Record<string, unknown>} */ (row)));
    }
    if (showPostExtractionProgress) {
      applyPostExtractionAiBatchProgress(i + 1, batches.length);
    }
  }
  const order = list.map((r) => r.username.toLowerCase());
  const updatedSubset = order.map((k) => byKey.get(k)).filter(Boolean).map(normalizeStoredLead);
  leads = updatedSubset;
  await chrome.storage.local.set({ [STORAGE_KEYS.LEADS]: leads });
  renderTable();
  const finalEmailCount = countRowsWithEmail(updatedSubset);
  return { scrapedEmailCount, finalEmailCount };
}

/**
 * Content script finalizes session history before AI enrich; refresh the newest session row with current LEADS.
 */
async function patchLatestSessionHistoryWithCurrentLeads() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.SESSION_HISTORY, STORAGE_KEYS.LEADS]);
  const hist = Array.isArray(data[STORAGE_KEYS.SESSION_HISTORY]) ? [...data[STORAGE_KEYS.SESSION_HISTORY]] : [];
  if (!hist.length) return;
  const rawLeads = data[STORAGE_KEYS.LEADS] || [];
  const snapshot = rawLeads.map((r) => {
    const x = normalizeStoredLead(r);
    return {
      username: String(x.username || ''),
      followerCount: x.followerCount == null ? null : Number(x.followerCount),
      bio: String(x.bio || ''),
      email: String(x.email || ''),
      phone: String(x.phone || ''),
      websiteUrl: String(x.websiteUrl || ''),
      scrapedAt: x.scrapedAt ? String(x.scrapedAt) : '',
    };
  });
  const merged = {
    ...hist[0],
    leads: snapshot,
    totals: { ...(hist[0].totals && typeof hist[0].totals === 'object' ? hist[0].totals : {}), gathered: snapshot.length },
    updatedAt: Date.now(),
  };
  const next = [merged, ...hist.slice(1)].slice(0, SESSION_HISTORY_LIMIT);
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: next });
  sessions = next;
  renderHistory();
}

async function runPostExtractionAiEnrich() {
  aiTrace('post_extraction_ai_start');
  const runNote = document.getElementById('lfSessionRunningNote');
  if (selectedSessionId) {
    aiTrace('post_extraction_ai_abort_history');
    setRunningUi(false);
    return;
  }
  const freeGate = await canStartExtractionForFreeTier();
  if (!freeGate.ok && freeGate.reason === 'at_cap') {
    appendStatusLine(t(uiLocale, 'dashboard.enrichBlockedAtCap'));
    aiTrace('post_extraction_ai_abort_at_cap');
    setRunningUi(false);
    return;
  }
  await loadLeads();
  const list = getActiveLeads();
  if (!list.length) {
    aiTrace('post_extraction_ai_abort_no_leads');
    setRunningUi(false);
    return;
  }
  if (runNote) runNote.textContent = t(uiLocale, 'dashboard.sessionRunningNoteAi');
  const options = {
    llm: els.aiLlm ? els.aiLlm.checked : true,
    verify: false,
    fetchUrlTool: els.aiFetchUrl ? els.aiFetchUrl.checked : false,
    excludeFakeEmails: els.aiExcludeFake ? els.aiExcludeFake.checked : true,
  };
  if (els.aiEnrich) els.aiEnrich.disabled = true;
  try {
    appendStatusLine(t(uiLocale, 'dashboard.postExtractionAiStarting'));
    const { finalEmailCount } = await runRemoteEnrichOnList(list, options, true);
    await patchLatestSessionHistoryWithCurrentLeads();
    appendStatusLine(tf(uiLocale, 'dashboard.postExtractionAiDone', { n: leads.length }));
    setAiStatus('');
    showExtractionSummaryModal(finalEmailCount);
    aiTrace('post_extraction_ai_done', { finalEmailCount, leads: leads.length });
  } catch (e) {
    const msg = String(e?.message || e);
    appendStatusLine(tf(uiLocale, 'dashboard.postExtractionAiFail', { msg }));
    setAiStatus(tf(uiLocale, 'dashboard.postExtractionAiFail', { msg }));
    aiTrace('post_extraction_ai_error', { message: msg });
  } finally {
    if (els.aiEnrich) els.aiEnrich.disabled = false;
    setRunningUi(false);
    aiTrace('post_extraction_ai_end');
  }
}

async function sendJoshChat(userMessage) {
  const active = getActiveLeads();
  const payload = {
    type: MSG.LF_JOSH_CHAT,
    userMessage,
    leads: active.map(leadToEnrichDto),
    uiState: {
      filter: String(els.filter?.value || ''),
      sortKey,
      sortDir,
      selectedCount: getSelectedRows().length,
      visibleCount: getVisibleUsernames().length,
      totalCount: active.length,
    },
  };
  /** @type {{ ok?: boolean, error?: string, data?: { reply?: string, actions?: unknown[] } }} */
  const resp = await sendMessageAsync(payload);
  if (!resp?.ok) throw new Error(resp?.error || 'Josh request failed');
  const reply = String(resp?.data?.reply || '').trim();
  return { reply, notes: [] };
}

async function runRemoteEnrichPipeline() {
  aiTrace('pipeline_start_clicked');
  const freeGate = await canStartExtractionForFreeTier();
  if (!freeGate.ok && freeGate.reason === 'at_cap') {
    setAiStatus(t(uiLocale, 'dashboard.enrichBlockedAtCap'));
    appendStatusLine(t(uiLocale, 'dashboard.enrichBlockedAtCap'));
    void refreshDashboardCapBanner();
    aiTrace('pipeline_abort_at_cap');
    return;
  }
  if (selectedSessionId) {
    const line = t(uiLocale, 'dashboard.aiEnrichNeedLive');
    setAiStatus(line);
    appendStatusLine(line);
    aiTrace('pipeline_abort_history_selected');
    return;
  }
  const list = getActiveLeads();
  if (!list.length) {
    setAiStatus(t(uiLocale, 'dashboard.aiEnrichNoLeads'));
    aiTrace('pipeline_abort_no_leads');
    return;
  }
  const useLlm = els.aiLlm ? els.aiLlm.checked : true;
  const useFetchUrl = els.aiFetchUrl ? els.aiFetchUrl.checked : false;
  const excludeFakeEmails = els.aiExcludeFake ? els.aiExcludeFake.checked : true;
  const options = { llm: useLlm, verify: false, fetchUrlTool: useFetchUrl, excludeFakeEmails };
  if (els.aiEnrich) els.aiEnrich.disabled = true;
  try {
    const { scrapedEmailCount, finalEmailCount } = await runRemoteEnrichOnList(list, options);
    appendStatusLine(tf(uiLocale, 'dashboard.aiEnrichDone', { n: leads.length }));
    setAiStatus('');
    showAiSummaryModal(scrapedEmailCount, finalEmailCount);
    aiTrace('pipeline_done', {
      leadsOut: leads.length,
      finalEmailCount,
      addedEmails: Math.max(0, finalEmailCount - scrapedEmailCount),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    appendStatusLine(tf(uiLocale, 'dashboard.aiEnrichFail', { msg }));
    setAiStatus(tf(uiLocale, 'dashboard.aiEnrichFail', { msg }));
    aiTrace('pipeline_error', { message: msg });
  } finally {
    if (els.aiEnrich) els.aiEnrich.disabled = false;
    aiTrace('pipeline_end');
  }
}

/** @param {Lead[]} rows */
function toCsv(rows) {
  const L = uiLocale;
  const header = [
    t(L, 'dashboard.thUser'),
    t(L, 'dashboard.thFollowers'),
    t(L, 'dashboard.thBio'),
    t(L, 'dashboard.thEmail'),
    t(L, 'dashboard.thPhone'),
    t(L, 'dashboard.thWebsite'),
    t(L, 'dashboard.thScraped'),
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      r.username,
      r.followerCount == null ? '' : String(r.followerCount),
      r.bio || '',
      r.email || '',
      r.phone || '',
      r.websiteUrl || '',
      r.scrapedAt || '',
    ].map((c) => {
      const s = String(c).replace(/"/g, '""');
      if (/[",\n]/.test(s)) return `"${s}"`;
      return s;
    });
    lines.push(cells.join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

/** @param {Lead[]} rows */
function toCsvEmails(rows) {
  const L = uiLocale;
  const header = [t(L, 'dashboard.thUser'), t(L, 'dashboard.thEmail'), t(L, 'dashboard.thPhone')];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [r.username, r.email || '', r.phone || ''].map((c) => {
      const s = String(c).replace(/"/g, '""');
      if (/[",\n]/.test(s)) return `"${s}"`;
      return s;
    });
    lines.push(cells.join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

async function copySelected() {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const target = rows.length ? rows : active;
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingCopy'));
    return;
  }
  const text = target
    .map(
      (r) =>
        `${r.username}\t${fmtFollowers(r.followerCount)}\t${r.bio || ''}\t${r.email || ''}\t${r.phone || ''}\t${r.websiteUrl || ''}`,
    )
    .join('\n');
  try {
    await navigator.clipboard.writeText(text);
    appendStatusLine(tf(uiLocale, 'dashboard.copied', { n: target.length }));
  } catch {
    appendStatusLine(t(uiLocale, 'dashboard.clipboardFail'));
  }
}

async function doExportProfiles(/** @type {'xlsx'|'csv'} */ format) {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const target = rows.length ? rows : active;
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingExport'));
    return;
  }
  if (format === 'csv') {
    const fname = await buildExportFilename('csv', 'profiles');
    const csv = toCsv(target);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    appendStatusLine(tf(uiLocale, 'dashboard.exportedCsv', { n: target.length, f: fname }));
    return;
  }
  const X = typeof globalThis !== 'undefined' && globalThis.XLSX;
  if (!X || typeof X.utils?.json_to_sheet !== 'function' || typeof X.writeFile !== 'function') {
    appendStatusLine(t(uiLocale, 'dashboard.excelFallback'));
    await doExportProfiles('csv');
    return;
  }
  const L = uiLocale;
  const data = target.map((r) => {
    return {
      [t(L, 'dashboard.thUser')]: r.username,
      [t(L, 'dashboard.thFollowers')]: r.followerCount == null ? '' : r.followerCount,
      [t(L, 'dashboard.thBio')]: r.bio || '',
      [t(L, 'dashboard.thEmail')]: r.email || '',
      [t(L, 'dashboard.thPhone')]: r.phone || '',
      [t(L, 'dashboard.thWebsite')]: r.websiteUrl || '',
      [t(L, 'dashboard.thScraped')]: r.scrapedAt || '',
    };
  });
  const ws = X.utils.json_to_sheet(data);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, t(L, 'dashboard.excelSheetProfiles'));
  const fname = await buildExportFilename('xlsx', 'profiles');
  X.writeFile(wb, fname);
  appendStatusLine(tf(uiLocale, 'dashboard.exportedXlsx', { n: target.length, f: fname }));
}

async function doExportEmails(/** @type {'xlsx'|'csv'} */ format) {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const base = rows.length ? rows : active;
  const target = base.filter((r) => String(r.email || '').trim().length > 0);
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingExportEmails'));
    return;
  }
  if (format === 'csv') {
    const fname = await buildExportFilename('csv', 'emails');
    const csv = toCsvEmails(target);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    appendStatusLine(tf(uiLocale, 'dashboard.exportedCsv', { n: target.length, f: fname }));
    return;
  }
  const X = typeof globalThis !== 'undefined' && globalThis.XLSX;
  if (!X || typeof X.utils?.json_to_sheet !== 'function' || typeof X.writeFile !== 'function') {
    appendStatusLine(t(uiLocale, 'dashboard.excelFallback'));
    await doExportEmails('csv');
    return;
  }
  const L = uiLocale;
  const data = target.map((r) => ({
    [t(L, 'dashboard.thUser')]: r.username,
    [t(L, 'dashboard.thEmail')]: r.email || '',
    [t(L, 'dashboard.thPhone')]: r.phone || '',
  }));
  const ws = X.utils.json_to_sheet(data);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, t(L, 'dashboard.excelSheetEmails'));
  const fname = await buildExportFilename('xlsx', 'emails');
  X.writeFile(wb, fname);
  appendStatusLine(tf(uiLocale, 'dashboard.exportedXlsxEmails', { n: target.length, f: fname }));
}

function syncHistoryPanelAria() {
  if (!els.historyToggle || !els.historyShell || !els.historyBody) return;
  const open = els.historyShell.classList.contains('lf-history-expanded');
  els.historyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  const L = uiLocale;
  els.historyToggle.setAttribute(
    'title',
    open ? t(L, 'dashboard.historyToggleCollapse') : t(L, 'dashboard.historyToggleExpand'),
  );
  els.historyToggle.setAttribute(
    'aria-label',
    open ? t(L, 'dashboard.historyToggleCollapse') : t(L, 'dashboard.historyToggleExpand'),
  );
}

async function clearList() {
  if (selectedSessionId) {
    if (!confirm(t(uiLocale, 'dashboard.confirmRemoveSession'))) return;
    const next = sessions.filter((s) => s.id !== selectedSessionId);
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: next });
    selectedSessionId = '';
    sessions = next;
    renderHistory();
    renderTable();
    appendStatusLine(t(uiLocale, 'dashboard.historyRemoved'));
    return;
  }
  if (!leads.length) return;
  if (!confirm(t(uiLocale, 'dashboard.confirmClear'))) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.LEADS]: [] });
  leads = [];
  renderTable();
  appendStatusLine(t(uiLocale, 'dashboard.listCleared'));
}

function onRuntimeMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === MSG.PROGRESS) {
    applyProgressFromMessage(msg);
    void loadLeads();
  }
  if (msg.type === MSG.LOG && msg.line) {
    appendStatusLine(msg.line);
  }
  if (msg.type === MSG.COMPLETE) {
    /** Leave `running` true until post-extraction AI finishes (do not call setRunningUi(false) here). */
    void loadLeads().then(() => void runPostExtractionAiEnrich());
  }
  if (msg.type === MSG.ERROR) {
    setRunningUi(false);
    appendStatusLine(
      `${t(uiLocale, 'dashboard.errorPrefix')} ${msg.message || 'Unknown'}`,
    );
  }
}

function appendJoshMessage(role, text) {
  if (!els.joshThoughtMessages) return;
  const div = document.createElement('div');
  div.className = `lf-josh-msg ${role}`;
  div.textContent = `${role === 'user' ? 'You' : 'Josh'}: ${text}`;
  els.joshThoughtMessages.appendChild(div);
  els.joshThoughtMessages.scrollTop = els.joshThoughtMessages.scrollHeight;
}

function isJoshChatOpen() {
  return Boolean(els.joshThoughtChat && !els.joshThoughtChat.classList.contains('hidden'));
}

function clearJoshBubbleTimers() {
  for (const id of joshBubbleTimers) clearTimeout(id);
  joshBubbleTimers = [];
}

/** @param {() => void} fn @param {number} delay */
function scheduleJoshBubble(fn, delay) {
  const id = setTimeout(() => {
    joshBubbleTimers = joshBubbleTimers.filter((t) => t !== id);
    fn();
  }, delay);
  joshBubbleTimers.push(id);
}

function setJoshThoughtBubbleHidden(hidden) {
  if (!els.joshThoughtSimple) return;
  els.joshThoughtSimple.classList.toggle('lf-josh-thought-bubble-hidden', hidden);
  if (els.joshAvatarThought) {
    els.joshAvatarThought.tabIndex = hidden ? -1 : 0;
  }
}

function stopJoshBubbleRotation() {
  clearJoshBubbleTimers();
  if (els.joshAvatarThought) els.joshAvatarThought.textContent = '';
  setJoshThoughtBubbleHidden(true);
}

function getJoshBubbleLines() {
  return [t(uiLocale, 'dashboard.joshBubbleLineDrag'), t(uiLocale, 'dashboard.joshBubbleLineMegaLeadsHelp')].filter(
    Boolean,
  );
}

function runJoshBubbleIdlePhase() {
  if (!els.joshAvatarThought || !els.joshThoughtSimple || !els.joshThoughtWrap) return;
  if (isJoshChatOpen()) return;
  els.joshAvatarThought.textContent = '';
  setJoshThoughtBubbleHidden(true);
  scheduleJoshBubble(() => runJoshBubbleShowPhase(), JOSH_BUBBLE_IDLE_MS);
}

function runJoshBubbleShowPhase() {
  if (!els.joshAvatarThought || !els.joshThoughtSimple || !els.joshThoughtWrap) return;
  if (isJoshChatOpen()) return;
  const lines = getJoshBubbleLines();
  if (!lines.length) return;
  const line = lines[joshBubbleMessageIndex % lines.length];
  els.joshAvatarThought.textContent = line;
  requestAnimationFrame(() => {
    if (isJoshChatOpen()) return;
    setJoshThoughtBubbleHidden(false);
  });
  scheduleJoshBubble(() => runJoshBubbleHidePhase(), JOSH_BUBBLE_DISPLAY_MS);
}

function runJoshBubbleHidePhase() {
  if (isJoshChatOpen()) return;
  setJoshThoughtBubbleHidden(true);
  scheduleJoshBubble(() => {
    joshBubbleMessageIndex = (joshBubbleMessageIndex + 1) % 2;
    runJoshBubbleIdlePhase();
  }, JOSH_BUBBLE_FADE_MS);
}

function startJoshBubbleRotation() {
  clearJoshBubbleTimers();
  if (!els.joshAvatarThought || !els.joshThoughtSimple) return;
  runJoshBubbleIdlePhase();
}

function restartJoshBubbleRotationFromSimpleView() {
  if (isJoshChatOpen()) return;
  startJoshBubbleRotation();
}

/** @param {{ resumeBubble?: boolean }} [opts] */
function showJoshSimple(opts = {}) {
  const resumeBubble = opts.resumeBubble !== false;
  if (!els.joshThoughtSimple || !els.joshThoughtChat) return;
  els.joshThoughtSimple.classList.remove('hidden');
  els.joshThoughtChat.classList.add('hidden');
  if (resumeBubble) restartJoshBubbleRotationFromSimpleView();
}

function showJoshChat() {
  if (!els.joshThoughtSimple || !els.joshThoughtChat) return;
  stopJoshBubbleRotation();
  els.joshThoughtSimple.classList.add('hidden');
  els.joshThoughtChat.classList.remove('hidden');
  if (els.joshThoughtChatInput) els.joshThoughtChatInput.focus();
}

function spawnJoshSparkle(x, y) {
  const el = document.createElement('span');
  el.className = 'lf-josh-sparkle';
  const jitterX = (Math.random() - 0.5) * 20;
  const jitterY = (Math.random() - 0.5) * 20;
  const size = 5 + Math.random() * 8;
  el.style.left = `${x + jitterX}px`;
  el.style.top = `${y + jitterY}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 650);
}

function initJoshDrag() {
  const wrap = els.joshAvatar;
  if (!wrap) return;
  let startX = 0;
  let startY = 0;
  let left = 0;
  let top = 0;
  let dragging = false;
  let pointerId = -1;
  let sparkleAt = 0;
  function onPointerDown(ev) {
    if (
      ev.target instanceof HTMLElement &&
      ev.target.closest('button,input,.lf-josh-thought-chat,.lf-josh-avatar-thought,.lf-josh-thought-simple')
    ) {
      return;
    }
    ev.preventDefault();
    const r = wrap.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    left = r.left;
    top = r.top;
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    dragging = true;
    pointerId = ev.pointerId;
    wrap.setPointerCapture(pointerId);
  }
  function onPointerMove(ev) {
    if (!dragging || ev.pointerId !== pointerId) return;
    ev.preventDefault();
    const nextLeft = Math.max(6, Math.min(window.innerWidth - wrap.offsetWidth - 6, left + (ev.clientX - startX)));
    const nextTop = Math.max(6, Math.min(window.innerHeight - wrap.offsetHeight - 6, top + (ev.clientY - startY)));
    wrap.style.left = `${nextLeft}px`;
    wrap.style.top = `${nextTop}px`;
    const now = Date.now();
    if (now - sparkleAt >= 35) {
      sparkleAt = now;
      const r = wrap.getBoundingClientRect();
      spawnJoshSparkle(r.left + r.width * 0.5, r.top + r.height * 0.85);
      if (Math.random() > 0.55) spawnJoshSparkle(r.left + r.width * 0.3, r.top + r.height * 0.6);
    }
  }
  function onPointerUp(ev) {
    if (ev.pointerId !== pointerId) return;
    dragging = false;
    pointerId = -1;
  }
  wrap.addEventListener('dragstart', (ev) => ev.preventDefault());
  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', onPointerUp);
  wrap.addEventListener('pointercancel', onPointerUp);
}

async function onJoshSend() {
  const input = els.joshThoughtChatInput;
  if (!input || joshSending) return;
  const text = String(input.value || '').trim();
  if (!text) return;
  joshSending = true;
  input.value = '';
  appendJoshMessage('user', text);
  appendJoshMessage('bot', t(uiLocale, 'dashboard.joshTyping'));
  try {
    const { reply } = await sendJoshChat(text);
    if (els.joshThoughtMessages?.lastElementChild) {
      els.joshThoughtMessages.lastElementChild.remove();
    }
    appendJoshMessage('bot', reply || t(uiLocale, 'dashboard.joshNetworkError'));
  } catch (e) {
    if (els.joshThoughtMessages?.lastElementChild) {
      els.joshThoughtMessages.lastElementChild.remove();
    }
    const msg = String(e?.message || '').trim();
    appendJoshMessage('bot', msg || t(uiLocale, 'dashboard.joshNetworkError'));
  } finally {
    joshSending = false;
  }
}

function closeAccountModals() {
  const usage = document.getElementById('lfAccountUsageWrap');
  if (usage) usage.hidden = true;
}

async function refreshDashboardCapBanner() {
  const el = document.getElementById('lfDashboardCapBanner');
  const gate = await canStartExtractionForFreeTier();
  const atCap = !gate.ok && gate.reason === 'at_cap';
  if (el) {
    if (atCap) {
      el.textContent = tf(uiLocale, 'dashboard.capBanner', { cap: FREE_EMAIL_EXTRACTION_CAP });
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }
  if (els.sessionStop && !running) {
    els.sessionStop.disabled = atCap;
  } else   if (els.sessionStop && running) {
    els.sessionStop.disabled = false;
  }
}

async function refreshDashboardHeaderProgress() {
  const wrap = document.getElementById('lfDashboardHeaderProgressWrap');
  const paidTitle = document.getElementById('lfDashboardPaidTitle');
  const label = document.getElementById('lfDashboardFreeTierLabel');
  const countEl = document.getElementById('lfDashboardHeaderProgressCount');
  const fill = document.getElementById('lfDashboardHeaderProgressFill');
  const bar = document.getElementById('lfDashboardHeaderProgressBar');
  const upgradeBtn = els.dashboardUpgrade || document.getElementById('lfDashboardUpgrade');
  const crown = document.getElementById('lfDashboardAccountCrown');
  const joshCrown = document.getElementById('lfJoshCrown');
  if (!wrap || !countEl || !fill || !bar) return;
  const unlimited = await readSubscriptionUnlimited();
  if (unlimited) {
    wrap.hidden = true;
    if (paidTitle) {
      paidTitle.hidden = false;
      paidTitle.textContent = t(uiLocale, 'dashboard.unlimitedIgEmailExtraction');
    }
    if (crown) crown.hidden = false;
    if (joshCrown) joshCrown.hidden = false;
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
    if (joshCrown) joshCrown.hidden = true;
    if (upgradeBtn instanceof HTMLElement) {
      upgradeBtn.hidden = false;
      upgradeBtn.style.display = '';
    }
    return;
  }
  if (upgradeBtn instanceof HTMLElement) {
    upgradeBtn.hidden = false;
    upgradeBtn.style.display = '';
  }
  if (paidTitle) paidTitle.hidden = true;
  if (crown) crown.hidden = true;
  if (joshCrown) joshCrown.hidden = true;
  wrap.hidden = false;
  if (label) label.textContent = t(uiLocale, 'dashboard.freeTierEmailsLabel');
  wrap.setAttribute('aria-label', t(uiLocale, 'dashboard.headerProgressAria'));
  const count = await readEffectiveUsageCount();
  const cap = FREE_EMAIL_EXTRACTION_CAP;
  bar.classList.remove('is-at-cap', 'is-unlimited');
  const pct = Math.min(100, (count / cap) * 100);
  countEl.textContent = tf(uiLocale, 'dashboard.headerEmailsProgress', { count, cap });
  fill.style.width = `${pct}%`;
  if (count >= cap) bar.classList.add('is-at-cap');
}

function syncAccountModalLocale() {
  const L = uiLocale;
  const q = (id) => document.getElementById(id);
  const setText = (id, path) => {
    const el = q(id);
    if (el) el.textContent = t(L, path);
  };
  setText('lfAccountUsageTitle', 'dashboard.accountUsageTitle');
  const diamond = q('lfAccountStripeDiamond');
  if (diamond) diamond.setAttribute('aria-label', t(L, 'dashboard.ariaCheckoutDiamond'));
  const dlab = q('lfAccountStripeDiamondLabel');
  if (dlab) dlab.textContent = t(L, 'dashboard.accountCheckoutDiamond');
  const lo = q('lfAccountUsageLogout');
  if (lo) lo.textContent = t(L, 'dashboard.accountLogout');
  const manage = q('lfManageSubscription');
  if (manage) manage.textContent = t(L, 'dashboard.manageSubscription');
  const ucls = q('lfAccountUsageClose');
  if (ucls) ucls.textContent = t(L, 'dashboard.accountClose');
  if (els.dashboardAccountBtn) {
    els.dashboardAccountBtn.title = t(L, 'dashboard.accountHeaderTitle');
    els.dashboardAccountBtn.setAttribute('aria-label', t(L, 'dashboard.ariaAccount'));
  }
}

async function openUsageAccountModal() {
  closeAccountModals();
  const w = document.getElementById('lfAccountUsageWrap');
  if (!w) return;
  const session = await readUserSession();
  if (!session) {
    await redirectToSignupFromDashboard();
    return;
  }
  syncAccountModalLocale();
  const L = uiLocale;
  const unlimited = await readSubscriptionUnlimited();
  const titleEl = document.getElementById('lfAccountUsageTitle');
  const signed = document.getElementById('lfAccountUsageSignedIn');
  const cntEl = document.getElementById('lfAccountUsageCount');
  const note = document.getElementById('lfAccountUsageCapNote');
  const atCap = document.getElementById('lfAccountUsageAtCap');
  const barWrap = w.querySelector('.lf-account-usage-bar-wrap');
  const ctaRow = w.querySelector('.lf-account-usage-cta-row');
  const manageBtn = document.getElementById('lfManageSubscription');

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
    cntEl.textContent = tf(L, 'dashboard.accountUsageCount', { count });
    const cap = FREE_EMAIL_EXTRACTION_CAP;
    const pct = Math.min(100, (count / cap) * 100);
    const barFill = document.getElementById('lfAccountUsageBarFill');
    if (barFill) barFill.style.width = `${pct}%`;
    const barLab = document.getElementById('lfAccountUsageBarLabel');
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

async function onDashboardAccountButtonClick() {
  const session = await readUserSession();
  if (!session) {
    await redirectToSignupFromDashboard();
    return;
  }
  await openUsageAccountModal();
}

async function consumePendingAccountModal() {
  const key = STORAGE_KEYS.DASHBOARD_PENDING_ACCOUNT;
  const { [key]: pend } = await chrome.storage.local.get(key);
  if (pend === 'usage') {
    await chrome.storage.local.remove(key);
    await openUsageAccountModal();
  }
}

function wireAccountModals() {
  const usageWrap = document.getElementById('lfAccountUsageWrap');
  if (usageWrap) {
    usageWrap.addEventListener('click', (ev) => {
      if (ev.target === usageWrap) closeAccountModals();
    });
    const usageCard = usageWrap.querySelector('.lf-account-modal');
    if (usageCard) usageCard.addEventListener('click', (ev) => ev.stopPropagation());
  }
  const closeU = document.getElementById('lfAccountUsageClose');
  if (closeU) closeU.addEventListener('click', () => closeAccountModals());
  const out = document.getElementById('lfAccountUsageLogout');
  if (out) out.addEventListener('click', () => void onAccountLogoutClick());
  const manage = document.getElementById('lfManageSubscription');
  if (manage) manage.addEventListener('click', () => void onManageSubscriptionClick());
  const diamond = document.getElementById('lfAccountStripeDiamond');
  if (diamond) diamond.addEventListener('click', () => void onStripeDiamondClick());
}

async function onAccountLogoutClick() {
  await clearUserSession();
  closeAccountModals();
}

async function onStripeDiamondClick() {
  const r = await openStripeCheckoutInNewTab();
  if (!r.ok) appendStatusLine(t(uiLocale, 'dashboard.stripeMissing'));
}

async function onManageSubscriptionClick() {
  const r = await openManageSubscriptionInNewTab();
  if (!r.ok) appendStatusLine(t(uiLocale, 'dashboard.manageSubscriptionMissing'));
}

function wireEvents() {
  wireAccountModals();
  wireExportFormatModal();
  if (els.dashboardAccountBtn) {
    els.dashboardAccountBtn.addEventListener('click', () => void onDashboardAccountButtonClick());
  }

  els.filter.addEventListener('input', () => renderTable());

  els.copy.addEventListener('click', () => void copySelected());
  els.exportProfiles.addEventListener('click', () => tryOpenExportFormatModal('profiles'));
  els.exportEmails.addEventListener('click', () => tryOpenExportFormatModal('emails'));
  if (els.aiEnrich) els.aiEnrich.addEventListener('click', () => void runRemoteEnrichPipeline());
  if (els.aiSummaryOk) els.aiSummaryOk.addEventListener('click', closeAiSummaryModal);
  if (els.aiSummaryWrap) {
    els.aiSummaryWrap.addEventListener('click', (ev) => {
      if (ev.target === els.aiSummaryWrap) closeAiSummaryModal();
    });
  }
  els.clear.addEventListener('click', () => void clearList());
  if (els.historyToggle && els.historyShell && els.historyBody) {
    els.historyBody.hidden = true;
    els.historyShell.classList.remove('lf-history-expanded');
    syncHistoryPanelAria();
    els.historyToggle.addEventListener('click', () => {
      els.historyShell.classList.toggle('lf-history-expanded');
      const open = els.historyShell.classList.contains('lf-history-expanded');
      els.historyBody.hidden = !open;
      syncHistoryPanelAria();
    });
  }
  if (els.historyList) {
    els.historyList.addEventListener('click', (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target.closest('[data-session-id]') : null;
      if (!target) return;
      selectedSessionId = target.getAttribute('data-session-id') || '';
      renderHistory();
      renderTable();
    });
  }
  if (els.historyClear) {
    els.historyClear.addEventListener('click', async () => {
      if (!confirm(t(uiLocale, 'dashboard.confirmClearHistory'))) return;
      sessions = [];
      selectedSessionId = '';
      await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_HISTORY]: [] });
      renderHistory();
      renderTable();
      appendStatusLine(t(uiLocale, 'dashboard.historyCleared'));
    });
  }

  els.selectAll.addEventListener('change', () => {
    const on = els.selectAll.checked;
    els.tableBody.querySelectorAll('.lf-row-check').forEach((c) => {
      if (c instanceof HTMLInputElement) c.checked = on;
    });
  });

  if (els.langToggle) {
    els.langToggle.hidden = true;
    els.langToggle.setAttribute('aria-hidden', 'true');
  }

  els.themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('lf-dark');
    syncThemeToggleUi();
    void savePrefsUi();
  });

  if (els.dashboardUpgrade) {
    els.dashboardUpgrade.addEventListener('click', () => {
      void (async () => {
        const r = await openStripeCheckoutInNewTab();
        if (!r.ok) appendStatusLine(t(uiLocale, 'dashboard.stripeMissing'));
      })();
    });
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const pend = changes[STORAGE_KEYS.DASHBOARD_PENDING_ACCOUNT];
    if (pend?.newValue === 'usage') {
      void chrome.storage.local.remove(STORAGE_KEYS.DASHBOARD_PENDING_ACCOUNT);
      void openUsageAccountModal();
    }
    const uiNext = changes[STORAGE_KEYS.UI_PREFS]?.newValue;
    if (uiNext && typeof uiNext === 'object') {
      const next = uiLocaleFromUiPrefs(uiNext);
      if (next !== uiLocale) {
        uiLocale = next;
        applyDashboardLocale();
      }
    }
    if (changes[STORAGE_KEYS.LEADS]) {
      leads = (changes[STORAGE_KEYS.LEADS].newValue || []).map(normalizeStoredLead);
      renderTable();
    }
    if (changes[STORAGE_KEYS.SESSION_HISTORY]) {
      sessions = changes[STORAGE_KEYS.SESSION_HISTORY].newValue || [];
      syncSessionBar(lastSessionRs);
      renderHistory();
      renderTable();
    }
    if (changes[STORAGE_KEYS.RUN_STATE]) {
      const rs = changes[STORAGE_KEYS.RUN_STATE].newValue;
      if (rs?.running) setRunningUi(true);
      else if (rs && rs.running === false) {
        setRunningUi(false);
        void refreshDashboardCapBanner();
        void refreshDashboardHeaderProgress();
      }
      syncSessionBar(rs);
      syncExportButtonLabels();
      if (typeof rs?.lastStatusLine === 'string') appendStatusLine(rs.lastStatusLine);
      if (typeof rs?.sourceTransition === 'string' && rs.sourceTransition) appendStatusLine(rs.sourceTransition);
      const metricsLine = metricsStatusLine(rs);
      if (metricsLine) appendStatusLine(metricsLine);
      if (rs && rs.running === false && rs.stopReason) {
        const line = stopReasonText(rs.stopReason);
        if (line) appendStatusLine(line);
      }
    }
    if (
      changes[STORAGE_KEYS.LEADS] ||
      changes[STORAGE_KEYS.SESSION_HISTORY] ||
      changes[STORAGE_KEYS.SUBSCRIPTION] ||
      changes[STORAGE_KEYS.USER_SESSION]
    ) {
      void refreshDashboardCapBanner();
      void refreshDashboardHeaderProgress();
    }
  });

  if (els.sessionStop) {
    els.sessionStop.addEventListener('click', () => void onDashboardRunToggleClick());
  }

  if (els.joshThoughtSimple) {
    els.joshThoughtSimple.addEventListener('click', (ev) => {
      if (els.joshThoughtSimple.classList.contains('lf-josh-thought-bubble-hidden')) return;
      if ((ev.target instanceof HTMLElement && ev.target.closest('.lf-josh-thought-chat')) || isJoshChatOpen()) {
        return;
      }
      showJoshChat();
    });
  }
  if (els.joshAvatarThought) {
    els.joshAvatarThought.addEventListener('keydown', (ev) => {
      if (els.joshThoughtSimple?.classList.contains('lf-josh-thought-bubble-hidden')) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        showJoshChat();
      }
    });
  }
  if (els.joshAvatarHelp) {
    els.joshAvatarHelp.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showJoshChat();
    });
  }
  if (els.joshThoughtClose) els.joshThoughtClose.addEventListener('click', () => showJoshSimple());
  if (els.joshThoughtChatSend) els.joshThoughtChatSend.addEventListener('click', () => void onJoshSend());
  if (els.joshThoughtChatInput) {
    els.joshThoughtChatInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void onJoshSend();
      }
    });
  }
  if (els.joshAvatar) {
    document.addEventListener('mousedown', (ev) => {
      if (!els.joshAvatar.contains(/** @type {Node} */ (ev.target))) showJoshSimple();
    });
  }
}

async function init() {
  const session = await readUserSession();
  if (!session) {
    await redirectToSignupFromDashboard();
    return;
  }
  void notifyServerAccountRegistered(session.email);
  const sp = new URLSearchParams(window.location.search);
  const wantsAdmin = sp.get('admin') === '1';
  if (session.isAdmin || wantsAdmin) {
    await initAdminDashboard(session);
    return;
  }
  void syncSubscriptionFromServer();

  bindEls();
  await loadPrefsUi();

  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  syncSessionBar(rs);
  if (rs?.running) setRunningUi(true);

  await loadLeads();
  await loadSessionHistory();
  wireTableSort();
  wireEvents();
  await consumePendingAccountModal();
  await refreshDashboardCapBanner();
  await refreshDashboardHeaderProgress();
  initJoshDrag();
  if (els.joshAvatar) {
    setTimeout(() => {
      els.joshAvatar?.classList.add('lf-josh-visible');
      startJoshBubbleRotation();
    }, 3000);
  }
  showJoshSimple({ resumeBubble: false });
  appendJoshMessage('bot', t(uiLocale, 'dashboard.joshWelcome'));
}

void init();
