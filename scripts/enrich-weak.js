/**
 * Shared weak-lead detection for enrich (extension + Render API).
 */

import { normalizeEmailCandidate, isLikelyPlaceholderEmail } from './email-quality.js';

/**
 * True when LLM may still improve contact fields (missing/placeholder email or missing phone with a site).
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {boolean}
 */
export function isWeakLeadForLlm(row) {
  if (!row || typeof row !== 'object') return true;
  const email = normalizeEmailCandidate(String(row.email || ''));
  if (!email || isLikelyPlaceholderEmail(email)) return true;
  const phone = String(row.phone || '').trim();
  const website = String(row.websiteUrl || '').trim();
  const hasFetchableSite =
    /^https?:\/\//i.test(website) && !/instagram\.com|instagr\.am/i.test(website);
  if (!phone && hasFetchableSite) return true;
  return false;
}
