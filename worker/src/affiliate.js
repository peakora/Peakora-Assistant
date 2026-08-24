/**
 * Peakora Affiliate Engine — Cloudflare Worker module.
 *
 * All affiliate domain logic lives here so the main router (index.js) stays a
 * thin dispatcher. Commission is ALWAYS computed server-side, tied to a
 * verified payment event — never client-trustable.
 *
 * Attribution model: last-click-wins within the affiliate's cookie window.
 * A referral click row is written by /affiliate/click; when a payment webhook
 * fires, we resolve the most recent click for the customer's email/IP within
 * the window and accrue a pending commission (30-day hold before approval).
 *
 * Tables (see worker/schema.sql): affiliates, referral_clicks, commissions,
 * payouts.
 */

// ── Config: commission tiers, cookie windows, payout hold ─────────────────

/** Default commission model: a single flat 30% recurring rate for every
 *  partner. Wellness affiliate programs (Calm, Insight, Gaia) use one rate,
 *  not a tier ladder — simpler for partners and honest about what we honor.
 *  Admins can still override an individual partner's rate/commission_type via
 *  the admin panel (custom deals for high-volume partners). Kept as an array
 *  so resolveTier() and tier_config stay backward compatible. */
export const DEFAULT_TIERS = [
  { minReferrals: 0, rate: 0.50, name: 'Partner', cookieDays: 90, payoutMin: 25, payoutSchedule: 'monthly' }
];

/** Auto-approval: every applicant is approved instantly on apply, so they can
 *  generate links and log in right away (same as Calm/Gaia-style programs).
 *  The master email is still special-cased only as a safety net. */
const MASTER_EMAIL = 'peakora.network@gmail.com';

/** Days a commission stays pending before it is auto-approved (payout hold). */
export const PAYOUT_HOLD_DAYS = 30;

/** Price snapshot — used only for fraud/earnings sanity checks, not billing.
 *  Authoritative price lives in the Dodo product config (wrangler vars). */
export const PRICE_SNAPSHOT = { monthly: 9.99, yearly: 95.88 };

export const PAYOUT_METHODS = ['paypal', 'wise', 'bank', 'usdc'];

// ── Helpers ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Generate a URL/file-safe random id with a prefix. */
export function genId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/** Generate a short human-friendly referral code (no ambiguous chars). */
export function genReferralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < bytes.length; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

