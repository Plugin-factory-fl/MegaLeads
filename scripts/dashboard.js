/**
 * LeadFlow — full-tab dashboard: progress, log, results (controls in popup).
 */

import { MSG, STORAGE_KEYS } from './constants.js';
import { buildScrapePayloadFromUiPrefs } from './scrape-payload.js';
import { extractEmailPhoneFromParts } from './selectors.js';
import { t, tf, translateSessionMode, uiLocaleFromUiPrefs } from './i18n.js';

/** Max rows per POST to the enrich API (must be ≤ server cap). */
const ENRICH_BATCH_SIZE = 40;

/** @typedef {{ username: string, followerCount: number|null, bio: string, email: string, phone: string, websiteUrl: string, scrapedAt?: string, contact?: string, segment_primary?: string, segment_tags?: string[], enrich_notes?: string, email_confidence_0_1?: number, email_action?: string, email_deliverability?: string, email_verify_reason?: string, email_quality_codes?: string[] }} Lead */

/** Server → stored lead fields (additive). */
const ENRICH_KEYS_FROM_API = [
  'email',
  'segment_primary',
  'segment_tags',
  'enrich_notes',
  'email_confidence_0_1',
  'email_action',
  'email_deliverability',
  'email_verify_reason',
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

/** @typedef {'en' | 'it'} Locale */

/** @type {Locale} */
let uiLocale = 'it';

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
  sheetsHint: null,
  openSheets: null,
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
  els.sheetsHint = document.getElementById('lfSheetsHint');
  els.openSheets = document.getElementById('lfOpenSheets');
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
}

/** @param {Record<string, unknown> | undefined} rs */
function syncSessionBar(rs) {
  lastSessionRs = rs;
  const L = uiLocale;
  const locStr = L === 'it' ? 'it-IT' : 'en-US';
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
      locale: uiLocale,
      preferEnglish: uiLocale === 'en',
      theme: document.documentElement.classList.contains('lf-dark') ? 'dark' : 'light',
    },
  });
}

