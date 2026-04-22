/**
 * LeadFlow enrich API — Render-friendly Express service.
 * Auth: Authorization: Bearer <MEGALEADS_API_KEY>
 */

import express from 'express';
import { pickBestEmail, normalizeEmailCandidate, EMAIL_RE } from '../scripts/email-quality.js';

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MEGALEADS_API_KEY = (process.env.MEGALEADS_API_KEY || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const MAX_LEADS = Math.min(
  200,
  Math.max(1, Number(process.env.LEADFLOW_MAX_LEADS_PER_REQUEST) || 75),
);
const LOG_LEVEL = (process.env.LEADFLOW_LOG_LEVEL || 'info').toLowerCase();
const EMAIL_VERIFICATION_API_KEY = (process.env.EMAIL_VERIFICATION_API_KEY || '').trim();
const EMAIL_VERIFICATION_PROVIDER = (process.env.EMAIL_VERIFICATION_PROVIDER || '').trim().toLowerCase();
/** Max extension fetch_url rounds per batch (client increments toolRound). */
const FETCH_TOOL_MAX_ROUNDS = Math.min(24, Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_ROUNDS) || 10));
/** Max URLs sent to the extension per needs_fetch response. */
const FETCH_TOOL_MAX_URLS = Math.min(12, Math.max(1, Number(process.env.MEGALEADS_FETCH_TOOL_MAX_URLS_PER_ROUND) || 5));

function logInfo(msg, extra) {
  if (LOG_LEVEL === 'error' || LOG_LEVEL === 'warn') return;
  if (extra) console.info(`[leadflow] ${msg}`, extra);
  else console.info(`[leadflow] ${msg}`);
}

function logWarn(msg, extra) {
  if (LOG_LEVEL === 'error') return;
  if (extra) console.warn(`[leadflow] ${msg}`, extra);
  else console.warn(`[leadflow] ${msg}`);
}

/** @param {string} email */
function redactEmail(email) {
  const s = String(email || '');
  if (!s.includes('@')) return '(empty)';
  const [l, h] = s.split('@');
  if (!h) return '(invalid)';
  const safeL = l.length <= 2 ? '**' : `${l.slice(0, 2)}…${l.slice(-1)}`;
  return `${safeL}@${h}`;
}

function requireBearer(req, res, next) {
  const want = MEGALEADS_API_KEY;
  if (!want) {
    logWarn('MEGALEADS_API_KEY is not set');
    const message = OPENAI_API_KEY
      ? 'MEGALEADS_API_KEY is missing. It is not the same as OPENAI_API_KEY: set MEGALEADS_API_KEY (any long random string) for extension Bearer auth; OPENAI_API_KEY is only for OpenAI on the server.'
      : 'Set MEGALEADS_API_KEY (any long random string). The Chrome extension sends Authorization: Bearer with that value; it must match scripts/leadflow-remote-config.js apiKey.';
    return res.status(503).json({ error: 'server_misconfigured', message });
  }
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  const got = m ? m[1].trim() : '';
  if (got !== want) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing bearer token' });
  }
  next();
}

/**
 * Pull loose emails from text for deterministic rescoring.
 * @param {string} text
 * @returns {string[]}
 */
function emailsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const re = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
  return text.match(re) || [];
}

/**
 * @param {object} row
 * @returns {string[]} candidates for pickBestEmail
 */
function emailCandidatesForRow(row) {
  const parts = [];
  if (row.email) parts.push(String(row.email));
  if (row.bio) parts.push(...emailsFromText(String(row.bio)));
  if (row.websiteUrl) parts.push(...emailsFromText(String(row.websiteUrl)));
  return parts;
}

/**
 * Optional deliverability — extend with real vendor HTTP calls.
 * @param {string} email
 * @returns {Promise<{ status: string, reason?: string }|null>}
 */
