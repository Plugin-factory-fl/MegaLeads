/**
 * API endpoint + Bearer token for dashboard “AI enrich” (background proxy).
 * `apiKey` must match Render env `MEGALEADS_API_KEY` (a random secret you create — not `OPENAI_API_KEY`).
 *
 * For a fresh clone, edit the two exports below and reload the extension.
 */
export const apiBaseUrl = 'https://megaleads.onrender.com';

export const apiKey = '8008569420';

/**
 * OpenAI API key for Josh chat (sk-…). Sent with Josh requests so the server can call OpenAI
 * without Render having OPENAI_API_KEY. Anyone who unpacks the extension can see it — prefer
 * server env for production; this is for getting chat working quickly.
 */
export const openAiApiKey = '';

/**
 * Stripe Checkout or Payment Link URL (opens in a new browser tab).
 * Leave empty until you have a live link; the UI will show a short setup hint instead.
 */
export const stripeCheckoutUrl = '';
