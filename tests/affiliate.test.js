/**
 * Peakora Affiliate Engine tests — node:test.
 *
 * Tests the pure attribution + commission logic and the webhook commission
 * flow using an in-memory fake D1 (so no Cloudflare runtime is required).
 * Run: node --test tests/affiliate.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReferralToken, calculateCommission, resolveTier, genReferralCode,
  genId, normalizeEmail, sha256Hex, DEFAULT_TIERS, PAYOUT_HOLD_DAYS,
  PRICE_SNAPSHOT, PAYOUT_METHODS,
  processAffiliateAttribution
} from '../worker/src/affiliate.js';

// ── Fake D1 ─────────────────────────────────────────────────────────────────
/**
 * A minimal in-memory D1 that implements prepare(...).bind(...).run/first/all
 * for the small set of queries the affiliate module uses. Each table is its
 * own array so joins read cleanly. Not a SQL engine.
 */
function makeFakeDb() {
  const db = {
    affiliates: [],
    referral_clicks: [],
    commissions: [],
    payouts: []
  };
  // The queries we must support are emitted against whichever table the SQL
  // mentions first. We route by keyword.
  function tableFor(sql) {
    const s = sql.toLowerCase();
    if (s.includes('from referral_clicks') || s.includes('into referral_clicks')) return db.referral_clicks;
    if (s.includes('from commissions') || s.includes('into commissions') || s.includes('update commissions')) return db.commissions;
    if (s.includes('from payouts') || s.includes('into payouts') || s.includes('update payouts')) return db.payouts;
    return db.affiliates;
  }
  const prepared = (sql) => ({
    bind: (...params) => ({
      run: async () => { exec(sql, params); return { success: true }; },
      first: async () => exec(sql, params, 'first'),
      all: async () => ({ results: exec(sql, params, 'all') })
    })
  });
  db.prepare = prepared;

  function exec(sql, params, mode) {
    const s = sql.toLowerCase();
    // SELECT 1 FROM commissions WHERE transaction_id = ?
    if (s.includes('select 1 from commissions where transaction_id')) {
      const txn = params[0];
      const found = db.commissions.find(r => r.transaction_id === txn && r.status !== 'refunded');
      return mode === 'first' ? (found ? { 1: 1 } : null) : [];
    }
    // SELECT 1 FROM commissions WHERE affiliate_id = ? AND customer_email = ?
    if (s.includes('select 1 from commissions where affiliate_id') && s.includes('customer_email')) {
      const found = db.commissions.find(r => r.affiliate_id === params[0] && r.customer_email === params[1] && r.status !== 'refunded');
      return mode === 'first' ? (found ? { 1: 1 } : null) : [];
    }
    // SELECT * FROM affiliates WHERE id = ?
    if (s.includes('select * from affiliates where id = ?')) {
      const row = db.affiliates.find(r => r.id === params[0]);
      return mode === 'first' ? (row ? { ...row } : null) : (row ? [row] : []);
    }
    // SELECT * FROM affiliates WHERE referral_code = ? AND status = ?
    if (s.includes('select * from affiliates where referral_code = ? and status = ?')) {
      const row = db.affiliates.find(r => r.referral_code === params[0] && r.status === params[1]);
      return mode === 'first' ? (row ? { ...row } : null) : [];
    }
    // SELECT 1 FROM affiliates WHERE referral_code = ?
    if (s.includes('select 1 from affiliates where referral_code')) {
      const found = db.affiliates.find(r => r.referral_code === params[0]);
      return mode === 'first' ? (found ? { 1: 1 } : null) : [];
    }
    // Attribution join: clicks -> affiliates ordered by clicked_at DESC
    if (s.includes('from referral_clicks c') && s.includes('join affiliates a')) {
      const out = [];
      for (const c of db.referral_clicks) {
        const a = db.affiliates.find(x => x.id === c.affiliate_id);
        if (a) out.push({ click_id: c.id, clicked_at: c.clicked_at, affiliate_id: a.id, user_email: a.user_email });
      }
      out.sort((x, y) => (x.clicked_at < y.clicked_at ? 1 : -1));
      return mode === 'all' ? out.slice(0, 200) : out[0];
    }
    // UPDATE commissions SET status = 'refunded' WHERE transaction_id = ?
    if (s.includes("update commissions set status = 'refunded'") && s.includes('where transaction_id')) {
      db.commissions.forEach(r => { if (r.transaction_id === params[0]) r.status = 'refunded'; });
      return mode === 'first' ? null : [];
    }
    // INSERT INTO commissions ... (placeholder-by-position)
    if (s.startsWith('insert into commissions')) {
      const placeholders = (sql.match(/\?/g) || []).length;
      const row = {};
      for (let i = 0; i < placeholders; i++) row['__p' + i] = params[i];
      // Map known columns by position for the insert query we emit.
      row.id = params[0];
      row.affiliate_id = params[1];
      row.customer_email = params[2];
      row.transaction_id = params[3];
      row.gross_amount = params[4];
      row.commission_amount = params[5];
      row.commission_rate = params[6];
      row.status = 'pending';
      row.plan = params[7];
      row.hold_until_date = params[8];
      db.commissions.push(row);
      return mode === 'first' ? null : [];
    }
    return mode === 'all' ? [] : null;
  }
  return db;
}

