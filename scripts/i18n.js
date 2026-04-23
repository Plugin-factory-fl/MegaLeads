/**
 * MegaLeadsAI UI strings - English only.
 * @typedef {'en'} Locale
 */

/** @param {unknown} _v */
export function normalizeLocale(_v) {
  return 'en';
}

/**
 * @param {unknown} _p `leadflow_ui_prefs` blob from storage
 * @returns {Locale}
 */
export function uiLocaleFromUiPrefs(_p) {
  return 'en';
}

/** @type {Record<Locale, Record<string, unknown>>} */
export const I18N = {
  en: {
    popup: {
      langSwitch: 'English',
      themeLight: 'Light mode',
      themeDark: 'Dark mode',
      ariaThemeToLight: 'Switch to light mode',
      ariaThemeToDark: 'Switch to dark mode',
      modeLabel: 'Mode',
      modeFollowers: 'Followers',
      modeFollowing: 'Following',
      modeHashtag: 'Hashtag',
      queryHashtag: 'Hashtag',
      queryUsername: 'Username',
      phHashtag: 'e.g. food or #food (match Explore tag or search ?q=)',
      phUser: 'e.g. exampleuser or @exampleuser',
      minFollowers: 'Minimum followers',
      minFollowersHelp:
        'After profiles are gathered and enriched with API data, anyone below this follower count is removed from the list. Set to 0 to keep every profile regardless of size.',
      profileLimit: 'Limit max extract No.',
      profileLimitToggle: 'Use max extraction limit',
      profileLimitHelp:
        'Maximum number of accounts to collect in one run. Gathering stops when this count is reached (or when the list ends). Lower values finish faster; higher values collect more before enrichment.',
      delayLabel: 'Delay between requests (gather pages & profile enrich)',
      delayRange: '{min}–{max} s',
      hint: 'Keep an Instagram tab open in this window, then tap Start. A dashboard tab opens with progress and results.',
      start: 'Start extraction',
      stop: 'Stop',
      riskToast:
        'Shorter delays between batches increase the risk of Instagram restricting your account. Longer intervals are safer. Use responsibly.',
      riskOk: 'OK',
      infoMinFollowers: 'About minimum followers',
      infoProfileLimit: 'About extract limit',
      statusNoTab: 'No active tab.',
      statusNoIg: 'Select an Instagram tab in this window, then try again.',
      statusRejected: 'Start rejected.',
      statusReload:
        'Could not start: reload the Instagram page (F5) so the extension can attach, then retry.',
      langSwitchToIt: 'English only',
      langSwitchToEn: 'English only',
    },
    dashboard: {
      langSwitch: 'English',
      title: 'MegaLeadsAI - Dashboard',
      version: 'v1.0 · Dashboard',
      themeLight: 'Light mode',
      themeDark: 'Dark mode',
      ariaThemeToLight: 'Switch to light mode',
      ariaThemeToDark: 'Switch to dark mode',
      hint: 'Progress and results for the current run. Mode, hashtag, and delays are in the toolbar popup.',
      alreadyRunning: 'An extraction is already running.',
      sessionTitle: 'Current extraction',
      sessionStop: 'Stop extraction',
      sessionStart: 'Start extraction',
      sessionContinue: 'Continue extracting',
      sessionComplete: 'Extraction Complete!',
      sessionLink: 'Open source page on Instagram',
      sessionGoal: 'Target: {n} profiles max',
      progressGather: 'Gathering accounts from the page…',
      progressGatherN: 'Gathering accounts from the page… ({n} found)',
      progressGatherGoal: 'Gathering profiles… {cur} / {goal}',
      progressEnrich: 'Analyzing profile details ({cur}/{tot})',
      historyLabel: 'Extraction history',
      historyToggleExpand: 'Show extraction history',
      historyToggleCollapse: 'Hide extraction history',
      historyClear: 'Clear history',
      historyEmpty: 'No sessions yet.',
      historyCurrent: 'Current results',
      historyUntitled: 'Session',
      historyRemoved: 'Session removed from history.',
      historyCleared: 'Extraction history cleared.',
      historyStatusCompleted: 'completed',
      historyStatusStopped: 'stopped',
      historyStatusRunning: 'running',
      historyStatusUnknown: 'unknown',
      results: 'Results',
      filterPh: 'Filter by username, bio, email, phone, or website…',
      copy: 'Copy selected',
      exportProfiles: 'Export profiles to Excel',
      exportEmails: 'Export emails to Excel',
      exportProfilesCount: 'Export {n} profiles to Excel',
      exportEmailsCount: 'Export {n} emails to Excel',
      clear: 'Clear list',
      thUser: 'Username',
      thFollowers: 'Followers',
      thBio: 'Bio',
      thEmail: 'Email',
      thPhone: 'Phone',
      thWebsite: 'Website',
      thScraped: 'Scraped at',
      selectAll: 'Select all',
      emptyMsg: 'No leads yet. Start from the toolbar popup or use Start extraction here.',
      footer: 'Created by MegaMix AI, LLC',
      stopSent: 'Stop sent (tab may need to be open).',
      stopNoTab: 'No Instagram tab found to stop.',
      nothingCopy: 'Nothing to copy.',
      copied: 'Copied {n} row(s) to clipboard.',
      clipboardFail: 'Clipboard failed.',
      nothingExport: 'Nothing to export.',
      nothingExportEmails: 'No rows with an email to export.',
      exportedCsv: 'Exported {n} row(s) as CSV ({f}).',
      excelFallback: 'Excel export unavailable — saving as CSV instead.',
      exportedXlsx: 'Exported {n} row(s) to {f}.',
      exportedXlsxEmails: 'Exported {n} row(s) with email to {f}.',
      confirmClear: 'Clear all extracted leads from storage?',
      confirmRemoveSession: 'Remove selected session from history?',
      confirmClearHistory: 'Clear extraction history?',
      listCleared: 'List cleared.',
      errorPrefix: 'Error:',
      stopReasonCompleted: 'Extraction completed.',
      stopReasonUserStopped: 'Extraction stopped by user.',
      stopReasonTimeout: 'Session timeout reached.',
      stopReasonCap: 'Profile cap reached.',
      stopReasonSourceExhausted: 'No more new profiles from source.',
      stopReasonTopSerpExhausted: 'top_serp exhausted.',
      stopReasonTopSerpError: 'top_serp stopped due to API error.',
      stopReasonTopSerpRateLimited: 'top_serp rate limited.',
      stopReasonTopSerpDuplicatePivot: 'Switched from top_serp due to high duplicates.',
      stopReasonGraphqlExhausted: 'GraphQL exhausted.',
      stopReasonGraphqlError: 'GraphQL stopped due to API error.',
      stopReasonReservedForEnrichment: 'Gather paused to reserve time for enrichment.',
      stopReasonNavigationRequired: 'Open the target list page, then start again.',
      stopReasonRuntimeError: 'Extraction stopped due to runtime error.',
      stopReasonValidationError: 'Extraction could not start on this page.',
      modeFollowers: 'Followers',
      modeFollowing: 'Following',
      modeHashtag: 'Hashtag',
      langSwitchToIt: 'English only',
      langSwitchToEn: 'English only',
      excelSheetProfiles: 'Leads',
      excelSheetEmails: 'Emails',
      aiPanelTitle: 'AI: clean & segment',
      aiPanelDesc:
        'Uses your MegaLeadsAI API (Render) for deterministic email rescoring, optional LLM signal segments, and optional deliverability checks. Segments are heuristic - not demographics.',
      aiLlmToggle: 'Use LLM (OpenAI on server)',
      aiVerifyToggle: 'Verify emails (if configured on server)',
      aiFetchUrlToggle: 'Allow FETCH_URL (extension fetches pages the model requests)',
      aiExcludeFakeToggle: 'Exclude fake/placeholder emails',
      aiFetchRound: 'Fetching pages for AI… round {n}',
      aiEnrichRun: 'Run AI enrich',
      aiEnriching: 'Enriching… batch {cur}/{tot}',
      aiEnrichDone: 'AI enrich finished ({n} rows).',
      aiEnrichFail: 'AI enrich failed: {msg}',
      aiEnrichNoLeads: 'No leads to enrich.',
      aiEnrichNeedLive: 'Switch to “Current results” to enrich — history sessions are read-only here.',
      aiConfigMissing: 'Configure scripts/leadflow-remote-config.js (see example file).',
      openSheets: 'Open Google Sheets',
      sheetsHint:
        'Tip: in the new spreadsheet use File → Import → Upload and pick the CSV you just downloaded.',
      thSegment: 'Segment',
      thEmailQa: 'Email QA',
      exportColDeliverability: 'Deliverability',
      exportColEmailAction: 'Email action',
      exportColEnrichNotes: 'AI notes',
      joshBubbleHintA: 'Need help with your leads?',
      joshBubbleHintB: 'Ask Josh to clean, sort, filter, or export.',
      joshBubbleLineDrag: 'Click and drag me around the screen!',
      joshBubbleLineSheets: 'Ask me to export your list to Google Sheets.',
      joshBubbleLineAskAnything: 'Ask me anything about MegaLeads AI.',
      joshBubbleLineFilter: 'Ask me to filter your leads by niche or keyword.',
      joshBubbleLineSort: 'Ask me to sort your leads by followers or email quality.',
      joshWelcome:
        'I am Josh, your MegaLeadsAI helper. Ask me questions or tell me what to do with your extracted leads list.',
      joshTyping: 'Thinking...',
      joshNetworkError: "Couldn't reach Josh. Check your API config and try again.",
    },
  },
};