async function verifyEmailOptional(email) {
  if (!EMAIL_VERIFICATION_API_KEY || !EMAIL_VERIFICATION_PROVIDER) return null;
  if (!email || !normalizeEmailCandidate(email)) return { status: 'unknown', reason: 'invalid_syntax' };

  if (EMAIL_VERIFICATION_PROVIDER === 'zerobounce') {
    try {
      const url = new URL('https://api.zerobounce.net/v2/validate');
      url.searchParams.set('api_key', EMAIL_VERIFICATION_API_KEY);
      url.searchParams.set('email', email);
      const r = await fetch(url.href, { method: 'GET' });
      if (!r.ok) return { status: 'unknown', reason: `http_${r.status}` };
      const j = await r.json();
      const st = String(j.status || '').toLowerCase();
      if (st === 'valid') return { status: 'valid' };
      if (st === 'invalid' || st === 'do_not_mail') return { status: 'invalid' };
      if (st === 'catch-all' || st === 'unknown') return { status: 'risky', reason: st };
      return { status: 'unknown', reason: st || 'zerobounce' };
    } catch (e) {
      logWarn('zerobounce verify failed', { err: String(e?.message || e) });
      return { status: 'unknown', reason: 'request_error' };
    }
  }

  logInfo(`email verify skipped: unknown provider "${EMAIL_VERIFICATION_PROVIDER}"`);
  return { status: 'unknown', reason: 'provider_not_integrated' };
}

/** Same rules as extension `isAllowedThirdPartyTextFetchUrl` — extension performs the actual fetch. */
function isFetchUrlAllowedForTool(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local')) return false;
    if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false;
    if (h.endsWith('instagram.com') || h === 'instagr.am') return false;
    return true;
  } catch {
    return false;
  }
}

function compactLeadsForLlm(leads) {
  return leads.map((r) => ({
    username: String(r.username || ''),
    followerCount: r.followerCount ?? null,
    bio: String(r.bio || '').slice(0, 1200),
    websiteUrl: String(r.websiteUrl || '').slice(0, 500),
    email: String(r.email || ''),
    phone: String(r.phone || '').slice(0, 80),
  }));
}

/** @param {string} text */
function extractJsonObjectWithItems(text) {
  const t = String(text || '').trim();
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(t.slice(start, i + 1));
          if (parsed && Array.isArray(parsed.items)) return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** @param {unknown[]} items */
function itemsArrayToLlmMap(items) {
  /** @type {Map<string, object>} */
  const byUser = new Map();
  for (const it of items) {
    const u = String(it?.username || '').trim();
    if (u) byUser.set(u.toLowerCase(), it);
  }
  return byUser;
}

const FETCH_URL_TOOL_SYSTEM = `You enrich Instagram lead rows for a CRM export. You may call fetch_url with absolute http(s) URLs to load public HTML (contact pages, link-in-bio sites, about pages). Never use instagram.com or instagr.am. Use fetch only when extra page text would materially improve email or segmentation. When finished (with or without fetches), reply with ONE JSON object only (no markdown fences), shape: {"items":[...]} where each item has username, segment_primary, segment_tags (array), email_suggested, email_action (keep|replace|clear), email_confidence_0_1, notes. Segments are signal-based heuristics, not census demographics.`;

const FETCH_URL_FUNCTION = {
  type: 'function',
  function: {
    name: 'fetch_url',
    description:
      'Load public page HTML as text via the user browser extension. Use https when possible. One URL per call.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Absolute URL, e.g. https://example.com/contact' },
      },
      required: ['url'],
    },
  },
};

/**
 * @param {object[]} messages OpenAI chat messages
 * @returns {Promise<object>} assistant message object (content and/or tool_calls)
 */
async function openAiChatWithFetchTool(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages,
      tools: [FETCH_URL_FUNCTION],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    logWarn('OpenAI fetch-tool error', { status: res.status, body: t.slice(0, 400) });
    throw Object.assign(new Error('openai_http_error'), { status: res.status, body: t.slice(0, 500) });
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') throw new Error('openai_empty_message');
  return msg;
}

/**
 * @param {object[]} leadsIn
 * @param {object} options
 * @param {object} body raw POST body
 * @returns {Promise<{ kind: 'needs_fetch'; messages: object[]; fetchJobs: object[]; prefilledToolResults: object[] } | { kind: 'done'; leadsOut: object[] }>}
 */
