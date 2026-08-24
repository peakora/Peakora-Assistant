/**
 * Peakora shared API backend — Cloudflare Worker.
 *
 * Routes:
 *   GET  /dodo/config              — public payment config (link URLs, prices)
 *   POST /dodo/webhook             — receives Dodo payment events (HMAC-verified)
 *   GET  /subscription-status       — check subscription by email
 *   POST /subscribe                — email newsletter capture
 *   POST /feedback                 — user feedback
 *   POST /event                   — usage telemetry
 *   GET  /stats                    — admin dashboard stats (admin token)
 *   POST /push-subscribe           — web push subscription
 *   POST /push-unsubscribe         — remove web push subscription
 *   POST /push-broadcast           — admin push broadcast (admin token)
 *
 * Affiliate program (see affiliate.js):
 *   GET  /affiliate/click          — record a referral click (returns 1x1 GIF)
 *   POST /affiliate/apply          — partner application
 *   POST /affiliate/login          — partner portal login (email + password -> signed token)
 *   POST /affiliate/set-password   — set/change password (legacy one-time or authenticated)
 *   GET  /affiliate/dashboard      — partner portal aggregate (token auth)
 *   POST /affiliate/link           — generate a tracked referral link (token auth)
 *   POST /affiliate/payout-setup   — set payout method/details (token auth)
 *   POST /affiliate/request-payout — request a payout of approved balance (token auth)
 *   GET  /affiliate/admin/list           — list affiliates (admin token)
 *   POST /affiliate/admin/approve        — approve a partner (admin token)
 *   POST /affiliate/admin/reject         — suspend/reject a partner (admin token)
 *   POST /affiliate/admin/adjust-commission — set custom rate (admin token)
 *   POST /affiliate/admin/set-password  — set/reset a partner password (admin token)
 *   GET  /affiliate/admin/ledger         — commission ledger (admin token)
 *   POST /affiliate/admin/fulfill-payout — mark a payout sent (admin token)
 *   GET  /affiliate/admin/export.csv     — export commission ledger CSV (admin token)
 *
 * D1 binding: env.DB
 * KV binding:  env.AUTH (future: session tokens)
 */

// ── Dodo webhook verification (Standard Webhooks, Web Crypto API) ──────────

import {
  handleAffiliateClick, handleAffiliateApply, handleAffiliateLogin,
  handleAffiliateSetPassword, handleAffiliateDashboard, handleAffiliateLink,
  handleAffiliatePayoutSetup, handleAffiliateRequestPayout,
  handleAdminListAffiliates, handleAdminApproveAffiliate, handleAdminRejectAffiliate,
  handleAdminAdjustCommission, handleAdminSetAffiliatePassword,
  handleAdminCommissionLedger, handleAdminFulfillPayout,
  handleAdminExportCsv, processAffiliateAttribution
} from './affiliate.js';

