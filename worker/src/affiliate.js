// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
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
 *  The master email is the program admin (is_admin = 1). */
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

const PBKDF2_ITER = 100000;

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

/** Hash a password with PBKDF2-SHA256 + random salt. Returns 'pbkdf2$iter$saltB64$hashB64'. */
export async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toB64(saltBytes);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  const hash = toB64(bits);
  return `pbkdf2${'$'}${PBKDF2_ITER}${'$'}${salt}${'$'}${hash}`;
}

/** Verify a password against a stored 'pbkdf2$iter$saltB64$hashB64' string. */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  const salt = fromB64(parts[2]);
  const expected = parts[3];
  if (!Number.isFinite(iter) || iter <= 0) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  const actual = toB64(bits);
  return timingSafeStrEq(actual, expected);
}

function timingSafeStrEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validate a password against minimum policy. */
export function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

/** Validate payout method + details; returns {method, details} or throws via return of null+reason. */
export function validatePayout(method, details) {
  if (!PAYOUT_METHODS.includes(method)) return { ok: false, error: 'Unsupported payout method.' };
  const obj = details && typeof details === 'object' ? details : {};
  const required = {
    paypal: ['email'], wise: ['email'], bank: ['account_holder', 'iban_or_account', 'swift_or_routing', 'country'],
    usdc: ['wallet_address', 'network']
  }[method] || [];
  for (const f of required) {
    if (!obj[f]) return { ok: false, error: `Missing payout field: ${f}` };
  }
  return { ok: true, method, details: obj };
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
    payout_details: row.payout_details ? JSON.parse(row.payout_details) : null,
    is_admin: Number(row.is_admin) === 1 || row.user_email === MASTER_EMAIL
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
 * Resolve attribution for a new payment using the referral code the customer
 * carried into checkout (metadata.via, echoed back by Dodo in the webhook).
 *
 * This is the professional, reliable pattern: the affiliate code is set at the
 * converting customer's checkout and comes back in the webhook, so commission
 * is paid to the affiliate who ACTUALLY referred THAT customer — not the most
 * recent click across all affiliates globally (the old, broken behavior).
 *
 * We still validate against a stored referral_click for that code within the
 * affiliate's cookie window: proof the customer genuinely clicked the link
 * before buying (last-click-wins within that affiliate's window). If no click
 * is recorded, no commission is paid (better to pay no one than the wrong one).
 *
 * Self-referral blocking is enforced at accrual time (processAffiliateAttribution).
 *
 * @param {D1Database} db
 * @param {string|null} referralCode  the metadata.via code from the webhook
 * @param {string|null} customerEmail  the paying customer's email (self-ref check)
 * @returns {Promise<{affiliate, clickId, clickedAt}|null>}
 */
export async function resolveAttribution(db, referralCode, customerEmail) {
  if (!referralCode) return null;
  const code = String(referralCode).trim().toUpperCase();

  // The affiliate whose link/code was used at checkout.
  const affiliate = await getAffiliateByCode(db, code);
  if (!affiliate || affiliate.status !== 'active') return null;

  // Validate a real click exists for this code within the cookie window
  // (last-click-wins). This proves the conversion followed a genuine referral.
  const cookieMs = (affiliate.cookie_days || 90) * 24 * 3600 * 1000;
  const since = new Date(Date.now() - cookieMs).toISOString();
  const click = await db.prepare(
    `SELECT id, clicked_at FROM referral_clicks
     WHERE referral_code = ? AND clicked_at > ?
     ORDER BY clicked_at DESC LIMIT 1`
  ).bind(code, since).first();
  // No recorded click in window -> cannot confirm the referral; pay no one.
  if (!click) return null;

  return { affiliate, clickId: click.id, clickedAt: click.clicked_at };
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
  const password = String(body.password || '');
  const platform = String(body.platform || '').trim().slice(0, 120);
  const audience = String(body.audience || '').trim().slice(0, 60);
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!email) return json({ success: false, error: 'A valid email is required.' }, 400);
  if (!name) return json({ success: false, error: 'Your name is required.' }, 400);
  if (!validPassword(password)) return json({ success: false, error: 'A password of at least 8 characters is required.' }, 400);

  const existing = await getAffiliateByEmail(env.DB, email);
  if (existing) {
    // One account per email, ever. Surface the stored code + a sign-in CTA so the
    // partner can reach their portal instead of re-applying (which used to confuse
    // people by hinting at a different code).
    return json({
      success: true,
      already_partner: true,
      status: existing.status,
      referral_code: existing.referral_code,
      message: existing.status === 'active'
        ? 'You are already a partner. Sign in to your portal to access your dashboard.'
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

  // Payout method is NOT collected at signup — partners set it later in the
  // portal once they have earnings. Signup stays frictionless: name + email +
  // password (or Google). Payout setup lives in the portal payout-setup route.

  const id = genId('aff');
  const passwordHash = await hashPassword(password);
  const notes = JSON.stringify({ platform, audience, message });
  // Every applicant is approved instantly so they can generate links and log in
  // right away, the way Calm and Gaia handle their programs. No review queue.
  const initialStatus = 'active';
  const tier = resolveTier(0, DEFAULT_TIERS);
  const isAdmin = email === MASTER_EMAIL ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO affiliates (id, user_email, password_hash, is_admin, display_name, referral_code, status, commission_type, commission_rate, tier_config, payout_min, payout_schedule, notes, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'percentage', ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, email, passwordHash, isAdmin, name, referralCode, initialStatus,
    tier.rate, JSON.stringify(DEFAULT_TIERS), tier.payoutMin, tier.payoutSchedule, notes,
    new Date().toISOString()
  ).run();

  return json({
    success: true,
    status: initialStatus,
    referral_code: referralCode,
    is_admin: isAdmin === 1,
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

/** Verify a partner portal token and return the affiliate if they are an admin.
 *  Used to unlock the admin panel via sign-in (Google or email) instead of the
 *  raw ADMIN_TOKEN. Exposed for the router. */
export async function verifyAdminPartner(request, env) {
  const email = await verifyPortalAuth(request, env);
  if (!email) return null;
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff || !aff.is_admin || aff.status !== 'active') return null;
  return aff;
}

export async function handleAffiliateLogin(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
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

  // Legacy migration: accounts created before passwords existed have no hash.
  // They must set a password once before they (or anyone else) can log in.
  if (!aff.password_hash) {
    // Google-only accounts have no password. Steer them to Google sign-in
    // instead of the dead-end set-password flow.
    if (aff.google_sub) {
      return json({ success: false, use_google: true, error: 'This account uses Google sign-in. Please continue with Google.' });
    }
    return json({ success: false, needs_password: true, error: 'Please set a password for your account to continue.' });
  }
  if (!password) return json({ success: false, error: 'Password is required.' }, 400);
  const ok = await verifyPassword(password, aff.password_hash);
  if (!ok) return json({ success: false, error: 'Incorrect email or password.' }, 401);

  const token = await portalToken(email, env);
  return json({ success: true, token, email, referral_code: aff.referral_code, is_admin: aff.is_admin });
}

/** One-time self-service password set for legacy accounts (no hash yet) OR an
 *  authenticated password change for partners already holding a valid token.
 *  This closes the email-only access hole: once a password exists, the email is
 *  not enough to reach the dashboard. */
export async function handleAffiliateSetPassword(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const newPassword = String(body.new_password || '');
  const currentPassword = String(body.current_password || '');
  if (!email) return json({ success: false, error: 'Valid email required.' }, 400);
  if (!validPassword(newPassword)) return json({ success: false, error: 'New password must be at least 8 characters.' }, 400);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'No affiliate account found for that email.' }, 404);

  if (aff.password_hash) {
    // Authenticated change: require the current password OR a valid portal token.
    const tokenEmail = await verifyPortalAuth(request, env);
    if (tokenEmail !== email) {
      const ok = await verifyPassword(currentPassword, aff.password_hash);
      if (!ok) return json({ success: false, error: 'Current password is incorrect.' }, 401);
    }
  } else if (aff.google_sub) {
    // Google-only accounts have no password and must NOT get one via this
    // unauthenticated path — that would let anyone who knows the email take
    // over the account. Direct them to Google sign-in.
    return json({ success: false, use_google: true, error: 'This account uses Google sign-in. Please continue with Google to access your portal.' }, 403);
  } else if (!await verifyPortalAuth(request, env)) {
    // Legacy passwordless account: require a valid portal token to set the
    // first password. This window only exists until a password is stored;
    // afterwards the authenticated-change path above requires the current password.
    return json({ success: false, error: 'Authentication required to set a password. Sign in via Google or use the portal link emailed to you.' }, 401);
  }
  const hash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE affiliates SET password_hash = ? WHERE id = ?').bind(hash, aff.id).run();
  const token = await portalToken(email, env);
  return json({ success: true, token, email, referral_code: aff.referral_code, message: 'Password set. You are signed in.' });
}

// ── Google sign-in (OAuth Authorization Code flow, server-side verified) ───
//
// Flow: frontend "Continue with Google" -> GET /affiliate/google/start builds a
// Google consent URL (client_id + redirect_uri + scope email+profile + state
// nonce) and 302-redirects the browser there. Google calls back to
// /affiliate/google/callback?code=&state=. The Worker exchanges the code for
// tokens (using GOOGLE_CLIENT_SECRET), fetches Google's authoritative userinfo
// (verified email + name + google subject id), then find-or-creates the
// affiliate and issues the same HMAC portal token used by email/password login.
// The token is passed back to the Pages portal via a URL fragment (never sent
// to a server on subsequent loads). No Firebase, no refresh tokens, no sessions.

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Build the public Google consent URL and redirect the browser to it.
 *  The redirect_uri is fixed to this Worker's /affiliate/google/callback. */
export function buildGoogleConsentUrl(env, state) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const redirect = `${env.APP_PUBLIC_URL_API || 'https://peakora-api.peakora.workers.dev'}/affiliate/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
    state: state,
    prompt: 'select_account'
  });
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
}

export async function handleAffiliateGoogleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ success: false, error: 'Google sign-in is not configured.' }, 503);
  const state = genId('gsta').slice(4); // opaque nonce
  const url = buildGoogleConsentUrl(env, state);
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
}

/** Exchange an authorization code for Google tokens, then fetch verified
 *  userinfo. Returns { sub, email, email_verified, name } or null. */
export async function exchangeGoogleCode(env, code) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const redirect = `${env.APP_PUBLIC_URL_API || 'https://peakora-api.peakora.workers.dev'}/affiliate/google/callback`;
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    }).toString()
  });
  if (!tokenRes.ok) return null;
  const tokens = await tokenRes.json();
  const access = tokens.access_token;
  if (!access) return null;
  const infoRes = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${access}` } });
  if (!infoRes.ok) return null;
  const info = await infoRes.json();
  if (!info.email || String(info.email_verified) !== 'true') return null;
  return { sub: String(info.sub || ''), email: String(info.email).toLowerCase(), email_verified: true, name: String(info.name || info.given_name || '') };
}