async function handleEnrichFetchUrlToolFlow(leadsIn, options, body) {
  if (!OPENAI_API_KEY) {
    throw Object.assign(new Error('OPENAI_API_KEY missing'), { code: 'openai_missing' });
  }
  const clientRound = Number(body.toolRound) || 0;
  if (clientRound > FETCH_TOOL_MAX_ROUNDS) {
    throw new Error(`fetch_url tool: exceeded max rounds (${FETCH_TOOL_MAX_ROUNDS})`);
  }

  let messages =
    Array.isArray(body.messages) && body.messages.length > 0 ? [...body.messages] : null;
  const toolResultsIn = Array.isArray(body.toolResults) ? body.toolResults : [];

  if (!messages) {
    const compact = compactLeadsForLlm(leadsIn);
    messages = [
      { role: 'system', content: FETCH_URL_TOOL_SYSTEM },
      { role: 'user', content: `Leads JSON:\n${JSON.stringify(compact)}` },
    ];
  }

  for (const tr of toolResultsIn) {
    if (!tr || typeof tr !== 'object') continue;
    const id = String(tr.tool_call_id || '').trim();
    const content = String(tr.content != null ? tr.content : '').slice(0, 120000);
    if (!id) continue;
    messages.push({ role: 'tool', tool_call_id: id, content });
  }

  const INNER_MAX = 6;
  for (let inner = 0; inner < INNER_MAX; inner++) {
    const choice = await openAiChatWithFetchTool(messages);
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

    if (!toolCalls.length) {
      const parsed = extractJsonObjectWithItems(choice.content || '');
      if (!parsed) throw new Error('openai_final_parse_failed');
      const llmByUser = itemsArrayToLlmMap(parsed.items);
      const doVerify = options.verify === true;
      const leadsOut = [];
      for (const row of leadsIn) {
        leadsOut.push(await enrichOne(row, llmByUser, doVerify));
      }
      return { kind: 'done', leadsOut };
    }

    const assistantMsg = {
      role: 'assistant',
      content: choice.content || null,
      tool_calls: toolCalls,
    };
    const messagesWithAssistant = [...messages, assistantMsg];

    /** @type {{ toolCallId: string, url: string }[]} */
    const fetchJobs = [];
    /** @type {{ tool_call_id: string, content: string }[]} */
    const prefilledToolResults = [];

    for (const tc of toolCalls) {
      const tcId = String(tc.id || '').trim();
      const fn = tc.function?.name;
      if (!tcId) continue;
      if (fn !== 'fetch_url') {
        prefilledToolResults.push({ tool_call_id: tcId, content: 'Only fetch_url is supported.' });
        continue;
      }
      let url = '';
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        url = String(args.url || '').trim();
      } catch {
        prefilledToolResults.push({ tool_call_id: tcId, content: 'Invalid JSON in fetch_url arguments.' });
        continue;
      }
      if (!isFetchUrlAllowedForTool(url)) {
        prefilledToolResults.push({
          tool_call_id: tcId,
          content: `URL not allowed (must be http(s), not Instagram, not localhost): ${url}`,
        });
        continue;
      }
      if (fetchJobs.length < FETCH_TOOL_MAX_URLS) {
        fetchJobs.push({ toolCallId: tcId, url });
      } else {
        prefilledToolResults.push({
          tool_call_id: tcId,
          content: 'Skipped: max fetch_url calls per round reached.',
        });
      }
    }

    if (fetchJobs.length) {
      return {
        kind: 'needs_fetch',
        messages: messagesWithAssistant,
        fetchJobs,
        prefilledToolResults,
      };
    }

    for (const p of prefilledToolResults) {
      messagesWithAssistant.push({
        role: 'tool',
        tool_call_id: p.tool_call_id,
        content: p.content,
      });
    }
    messages = messagesWithAssistant;
  }

  throw new Error('fetch_url tool: inner loop exhausted without final JSON');
}

/**
 * @param {object[]} leads
 * @param {{ llm?: boolean, verify?: boolean }} options
 */