// ── Tests: pure functions ──────────────────────────────────────────────────
describe('referral token parsing', () => {
  test('extracts ?via= code', () => {
    assert.equal(parseReferralToken('https://peakora.life/?via=ABC123'), 'ABC123');
  });
  test('extracts ?ref= code', () => {
    assert.equal(parseReferralToken('https://peakora.life/?ref=XYZ789'), 'XYZ789');
  });
  test('returns null when no token present', () => {
    assert.equal(parseReferralToken('https://peakora.life/'), null);
  });
  test('returns null for empty/garbage input', () => {
    assert.equal(parseReferralToken(''), null);
    assert.equal(parseReferralToken(null), null);
  });
  test('prefers via when present before ref', () => {
    assert.equal(parseReferralToken('https://peakora.life/?via=AAA&ref=BBB'), 'AAA');
  });
});

describe('commission calculation', () => {
  test('percentage recurring: 30% of $9.99 = $3.00', () => {
    const aff = { commission_type: 'percentage', commission_rate: 0.30 };
    assert.equal(calculateCommission(aff, 9.99), 3.00);
  });
  test('percentage recurring: 40% of $95.88 = $38.35', () => {
    const aff = { commission_type: 'percentage', commission_rate: 0.40 };
    assert.equal(calculateCommission(aff, 95.88), 38.35);
  });
  test('flat: fixed amount regardless of gross', () => {
    const aff = { commission_type: 'flat', commission_rate: 5 };
    assert.equal(calculateCommission(aff, 4.99), 5);
    assert.equal(calculateCommission(aff, 47.99), 5);
  });
  test('zero rate yields zero', () => {
    const aff = { commission_type: 'percentage', commission_rate: 0 };
    assert.equal(calculateCommission(aff, 4.99), 0);
  });
});

describe('tier resolution', () => {
  test('Starter (0 referrals)', () => {
    assert.equal(resolveTier(0, DEFAULT_TIERS).name, 'Starter');
    assert.equal(resolveTier(0, DEFAULT_TIERS).rate, 0.30);
  });
  test('Growth (25 referrals)', () => {
    assert.equal(resolveTier(25, DEFAULT_TIERS).name, 'Growth');
    assert.equal(resolveTier(50, DEFAULT_TIERS).rate, 0.35);
  });
  test('Elite (100+ referrals)', () => {
    assert.equal(resolveTier(100, DEFAULT_TIERS).name, 'Elite');
    assert.equal(resolveTier(500, DEFAULT_TIERS).rate, 0.40);
    assert.equal(resolveTier(500, DEFAULT_TIERS).cookieDays, 120);
  });
  test('falls back to DEFAULT_TIERS when none provided', () => {
    assert.equal(resolveTier(0, null).name, 'Starter');
    // Empty array => DEFAULT_TIERS used, so 100 referrals resolve to Elite.
    assert.equal(resolveTier(100, []).name, 'Elite');
    assert.equal(resolveTier(100, []).rate, 0.40);
  });
});

