/**
 * Deterministic email hygiene — shared by dashboard tooling, content scripts (via bridge),
 * and the Render enrich API. Keep `content/chunk-00b-email-quality-global.js` aligned.
 */

export const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Trailing punctuation trimmed from email/phone candidates — also used by phone normalization. */
export const EMAIL_TRAIL_RE = /[),.;:!?]+$/;

export const EMAIL_BAD_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'json']);

/** Sentry / Wix / Zipify session ids scraped as `user@host` — not merchant contact. */
export function isLikelyJunkOrTelemetryEmail(local, host) {
  const h = String(host || '').toLowerCase();
  const l = String(local || '').toLowerCase();
  if (!h || !l) return false;
  if (h.includes('sentry')) return true;
  if (h.includes('datadog') || h.includes('newrelic')) return true;
  if (h.includes('wixpress.com') && /^[0-9a-f]{20,}$/i.test(l)) return true;
  if (h.includes('zipify.com') && (h.includes('sentry') || /^[0-9a-f]{20,}$/i.test(l))) return true;
  if (/^[0-9a-f]{32}$/i.test(l)) return true;
  if (/^[0-9a-f]{24,}$/i.test(l)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l)) return true;
  return false;
}

/**
 * @param {string} raw
 * @returns {string} normalized email or empty string if invalid / junk
 */
export function normalizeEmailCandidate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const base = raw.trim().replace(EMAIL_TRAIL_RE, '').toLowerCase();
  if (!base || !base.includes('@')) return '';
  const parts = base.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) return '';
  const tld = parts[1].split('.').pop() || '';
  if (EMAIL_BAD_TLDS.has(tld)) return '';
  if (isLikelyJunkOrTelemetryEmail(parts[0], parts[1])) return '';
  return base;
}

function isLikelyAutoEmailLocal(local) {
  const l = String(local || '').toLowerCase();
  return /^(no-?reply|donotreply|mailer-daemon|bounce|newsletter|blackhole|postmaster)/.test(l);
}

/**
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function pickBestEmail(candidates) {
  const uniq = [];
  const seen = new Set();
  for (const raw of candidates) {
    const normalized = normalizeEmailCandidate(raw);
    if (!normalized || seen.has(normalized)) continue;
    const local = normalized.split('@')[0] || '';
    if (isLikelyAutoEmailLocal(local)) continue;
    seen.add(normalized);
    uniq.push(normalized);
  }
  if (!uniq.length) return null;
  uniq.sort((a, b) => {
    const la = (a.split('@')[0] || '').length;
    const lb = (b.split('@')[0] || '').length;
    if (la !== lb) return lb - la;
    return b.length - a.length;
  });
  return uniq[0] || null;
}