async function runLlmBatch(leads, options) {
  const useLlm = options.llm !== false;
  if (!useLlm) return new Map();

  if (!OPENAI_API_KEY) {
    throw Object.assign(new Error('OPENAI_API_KEY missing'), { code: 'openai_missing' });
  }

  const compact = compactLeadsForLlm(leads);

  const schema = {
    name: 'lead_enrich_batch',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              username: { type: 'string' },
              segment_primary: { type: 'string' },
              segment_tags: {
                type: 'array',
                items: { type: 'string' },
              },
              email_suggested: { type: 'string' },
              email_action: { type: 'string', enum: ['keep', 'replace', 'clear'] },
              email_confidence_0_1: { type: 'number' },
              notes: { type: 'string' },
            },
            required: [
              'username',
              'segment_primary',
              'segment_tags',
              'email_suggested',
              'email_action',
              'email_confidence_0_1',
              'notes',
            ],
          },
        },
      },
      required: ['items'],
    },
  };

  const system = `You enrich Instagram lead rows for a CRM export. Output is signal-based segmentation only — not census demographics. Use short segment labels (e.g. creator_signals, local_business_signals, b2b_domain, agency_signals, unknown). email_action: keep = keep current email; replace = use email_suggested (must be plausible contact); clear = remove email. Respect username keys exactly.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify(compact),
        },
      ],
      response_format: { type: 'json_schema', json_schema: schema },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    logWarn('OpenAI error', { status: res.status, body: t.slice(0, 400) });
    throw Object.assign(new Error('openai_http_error'), { status: res.status, body: t.slice(0, 500) });
  }

  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content;
  if (!txt || typeof txt !== 'string') throw new Error('openai_empty_content');
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    throw new Error('openai_invalid_json');
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  /** @type {Map<string, object>} */
  const byUser = new Map();
  for (const it of items) {
    const u = String(it?.username || '').trim();
    if (u) byUser.set(u.toLowerCase(), it);
  }
  return byUser;
}

/**
 * @param {object} row
 * @param {Map<string, object>} llmByUser
 * @param {boolean} doVerify
 */
async function enrichOne(row, llmByUser, doVerify) {
  const username = String(row.username || '').trim();
  const key = username.toLowerCase();
  const candidates = emailCandidatesForRow(row);
  const rescored = pickBestEmail(candidates) || '';

  const out = {
    ...row,
    email_deterministic: rescored,
    email_quality_codes: [],
  };

  if (rescored && rescored !== String(row.email || '').trim().toLowerCase()) {
    out.email_quality_codes = [...(out.email_quality_codes || []), 'rescored_from_bio_or_url'];
  }

  const llm = llmByUser.get(key);
  if (llm) {
    out.segment_primary = String(llm.segment_primary || '').slice(0, 120);
    out.segment_tags = Array.isArray(llm.segment_tags) ? llm.segment_tags.map((x) => String(x).slice(0, 64)) : [];
    out.enrich_notes = String(llm.notes || '').slice(0, 500);
    out.email_confidence_0_1 = Math.max(0, Math.min(1, Number(llm.email_confidence_0_1) || 0));

    const action = String(llm.email_action || 'keep');
    const suggested = normalizeEmailCandidate(String(llm.email_suggested || ''));

    if (action === 'clear') {
      out.email = '';
      out.email_action = 'clear';
    } else if (action === 'replace' && suggested && out.email_confidence_0_1 >= 0.45) {
      out.email = suggested;
      out.email_action = 'replace';
    } else if (action === 'replace' && suggested) {
      out.email = rescored || row.email || '';
      out.email_action = 'keep';
      out.email_quality_codes = [...(out.email_quality_codes || []), 'llm_replace_low_confidence'];
    } else {
      out.email = rescored || String(row.email || '').trim();
      out.email_action = 'keep';
    }
  } else {
    out.email = rescored || String(row.email || '').trim();
    out.segment_primary = out.segment_primary || '';
    out.segment_tags = Array.isArray(out.segment_tags) ? out.segment_tags : [];
    out.email_action = out.email_action || 'keep';
  }

  if (doVerify && out.email) {
    const v = await verifyEmailOptional(out.email);
    if (v) {
      out.email_deliverability = v.status;
      if (v.reason) out.email_verify_reason = v.reason;
    }
  }

  delete out.email_deterministic;
  return out;
}

async function handleEnrich(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const leadsIn = Array.isArray(body.leads) ? body.leads : [];
  const options = body.options && typeof body.options === 'object' ? body.options : {};

  if (leadsIn.length === 0) {
    return res.status(400).json({ error: 'validation', message: 'leads array required' });
  }
  if (leadsIn.length > MAX_LEADS) {
    return res.status(400).json({
      error: 'too_many_leads',
      message: `Max ${MAX_LEADS} leads per request`,
    });
  }

  for (const r of leadsIn) {
    if (!r || typeof r !== 'object' || !String(r.username || '').trim()) {
      return res.status(400).json({ error: 'validation', message: 'Each lead must have a username' });
    }
  }

  if (options.fetchUrlTool === true) {
    if (options.llm === false) {
      return res.status(400).json({
        error: 'validation',
        message: 'fetchUrlTool requires LLM to be enabled.',
      });
    }
    try {
      const out = await handleEnrichFetchUrlToolFlow(leadsIn, options, body);
      if (out.kind === 'needs_fetch') {
        return res.json({
          status: 'needs_fetch',
          messages: out.messages,
          fetchJobs: out.fetchJobs,
          prefilledToolResults: out.prefilledToolResults,
          toolRound: Number(body.toolRound) || 0,
          meta: { model: OPENAI_MODEL },
        });
      }
      const leadsOut = out.leadsOut;
      logInfo('enrich_ok', {
        count: leadsOut.length,
        llm: true,
        verify: options.verify === true,
        fetchUrlTool: true,
        sampleUser: leadsOut[0]?.username,
        sampleEmail: leadsOut[0]?.email ? redactEmail(leadsOut[0].email) : '(none)',
      });
      return res.json({
        leads: leadsOut,
        meta: { model: OPENAI_MODEL, count: leadsOut.length, fetchUrlTool: true },
      });
    } catch (e) {
      logWarn('fetchUrlTool enrich failed', { err: String(e?.message || e) });
      return res.status(502).json({
        error: 'llm_failed',
        message: String(e?.message || e),
      });
    }
  }

  let llmByUser = new Map();
  if (options.llm !== false) {
    try {
      llmByUser = await runLlmBatch(leadsIn, { llm: true });
    } catch (e) {
      logWarn('LLM batch failed', { err: String(e?.message || e) });
      return res.status(502).json({
        error: 'llm_failed',
        message: String(e?.message || e),
      });
    }
  }

  const doVerify = options.verify === true;
  const leadsOut = [];
  for (const row of leadsIn) {
    leadsOut.push(await enrichOne(row, llmByUser, doVerify));
  }

  logInfo('enrich_ok', {
    count: leadsOut.length,
    llm: options.llm !== false,
    verify: doVerify,
    sampleUser: leadsOut[0]?.username,
    sampleEmail: leadsOut[0]?.email ? redactEmail(leadsOut[0].email) : '(none)',
  });

  return res.json({ leads: leadsOut, meta: { model: OPENAI_MODEL, count: leadsOut.length } });
}

function main() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));

  const healthJson = { ok: true, service: 'leadflow-enrich', env: NODE_ENV };
  /** Root + `/health` both return 200 so Render (and other probes) work with default `/` checks. */
  app.get('/health', (_req, res) => {
    res.json(healthJson);
  });
  app.get('/', (_req, res) => {
    res.json(healthJson);
  });

  app.post('/v1/leads/enrich', requireBearer, (req, res, next) => {
    handleEnrich(req, res).catch(next);
  });

  app.use((err, _req, res, _next) => {
    logWarn('unhandled', { err: String(err?.message || err) });
    if (!res.headersSent) res.status(500).json({ error: 'internal', message: 'Server error' });
  });

  app.listen(PORT, () => {
    logInfo(`listening on ${PORT}`, { health: ['/', '/health'], enrich: 'POST /v1/leads/enrich' });
  });
}

main();
