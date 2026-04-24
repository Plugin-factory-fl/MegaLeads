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
      upgrade: 'Get Infinite Emails',
      ariaUpgrade: 'Get Infinite Emails (Stripe checkout)',
      account: 'Account',
      ariaAccount: 'Account — create account, usage, or open dashboard',
      stripeMissing: 'Add stripeCheckoutUrl in scripts/leadflow-remote-config.js',
      authBannerTitle: 'Create your MegaLeadsAI account',
      authBannerBody: 'Create a free account to use the free tier (tracked unique emails, up to 500).',
      authBannerCta: 'Create free account',
      atCapBannerTitle: 'Free email limit reached',
      atCapBannerBody: 'Get Infinite Emails for unlimited Instagram extractions.',
      atCapBannerCta: 'Get Infinite Emails',
      statusNeedsAccount: 'Create an account before starting extraction.',
      statusAtCap: 'You have reached the 500 free unique emails limit. Get Infinite Emails to continue.',
      freeTierEmailsLabel: 'Emails remaining',
      headerEmailsProgress: '{count} / {cap}',
      headerEmailsUnlimited: 'Unlimited',
      unlimitedIgEmailExtraction: 'Unlimited IG Email Extraction',
      headerProgressAria: 'Emails remaining on free tier',
      loggedInToast: 'You are logged in.',
      loginToastDismissAria: 'Dismiss',
      authModalLogInBtn: 'Log In',
      authModalCreateAccountBtn: 'Create free account',
    },
    signup: {
      pageTitle: 'MegaLeadsAI — Create your account',
      heroTitle: 'Create your MegaLeadsAI account',
      heroLead:
        'One free account ties your device to the free tier: up to 500 unique emails extracted, then Get Infinite Emails for unlimited access.',
      createTitle: 'Sign up',
      createDesc: 'Use a real email you can access later for receipts and account recovery.',
      email: 'Email',
      password: 'Password (at least 8 characters)',
      confirmPassword: 'Confirm password',
      createSubmit: 'Create free account',
      signinTitle: 'Already registered?',
      signinDesc: 'Sign in with the same email and password. (Password is checked locally until server auth is connected.)',
      signinSubmit: 'Sign in',
      openDashboard: 'Open dashboard',
      success: 'You are signed in. You can open the dashboard to run extractions.',
      successNoReturn:
        'You are signed in. Use the MegaLeads toolbar button on Instagram when you are ready, or open the dashboard below.',
      footerNote: 'Created by MegaMix AI, LLC',
      themeLight: 'Light mode',
      themeDark: 'Dark mode',
      ariaThemeLight: 'Switch to light mode',
      ariaThemeDark: 'Switch to dark mode',
      errPasswordMismatch: 'Passwords do not match.',
      errPasswordShort: 'Password must be at least 8 characters.',
      errSignin: 'Enter a valid email and password (at least 8 characters).',
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
      sessionRunningNote:
        'NOTE: This is the part that takes a while. Profiles and emails will build up below. Either wait for extraction to complete or Stop Extraction anytime to download what is there.',
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
      progressAiEnrich: 'AI enrichment… batch {cur}/{tot}',
      sessionRunningNoteAi: 'Finishing with AI enrichment…',
      postExtractionAiStarting: 'Running AI enrichment on your results…',
      postExtractionAiDone: 'AI enrichment finished ({n} rows).',
      postExtractionAiFail: 'AI enrichment after extraction failed: {msg}',
      aiSummaryTitle: 'AI Enrichment Summary',
      aiSummaryScrapedLine: 'Emails extracted by scraping: {n}',
      aiSummaryAddedLine: 'Emails added after AI enrichment: {n}',
      aiSummaryImprovedLine: 'AI has improved your email list by {n} emails',
      extractionSummaryTitle: 'Extraction Summary',
      extractionSummaryJoshLine: 'This run includes {n} rows with an email address.',
      extractionSummaryOk: 'OK',
      aiConfigMissing: 'Configure scripts/leadflow-remote-config.js (see example file).',
      exportFormatTitleProfiles: 'Export profiles',
      exportFormatTitleEmails: 'Export emails',
      exportFormatHint:
        'In Excel or Google Sheets, use File → Import → Upload to open the file you download.',
      exportFormatXlsxBtn: 'Download .xlsx',
      exportFormatCsvBtn: 'Download .csv',
      exportFormatCancel: 'Cancel',
      thSegment: 'Segment',
      thEmailQa: 'Email QA',
      exportColDeliverability: 'Deliverability',
      exportColEmailAction: 'Email action',
      exportColEnrichNotes: 'AI notes',
      joshBubbleHintA: 'Need help with your leads?',
      joshBubbleHintB: 'Ask Josh how MegaLeadsAI works — Q&A only.',
      joshBubbleLineDrag: 'Click and drag me around the screen!',
      joshBubbleLineMegaLeadsHelp: 'Ask me about MegaLeadsAI — Q&A only, no tasks run from chat.',
      joshWelcome:
        "I'm Josh — ask me how MegaLeadsAI works. This chat is Q&A only: I can't change your list or run exports; use the dashboard for that.",
      joshTyping: 'Thinking...',
      joshNetworkError:
        "Couldn't get a reply from the assistant. Check apiBaseUrl and apiKey in leadflow-remote-config.js, your connection, and that the Render service is running.",
      accountClose: 'Close',
      accountUsageTitle: 'Your account',
      accountUsageSignedInAs: 'Signed in as {email}',
      accountUsageCount: 'Unique emails extracted on this device: {count}',
      accountUsageProgress: '{count} of {cap} free unique emails used',
      accountUsageCapNote:
        'The free tier includes up to {cap} unique email extractions. Subscribe for unlimited Instagram email extractions.',
      accountUsageAtCap: 'You have reached the free email limit. Get Infinite Emails to continue extracting.',
      accountUsagePlusRoyalty:
        "You're a MegaLeads AI Plus user. You're royalty.",
      manageSubscription: 'Manage subscription',
      manageSubscriptionMissing: 'Could not open subscription management right now.',
      accountLogout: 'Sign out',
      accountCheckoutDiamond: 'Get Infinite Emails',
      ariaCheckoutDiamond: 'Open checkout to Get Infinite Emails',
      stripeMissing: 'Configure stripeCheckoutUrl in scripts/leadflow-remote-config.js',
      accountHeaderTitle: 'Account',
      ariaAccount: 'Account — usage and upgrade',
      freeTierEmailsLabel: 'Emails remaining',
      headerEmailsProgress: '{count} / {cap}',
      headerEmailsUnlimited: 'Unlimited',
      unlimitedIgEmailExtraction: 'Unlimited IG Email Extraction',
      headerProgressAria: 'Emails remaining on free tier',
      getInfiniteEmails: 'Get Infinite Emails',
      ariaGetInfiniteEmails: 'Get Infinite Emails (Stripe checkout)',
      capBanner: 'You have used all {cap} free unique emails on this account. Get Infinite Emails to continue extracting.',
      startBlockedAtCap: 'Get Infinite Emails to start a new extraction — free unique email limit reached.',
      enrichBlockedAtCap: 'Get Infinite Emails to run AI enrich — free unique email limit reached.',
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