async function verifyDodoWebhook(rawBody, headers, secret) {
  if (!secret) return false;
  const msgId = headers.get('webhook-id') || '';
  const msgTs = headers.get('webhook-timestamp') || '';
  const sigHeader = headers.get('webhook-signature') || '';
  if (!msgId || !msgTs || !sigHeader) return false;

  const tsNum = Number(msgTs);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  const signed = `${msgId}.${msgTs}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  for (const part of sigHeader.split(' ')) {
    const sig = part.startsWith('v1,') ? part.slice(3) : part;
    if (sig.length === expected.length && timingSafeCompare(sig, expected)) return true;
  }
  return false;
}

function timingSafeCompare(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-admin-token') || '';
  return timingSafeCompare(token, env.ADMIN_TOKEN);
}

// ── Dodo event mapping ────────────────────────────────────────────────────

/** Resolve the gross amount paid in a Dodo event (across event shapes). */
function resolveGrossAmount(data, sub) {
  const candidates = [
    data.amount, data.amount_paid, data.total, data.price,
    sub.amount, sub.amount_paid, sub.total,
    data.payment && data.payment.amount, data.invoice && data.invoice.amount_paid,
    data.amount_total, data.value
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Fall back to known plan prices (env-agnostic) so attribution still accrues.
  return null;
}

function mapDodoEvent(payload, env) {
  const type = payload.type || payload.event_type || '';
  const data = payload.data || payload;
  const sub = data.subscription || data;
  const customer = data.customer || {};

  const email = (customer.email || data.email || sub.email || '').toLowerCase() || null;
  const productId = sub.product_id || data.product_id || null;
  const yearlyId = env.DODO_YEARLY_PRODUCT_ID;
  const monthlyId = env.DODO_MONTHLY_PRODUCT_ID;
  const plan = (productId === yearlyId) ? 'yearly'
    : (productId === monthlyId ? 'monthly' : (sub.plan || 'monthly'));

  let status = 'active';
  const t = type.toLowerCase();
  if (t.includes('cancel') || t.includes('paused') || t.includes('expired')) status = 'canceled';
  else if (t.includes('failed') || t.includes('past_due')) status = 'past_due';

  return {
    email, status, plan, productId,
    transactionId: sub.id || data.subscription_id || data.payment_id || data.id || ('DODO-' + Date.now().toString().slice(-6)),
    eventType: type,
    method: data.payment_method || sub.payment_method || 'Dodo Payments',
    grossAmount: resolveGrossAmount(data, sub),
    updatedAt: new Date().toISOString()
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const ALLOWED_ORIGINS = [
  'https://peakora-assistant.pages.dev',
  'https://peakora.life',
  'https://www.peakora.life',
  'https://peakora-api.peakora.workers.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

function cors(response, request) {
  const origin = request ? (request.headers.get('Origin') || '') : '';
  // Affiliate portal + local dev run on the same origins; allow echo for same-site.
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  response.headers.set('Access-Control-Allow-Origin', allowOrigin);
  response.headers.set('Vary', 'Origin');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-affiliate-token, x-affiliate-email');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

async function readJson(request) {
  const text = await request.text();
  try { return JSON.parse(text); }
  catch { return {}; }
}

// ── Route handlers ─────────────────────────────────────────────────────────

async function handleDodoConfig(_request, env) {
  return json({
    success: true,
    provider: 'dodo',
    environment: env.DODO_ENVIRONMENT || 'test_mode',
    configured: true,
    monthlyPrice: '$9.99',
    yearlyPrice: '$95.88',
    merchantOfRecord: 'Dodo Payments',
    monthlyLink: env.DODO_MONTHLY_PAYMENT_LINK,
    yearlyLink: env.DODO_YEARLY_PAYMENT_LINK
  });
}

async function handleDodoWebhook(request, env) {
  const rawBody = await request.text();
  const verified = await verifyDodoWebhook(rawBody, request.headers, env.DODO_PAYMENTS_WEBHOOK_SECRET);
  if (!verified) {
    return json({ success: false, error: 'Invalid signature' }, 401);
  }
  const payload = JSON.parse(rawBody);
  const rec = mapDodoEvent(payload, env);
  if (!rec.email) {
    return json({ success: false, error: 'No email in webhook payload' }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO subscriptions (email, status, plan, transaction_id, event_type, method, product_id, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       status=excluded.status, plan=excluded.plan, transaction_id=excluded.transaction_id,
       event_type=excluded.event_type, method=excluded.method, product_id=excluded.product_id,
       updated_at=excluded.updated_at`
  ).bind(rec.email, rec.status, rec.plan, rec.transactionId, rec.eventType, rec.method, rec.productId, rec.updatedAt).run();

  // Affiliate attribution: accrue/reverse commission for this verified payment.
  // Best-effort — a failure here must never break payment recording.
  let affiliateResult = null;
  try {
    affiliateResult = await processAffiliateAttribution(env, rec);
    if (affiliateResult) console.log(`[Affiliate] ${affiliateResult.action} | txn=${rec.transactionId}`);
  } catch (e) {
    console.warn('[Affiliate] attribution error (non-blocking):', e.message);
  }

  return json({ success: true, event_type: rec.eventType, status: rec.status, email: rec.email, affiliate: affiliateResult });
}

async function handleSubscriptionStatus(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ success: true, status: 'free', isPlus: false });

  // Master account — always full access, bypasses all paywalls
  const MASTER_EMAIL = 'peakora.network@gmail.com';
  if (email === MASTER_EMAIL) {
    return json({ success: true, email, status: 'active', plan: 'master', isPlus: true, isMaster: true });
  }

  const row = await env.DB.prepare(
    'SELECT email, status, plan, updated_at FROM subscriptions WHERE email = ?'
  ).bind(email).first();

  if (row) {
    return json({ success: true, ...row, isPlus: row.status === 'active' });
  }
  return json({ success: true, email, status: 'free', isPlus: false });
}

