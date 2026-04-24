/**
 * Copy this file to `scripts/leadflow-remote-config.js` (gitignored) and fill in values
 * that match your Render Web Service (`MEGALEADS_API_KEY` must match `apiKey` here).
 *
 *   cp scripts/leadflow-remote-config.example.js scripts/leadflow-remote-config.js
 */

/** @example https://megaleads.onrender.com */
export const apiBaseUrl = '';

/**
 * Same value as Render env `MEGALEADS_API_KEY` (a secret you chose — not OpenAI).
 */
export const apiKey = '';

/**
 * Optional: OpenAI key (sk-…) for Josh only. If set, the extension sends it to your API and the
 * server uses it for chat completions (so Render does not need OPENAI_API_KEY for Josh).
 * Prefer setting OPENAI_API_KEY on the server for production.
 */
export const openAiApiKey = '';