/** Find-or-create an affiliate from a verified Google profile. Google-only
 *  accounts have no password (password_hash stays null) — they always sign in
 *  via Google. If an email/password account already exists, Google sign-in
 *  links to it (links google_sub) and logs it in. */
export async function findOrCreateGoogleAffiliate(env, profile) {
  let aff = await getAffiliateByEmail(env.DB, profile.email);
  if (aff) {
    if (aff.status !== 'active') return { error: `Account is ${aff.status}. Contact us if you need help.`, status: 403 };
    // Link the Google subject id if not already stored.
    if (profile.sub && !aff.google_sub) {
      await env.DB.prepare('UPDATE affiliates SET google_sub = ? WHERE id = ?').bind(profile.sub, aff.id).run();
    }
    // Keep display name fresh only if the account never set one.
    if (!aff.display_name && profile.name) {
      await env.DB.prepare('UPDATE affiliates SET display_name = ? WHERE id = ?').bind(profile.name.slice(0, 120), aff.id).run();
    }
    // Safety net: activate a stale pending account on successful Google login.
    if (aff.status === 'pending') {
      await env.DB.prepare("UPDATE affiliates SET status = 'active', approved_at = ? WHERE id = ?").bind(new Date().toISOString(), aff.id).run();
    }
    return { aff: await getAffiliateByEmail(env.DB, profile.email) };
  }
  // No account yet: create one. Generate a unique referral code.
  let referralCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = genReferralCode();
    const clash = await env.DB.prepare('SELECT 1 FROM affiliates WHERE referral_code = ?').bind(candidate).first();
    if (!clash) { referralCode = candidate; break; }
  }
  if (!referralCode) return { error: 'Could not allocate referral code. Please retry.', status: 500 };
  const id = genId('aff');
  const isAdmin = profile.email === MASTER_EMAIL ? 1 : 0;
  const tier = resolveTier(0, DEFAULT_TIERS);
  await env.DB.prepare(
    `INSERT INTO affiliates (id, user_email, password_hash, google_sub, is_admin, display_name, referral_code, status, commission_type, commission_rate, tier_config, payout_min, payout_schedule, notes, approved_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', 'percentage', ?, ?, ?, ?, '{}', ?)`
  ).bind(
    id, profile.email, profile.sub, isAdmin, (profile.name || '').slice(0, 120), referralCode,
    tier.rate, JSON.stringify(DEFAULT_TIERS), tier.payoutMin, tier.payoutSchedule,
    new Date().toISOString()
  ).run();
  return { aff: await getAffiliateByEmail(env.DB, profile.email) };
}

