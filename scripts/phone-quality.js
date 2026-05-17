/**
 * Deterministic phone hygiene — shared by enrich API and weak-lead detection.
 */

export const PHONE_TRAIL_RE = /[),.;:!?]+$/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,9}\b/g;

/** @param {string} text */
export function phonesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const re = new RegExp(PHONE_RE.source, PHONE_RE.flags);
  return text.match(re) || [];
}

/** @param {string} raw */
function looksLikeDateLikePhone(raw) {
  const t = String(raw || '').trim();
  return (
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.test(t) ||
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.test(t) ||
    /^\d{4}\s*[-–—]\s*\d{4}$/.test(t)
  );
}

/** @param {string} raw */
function looksLikeDatePlusDecimalNoise(raw) {
  const t = String(raw || '').trim();
  return /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(t) && /\b\d+\.\d+\b/.test(t);
}

/** @param {string} raw */
function looksLikeCoordinateNoise(raw) {
  const t = String(raw || '').trim();
  return /^[-+]?\d{1,3}\.\d{3,}\s+[-+]?\d{1,3}\.\d{3,}(?:\s+[-+]?\d+(?:\.\d+)?)?$/.test(t);
}

/** @param {string} raw */
function looksLikeDottedNumericNoise(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, '');
  if (!/^[+\d.]+$/.test(t)) return false;
  const dots = (t.match(/\./g) || []).length;
  if (dots < 2) return false;
  return t.length >= 10;
}

/** @param {string} raw */
function looksLikeVersionOrBuildNumber(raw) {
  const t = String(raw || '').trim();
  if (/^\d{1,3}(\.\d{1,4}){2,}$/.test(t.replace(/\s+/g, ''))) return true;
  if (/^v?\d+\.\d+\.\d+/.test(t.toLowerCase())) return true;
  return false;
}

/** @param {string} digits */
function looksLikeRepeatedDigitNoise(digits) {
  if (!digits || digits.length < 8) return false;
  if (/^(\d)\1{7,}$/.test(digits)) return true;
  if (/^(0123456789|1234567890|9876543210)/.test(digits)) return true;
  return false;
}

/**
 * True when the value looks like a phone but is likely junk (dates, IDs, versions).
 * @param {string} raw
 * @returns {boolean}
 */
export function isLikelyJunkPhone(raw) {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (looksLikeDateLikePhone(t)) return true;
  if (looksLikeDatePlusDecimalNoise(t)) return true;
  if (looksLikeCoordinateNoise(t)) return true;
  if (looksLikeDottedNumericNoise(t)) return true;
  if (looksLikeVersionOrBuildNumber(t)) return true;
  const digits = t.replace(/\D/g, '');
  if (looksLikeRepeatedDigitNoise(digits)) return true;
  if (/^(19|20)\d{2}$/.test(digits)) return true;
  if (digits.length >= 12 && !t.trim().startsWith('+')) return true;
  return false;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizePhoneCandidate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const base = String(raw).trim().replace(PHONE_TRAIL_RE, '');
  if (!base || base.includes('@')) return '';
  if (isLikelyJunkPhone(base)) return '';
  const digits = base.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  const hasPlus = base.trim().startsWith('+');
  if (!hasPlus && digits.length > 11) return '';
  if (!hasPlus && digits.length === 11 && !digits.startsWith('1')) return '';
  if (/\d{4}[-.\s]\d{4}[-.\s]\d{4}/.test(base)) return '';
  if (/^\+?\d+$/.test(base.replace(/\s+/g, ''))) {
    if (!base.trim().startsWith('+')) {
      if (digits.length < 10 || digits.length > 11) return '';
      if (digits.length === 11 && !digits.startsWith('1')) return '';
    }
  }
  if (!/[()\s.\-+]/.test(base) && digits.length >= 12) return '';
  return base;
}

/**
 * @param {string[]} candidates
 * @returns {string}
 */
export function pickBestPhone(candidates) {
  const uniq = [];
  const seen = new Set();
  for (const c of candidates || []) {
    const n = normalizePhoneCandidate(String(c || ''));
    if (!n) continue;
    const k = n.replace(/\D/g, '');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (!uniq.length) return '';
  uniq.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
  return uniq[0] || '';
}