function applyDashboardLocale() {
  const L = uiLocale;
  document.documentElement.lang = L === 'it' ? 'it' : 'en';
  document.title = t(L, 'dashboard.title');
  const ver = document.querySelector('.lf-version');
  if (ver) ver.textContent = t(L, 'dashboard.version');
  if (els.langToggle) {
    els.langToggle.textContent = t(L, 'dashboard.langSwitch');
    els.langToggle.setAttribute(
      'title',
      L === 'en' ? t(L, 'dashboard.langSwitchToIt') : t(L, 'dashboard.langSwitchToEn'),
    );
    els.langToggle.setAttribute(
      'aria-label',
      L === 'en' ? t(L, 'dashboard.langSwitchToIt') : t(L, 'dashboard.langSwitchToEn'),
    );
  }
  syncThemeToggleUi();
  const hint = document.querySelector('.lf-dashboard-hint');
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
  if (els.aiEnrich) els.aiEnrich.textContent = t(L, 'dashboard.aiEnrichRun');
  if (els.openSheets) els.openSheets.textContent = t(L, 'dashboard.openSheets');

  const thMap = {
    username: 'dashboard.thUser',
    followerCount: 'dashboard.thFollowers',
    bio: 'dashboard.thBio',
    email: 'dashboard.thEmail',
    phone: 'dashboard.thPhone',
    websiteUrl: 'dashboard.thWebsite',
    segment_primary: 'dashboard.thSegment',
    email_deliverability: 'dashboard.thEmailQa',
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
}

function toggleDashboardLocale() {
  uiLocale = uiLocale === 'it' ? 'en' : 'it';
  applyDashboardLocale();
  void savePrefsUi();
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
  const locStr = L === 'it' ? 'it-IT' : 'en-US';
  if (msg.phase === 'enrich' && msg.enrichTotal > 0) {
    const cur = Math.max(0, Number(msg.enrichCurrent) || 0);
    const tot = Number(msg.enrichTotal) || 1;
    els.progressBar.classList.add('lf-progress-determinate');
    const pct = Math.min(100, (100 * cur) / tot);
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
  const locStr = uiLocale === 'it' ? 'it-IT' : 'en-US';
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
        (r.websiteUrl && r.websiteUrl.toLowerCase().includes(q)) ||
        (r.segment_primary && String(r.segment_primary).toLowerCase().includes(q)) ||
        (Array.isArray(r.segment_tags) &&
          r.segment_tags.join(' ').toLowerCase().includes(q)) ||
        (r.enrich_notes && String(r.enrich_notes).toLowerCase().includes(q)) ||
        (r.email_deliverability && String(r.email_deliverability).toLowerCase().includes(q)),
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
    els.tableBody.innerHTML = `<tr class="lf-empty-row"><td colspan="9" class="lf-empty-msg">${emptyEsc}</td></tr>`;
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
      const seg = (r.segment_primary || '').trim();
      const tags = Array.isArray(r.segment_tags) ? r.segment_tags.join(', ') : '';
      const segTitle = escapeHtml([seg, tags].filter(Boolean).join(' · ').slice(0, 500));
      const segCell = seg ? escapeHtml(truncate(seg, 28)) : '—';
      const del = String(r.email_deliverability || '').trim().toLowerCase();
      const qaParts = [
        r.email_action && `action: ${r.email_action}`,
        del && `deliverability: ${del}`,
        r.email_verify_reason && `verify: ${r.email_verify_reason}`,
        r.enrich_notes && String(r.enrich_notes).slice(0, 400),
      ].filter(Boolean);
      const qaTitle = escapeHtml(qaParts.join(' | '));
      const qaCell = del ? escapeHtml(del) : '—';
      return `<tr data-user="${escapeHtml(r.username)}">
        <td><input type="checkbox" class="lf-row-check" /></td>
        <td><a href="${ig}" target="_blank" rel="noreferrer">${escapeHtml(r.username)}</a></td>
        <td>${escapeHtml(fmtFollowers(r.followerCount))}</td>
        <td class="lf-bio-cell" title="${bioFull}">${bioShort}</td>
        <td>${escapeHtml(r.email || '')}</td>
        <td>${escapeHtml(r.phone || '')}</td>
        <td>${webCell}</td>
        <td class="lf-seg-cell" title="${segTitle}">${segCell}</td>
        <td class="lf-qa-cell" title="${qaTitle}">${qaCell}</td>
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

/**
 * One enrich batch: optional multi-round fetch_url tool (extension fetches HTML).
 * @param {ReturnType<typeof leadToEnrichDto>[]} dtos
 * @param {{ llm?: boolean, verify?: boolean, fetchUrlTool?: boolean }} options
 */
async function processRemoteEnrichBatch(dtos, options) {
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
    return returned;
  }

  /** @type {unknown[]|undefined} */
  let messages;
  /** @type {{ tool_call_id: string, content: string }[]|undefined} */
  let toolResults;
  let toolRound = 0;
  while (true) {
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
      messages = /** @type {unknown[]} */ (data.messages);
      const merged = [
        ...(Array.isArray(data.prefilledToolResults) ? data.prefilledToolResults : []),
      ];
      for (const job of data.fetchJobs || []) {
        if (!job || typeof job !== 'object') continue;
        const url = String(job.url || '');
        const toolCallId = String(job.toolCallId || '');
        /** @type {{ bridgeOk?: boolean, text?: string, error?: string }} */
        const r = await sendMessageAsync({ type: MSG.HTTP_TEXT_FETCH, url });
        const text =
          r?.bridgeOk && typeof r.text === 'string'
            ? r.text.slice(0, 80000)
            : `Fetch error: ${(r && r.error) || 'unknown'}`;
        merged.push({ tool_call_id: toolCallId, content: text });
      }
      toolResults = merged;
      toolRound += 1;
      if (toolRound > 22) throw new Error('Too many fetch_url rounds');
      setAiStatus(tf(uiLocale, 'dashboard.aiFetchRound', { n: toolRound }));
      continue;
    }
    const returned = data.leads;
    if (!Array.isArray(returned)) throw new Error('Invalid API response');
    return returned;
  }
}

async function runRemoteEnrichPipeline() {
  if (selectedSessionId) {
    const line = t(uiLocale, 'dashboard.aiEnrichNeedLive');
    setAiStatus(line);
    appendStatusLine(line);
    return;
  }
  const list = getActiveLeads();
  if (!list.length) {
    setAiStatus(t(uiLocale, 'dashboard.aiEnrichNoLeads'));
    return;
  }
  if (els.aiEnrich) els.aiEnrich.disabled = true;
  const useLlm = els.aiLlm ? els.aiLlm.checked : true;
  const useVerify = els.aiVerify ? els.aiVerify.checked : false;
  const useFetchUrl = els.aiFetchUrl ? els.aiFetchUrl.checked : false;
  const options = { llm: useLlm, verify: useVerify, fetchUrlTool: useFetchUrl };
  const batches = chunkArray(list, ENRICH_BATCH_SIZE);
  const byKey = new Map(list.map((r) => [r.username.toLowerCase(), { ...normalizeStoredLead(r) }]));
  try {
    for (let i = 0; i < batches.length; i++) {
      setAiStatus(tf(uiLocale, 'dashboard.aiEnriching', { cur: i + 1, tot: batches.length }));
      const dtos = batches[i].map(leadToEnrichDto);
      const returned = await processRemoteEnrichBatch(dtos, options);
      for (const row of returned) {
        if (!row || typeof row !== 'object') continue;
        const k = String(row.username || '').toLowerCase();
        if (!byKey.has(k)) continue;
        const cur = byKey.get(k);
        byKey.set(k, mergeLeadFromEnrich(cur, /** @type {Record<string, unknown>} */ (row)));
      }
    }
    const order = list.map((r) => r.username.toLowerCase());
    leads = order.map((k) => byKey.get(k)).filter(Boolean).map(normalizeStoredLead);
    await chrome.storage.local.set({ [STORAGE_KEYS.LEADS]: leads });
    renderTable();
    appendStatusLine(tf(uiLocale, 'dashboard.aiEnrichDone', { n: leads.length }));
    setAiStatus('');
  } catch (e) {
    const msg = String(e?.message || e);
    appendStatusLine(tf(uiLocale, 'dashboard.aiEnrichFail', { msg }));
    setAiStatus(tf(uiLocale, 'dashboard.aiEnrichFail', { msg }));
  } finally {
    if (els.aiEnrich) els.aiEnrich.disabled = false;
  }
}

async function openGoogleSheetsFlow() {
  await exportCsv();
  window.open('https://sheets.new', '_blank', 'noopener,noreferrer');
  if (els.sheetsHint) {
    els.sheetsHint.textContent = t(uiLocale, 'dashboard.sheetsHint');
    els.sheetsHint.hidden = false;
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
    t(L, 'dashboard.thSegment'),
    t(L, 'dashboard.exportColDeliverability'),
    t(L, 'dashboard.exportColEmailAction'),
    t(L, 'dashboard.exportColEnrichNotes'),
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const tags = Array.isArray(r.segment_tags) ? r.segment_tags.join('; ') : '';
    const segCol = [r.segment_primary || '', tags].filter(Boolean).join(' | ');
    const cells = [
      r.username,
      r.followerCount == null ? '' : String(r.followerCount),
      r.bio || '',
      r.email || '',
      r.phone || '',
      r.websiteUrl || '',
      r.scrapedAt || '',
      segCol,
      r.email_deliverability || '',
      r.email_action || '',
      r.enrich_notes || '',
    ].map((c) => {
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

async function exportCsv() {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const target = rows.length ? rows : active;
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingExport'));
    return;
  }
  const fname = await buildExportFilename('csv');
  const csv = toCsv(target);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
  appendStatusLine(tf(uiLocale, 'dashboard.exportedCsv', { n: target.length, f: fname }));
}

async function exportExcelProfiles() {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const target = rows.length ? rows : active;
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingExport'));
    return;
  }
  const X = typeof globalThis !== 'undefined' && globalThis.XLSX;
  if (!X || typeof X.utils?.json_to_sheet !== 'function' || typeof X.writeFile !== 'function') {
    appendStatusLine(t(uiLocale, 'dashboard.excelFallback'));
    await exportCsv();
    return;
  }
  const L = uiLocale;
  const data = target.map((r) => {
    const tags = Array.isArray(r.segment_tags) ? r.segment_tags.join('; ') : '';
    const segCol = [r.segment_primary || '', tags].filter(Boolean).join(' | ');
    return {
      [t(L, 'dashboard.thUser')]: r.username,
      [t(L, 'dashboard.thFollowers')]: r.followerCount == null ? '' : r.followerCount,
      [t(L, 'dashboard.thBio')]: r.bio || '',
      [t(L, 'dashboard.thEmail')]: r.email || '',
      [t(L, 'dashboard.thPhone')]: r.phone || '',
      [t(L, 'dashboard.thWebsite')]: r.websiteUrl || '',
      [t(L, 'dashboard.thScraped')]: r.scrapedAt || '',
      [t(L, 'dashboard.thSegment')]: segCol,
      [t(L, 'dashboard.exportColDeliverability')]: r.email_deliverability || '',
      [t(L, 'dashboard.exportColEmailAction')]: r.email_action || '',
      [t(L, 'dashboard.exportColEnrichNotes')]: r.enrich_notes || '',
    };
  });
  const ws = X.utils.json_to_sheet(data);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, t(L, 'dashboard.excelSheetProfiles'));
  const fname = await buildExportFilename('xlsx', 'profiles');
  X.writeFile(wb, fname);
  appendStatusLine(tf(uiLocale, 'dashboard.exportedXlsx', { n: target.length, f: fname }));
}

async function exportExcelEmails() {
  const rows = getSelectedRows();
  const active = getActiveLeads();
  const base = rows.length ? rows : active;
  const target = base.filter((r) => String(r.email || '').trim().length > 0);
  if (!target.length) {
    appendStatusLine(t(uiLocale, 'dashboard.nothingExportEmails'));
    return;
  }
  const X = typeof globalThis !== 'undefined' && globalThis.XLSX;
  if (!X || typeof X.utils?.json_to_sheet !== 'function' || typeof X.writeFile !== 'function') {
    appendStatusLine(t(uiLocale, 'dashboard.excelFallback'));
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
    setRunningUi(false);
    void loadLeads();
  }
  if (msg.type === MSG.ERROR) {
    setRunningUi(false);
    appendStatusLine(
      `${t(uiLocale, 'dashboard.errorPrefix')} ${msg.message || 'Unknown'}`,
    );
  }
}

function wireEvents() {
  els.filter.addEventListener('input', () => renderTable());

  els.copy.addEventListener('click', () => void copySelected());
  els.exportProfiles.addEventListener('click', () => void exportExcelProfiles());
  els.exportEmails.addEventListener('click', () => void exportExcelEmails());
  if (els.openSheets) els.openSheets.addEventListener('click', () => void openGoogleSheetsFlow());
  if (els.aiEnrich) els.aiEnrich.addEventListener('click', () => void runRemoteEnrichPipeline());
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
    els.langToggle.addEventListener('click', () => toggleDashboardLocale());
  }

  els.themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('lf-dark');
    syncThemeToggleUi();
    void savePrefsUi();
  });

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
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
      else if (rs && rs.running === false) setRunningUi(false);
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
  });

  if (els.sessionStop) {
    els.sessionStop.addEventListener('click', () => void onDashboardRunToggleClick());
  }
}

async function init() {
  bindEls();
  await loadPrefsUi();

  const { [STORAGE_KEYS.RUN_STATE]: rs } = await chrome.storage.local.get(STORAGE_KEYS.RUN_STATE);
  syncSessionBar(rs);

  await loadLeads();
  await loadSessionHistory();
  wireTableSort();
  wireEvents();

  if (rs?.running) setRunningUi(true);
}

void init();
