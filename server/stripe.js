/**
 * Stripe Checkout + webhook — uses Render env:
 * STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET,
 * PUBLIC_BASE_URL or RENDER_EXTERNAL_URL for return URLs.
 */

import express from 'express';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const STRIPE_PRODUCT_ID = (process.env.STRIPE_PRODUCT_ID || '').trim();

const LOG_LEVEL = (process.env.LEADFLOW_LOG_LEVEL || 'info').toLowerCase();

function logInfo(msg, extra) {
  if (LOG_LEVEL === 'error' || LOG_LEVEL === 'warn') return;
  if (extra) console.info(`[stripe] ${msg}`, extra);
  else console.info(`[stripe] ${msg}`);
}

function logWarn(msg, extra) {
  if (LOG_LEVEL === 'error') return;
  if (extra) console.warn(`[stripe] ${msg}`, extra);
  else console.warn(`[stripe] ${msg}`);
}

/** @type {Stripe | null} */
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function publicBaseUrl() {
  const raw = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  return raw || '';
}

function checkoutReturnUrls() {
  const base = publicBaseUrl();
  if (!base) return null;
  return {
    success_url: `${base}/v1/stripe/checkout-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/v1/stripe/checkout-return?canceled=1`,
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleStripeCheckoutSession(req, res) {
  if (!stripe || !STRIPE_PRICE_ID) {
    return res.status(503).json({
      error: 'stripe_misconfigured',
      message: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID on the server.',
    });
  }
  const urls = checkoutReturnUrls();
  if (!urls) {
    return res.status(503).json({
      error: 'stripe_misconfigured',
      message: 'Set PUBLIC_BASE_URL (or rely on RENDER_EXTERNAL_URL on Render) so success/cancel URLs are HTTPS.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : '';

  /** @type {import('stripe').Stripe.Checkout.SessionCreateParams} */
  const params = {
    mode: 'subscription',
    /** Shows “Add promotion code” on hosted Checkout (Dashboard → Coupons / Promotion codes). */
    allow_promotion_codes: true,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: urls.success_url,
    cancel_url: urls.cancel_url,
    metadata: {
      source: 'megaleads_extension',
      ...(STRIPE_PRODUCT_ID ? { product_id: STRIPE_PRODUCT_ID } : {}),
    },
  };
  if (customerEmail.includes('@')) {
    params.customer_email = customerEmail;
  }

  try {
    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) {
      return res.status(502).json({ error: 'stripe_no_url', message: 'Checkout session had no URL.' });
    }
    return res.json({ url: session.url });
  } catch (e) {
    logWarn('checkout_session_failed', { err: String(e?.message || e) });
    return res.status(502).json({
      error: 'stripe_checkout_failed',
      message: 'Could not create Stripe Checkout session.',
    });
  }
}

/**
 * Raw body route — must be registered before express.json().
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleStripeWebhook(req, res) {
  if (!STRIPE_WEBHOOK_SECRET) {
    logWarn('webhook_called_without_secret');
    return res.status(503).send('Webhook not configured');
  }
  if (!stripe) {
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string') {
    return res.status(400).send('Missing stripe-signature');
  }

  let event;
  try {
    const raw = req.body;
    if (!Buffer.isBuffer(raw) && typeof raw !== 'string') {
      return res.status(400).send('Invalid body');
    }
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn('webhook_signature_failed', { msg });
    return res.status(400).send(`Webhook Error: ${msg}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = /** @type {import('stripe').Stripe.Checkout.Session} */ (event.data.object);
      logInfo('checkout.session.completed', {
        id: session.id,
        customer: session.customer,
        subscription: session.subscription,
        email: session.customer_details?.email || session.customer_email,
      });
      break;
    }
    default:
      logInfo(`webhook_event_${event.type}`, { id: event.id });
  }

  return res.json({ received: true });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleStripeCheckoutReturn(req, res) {
  const canceled = req.query.canceled === '1' || req.query.canceled === 'true';
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  const title = canceled ? 'Checkout canceled' : 'Thank you';
  const body = canceled
    ? '<p>Your checkout was canceled. You can close this tab.</p>'
    : `<p>Your subscription checkout completed.</p>${sessionId ? `<p class="sub">Session reference: <code>${escapeHtml(sessionId)}</code></p>` : ''}<p>You can close this tab and return to MegaLeadsAI.</p>`;

  res
    .status(200)
    .type('html')
    .send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)} — MegaLeadsAI</title><style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5}code{font-size:.85em}.sub{color:#555;font-size:.9rem}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Register POST /v1/stripe/webhook with raw body (call before express.json()).
 * @param {import('express').Express} app
 */
export function attachStripeWebhookRoute(app) {
  app.post('/v1/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    void handleStripeWebhook(req, res);
  });
}