describe('referral code generation', () => {
  test('generates 6-char codes from safe alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = genReferralCode();
      assert.equal(code.length, 6);
      assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, 'no ambiguous chars I/O/0/1');
    }
  });
  test('genId has prefix', () => {
    assert.match(genId('aff'), /^aff_[0-9a-f]{24}$/);
    assert.match(genId('com'), /^com_[0-9a-f]{24}$/);
  });
});

describe('email normalization', () => {
  test('lowercases and trims', () => {
    assert.equal(normalizeEmail('  Ala@Peakora.LIFE  '), 'ala@peakora.life');
  });
  test('rejects invalid', () => {
    assert.equal(normalizeEmail('not-an-email'), null);
    assert.equal(normalizeEmail(''), null);
    assert.equal(normalizeEmail(null), null);
  });
});

describe('sha256 hashing', () => {
  test('deterministic hex output', async () => {
    const h = await sha256Hex('1.2.3.4');
    assert.match(h, /^[0-9a-f]{64}$/);
    const h2 = await sha256Hex('1.2.3.4');
    assert.equal(h, h2);
  });
  test('different inputs produce different hashes', async () => {
    const a = await sha256Hex('1.2.3.4');
    const b = await sha256Hex('5.6.7.8');
    assert.notEqual(a, b);
  });
});

describe('config constants', () => {
  test('tiers are ascending by referrals and rate', () => {
    for (let i = 1; i < DEFAULT_TIERS.length; i++) {
      assert.ok(DEFAULT_TIERS[i].minReferrals > DEFAULT_TIERS[i - 1].minReferrals);
      assert.ok(DEFAULT_TIERS[i].rate > DEFAULT_TIERS[i - 1].rate);
    }
  });
  test('payout hold is 30 days', () => {
    assert.equal(PAYOUT_HOLD_DAYS, 30);
  });
  test('payout methods include all 4 options', () => {
    for (const m of ['paypal', 'wise', 'bank', 'usdc']) {
      assert.ok(PAYOUT_METHODS.includes(m));
    }
  });
  test('price snapshot matches known prices', () => {
    assert.equal(PRICE_SNAPSHOT.monthly, 9.99);
    assert.equal(PRICE_SNAPSHOT.yearly, 95.88);
  });
});

