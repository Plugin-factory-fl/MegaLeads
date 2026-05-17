/**
 * Chrome / browser password manager integration (Credential Management API + form hints).
 */

/**
 * Offer saved logins from the browser password manager (Chrome autofill picker).
 * @param {HTMLInputElement | null} emailEl
 * @param {HTMLInputElement | null} passwordEl
 */
export async function offerBrowserPasswordAutofill(emailEl, passwordEl) {
  if (!(emailEl instanceof HTMLInputElement) || !(passwordEl instanceof HTMLInputElement)) return;
  if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.get) return;
  if (emailEl.value.trim() && passwordEl.value) return;

  try {
    const cred = await navigator.credentials.get({
      password: true,
      mediation: 'optional',
    });
    if (!(cred instanceof PasswordCredential)) return;
    if (cred.id && !emailEl.value.trim()) emailEl.value = cred.id;
    if (cred.password && !passwordEl.value) passwordEl.value = cred.password;
  } catch {
    /* user dismissed or none saved */
  }
}

/**
 * Ask the browser to remember this login (Chrome “Save password?”).
 * @param {string} email
 * @param {string} password
 */
export async function storeBrowserPasswordCredential(email, password) {
  const id = String(email || '').trim();
  const pw = String(password || '');
  if (!id.includes('@') || pw.length < 8) return;
  if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.store) return;

  try {
    const cred = new PasswordCredential({
      id,
      password: pw,
      name: id,
    });
    await navigator.credentials.store(cred);
  } catch {
    /* declined or unsupported */
  }
}

/**
 * Wire password field to show Chrome saved-password picker on first focus.
 * @param {string} passwordInputId
 * @param {string} emailInputId
 */
export function wireBrowserPasswordAutofillOnFocus(passwordInputId, emailInputId) {
  const passwordEl = document.getElementById(passwordInputId);
  const emailEl = document.getElementById(emailInputId);
  if (!(passwordEl instanceof HTMLInputElement)) return;

  const offer = () => {
    void offerBrowserPasswordAutofill(
      emailEl instanceof HTMLInputElement ? emailEl : null,
      passwordEl,
    );
  };

  passwordEl.addEventListener('focus', offer, { once: true });
  if (emailEl instanceof HTMLInputElement) {
    emailEl.addEventListener('focus', offer, { once: true });
  }
}
