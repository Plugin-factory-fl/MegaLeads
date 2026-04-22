/**
 * LeadFlow UI strings — Italian (default) and English.
 * @typedef {'en' | 'it'} Locale
 */

/** @param {unknown} v */
export function normalizeLocale(v) {
  return v === 'en' ? 'en' : 'it';
}

/**
 * Italian is the default UI language. English only after the user explicitly opts in
 * (`preferEnglish: true` in `leadflow_ui_prefs`). Stale `locale: 'en'` without that flag
 * still opens in Italian (e.g. after extension reload).
 * @param {unknown} p `leadflow_ui_prefs` blob from storage
 * @returns {Locale}
 */
export function uiLocaleFromUiPrefs(p) {
  if (!p || typeof p !== 'object') return 'it';
  if (/** @type {Record<string, unknown>} */ (p).preferEnglish === true) return 'en';
  return 'it';
}

/** @type {Record<Locale, Record<string, unknown>>} */
export const I18N = {
  en: {
    popup: {
      langSwitch: 'Italiano',
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
      langSwitchToIt: 'Switch interface to Italian',
      langSwitchToEn: 'Switch interface to English',
    },
    dashboard: {
      langSwitch: 'Italiano',
      title: 'LeadFlow — Dashboard',
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
      footer: 'Built by Tommaso Parisi',
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
      langSwitchToIt: 'Switch interface to Italian',
      langSwitchToEn: 'Switch interface to English',
      excelSheetProfiles: 'Leads',
      excelSheetEmails: 'Emails',
      aiPanelTitle: 'AI: clean & segment',
      aiPanelDesc:
        'Uses your LeadFlow API (Render) for deterministic email rescoring, optional LLM signal segments, and optional deliverability checks. Segments are heuristic — not demographics.',
      aiLlmToggle: 'Use LLM (OpenAI on server)',
      aiVerifyToggle: 'Verify emails (if configured on server)',
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
    },
  },
  it: {
    popup: {
      langSwitch: 'English',
      themeLight: 'Modalità chiara',
      themeDark: 'Modalità scura',
      ariaThemeToLight: 'Passa alla modalità chiara',
      ariaThemeToDark: 'Passa alla modalità scura',
      modeLabel: 'Modalità',
      modeFollowers: 'Follower',
      modeFollowing: 'Seguiti',
      modeHashtag: 'Hashtag',
      queryHashtag: 'Hashtag',
      queryUsername: 'Nome utente',
      phHashtag: 'es. food o #food (tag Esplora o ricerca ?q=)',
      phUser: 'es. utente o @utente',
      minFollowers: 'Follower minimi',
      minFollowersHelp:
        'Dopo la raccolta e l’arricchimento via API, i profili con meno follower di questo valore vengono rimossi dall’elenco. Imposta 0 per non filtrare per numero di follower.',
      profileLimit: 'Limite max estrazione n.',
      profileLimitToggle: 'Usa limite massimo estrazione',
      profileLimitHelp:
        'Numero massimo di account da raccogliere in una sessione. L’estrazione si ferma al raggiungimento del limite (o a fine lista). Valori più bassi terminano prima; valori più alti raccolgono più profili prima dell’arricchimento.',
      delayLabel: 'Ritardo tra richieste (pagine raccolta e arricchimento profili)',
      delayRange: '{min}–{max} s',
      hint:
        'Tieni aperta la scheda Instagram in questa finestra, poi premi Avvia. Si apre la dashboard con avanzamento e risultati.',
      start: 'Avvia estrazione',
      stop: 'Interrompi',
      riskToast:
        'Intervalli più brevi tra le richieste aumentano il rischio che Instagram limiti l’account. Intervalli più lunghi sono più prudenti. Usa responsabilmente.',
      riskOk: 'OK',
      infoMinFollowers: 'Informazioni sui follower minimi',
      infoProfileLimit: 'Informazioni sul limite di estrazione',
      statusNoTab: 'Nessuna scheda attiva.',
      statusNoIg: 'Seleziona una scheda Instagram in questa finestra e riprova.',
      statusRejected: 'Avvio rifiutato.',
      statusReload:
        'Impossibile avviare: ricarica la pagina Instagram (F5) così l’estensione si collega, poi riprova.',
      langSwitchToIt: 'Passa all’italiano',
      langSwitchToEn: 'Passa all’inglese',
    },
    dashboard: {
      langSwitch: 'English',
      title: 'LeadFlow — Dashboard',
      version: 'v1.0 · Dashboard',
      themeLight: 'Modalità chiara',
      themeDark: 'Modalità scura',
      ariaThemeToLight: 'Passa alla modalità chiara',
      ariaThemeToDark: 'Passa alla modalità scura',
      hint:
        'Avanzamento e risultati dell’esecuzione corrente. Modalità, hashtag e ritardi sono nel popup della barra.',
      alreadyRunning: 'Un’estrazione è già in corso.',
      sessionTitle: 'Estrazione in corso',
      sessionStop: 'Interrompi estrazione',
      sessionStart: 'Avvia estrazione',
      sessionContinue: 'Continua estrazione',
      sessionComplete: 'Estrazione completata!',
      sessionLink: 'Apri pagina sorgente su Instagram',
      sessionGoal: 'Obiettivo: max {n} profili',
      progressGather: 'Raccolta account dalla pagina…',
      progressGatherN: 'Raccolta account dalla pagina… ({n} trovati)',
      progressGatherGoal: 'Raccolta profili… {cur} / {goal}',
      progressEnrich: 'Analisi dettagli profilo ({cur}/{tot})',
      historyLabel: 'Cronologia estrazioni',
      historyToggleExpand: 'Mostra cronologia estrazioni',
      historyToggleCollapse: 'Nascondi cronologia estrazioni',
      historyClear: 'Cancella cronologia',
      historyEmpty: 'Nessuna sessione.',
      historyCurrent: 'Risultati correnti',
      historyUntitled: 'Sessione',
      historyRemoved: 'Sessione rimossa dalla cronologia.',
      historyCleared: 'Cronologia estrazioni cancellata.',
      historyStatusCompleted: 'completata',
      historyStatusStopped: 'interrotta',
      historyStatusRunning: 'in corso',
      historyStatusUnknown: 'sconosciuto',
      results: 'Risultati',
      filterPh: 'Filtra per nome utente, bio, email, telefono o sito…',
      copy: 'Copia selezionati',
      exportProfiles: 'Esporta profili in Excel',
      exportEmails: 'Esporta email in Excel',
      exportProfilesCount: 'Esporta {n} profili in Excel',
      exportEmailsCount: 'Esporta {n} email in Excel',
      clear: 'Svuota elenco',
      thUser: 'Utente',
      thFollowers: 'Follower',
      thBio: 'Bio',
      thEmail: 'Email',
      thPhone: 'Telefono',
      thWebsite: 'Sito web',
      thScraped: 'Estratto il',
      selectAll: 'Seleziona tutto',
      emptyMsg: 'Nessun lead. Avvia dal popup della barra o con Avvia estrazione qui.',
      footer: 'Realizzato da Tommaso Parisi',
      stopSent: 'Stop inviato (la scheda potrebbe dover essere aperta).',
      stopNoTab: 'Nessuna scheda Instagram trovata per lo stop.',
      nothingCopy: 'Niente da copiare.',
      copied: 'Copiati {n} elementi negli appunti.',
      clipboardFail: 'Copia negli appunti non riuscita.',
      nothingExport: 'Niente da esportare.',
      nothingExportEmails: 'Nessuna riga con email da esportare.',
      exportedCsv: 'Esportati {n} elementi in CSV ({f}).',
      excelFallback: 'Esportazione Excel non disponibile — salvo come CSV.',
      exportedXlsx: 'Esportati {n} elementi in {f}.',
      exportedXlsxEmails: 'Esportati {n} elementi con email in {f}.',
      confirmClear: 'Cancellare tutti i lead salvati?',
      confirmRemoveSession: 'Rimuovere la sessione selezionata dalla cronologia?',
      confirmClearHistory: 'Cancellare tutta la cronologia estrazioni?',
      listCleared: 'Elenco svuotato.',
      errorPrefix: 'Errore:',
      stopReasonCompleted: 'Estrazione completata.',
      stopReasonUserStopped: 'Estrazione interrotta dall’utente.',
      stopReasonTimeout: 'Raggiunto il limite di sessione.',
      stopReasonCap: 'Raggiunto il limite profili.',
      stopReasonSourceExhausted: 'Nessun nuovo profilo dalla sorgente.',
      stopReasonTopSerpExhausted: 'top_serp esaurito.',
      stopReasonTopSerpError: 'top_serp interrotto per errore API.',
      stopReasonTopSerpRateLimited: 'top_serp limitato da rate limit.',
      stopReasonTopSerpDuplicatePivot: 'Passaggio da top_serp per duplicati elevati.',
      stopReasonGraphqlExhausted: 'GraphQL esaurito.',
      stopReasonGraphqlError: 'GraphQL interrotto per errore API.',
      stopReasonReservedForEnrichment: 'Raccolta fermata per riservare tempo all’arricchimento.',
      stopReasonNavigationRequired: 'Apri la lista target e avvia di nuovo.',
      stopReasonRuntimeError: 'Estrazione interrotta per errore di runtime.',
      stopReasonValidationError: 'Impossibile avviare l’estrazione su questa pagina.',
      modeFollowers: 'Follower',
      modeFollowing: 'Seguiti',
      modeHashtag: 'Hashtag',
      langSwitchToIt: 'Passa all’italiano',
      langSwitchToEn: 'Passa all’inglese',
      excelSheetProfiles: 'Profili',
      excelSheetEmails: 'Email',
      aiPanelTitle: 'AI: pulizia e segmentazione',
      aiPanelDesc:
        'Usa la tua API LeadFlow (Render) per il rescoring email deterministico, segmenti opzionali via LLM e controlli opzionali di deliverability. I segmenti sono euristici, non demografia.',
      aiLlmToggle: 'Usa LLM (OpenAI sul server)',
      aiVerifyToggle: 'Verifica email (se configurato sul server)',
      aiEnrichRun: 'Avvia arricchimento AI',
      aiEnriching: 'Arricchimento… batch {cur}/{tot}',
      aiEnrichDone: 'Arricchimento AI completato ({n} righe).',
      aiEnrichFail: 'Arricchimento AI non riuscito: {msg}',
      aiEnrichNoLeads: 'Nessun lead da arricchire.',
      aiEnrichNeedLive: 'Passa a «Risultati correnti» per arricchire — la cronologia è solo lettura qui.',
      aiConfigMissing: 'Configura scripts/leadflow-remote-config.js (vedi file di esempio).',
      openSheets: 'Apri Google Fogli',
      sheetsHint:
        'Suggerimento: nel nuovo foglio usa File → Importa → Carica e scegli il CSV appena scaricato.',
      thSegment: 'Segmento',
      thEmailQa: 'Email QA',
      exportColDeliverability: 'Deliverability',
      exportColEmailAction: 'Azione email',
      exportColEnrichNotes: 'Note AI',
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
  const L = normalizeLocale(locale);
  const enF = t('en', 'dashboard.modeFollowers');
  const enG = t('en', 'dashboard.modeFollowing');
  const enH = t('en', 'dashboard.modeHashtag');
  const itF = t('it', 'dashboard.modeFollowers');
  const itG = t('it', 'dashboard.modeFollowing');
  const itH = t('it', 'dashboard.modeHashtag');
  if (L === 'it') {
    if (s === enF || s === 'Followers') return itF;
    if (s === enG || s === 'Following') return itG;
    if (s === enH || s === 'Hashtag') return itH;
    return s;
  }
  if (s === itF || s === 'Follower') return enF;
  if (s === itG) return enG;
  if (s === itH) return enH;
  return s;
}