/**
 * @param {Locale} locale
 * @param {string} path dot path e.g. "popup.start"
 */
export function t(locale, path) {
  const loc = normalizeLocale(locale);
  const parts = path.split('.');
  /** @type {unknown} */
  let cur = I18N[loc];
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in /** @type {object} */ (cur)) {
      cur = /** @type {Record<string, unknown>} */ (cur)[p];
    } else {
      cur = undefined;
      break;
    }
  }
  if (typeof cur === 'string') return cur;
  /** fallback en */
  let fb = I18N.en;
  for (const p of parts) {
    if (fb && typeof fb === 'object' && p in fb) fb = /** @type {Record<string, unknown>} */ (fb)[p];
    else {
      fb = undefined;
      break;
    }
  }
  return typeof fb === 'string' ? fb : path;
}

/**
 * @param {Locale} locale
 * @param {string} path
 * @param {Record<string, string | number>} vars
 */
export function tf(locale, path, vars) {
  let s = t(locale, path);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/**
 * @param {Locale} locale
 * @param {string} modeLabel from session storage (English or Italian from content `lfLog`)
 */
export function translateSessionMode(locale, modeLabel) {
  const s = String(modeLabel || '').trim();
  const enF = t('en', 'dashboard.modeFollowers');
  const enG = t('en', 'dashboard.modeFollowing');
  const enH = t('en', 'dashboard.modeHashtag');
  void locale;
  if (s === 'Follower') return enF;
  return s;
}
