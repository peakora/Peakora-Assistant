import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  dodoPublicConfig, createCheckoutSession,
  verifyDodoWebhook, mapDodoEvent
} from './dodo-billing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Tiny JSON-file persistence — the "database" lives in ./data as plain JSON */
function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJSON(file, value) {
  const tmp = path.join(DATA_DIR, file + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, path.join(DATA_DIR, file));
}

const store = {
  subscriptions: loadJSON('subscriptions.json', {}),
  subscribers: loadJSON('subscribers.json', []),
  feedback: loadJSON('feedback.json', []),
  events: loadJSON('events.json', []),
  pushSubs: loadJSON('push-subscriptions.json', [])
};
const persist = {
  subscriptions: () => saveJSON('subscriptions.json', store.subscriptions),
  subscribers: () => saveJSON('subscribers.json', store.subscribers),
  feedback: () => saveJSON('feedback.json', store.feedback),
  events: () => saveJSON('events.json', store.events),
  pushSubs: () => saveJSON('push-subscriptions.json', store.pushSubs)
};

function requireAdmin(req, res) {
  const token = req.query.token || req.get('x-admin-token') || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(403).json({ success: false, error: 'Admin token required (set ADMIN_TOKEN env var).' });
    return false;
  }
  return true;
}

/* Capture raw body for Dodo webhook signature verification */
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true }));

/* ------------------------------ EMAIL CAPTURE ------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/subscribe', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const source = String((req.body && req.body.source) || 'app');
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }
  const existing = store.subscribers.find(s => s.email === email);
  if (existing) {
    existing.lastSeenAt = new Date().toISOString();
    existing.source = existing.source || source;
  } else {
    store.subscribers.push({
      email,
      source,
      consent: true,
      sequence: 'welcome-3',
      subscribedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
  }
  persist.subscribers();
  console.log(`[Subscribe] ${email} via ${source} (total: ${store.subscribers.length})`);
  res.json({ success: true, total: store.subscribers.length });
});

app.get('/api/subscribers', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ success: true, total: store.subscribers.length, subscribers: store.subscribers });
});

/* -------------------------------- FEEDBACK --------------------------------- */
app.post('/api/feedback', (req, res) => {
  const body = req.body || {};
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ success: false, error: 'Message is empty.' });
  store.feedback.push({
    id: 'fb_' + Date.now(),
    message,
    rating: Number(body.rating) || null,
    page: String(body.page || ''),
    email: String(body.email || '').trim().toLowerCase() || null,
    timestamp: new Date().toISOString()
  });
  if (store.feedback.length > 2000) store.feedback = store.feedback.slice(-2000);
  persist.feedback();
  console.log(`[Feedback] new message (total: ${store.feedback.length})`);
  res.json({ success: true });
});

app.get('/api/feedback', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ success: true, total: store.feedback.length, feedback: store.feedback.slice(-200) });
});

/* --------------------------- USAGE TELEMETRY (light) ------------------------ */
app.post('/api/event', (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').slice(0, 80);
  if (!action) return res.status(400).json({ success: false });
  store.events.push({
    action,
    details: typeof body.details === 'object' && body.details ? body.details : {},
    timestamp: body.timestamp || new Date().toISOString()
  });
  if (store.events.length > 5000) store.events = store.events.slice(-5000);
  persist.events();
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const counts = {};
  store.events.forEach(e => { counts[e.action] = (counts[e.action] || 0) + 1; });
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  res.json({
    success: true,
    subscribers: store.subscribers.length,
    feedback: store.feedback.length,
    events: store.events.length,
    activeLast24h: store.events.filter(e => new Date(e.timestamp).getTime() > dayAgo).length,
    activeSubscriptions: Object.values(store.subscriptions).filter(s => s.status === 'active').length,
    pushSubscriptions: store.pushSubs.length,
    topActions: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20)
  });
});

/* ------------------------------- DODO PAYMENTS ----------------------------- */
/* Public-safe config for the frontend (no secrets leak here). */
app.get('/api/dodo-config', (_req, res) => {
  res.json({ success: true, ...dodoPublicConfig() });
});

