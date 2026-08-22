/**
 * Peakora Dodo Payments integration — hub-portable billing module.
 *
 * Self-contained: the checkout-session creator + webhook verifier live here so
 * the whole module can move to the central hub unchanged. server.js only wires
 * it to Express routes and the JSON-file store.
 *
 * Env vars:
 *   DODO_PAYMENTS_API_KEY        — secret API key (server-side only, never exposed)
 *   DODO_PAYMENTS_ENVIRONMENT    — "test_mode" | "live_mode"  (default test_mode)
 *   DODO_MONTHLY_PRODUCT_ID      — pdt_... for the $4.99/mo plan
 *   DODO_YEARLY_PRODUCT_ID       — pdt_... for the $47.99/yr plan
 *   DODO_PAYMENTS_WEBHOOK_SECRET — Standard Webhooks signing secret
 *   APP_PUBLIC_URL               — public base URL for return_url / cancel_url
 */
import crypto from 'crypto';

const BASE_URLS = {
  test_mode: 'https://testapi.dodopayments.com',
  live_mode: 'https://api.dodopayments.com'
};

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v);
}

export function dodoConfig() {
  const environment = env('DODO_PAYMENTS_ENVIRONMENT', 'test_mode');
  return {
    apiKey: env('DODO_PAYMENTS_API_KEY'),
    environment,
    baseUrl: BASE_URLS[environment] || BASE_URLS.test_mode,
    webhookSecret: env('DODO_PAYMENTS_WEBHOOK_SECRET'),
    monthlyProductId: env('DODO_MONTHLY_PRODUCT_ID'),
    yearlyProductId: env('DODO_YEARLY_PRODUCT_ID'),
    publicUrl: env('APP_PUBLIC_URL', '').replace(/\/+$/, ''),
    configured: Boolean(env('DODO_PAYMENTS_API_KEY'))
  };
}

/** Public-safe config for the frontend (no secrets). */
export function dodoPublicConfig() {
  const c = dodoConfig();
  return {
    provider: 'dodo',
    environment: c.environment,
    configured: c.configured && Boolean(c.monthlyProductId && c.yearlyProductId),
    monthlyPrice: '$4.99',
    yearlyPrice: '$47.99',
    merchantOfRecord: 'Dodo Payments'
  };
}

const PLAN_PRODUCTS = {
  monthly: () => dodoConfig().monthlyProductId,
  yearly: () => dodoConfig().yearlyProductId
};

/**
 * Resolve a plan key ("monthly" | "yearly") to a Dodo product id.
 * Falls back to an explicit productId argument.
 */
export function resolveProductId(plan, productId) {
  if (productId) return productId;
  const fn = PLAN_PRODUCTS[plan];
  return fn ? fn() : '';
}

/**
 * Create a Dodo hosted checkout session.
 * @param {{plan?: string, productId?: string, email?: string, metadata?: object}} opts
 * @returns {Promise<{checkout_url: string, session_id?: string}>}
 */
export async function createCheckoutSession({ plan = 'monthly', productId, email, metadata } = {}) {
  const cfg = dodoConfig();
  if (!cfg.apiKey) {
    const err = new Error('Dodo Payments not configured (DODO_PAYMENTS_API_KEY missing)');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const resolvedProduct = resolveProductId(plan, productId);
  if (!resolvedProduct) {
    const err = new Error(`No Dodo product id for plan "${plan}" (set DODO_${plan.toUpperCase()}_PRODUCT_ID)`);
    err.code = 'NO_PRODUCT';
    throw err;
  }

  const returnUrl = cfg.publicUrl
    ? `${cfg.publicUrl}/thankyou.html?status=success&plan=${encodeURIComponent(plan)}`
    : '/thankyou.html?status=success&plan=' + encodeURIComponent(plan);

  const body = {
    product_cart: [{ product_id: resolvedProduct, quantity: 1 }],
    return_url: returnUrl
  };
  if (email) body.customer = { email };
  if (metadata && typeof metadata === 'object') body.metadata = metadata;

  let resp;
  try {
    resp = await fetch(`${cfg.baseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (netErr) {
    const err = new Error(`Unable to reach Dodo Payments API (${cfg.baseUrl}). Check network connectivity and that DODO_PAYMENTS_ENVIRONMENT is correct.`);
    err.code = 'DODO_UNREACHABLE';
    err.cause = netErr.message;
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Dodo API error ${resp.status}: ${text.slice(0, 300)}`);
    err.code = 'DODO_API_ERROR';
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return {
    checkout_url: data.checkout_url,
    session_id: data.session_id || data.id || null
  };
}

/**
 * Verify a Dodo webhook (Standard Webhooks spec).
 * Signed message = `${webhook-id}.${webhook-timestamp}.${rawBody}`.
 * Header webhook-signature may contain multiple "v1,..." signatures; any match passes.
 * @param {Buffer|string} rawBody — the exact raw request body
 * @param {{'webhook-id'?: string, 'webhook-signature'?: string, 'webhook-timestamp'?: string}} headers
 * @returns {boolean}
 */
export function verifyDodoWebhook(rawBody, headers) {
  const cfg = dodoConfig();
  if (!cfg.webhookSecret) return false; // never accept unsigned when unconfigured
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);

  const msgId = headers['webhook-id'];
  const msgTs = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!msgId || !msgTs || !sigHeader) return false;

  // Reject stale timestamps (>5 min) to blunt replay attacks.
  const tsNum = Number(msgTs);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  const signed = `${msgId}.${msgTs}.${body}`;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(signed).digest('base64');

  // Header may be "v1,base64sig" or comma-separated multiple.
  for (const part of sigHeader.split(' ')) {
    const sig = part.startsWith('v1,') ? part.slice(3) : part;
    if (sig.length === expected.length) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return true;
      } catch { /* length mismatch already guarded */ }
    }
  }
  return false;
}

/**
 * Map a Dodo webhook payload to a normalized subscription record.
 * Handles subscription.* and payment.* event types.
 */
export function mapDodoEvent(payload) {
  const type = payload.type || payload.event_type || '';
  const data = payload.data || payload;
  const sub = data.subscription || data;
  const customer = data.customer || {};

  const email = customer.email || data.email || sub.email || null;
  const productId = sub.product_id || data.product_id || null;
  const plan = (productId === dodoConfig().yearlyProductId)
    ? 'yearly'
    : (productId === dodoConfig().monthlyProductId ? 'monthly' : (sub.plan || planFromType(type) || 'monthly'));

  let status = 'active';
  const t = type.toLowerCase();
  if (t.includes('cancel') || t.includes('paused') || t.includes('expired')) status = 'canceled';
  else if (t.includes('failed') || t.includes('past_due')) status = 'past_due';

  return {
    email,
    status,
    plan,
    transactionId: sub.id || data.subscription_id || data.payment_id || data.id || ('DODO-' + Date.now().toString().slice(-6)),
    eventType: type,
    method: data.payment_method || sub.payment_method || 'Dodo Payments',
    updatedAt: new Date().toISOString()
  };
}

function planFromType(type) {
  // No reliable plan signal in event type alone; left as fallback.
  return null;
}