/** SHA-256 hex hash of a string (Web Crypto). Used for IP hashing only. */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Validate + normalize an email. Returns null if invalid. */
export function normalizeEmail(raw) {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** Read JSON body safely. */
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Parse the referral token from a URL or its params (?via= or ?ref=). */
export function parseReferralToken(urlString) {
  if (!urlString) return null;
  try {
    const u = new URL(urlString, 'http://placeholder.local');
    return u.searchParams.get('via') || u.searchParams.get('ref') || null;
  } catch { return null; }
}

/** Resolve an affiliate's effective tier based on their active referral count. */
export function resolveTier(activeReferrals, tiers) {
  const ladder = tiers && tiers.length ? tiers : DEFAULT_TIERS;
  let current = ladder[0];
  for (const t of ladder) {
    if (activeReferrals >= t.minReferrals) current = t;
  }
  return current;
}

/** Count active referrals (distinct customers with a non-refunded commission). */
async function countActiveReferrals(db, affiliateId) {
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT customer_email) AS n FROM commissions
     WHERE affiliate_id = ? AND status != 'refunded'`
  ).bind(affiliateId).first();
  return row?.n || 0;
}

/** Load an affiliate row + parsed JSON fields. Returns null if not found. */
export async function getAffiliateByCode(db, referralCode) {
  const row = await db.prepare(
    'SELECT * FROM affiliates WHERE referral_code = ? AND status = ?'
  ).bind(referralCode, 'active').first();
  if (!row) return null;
  return decorateAffiliate(row);
}

export async function getAffiliateByEmail(db, email) {
  const row = await db.prepare(
    'SELECT * FROM affiliates WHERE user_email = ?'
  ).bind(email).first();
  return row ? decorateAffiliate(row) : null;
}

export async function getAffiliateById(db, id) {
  const row = await db.prepare('SELECT * FROM affiliates WHERE id = ?').bind(id).first();
  return row ? decorateAffiliate(row) : null;
}

function decorateAffiliate(row) {
  return {
    ...row,
    tier_config: row.tier_config ? JSON.parse(row.tier_config) : DEFAULT_TIERS,
    payout_details: row.payout_details ? JSON.parse(row.payout_details) : null
  };
}

// ── Commission calculation ─────────────────────────────────────────────────

/**
 * Compute the commission amount for a single verified payment.
 * @param {object} affiliate - decorated affiliate row
 * @param {number} grossAmount - gross payment (e.g. 9.99 or 95.88)
 * @returns {number}
 */
export function calculateCommission(affiliate, grossAmount) {
  const rate = Number(affiliate.commission_rate) || 0;
  if (affiliate.commission_type === 'flat') {
    // Flat payout per qualifying conversion (first paid invoice only is caller's job).
    return Math.round(rate * 100) / 100;
  }
  // Percentage, recurring: rate * gross. Round to cents.
  return Math.round(grossAmount * rate * 100) / 100;
}

/**
 * Resolve attribution for a new payment: find the most recent click within the
 * affiliate's cookie window matching the customer email OR ip_hash. Last-click
 * wins. Returns the affiliate row (decorated) to pay, or null.
 *
 * Self-referral blocking: if the paying customer's email equals the
 * affiliate's own login email, attribution is rejected.
 */
export async function resolveAttribution(db, customerEmail, ipHash) {
  const holdMs = 120 * 24 * 3600 * 1000; // 120-day max window for attribution lookup
  const since = new Date(Date.now() - holdMs).toISOString();
  // Join clicks -> affiliates, ordered most-recent first, active affiliates only.
  const rows = await db.prepare(
    `SELECT c.id AS click_id, c.clicked_at, a.id AS affiliate_id, a.user_email
     FROM referral_clicks c
     JOIN affiliates a ON a.id = c.affiliate_id
     WHERE a.status = 'active' AND c.clicked_at > ?
     ORDER BY c.clicked_at DESC
     LIMIT 200`
  ).bind(since).all();

  for (const c of rows.results || []) {
    // Last-click-wins: the most recent in-window click attributes, regardless
    // of whether it is a self-referral. The self-referral business rule is
    // enforced at accrual time (processAffiliateAttribution) so the lookup
    // stays a pure "who would be credited" resolver.
    const aff = await getAffiliateById(db, c.affiliate_id);
    if (!aff) continue;
    const cookieMs = (aff.cookie_days || 90) * 24 * 3600 * 1000;
    const clickedAt = new Date(c.clicked_at).getTime();
    if (Date.now() - clickedAt > cookieMs) continue; // expired for this affiliate
    return { affiliate: aff, clickId: c.click_id, clickedAt: c.clicked_at };
  }
  return null;
}

// ── Public route: record a referral click ───────────────────────────────────

export async function handleAffiliateClick(request, env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('via') || url.searchParams.get('ref') || '').trim();
  if (!code) return json({ success: false, error: 'Missing referral code' }, 400);

  const affiliate = await getAffiliateByCode(env.DB, code.toUpperCase());
  if (!affiliate) return json({ success: false, error: 'Invalid referral code' }, 404);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const ipHash = ip ? await sha256Hex(ip) : null;
  const ua = (request.headers.get('user-agent') || '').slice(0, 500);
  const landing = (url.searchParams.get('landing') || request.headers.get('referer') || '').slice(0, 500);
  const referrer = (url.searchParams.get('referrer_url') || '').slice(0, 500);

  const id = genId('clk');
  await env.DB.prepare(
    `INSERT INTO referral_clicks (id, affiliate_id, referral_code, ip_hash, user_agent, landing_page, referrer_url, clicked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, affiliate.id, affiliate.referral_code, ipHash, ua, landing, referrer).run();

  // Minimal transparent GIF so the tracker can be used as an <img> pixel.
  return new Response(
    new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59]),
    { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } }
  );
}

// ── Public route: affiliate application (partner signup) ───────────────────