async function handleSubscribe(request, env) {
  const body = await readJson(request);
  const email = (body.email || '').trim().toLowerCase();
  const source = body.source || 'app';
  if (!EMAIL_RE.test(email)) return json({ success: false, error: 'Invalid email address.' }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscribers (email, source, consent, sequence, subscribed_at, last_seen_at)
     VALUES (?, ?, 1, 'welcome-3', ?, ?)
     ON CONFLICT(email) DO UPDATE SET last_seen_at=excluded.last_seen_at, source=excluded.source`
  ).bind(email, source, now, now).run();

  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM subscribers').first();
  return json({ success: true, total: count?.n || 0 });
}

async function handleFeedback(request, env) {
  const body = await readJson(request);
  const message = (body.message || '').trim().slice(0, 2000);
  if (!message) return json({ success: false, error: 'Message is empty.' }, 400);

  const id = 'fb_' + Date.now();
  await env.DB.prepare(
    'INSERT INTO feedback (id, message, rating, page, email, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, message, body.rating || null, body.page || '', (body.email || '').toLowerCase() || null, new Date().toISOString()).run();

  return json({ success: true });
}

async function handleEvent(request, env) {
  const body = await readJson(request);
  const action = (body.action || '').slice(0, 80);
  if (!action) return json({ success: false }, 400);

  await env.DB.prepare(
    'INSERT INTO events (action, details, timestamp) VALUES (?, ?, ?)'
  ).bind(action, JSON.stringify(body.details || {}), body.timestamp || new Date().toISOString()).run();

  return json({ success: true });
}

async function handleStats(_request, env) {
  const [subs, feedback, events, activeSubs] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as n FROM subscribers').first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM feedback').first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM events').first(),
    env.DB.prepare("SELECT COUNT(*) as n FROM subscriptions WHERE status = 'active'").first(),
  ]);
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const active24 = await env.DB.prepare('SELECT COUNT(*) as n FROM events WHERE timestamp > ?').bind(dayAgo).first();
  const topActions = await env.DB.prepare(
    'SELECT action, COUNT(*) as cnt FROM events GROUP BY action ORDER BY cnt DESC LIMIT 20'
  ).all();

  return json({
    success: true,
    subscribers: subs?.n || 0,
    feedback: feedback?.n || 0,
    events: events?.n || 0,
    activeLast24h: active24?.n || 0,
    activeSubscriptions: activeSubs?.n || 0,
    topActions: (topActions.results || []).map(r => [r.action, r.cnt])
  });
}

async function handlePushSubscribe(request, env) {
  const body = await readJson(request);
  if (!body || !body.endpoint) return json({ success: false }, 400);
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, keys, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET keys=excluded.keys`
  ).bind(body.endpoint, JSON.stringify(body.keys || {})).run();
  return json({ success: true });
}

async function handlePushUnsubscribe(request, env) {
  const body = await readJson(request);
  const endpoint = body.endpoint;
  if (!endpoint) return json({ success: false }, 400);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return json({ success: true });
}

// ── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), request);
    }

    let response;
    try {
      if (path === '/dodo/config' && method === 'GET') {
        response = await handleDodoConfig(request, env);
      } else if (path === '/dodo/webhook' && method === 'POST') {
        response = await handleDodoWebhook(request, env);
      } else if (path === '/subscription-status' && method === 'GET') {
        response = await handleSubscriptionStatus(request, env);
      } else if (path === '/subscribe' && method === 'POST') {
        response = await handleSubscribe(request, env);
      } else if (path === '/feedback' && method === 'POST') {
        response = await handleFeedback(request, env);
      } else if (path === '/event' && method === 'POST') {
        response = await handleEvent(request, env);
      } else if (path === '/stats' && method === 'GET') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleStats(request, env);
      } else if (path === '/push-subscribe' && method === 'POST') {
        response = await handlePushSubscribe(request, env);
      } else if (path === '/push-unsubscribe' && method === 'POST') {
        response = await handlePushUnsubscribe(request, env);

      /* ── Affiliate program: public + partner routes ── */
      } else if (path === '/affiliate/click' && method === 'GET') {
        response = await handleAffiliateClick(request, env);
      } else if (path === '/affiliate/apply' && method === 'POST') {
        response = await handleAffiliateApply(request, env);
      } else if (path === '/affiliate/login' && method === 'POST') {
        response = await handleAffiliateLogin(request, env);
      } else if (path === '/affiliate/set-password' && method === 'POST') {
        response = await handleAffiliateSetPassword(request, env);
      } else if (path === '/affiliate/dashboard' && method === 'GET') {
        response = await handleAffiliateDashboard(request, env);
      } else if (path === '/affiliate/link' && method === 'POST') {
        response = await handleAffiliateLink(request, env);
      } else if (path === '/affiliate/payout-setup' && method === 'POST') {
        response = await handleAffiliatePayoutSetup(request, env);
      } else if (path === '/affiliate/request-payout' && method === 'POST') {
        response = await handleAffiliateRequestPayout(request, env);

      /* ── Affiliate program: admin routes (ADMIN_TOKEN) ── */
      } else if (path === '/affiliate/admin/list' && method === 'GET') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminListAffiliates(request, env);
      } else if (path === '/affiliate/admin/approve' && method === 'POST') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminApproveAffiliate(request, env);
      } else if (path === '/affiliate/admin/reject' && method === 'POST') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminRejectAffiliate(request, env);
      } else if (path === '/affiliate/admin/adjust-commission' && method === 'POST') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminAdjustCommission(request, env);
      } else if (path === '/affiliate/admin/set-password' && method === 'POST') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminSetAffiliatePassword(request, env);
      } else if (path === '/affiliate/admin/ledger' && method === 'GET') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminCommissionLedger(request, env);
      } else if (path === '/affiliate/admin/fulfill-payout' && method === 'POST') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminFulfillPayout(request, env);
      } else if (path === '/affiliate/admin/export.csv' && method === 'GET') {
        if (!requireAdmin(request, env)) response = json({ success: false, error: 'Admin token required' }, 403);
        else response = await handleAdminExportCsv(request, env);
      } else {
        response = json({ success: false, error: 'Not found', path }, 404);
      }
    } catch (error) {
      console.error('Worker error:', error);
      response = json({ success: false, error: 'Internal server error' }, 500);
    }

    return cors(response, request);
  }
};