export async function handleAffiliateGoogleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const error = url.searchParams.get('error') || '';
  const portalUrl = env.APP_PUBLIC_URL || 'https://peakora-assistant.pages.dev';
  const failRedirect = `${portalUrl}/affiliate-portal.html?google_error=1`;
  if (error) return new Response(null, { status: 302, headers: { Location: failRedirect, 'Cache-Control': 'no-store' } });
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response(null, { status: 302, headers: { Location: `${failRedirect}&reason=not_configured`, 'Cache-Control': 'no-store' } });
  }
  const profile = await exchangeGoogleCode(env, code);
  if (!profile) return new Response(null, { status: 302, headers: { Location: failRedirect, 'Cache-Control': 'no-store' } });
  const result = await findOrCreateGoogleAffiliate(env, profile);
  if (result.error) {
    return new Response(null, { status: 302, headers: { Location: `${failRedirect}&reason=${encodeURIComponent(result.error)}`, 'Cache-Control': 'no-store' } });
  }
  const aff = result.aff;
  const token = await portalToken(aff.user_email, env);
  // Pass credentials to the portal via a URL fragment so they never reach a
  // server log on later navigations. The portal JS reads + clears it.
  const payload = encodeURIComponent(JSON.stringify({ token, email: aff.user_email, referral_code: aff.referral_code, is_admin: aff.is_admin }));
  const okRedirect = `${portalUrl}/affiliate-portal.html#google_login=${payload}`;
  return new Response(null, { status: 302, headers: { Location: okRedirect, 'Cache-Control': 'no-store' } });
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

  const [clicks, conversions, pending, approved, paid, refunded, commissions, payouts, clickSeries, earningsSeries, topSources, statusCounts] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM referral_clicks WHERE affiliate_id = ?').bind(aff.id).first(),
    env.DB.prepare(`SELECT COUNT(DISTINCT customer_email) AS n FROM commissions WHERE affiliate_id = ? AND status != 'refunded'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'pending'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'approved'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'paid'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status = 'refunded'`).bind(aff.id).first(),
    env.DB.prepare(`SELECT * FROM commissions WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 50`).bind(aff.id).all(),
    env.DB.prepare(`SELECT * FROM payouts WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 50`).bind(aff.id).all(),
    // Daily click series, last 30 days. clicked_at is datetime('now') UTC text.
    env.DB.prepare(`SELECT substr(clicked_at,1,10) AS d, COUNT(*) AS n FROM referral_clicks WHERE affiliate_id = ? AND clicked_at >= datetime('now','-30 days') GROUP BY d ORDER BY d`).bind(aff.id).all(),
    // Daily earnings series, last 30 days (excludes refunded).
    env.DB.prepare(`SELECT substr(created_at,1,10) AS d, COALESCE(SUM(commission_amount),0) AS n FROM commissions WHERE affiliate_id = ? AND status != 'refunded' AND created_at >= datetime('now','-30 days') GROUP BY d ORDER BY d`).bind(aff.id).all(),
    // Top traffic sources by click count (referrer_url host). NULL/direct grouped as Direct.
    env.DB.prepare(`SELECT CASE WHEN referrer_url IS NULL OR referrer_url = '' THEN 'Direct' ELSE substr(replace(replace(referrer_url,'https://',''),'http://',''),1,instr(replace(replace(referrer_url,'https://',''),'http://','')||'/','/')-1) END AS source, COUNT(*) AS n FROM referral_clicks WHERE affiliate_id = ? GROUP BY source ORDER BY n DESC LIMIT 8`).bind(aff.id).all(),
    // Commission-status counts for the status donut.
    env.DB.prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(commission_amount),0) AS amt FROM commissions WHERE affiliate_id = ? GROUP BY status`).bind(aff.id).all()
  ]);

  // Auto-approve commissions past their hold window (best-effort, idempotent).
  await autoApproveHeld(env.DB, aff.id);

  // Build full 30-day date-keyed series so the chart has no gaps. D1 returns
  // dates as UTC 'YYYY-MM-DD' text from substr; walk the window explicitly.
  const seriesDays = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i);
    seriesDays.push(dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0'));
  }
  const clickIdx = {};
  (clickSeries.results || []).forEach(r => { clickIdx[r.d] = r.n; });
  const earnIdx = {};
  (earningsSeries.results || []).forEach(r => { earnIdx[r.d] = r.n; });
  const daily_series = seriesDays.map(d => ({
    date: d,
    clicks: clickIdx[d] || 0,
    earnings: round2(earnIdx[d] || 0)
  }));

  const totalEarnings = round2((pending?.n || 0) + (approved?.n || 0) + (paid?.n || 0));
  const totalClicks = clicks?.n || 0;
  const epc = totalClicks > 0 ? round2(totalEarnings / totalClicks) : 0;

  const statusMap = {};
  (statusCounts.results || []).forEach(r => { statusMap[r.status] = { count: r.n, amount: round2(r.amt) }; });
  ['pending', 'approved', 'paid', 'refunded'].forEach(s => { if (!statusMap[s]) statusMap[s] = { count: 0, amount: 0 }; });
  const totalCommissionCount = (statusMap.pending.count + statusMap.approved.count + statusMap.paid.count + statusMap.refunded.count);
  const refundRate = totalCommissionCount > 0 ? round2((statusMap.refunded.count / totalCommissionCount) * 100) : 0;

  return json({
    success: true,
    affiliate: {
      id: aff.id, display_name: aff.display_name, email: aff.user_email,
      referral_code: aff.referral_code, status: aff.status,
      commission_type: aff.commission_type, commission_rate: aff.commission_rate,
      payout_method: aff.payout_method, payout_schedule: aff.payout_schedule,
      payout_min: aff.payout_min, is_admin: aff.is_admin,
      google_only: !aff.password_hash && !!aff.google_sub
    },
    tier: { name: tier.name, rate: tier.rate, cookie_days: tier.cookieDays, payout_min: tier.payoutMin, payout_schedule: tier.payoutSchedule },
    active_referrals: activeRefs,
    totals: {
      clicks: totalClicks,
      conversions: conversions?.n || 0,
      pending_balance: round2(pending?.n || 0),
      available_balance: round2(approved?.n || 0),
      paid_balance: round2(paid?.n || 0),
      refunded_balance: round2(refunded?.n || 0),
      total_earnings: totalEarnings,
      epc,
      refund_rate: refundRate
    },
    daily_series,
    top_sources: (topSources.results || []).map(r => ({ source: r.source || 'Direct', clicks: r.n })),
    status_breakdown: statusMap,
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
  const pv = validatePayout(String(body.method || '').toLowerCase(), body.details);
  if (!pv.ok) return json({ success: false, error: pv.error }, 400);
  await env.DB.prepare(
    'UPDATE affiliates SET payout_method = ?, payout_details = ? WHERE id = ?'
  ).bind(pv.method, JSON.stringify(pv.details), aff.id).run();
  return json({ success: true, payout_method: pv.method });
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

/** Admin: permanently delete an affiliate and their dependent rows. Refuses to
 *  delete the master/admin account so the panel can never lock itself out. */
export async function handleAdminDeleteAffiliate(request, env) {
  const body = await readJson(request);
  const id = String(body.id || '');
  if (!id) return json({ success: false, error: 'Affiliate id required.' }, 400);
  const aff = await getAffiliateById(env.DB, id);
  if (!aff) return json({ success: false, error: 'Affiliate not found.' }, 404);
  if (aff.is_admin || aff.user_email === MASTER_EMAIL) {
    return json({ success: false, error: 'The admin account cannot be deleted.' }, 403);
  }
  await env.DB.prepare('DELETE FROM commissions WHERE affiliate_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM referral_clicks WHERE affiliate_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM payouts WHERE affiliate_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM affiliates WHERE id = ?').bind(id).run();
  return json({ success: true });
}

/** Admin panel sign-in check: confirms a partner portal token belongs to the
 *  admin account, so the panel can unlock via Google/email sign-in. Also
 *  accepts the raw ADMIN_TOKEN so the panel behaves consistently whether Ala
 *  unlocks with the token or a signed-in admin partner. */
function adminTokenMatches(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const url = new URL(request.url);
  const tok = url.searchParams.get('token') || request.headers.get('x-admin-token') || '';
  if (!tok || tok.length !== env.ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < tok.length; i++) diff |= tok.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

export async function handleAdminVerifyPartner(request, env) {
  if (adminTokenMatches(request, env)) {
    const aff = await getAffiliateByEmail(env.DB, MASTER_EMAIL);
    return json({ success: true, email: MASTER_EMAIL, referral_code: aff ? aff.referral_code : null, via: 'token' });
  }
  const aff = await verifyAdminPartner(request, env);
  if (!aff) return json({ success: false, error: 'Not an admin account.' }, 403);
  return json({ success: true, email: aff.user_email, referral_code: aff.referral_code, via: 'partner' });
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

/** Admin: set/reset a partner's password (bootstrap legacy accounts or resets). */
export async function handleAdminSetAffiliatePassword(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!email) return json({ success: false, error: 'Affiliate email required.' }, 400);
  if (!validPassword(password)) return json({ success: false, error: 'Password must be at least 8 characters.' }, 400);
  const aff = await getAffiliateByEmail(env.DB, email);
  if (!aff) return json({ success: false, error: 'Affiliate not found.' }, 404);
  const hash = await hashPassword(password);
  await env.DB.prepare('UPDATE affiliates SET password_hash = ? WHERE id = ?').bind(hash, aff.id).run();
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

  // Idempotency: dedup on the transaction id AND the webhook event id (if present)
  // so a replayed webhook never double-accrues commission. The transaction id is
  // now deterministic (stable Dodo ids, never Date.now()).
  const dup = await env.DB.prepare(
    `SELECT 1 FROM commissions WHERE transaction_id = ? AND status != 'refunded'`
  ).bind(rec.transactionId).first();
  if (dup) return { action: 'duplicate', transactionId: rec.transactionId };

  // Resolve attribution by the referral code carried in the checkout metadata.
  // No code -> no commission (pay no one rather than the wrong person).
  const attr = await resolveAttribution(env.DB, rec.referralCode, rec.email);
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
