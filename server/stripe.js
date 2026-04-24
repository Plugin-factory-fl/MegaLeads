/**
 * Stripe Checkout + webhook — uses Render env:
 * STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET,
 * PUBLIC_BASE_URL or RENDER_EXTERNAL_URL for return URLs.
 *
 * Promotion codes at hosted Checkout:
 * - Customers must enter a **Promotion code** (Billing → Coupons → pick coupon → Promotion codes),
 *   not the Coupon API id (e.g. `25OFF`). The customer-facing `code` string is what Checkout expects.
 * - If the coupon is limited to **specific products**, that list must include the **Product** linked to
 *   `STRIPE_PRICE_ID` (see `checkout_price_product_id` on the Checkout Session in the Dashboard).
 * - Test-mode promotion codes only work with test keys; live with live.
 * - `allow_promotion_codes` cannot be combined with a pre-applied `discounts` entry on the same session.
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
  const rawPromo = typeof body.promotionCode === 'string' ? body.promotionCode.trim() : '';

  /** @type {import('stripe').Stripe.Checkout.SessionCreateParams} */
  const params = {
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: urls.success_url,
    cancel_url: urls.cancel_url,
    metadata: {
      source: 'megaleads_extension',
      ...(STRIPE_PRODUCT_ID ? { product_id: STRIPE_PRODUCT_ID } : {}),
    },
  };

  try {
    const price = await stripe.prices.retrieve(STRIPE_PRICE_ID);
    const pid = typeof price.product === 'string' ? price.product : price.product?.id;
    if (typeof pid === 'string' && pid) {
      params.metadata = { ...params.metadata, checkout_price_product_id: pid };
    }
  } catch (e) {
    logWarn('price_retrieve_for_metadata', { err: String(e?.message || e) });
  }

  if (rawPromo) {
    /** Pre-apply one code (mutually exclusive with `allow_promotion_codes` in Stripe). */
    let listed;
    try {
      listed = await stripe.promotionCodes.list({ code: rawPromo, active: true, limit: 10 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarn('promotion_code_list_failed', { err: msg });
      return res.status(400).json({
        error: 'promotion_code_lookup_failed',
        message: 'Could not look up that promotion code in Stripe.',
      });
    }
    const promo = listed.data[0];
    if (!promo) {
      return res.status(400).json({
        error: 'promotion_code_not_found',
        message:
          'No active Stripe promotion code matches that value (match is case-sensitive). Create a Promotion code on the coupon in the Dashboard, and use Test/Live mode that matches this server.',
      });
    }
    params.discounts = [{ promotion_code: promo.id }];
  } else {
    params.allow_promotion_codes = true;
  }

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
    const errMsg = e instanceof Error ? e.message : String(e);
    logWarn('checkout_session_failed', { err: errMsg });
    const stripeDetail =
      e && typeof e === 'object' && 'raw' in e && /** @type {{ message?: string }} */ (e.raw)?.message;
    return res.status(502).json({
      error: 'stripe_checkout_failed',
      message: 'Could not create Stripe Checkout session.',
      ...(typeof stripeDetail === 'string' && stripeDetail ? { detail: stripeDetail } : {}),
    });
  }
}

/**
 * Returns paid status for a customer email by checking Stripe subscriptions.
 * Paid = any subscription in `active` or `trialing`.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleStripeSubscriptionStatus(req, res) {
  if (!stripe) {
    return res.status(503).json({
      error: 'stripe_misconfigured',
      message: 'Set STRIPE_SECRET_KEY on the server.',
    });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'bad_request', message: 'Valid email is required.' });
  }
  try {
    const customers = await stripe.customers.list({ email, limit: 20 });
    const customerIds = customers.data.map((c) => c.id).filter(Boolean);
    if (!customerIds.length) {
      return res.json({ unlimited: false, status: 'none', source: 'stripe' });
    }
    let unlimited = false;
    let status = 'none';
    for (const customer of customerIds) {
      const subs = await stripe.subscriptions.list({ customer, limit: 100, status: 'all' });
      for (const sub of subs.data) {
        const st = String(sub.status || '').toLowerCase();
        if (st === 'active' || st === 'trialing') {
          unlimited = true;
          status = st;
          break;
        }
        if (status === 'none' && st) status = st;
      }
      if (unlimited) break;
    }
    return res.json({ unlimited, status, source: 'stripe' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logWarn('subscription_status_failed', { err: msg });
    return res.status(502).json({
      error: 'stripe_subscription_lookup_failed',
      message: 'Could not verify subscription status.',
    });
  }
}

/**
 * Creates a Stripe Billing Portal session for a customer email.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleStripeManageSubscriptionSession(req, res) {
  if (!stripe) {
    return res.status(503).json({
      error: 'stripe_misconfigured',
      message: 'Set STRIPE_SECRET_KEY on the server.',
    });
  }
  const base = publicBaseUrl();
  if (!base) {
    return res.status(503).json({
      error: 'stripe_misconfigured',
      message: 'Set PUBLIC_BASE_URL (or rely on RENDER_EXTERNAL_URL on Render).',
    });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'bad_request', message: 'Valid email is required.' });
  }
  try {
    const customers = await stripe.customers.list({ email, limit: 20 });
    if (!customers.data.length) {
      return res.status(404).json({
        error: 'customer_not_found',
        message: 'No Stripe customer found for this email.',
      });
    }
    let selectedCustomerId = '';
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, limit: 100, status: 'all' });
      const hasManageable = subs.data.some((s) => {
        const st = String(s.status || '').toLowerCase();
        return st !== 'incomplete_expired' && st !== 'canceled';
      });
      if (hasManageable) {
        selectedCustomerId = customer.id;
        break;
      }
    }
    if (!selectedCustomerId) selectedCustomerId = customers.data[0]?.id || '';
    if (!selectedCustomerId) {
      return res.status(404).json({
        error: 'customer_not_found',
        message: 'No Stripe customer found for this email.',
      });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: selectedCustomerId,
      return_url: `${base}/v1/stripe/checkout-return`,
    });
    if (!portal.url) {
      return res.status(502).json({
        error: 'stripe_no_url',
        message: 'Billing portal session had no URL.',
      });
    }
    return res.json({ url: portal.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logWarn('manage_subscription_session_failed', { err: msg });
    return res.status(502).json({
      error: 'stripe_billing_portal_failed',
      message: 'Could not create Stripe Billing Portal session.',
    });
  }
}

/**
 * @returns {Promise<Set<string>>}
 */
export async function listPaidSubscriberEmails() {
  /** @type {Set<string>} */
  const out = new Set();
  if (!stripe) return out;
  let startingAfter;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of page.data) {
      const st = String(sub.status || '').toLowerCase();
      if (st !== 'active' && st !== 'trialing') continue;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ? String(sub.customer.id) : '';
      if (!customerId) continue;
      try {
        const customer = await stripe.customers.retrieve(customerId);
        const email = String(customer?.email || '').trim().toLowerCase();
        if (email.includes('@')) out.add(email);
      } catch {
        /* ignore missing customer */
      }
    }
    if (!page.has_more || !page.data.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
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