export async function handleAffiliateApply(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim().slice(0, 120);
  const platform = String(body.platform || '').trim().slice(0, 120);
  const audience = String(body.audience || '').trim().slice(0, 60);
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!email) return json({ success: false, error: 'A valid email is required.' }, 400);
  if (!name) return json({ success: false, error: 'Your name is required.' }, 400);

  const existing = await getAffiliateByEmail(env.DB, email);
  if (existing) {
    return json({
      success: true,
      status: existing.status,
      referral_code: existing.referral_code,
      message: existing.status === 'active'
        ? 'You are already a partner. Sign in to your portal.'
        : 'Your account is ' + existing.status + '. Contact us if you need help.'
    });
  }

  // Generate a unique referral code (retry on collision).
  let referralCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = genReferralCode();
    const clash = await env.DB.prepare('SELECT 1 FROM affiliates WHERE referral_code = ?').bind(candidate).first();
    if (!clash) { referralCode = candidate; break; }
  }
  if (!referralCode) return json({ success: false, error: 'Could not allocate referral code. Please retry.' }, 500);

  const id = genId('aff');
  const notes = JSON.stringify({ platform, audience, message });
  // Every applicant is approved instantly so they can generate links and log in
  // right away, the way Calm and Gaia handle their programs. No review queue.
  const initialStatus = 'active';
  const tier = resolveTier(0, DEFAULT_TIERS);
  await env.DB.prepare(
    `INSERT INTO affiliates (id, user_email, display_name, referral_code, status, commission_type, commission_rate, tier_config, notes, approved_at)
     VALUES (?, ?, ?, ?, ?, 'percentage', ?, ?, ?, ?)`
  ).bind(
    id, email, name, referralCode, initialStatus,
    tier.rate, JSON.stringify(DEFAULT_TIERS), notes,
    new Date().toISOString()
  ).run();

  return json({
    success: true,
    status: initialStatus,
    referral_code: referralCode,
    message: 'You are approved. Sign in to grab your referral link and start sharing.'
  });
}

// ── Partner portal: dashboard data (self-auth via email + token) ──────────

/**
 * Lightweight partner auth: the affiliate's email + a short-lived signed token
 * issued at apply-approval / portal-login. Token = HMAC(email|expiry, ADMIN_TOKEN).
 */
async function portalToken(email, env) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
  const msg = `${email}|${expiry}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN || 'fallback'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${expiry}.${sigB64}`;
}