/* Create a hosted checkout session and return the redirect URL. */
app.post('/api/dodo/checkout', async (req, res) => {
  try {
    const body = req.body || {};
    const plan = String(body.plan || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    const email = String(body.email || '').trim().toLowerCase() || null;
    const metadata = (typeof body.metadata === 'object' && body.metadata) ? body.metadata : {};

    const session = await createCheckoutSession({ plan, email, metadata });
    console.log(`[Dodo Checkout] session created for ${email || '(guest)'} plan=${plan}`);
    res.json({ success: true, checkout_url: session.checkout_url, session_id: session.session_id });
  } catch (error) {
    console.error('[Dodo Checkout Error]', error.message);
    const status = error.code === 'NOT_CONFIGURED' || error.code === 'NO_PRODUCT' || error.code === 'DODO_UNREACHABLE' ? 503
      : (error.status || 500);
    res.status(status).json({ success: false, error: error.message, code: error.code || null });
  }
});

/* Receive Dodo webhook events (Standard Webhooks spec). */
app.post('/api/dodo/webhook', (req, res) => {
  try {
    const headers = {
      'webhook-id': req.get('webhook-id') || '',
      'webhook-signature': req.get('webhook-signature') || '',
      'webhook-timestamp': req.get('webhook-timestamp') || ''
    };
    if (!verifyDodoWebhook(req.rawBody, headers)) {
      console.warn('[Dodo Webhook] Signature verification failed');
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    const payload = req.body || {};
    const rec = mapDodoEvent(payload);
    if (rec.email) {
      store.subscriptions[rec.email] = rec;
      persist.subscriptions();
    }
    console.log(`[Dodo Webhook] ${rec.eventType} | ${rec.email} | ${rec.status}`);
    res.json({ success: true, event_type: rec.eventType, status: rec.status, email: rec.email });
  } catch (error) {
    console.error('[Dodo Webhook Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/subscription-status', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const sub = email ? store.subscriptions[email] : null;
  if (sub) {
    res.json({ success: true, ...sub });
  } else {
    res.json({ success: true, email, status: 'free', isPlus: false });
  }
});

/* ------------------------------ WEB PUSH ----------------------------------- */
let webpush = null;
let vapidKeys = loadJSON('vapid.json', null);

async function initPush() {
  try {
    webpush = (await import('web-push')).default;
    if (!vapidKeys) {
      vapidKeys = webpush.generateVAPIDKeys();
      saveJSON('vapid.json', vapidKeys);
      console.log('[Push] Generated new VAPID keypair (persisted in data/vapid.json)');
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:peakora.network@gmail.com',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  } catch (e) {
    console.warn('[Push] web-push not available:', e.message);
    webpush = null;
  }
}

app.get('/api/push-key', (req, res) => {
  if (!vapidKeys) return res.status(503).json({ success: false, error: 'Push not initialized' });
  res.json({ success: true, key: vapidKeys.publicKey });
});

app.post('/api/push-subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ success: false });
  const idx = store.pushSubs.findIndex(s => s.endpoint === sub.endpoint);
  if (idx >= 0) store.pushSubs[idx] = sub;
  else store.pushSubs.push(sub);
  persist.pushSubs();
  console.log(`[Push] subscription saved (total: ${store.pushSubs.length})`);
  res.json({ success: true });
});

app.post('/api/push-unsubscribe', (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  store.pushSubs = store.pushSubs.filter(s => s.endpoint !== endpoint);
  persist.pushSubs();
  res.json({ success: true });
});

app.post('/api/push-broadcast', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!webpush) return res.status(503).json({ success: false, error: 'Push not initialized' });
  const payload = JSON.stringify({
    title: (req.body && req.body.title) || 'Peakora',
    body: (req.body && req.body.body) || 'A gentle nudge from your quiet corner.'
  });
  let sent = 0;
  const dead = [];
  for (const sub of store.pushSubs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
    }
  }
  if (dead.length) {
    store.pushSubs = store.pushSubs.filter(s => !dead.includes(s.endpoint));
    persist.pushSubs();
  }
  res.json({ success: true, sent, pruned: dead.length });
});

/* ------------------------------ STATIC SITE -------------------------------- */
app.use(express.static(__dirname, { extensions: ['html', 'htm'] }));

app.get('*', (req, res, next) => {
  if (req.path.includes('.')) return res.status(404).send('Not Found');
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, 'index.html'));
  next();
});

initPush().finally(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Peakora server listening on http://0.0.0.0:${PORT}`);
  });
});