// ── Tests: webhook commission attribution flow ────────────────────────────
describe('processAffiliateAttribution', () => {
  test('accrues commission for a qualifying subscription_created event', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const affiliate = {
      id: 'aff_1', user_email: 'partner@peakora.life', referral_code: 'ABCD12',
      status: 'active', commission_type: 'percentage', commission_rate: 0.30,
      cookie_days: 90
    };
    db.affiliates.push(affiliate);
    db.referral_clicks.push({
      id: 'clk_1', affiliate_id: 'aff_1', referral_code: 'ABCD12',
      clicked_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
    });

    const rec = {
      email: 'newbie@example.com', transactionId: 'DODO-001',
      eventType: 'subscription_created', grossAmount: 9.99, plan: 'monthly'
    };
    const result = await processAffiliateAttribution(env, rec);
    assert.equal(result.action, 'accrued');
    assert.equal(result.amount, 3.00);
    assert.equal(result.affiliateId, 'aff_1');
    const com = db.commissions[0];
    assert.ok(com, 'commission row persisted');
    assert.equal(com.commission_amount, 3.00);
    assert.equal(com.status, 'pending');
    assert.ok(com.hold_until_date);
  });

  test('blocks self-referral (customer == affiliate email)', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const affiliate = {
      id: 'aff_2', user_email: 'self@peakora.life', referral_code: 'SELF12',
      status: 'active', commission_type: 'percentage', commission_rate: 0.30,
      cookie_days: 90
    };
    db.affiliates.push(affiliate);
    db.referral_clicks.push({
      id: 'clk_2', affiliate_id: 'aff_2', referral_code: 'SELF12',
      clicked_at: new Date(Date.now() - 3600 * 1000).toISOString()
    });
    const rec = {
      email: 'self@peakora.life', transactionId: 'DODO-002',
      eventType: 'invoice_paid', grossAmount: 4.99
    };
    const result = await processAffiliateAttribution(env, rec);
    assert.equal(result.action, 'self_referral_blocked');
    assert.equal(db.commissions.length, 0);
  });

  test('reverses commission on refund', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    db.commissions.push({
      id: 'com_1', affiliate_id: 'aff_x', customer_email: 'c@x.com',
      transaction_id: 'DODO-003', gross_amount: 4.99, commission_amount: 1.50,
      status: 'pending'
    });
    const rec = {
      email: 'c@x.com', transactionId: 'DODO-003',
      eventType: 'charge_refunded', grossAmount: 4.99
    };
    const result = await processAffiliateAttribution(env, rec);
    assert.equal(result.action, 'refunded');
    assert.equal(db.commissions[0].status, 'refunded');
  });

  test('does not double-accrue the same transaction (idempotent)', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const affiliate = {
      id: 'aff_3', user_email: 'p3@peakora.life', referral_code: 'DBL123',
      status: 'active', commission_type: 'percentage', commission_rate: 0.30,
      cookie_days: 90
    };
    db.affiliates.push(affiliate);
    db.referral_clicks.push({
      id: 'clk_3', affiliate_id: 'aff_3', referral_code: 'DBL123',
      clicked_at: new Date(Date.now() - 3600 * 1000).toISOString()
    });
    const rec = {
      email: 'dup@example.com', transactionId: 'DODO-DUP',
      eventType: 'invoice_paid', grossAmount: 4.99
    };
    const r1 = await processAffiliateAttribution(env, rec);
    assert.equal(r1.action, 'accrued');
    const r2 = await processAffiliateAttribution(env, rec);
    assert.equal(r2.action, 'duplicate');
    assert.equal(db.commissions.length, 1);
  });

  test('returns null for non-accrual, non-refund events', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const rec = {
      email: 'x@example.com', transactionId: 'DODO-XYZ',
      eventType: 'subscription_updated', grossAmount: 0
    };
    const result = await processAffiliateAttribution(env, rec);
    assert.equal(result, null);
  });

  test('flat commission accrues only on first conversion per customer', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const affiliate = {
      id: 'aff_flat', user_email: 'flat@peakora.life', referral_code: 'FLAT12',
      status: 'active', commission_type: 'flat', commission_rate: 5,
      cookie_days: 90
    };
    db.affiliates.push(affiliate);
    db.referral_clicks.push({
      id: 'clk_flat', affiliate_id: 'aff_flat', referral_code: 'FLAT12',
      clicked_at: new Date(Date.now() - 3600 * 1000).toISOString()
    });
    const rec1 = {
      email: 'flatcust@example.com', transactionId: 'DODO-F1',
      eventType: 'subscription_created', grossAmount: 4.99
    };
    const r1 = await processAffiliateAttribution(env, rec1);
    assert.equal(r1.action, 'accrued');
    assert.equal(r1.amount, 5);
    const rec2 = {
      email: 'flatcust@example.com', transactionId: 'DODO-F2',
      eventType: 'invoice_paid', grossAmount: 4.99
    };
    const r2 = await processAffiliateAttribution(env, rec2);
    assert.equal(r2.action, 'flat_already_paid');
    assert.equal(db.commissions.length, 1);
  });

  test('no attribution when no recent click exists', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const rec = {
      email: 'orphan@example.com', transactionId: 'DODO-ORPH',
      eventType: 'subscription_created', grossAmount: 4.99
    };
    const result = await processAffiliateAttribution(env, rec);
    assert.equal(result.action, 'no_attribution');
    assert.equal(db.commissions.length, 0);
  });
});