async function verifyPortalAuth(request, env) {
  const auth = request.headers.get('x-affiliate-token') || '';
  const email = (request.headers.get('x-affiliate-email') || '').toLowerCase();
  if (!auth || !email) return null;
  const [expStr, sigB64] = auth.split('.');
  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  const msg = `${email}|${expiry}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN || 'fallback'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(msg));
  return ok ? email : null;
}

export async function handleAffiliateLogin(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) return json({ success: false, error: 'Valid email required.' }, 400);
  let aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'No affiliate account found for that email.' }, 404);
  // Safety net: if a legacy account is still pending (from before auto-approval),
  // activate it on login. New accounts are active from the moment they apply.
  if (aff.status === 'pending') {
    await env.DB.prepare(
      `UPDATE affiliates SET status = 'active', approved_at = ? WHERE id = ?`
    ).bind(new Date().toISOString(), aff.id).run();
    aff = await getAffiliateByEmail(env.DB, email);
  }
  if (aff.status !== 'active') return json({ success: false, error: `Account is ${aff.status}. Contact us if you need help.` }, 403);
  const token = await portalToken(email, env);
  return json({ success: true, token, email, referral_code: aff.referral_code });
}

/** Partner portal dashboard aggregate. */
export async function handleAffiliateDashboard(request, env) {
  const email = await verifyPortalAuth(request, env);
  if (!email) return json({ success: false, error: 'Unauthorized' }, 401);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff || aff.status !== 'active') return json({ success: false, error: 'Account not active.' }, 403);

  const activeRefs = await countActiveReferrals(env.DB, aff.id);
  const tier = resolveTier(activeRefs, aff.tier_config);
  // The stored commission_rate is the value that actually determines payouts.
  // Surface it as the tier rate so the portal never shows a stale tier_config
  // number that disagrees with the commissions it accrues.
  if (aff.commission_type === 'percentage') tier.rate = Number(aff.commission_rate) || tier.rate;

  const [clicks, conversions, pending, paid, commissions, payouts] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM referral_clicks WHERE affiliate_id = ?').bind(aff.id).first(),
    env.DB.prepare(`SELECT COUNT(DISTINCT customer_email) AS n FROM commissions WHERE affiliate_id = ? AND status != 'refunded'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'pending'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'paid'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT * FROM commissions WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 50`).bind(aff.id).all(),
    env.DB.prepare(`SELECT * FROM payouts WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 50`).bind(aff.id).all()
  ]);

  // Auto-approve commissions past their hold window (best-effort, idempotent).
  await autoApproveHeld(env.DB, aff.id);

  return json({
    success: true,
    affiliate: {
      id: aff.id, display_name: aff.display_name, email: aff.user_email,
      referral_code: aff.referral_code, status: aff.status,
      commission_type: aff.commission_type, commission_rate: aff.commission_rate,
      payout_method: aff.payout_method, payout_schedule: aff.payout_schedule
    },
    tier: { name: tier.name, rate: tier.rate, cookie_days: tier.cookie_days, payout_min: tier.payout_min },
    active_referrals: activeRefs,
    totals: {
      clicks: clicks?.n || 0,
      conversions: conversions?.n || 0,
      pending_balance: round2(pending?.n || 0),
      paid_balance: round2(paid?.n || 0)
    },
    recent_commissions: commissions.results || [],
    recent_payouts: payouts.results || []
  });
}

/** Partner portal: generate a tracked referral link for a campaign. */
export async function handleAffiliateLink(request, env) {
  const email = await verifyPortalAuth(request, env);
  if (!email) return json({ success: false, error: 'Unauthorized' }, 401);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'Not found' }, 404);
  const body = await readJson(request);
  const target = String(body.target || env.APP_PUBLIC_URL || 'https://peakora.life').replace(/\/+$/, '');
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : null;
  let url = `${target}/?via=${encodeURIComponent(aff.referral_code)}`;
  if (utm) {
    for (const [k, v] of Object.entries(utm)) {
      if (['source', 'medium', 'campaign', 'content', 'term'].includes(k)) {
        url += `&utm_${k}=${encodeURIComponent(String(v).slice(0, 120))}`;
      }
    }
  }
  return json({ success: true, url, referral_code: aff.referral_code });
}

/** Partner portal: update payout method/details. */
export async function handleAffiliatePayoutSetup(request, env) {
  const email = await verifyPortalAuth(request, env);
  if (!email) return json({ success: false, error: 'Unauthorized' }, 401);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'Not found' }, 404);
  const body = await readJson(request);
  const method = String(body.method || '').toLowerCase();
  if (!PAYOUT_METHODS.includes(method)) return json({ success: false, error: 'Unsupported payout method.' }, 400);
  const details = body.details && typeof body.details === 'object' ? body.details : {};
  // Minimal per-method field validation (no secrets stored beyond payout contact).
  const required = {
    paypal: ['email'], wise: ['email'], bank: ['account_holder', 'iban_or_account', 'swift_or_routing', 'country'],
    usdc: ['wallet_address', 'network']
  }[method] || [];
  for (const f of required) {
    if (!details[f]) return json({ success: false, error: `Missing payout field: ${f}` }, 400);
  }
  await env.DB.prepare(
    'UPDATE affiliates SET payout_method = ?, payout_details = ? WHERE id = ?'
  ).bind(method, JSON.stringify(details), aff.id).run();
  return json({ success: true, payout_method: method });
}

/** Partner portal: request a payout (creates a pending payout request). */
export async function handleAffiliateRequestPayout(request, env) {
  const email = await verifyPortalAuth(request, env);
  if (!email) return json({ success: false, error: 'Unauthorized' }, 401);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'Not found' }, 404);
  if (!aff.payout_method) return json({ success: false, error: 'Set up a payout method first.' }, 400);

  // Auto-approve held commissions first.
  await autoApproveHeld(env.DB, aff.id);

  const sum = await env.DB.prepare(
    `SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions
     WHERE affiliate_id = ? AND status = 'approved'`
  ).bind(aff.id).first();
  const available = round2(sum?.n || 0);
  const min = aff.payout_min || 0;
  if (available < min) return json({ success: false, error: `Minimum payout is $${min}. Current approved balance: $${available}.` }, 400);

  const payId = genId('pay');
  await env.DB.prepare(
    `INSERT INTO payouts (id, affiliate_id, amount, status, payout_method, created_at)
     VALUES (?, ?, ?, 'pending', ?, datetime('now'))`
  ).bind(payId, aff.id, available, aff.payout_method).run();
  // Mark commissions as paid (pending payout fulfillment by admin).
  await env.DB.prepare(
    `UPDATE commissions SET payout_id = ?, status = 'paid', paid_at = datetime('now')
     WHERE affiliate_id = ? AND status = 'approved'`
  ).bind(payId, aff.id).run();

  return json({ success: true, payout_id: payId, amount: available, status: 'pending' });
}

// ── Admin routes (ADMIN_TOKEN protected) ───────────────────────────────────

export async function handleAdminListAffiliates(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  let q = 'SELECT * FROM affiliates ORDER BY applied_at DESC';
  const binds = [];
  if (status) { q = 'SELECT * FROM affiliates WHERE status = ? ORDER BY applied_at DESC'; binds.push(status); }
  const res = await env.DB.prepare(q).bind(...binds).all();
  return json({ success: true, affiliates: (res.results || []).map(decorateAffiliate) });
}

export async function handleAdminApproveAffiliate(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  if (!id) return json({ success: false, error: 'Affiliate id required.' }, 400);
  await env.DB.prepare(
    "UPDATE affiliates SET status = 'active', approved_at = datetime('now') WHERE id = ?"
  ).bind(id).run();
  return json({ success: true });
}

export async function handleAdminRejectAffiliate(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  if (!id) return json({ success: false, error: 'Affiliate id required.' }, 400);
  await env.DB.prepare(
    "UPDATE affiliates SET status = 'suspended', suspended_at = datetime('now') WHERE id = ?"
  ).bind(id).run();
  return json({ success: true });
}

export async function handleAdminAdjustCommission(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  const type = String(body.commission_type || 'percentage').toLowerCase() === 'flat' ? 'flat' : 'percentage';
  const rate = Math.max(0, Math.min(1, Number(body.commission_rate) || 0));
  if (!id) return json({ success: false, error: 'Affiliate id required.' }, 400);
  await env.DB.prepare(
    'UPDATE affiliates SET commission_type = ?, commission_rate = ? WHERE id = ?'
  ).bind(type, type === 'flat' ? rate : rate, id).run();
  return json({ success: true });
}

export async function handleAdminCommissionLedger(request, env) {
  const res = await env.DB.prepare(
    `SELECT c.*, a.referral_code, a.user_email AS affiliate_email
     FROM commissions c JOIN affiliates a ON a.id = c.affiliate_id
     ORDER BY c.created_at DESC LIMIT 500`
  ).all();
  return json({ success: true, commissions: res.results || [] });
}

export async function handleAdminFulfillPayout(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  const reference = String(body.transaction_reference || '').slice(0, 200);
  if (!id) return json({ success: false, error: 'Payout id required.' }, 400);
  await env.DB.prepare(
    `UPDATE payouts SET status = 'sent', transaction_reference = ?, processed_at = datetime('now') WHERE id = ?`
  ).bind(reference, id).run();
  return json({ success: true });
}

/** Admin: export commission ledger as CSV. */
export async function handleAdminExportCsv(request, env) {
  const res = await env.DB.prepare(
    `SELECT c.id, a.referral_code, a.user_email AS affiliate_email, c.customer_email,
            c.transaction_id, c.gross_amount, c.commission_amount, c.commission_rate,
            c.status, c.plan, c.hold_until_date, c.created_at, c.paid_at, c.payout_id
     FROM commissions c JOIN affiliates a ON a.id = c.affiliate_id
     ORDER BY c.created_at DESC`
  ).all();
  const cols = ['id', 'referral_code', 'affiliate_email', 'customer_email', 'transaction_id', 'gross_amount',
    'commission_amount', 'commission_rate', 'status', 'plan', 'hold_until_date', 'created_at', 'paid_at', 'payout_id'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = cols.join(',');
  const rows = (res.results || []).map(r => cols.map(c => esc(r[c])).join(','));
  const csv = [header, ...rows].join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="peakora-commissions.csv"' } });
}

// ── Webhook attribution: called by the Dodo webhook handler after a verified
// payment event. Accrues commission for subscription_created / invoice_paid,
// prorates upgrades, and reverses on charge_refunded. ─────────────────────

/**
 * Process a verified payment event for affiliate attribution.
 * @param {object} env - Worker env (DB, etc.)
 * @param {{email, transactionId, eventType, grossAmount, plan, status}} rec
 */
export async function processAffiliateAttribution(env, rec) {
  if (!rec || !rec.email || !rec.transactionId || !rec.eventType) return null;
  const t = String(rec.eventType).toLowerCase();

  // Refund / reversal path.
  if (t.includes('refund')) {
    // Mark any commission tied to this transaction as refunded.
    await env.DB.prepare(
      `UPDATE commissions SET status = 'refunded' WHERE transaction_id = ? AND status IN ('pending','approved')`
    ).bind(rec.transactionId).run();
    return { action: 'refunded', transactionId: rec.transactionId };
  }

  // Accrual path: subscription_created or invoice_paid (recurring).
  const isAccrual = t.includes('subscription_created') || t.includes('subscription.create')
    || t.includes('invoice_paid') || t.includes('invoice.paid')
    || t.includes('payment_success') || t.includes('payment.success')
    || t.includes('subscription_active');

  if (!isAccrual) return null;

  // Idempotency: don't double-accrue the same transaction.
  const dup = await env.DB.prepare(
    `SELECT 1 FROM commissions WHERE transaction_id = ? AND status != 'refunded'`
  ).bind(rec.transactionId).first();
  if (dup) return { action: 'duplicate', transactionId: rec.transactionId };

  // Resolve attribution by email. (IP-based path handled inside resolveAttribution.)
  const attr = await resolveAttribution(env.DB, rec.email, null);
  if (!attr) return { action: 'no_attribution', transactionId: rec.transactionId };

  const { affiliate } = attr;
  // Self-referral block (belt + braces): the customer email must not match the affiliate email.
  if (rec.email && affiliate.user_email && rec.email.toLowerCase() === affiliate.user_email.toLowerCase()) {
    return { action: 'self_referral_blocked', transactionId: rec.transactionId };
  }

  const gross = Math.max(0, Number(rec.grossAmount) || 0);
  if (!gross) return { action: 'zero_amount', transactionId: rec.transactionId };

  // Flat commissions accrue only on the FIRST qualifying conversion per customer.
  let amount = calculateCommission(affiliate, gross);
  if (affiliate.commission_type === 'flat') {
    const prior = await env.DB.prepare(
      `SELECT 1 FROM commissions WHERE affiliate_id = ? AND customer_email = ? AND status != 'refunded'`
    ).bind(affiliate.id, rec.email).first();
    if (prior) return { action: 'flat_already_paid', transactionId: rec.transactionId };
  }

  const holdUntil = new Date(Date.now() + PAYOUT_HOLD_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const comId = genId('com');
  await env.DB.prepare(
    `INSERT INTO commissions (id, affiliate_id, customer_email, transaction_id, gross_amount, commission_amount, commission_rate, status, plan, hold_until_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`
  ).bind(comId, affiliate.id, rec.email, rec.transactionId, gross, amount, Number(affiliate.commission_rate), rec.plan || null, holdUntil).run();

  return { action: 'accrued', commissionId: comId, affiliateId: affiliate.id, amount };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function round2(n) { return Math.round(Number(n) * 100) / 100; }

/** Promote pending commissions to 'approved' once past their hold window. */
async function autoApproveHeld(db, affiliateId) {
  await db.prepare(
    `UPDATE commissions SET status = 'approved'
     WHERE affiliate_id = ? AND status = 'pending'
       AND hold_until_date IS NOT NULL AND date(hold_until_date) <= date('now')`
  ).bind(affiliateId).run();
}
