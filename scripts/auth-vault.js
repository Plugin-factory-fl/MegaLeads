/**
 * Local credential vault (chrome.storage.local) — keeps users signed in on this device.
 * Passwords are hashed with PBKDF2; plaintext is never stored.
 */

import { STORAGE_KEYS } from './constants.js';

/** @param {string} email */
function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** @param {ArrayBuffer | Uint8Array} bytes */
function b64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** @param {string} s */
function fromB64(s) {
  const bin = atob(String(s || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 */
async function deriveHash(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/** @returns {Promise<{ v: number, accounts: Record<string, { salt: string, hash: string }> }>} */
async function readVault() {
  const { [STORAGE_KEYS.AUTH_VAULT]: raw } = await chrome.storage.local.get(STORAGE_KEYS.AUTH_VAULT);
  if (!raw || typeof raw !== 'object') return { v: 1, accounts: {} };
  const accounts =
    raw.accounts && typeof raw.accounts === 'object'
      ? /** @type {Record<string, { salt: string, hash: string }>} */ (raw.accounts)
      : {};
  return { v: 1, accounts };
}

/** @param {{ v: number, accounts: Record<string, { salt: string, hash: string }> }} vault */
async function writeVault(vault) {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_VAULT]: vault });
}

/**
 * @param {string} email
 * @param {string} password
 */
export async function registerPasswordForEmail(email, password) {
  const em = normEmail(email);
  if (!em.includes('@') || String(password || '').length < 8) return false;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  const vault = await readVault();
  vault.accounts[em] = { salt: b64(salt), hash: b64(hash) };
  await writeVault(vault);
  return true;
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean | null>} true/false if vault entry exists; null if no entry
 */
export async function verifyPasswordForEmail(email, password) {
  const em = normEmail(email);
  const vault = await readVault();
  const rec = vault.accounts[em];
  if (!rec) return null;
  const salt = fromB64(rec.salt);
  const expected = fromB64(rec.hash);
  const got = await deriveHash(password, salt);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

/** @param {string} email */
export async function hasStoredPasswordForEmail(email) {
  const em = normEmail(email);
  const vault = await readVault();
  return Boolean(vault.accounts[em]);
}

/**
 * @param {string} email
 * @param {boolean} [remember]
 */
export async function saveRememberedLoginEmail(email, remember = true) {
  const em = normEmail(email);
  if (!remember || !em.includes('@')) {
    await chrome.storage.local.remove(STORAGE_KEYS.AUTH_REMEMBER_EMAIL);
    return;
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.AUTH_REMEMBER_EMAIL]: { email: em, remember: true },
  });
}

/** @returns {Promise<string>} */
export async function readRememberedLoginEmail() {
  const { [STORAGE_KEYS.AUTH_REMEMBER_EMAIL]: raw } = await chrome.storage.local.get(
    STORAGE_KEYS.AUTH_REMEMBER_EMAIL,
  );
  if (!raw || typeof raw !== 'object' || raw.remember !== true) return '';
  const em = normEmail(raw.email);
  return em.includes('@') ? em : '';
}
