import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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

/* Capture raw body for Paddle signature verification */
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

/* ------------------------------- PADDLE ------------------------------------ */
function verifyPaddleSignature(req) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return true; // not configured yet — accept (sandbox/dev)
  const header = req.get('Paddle-Signature') || '';
  const tsMatch = /ts=(\d+)/.exec(header);
  const h1Match = /h1=([a-f0-9]+)/i.exec(header);
  if (!tsMatch || !h1Match || !req.rawBody) return false;
  const signed = `${tsMatch[1]}:${req.rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(h1Match[1]));
  } catch {
    return false;
  }
}

app.post('/api/paddle-webhook', (req, res) => {
  try {
    if (!verifyPaddleSignature(req)) {
      console.warn('[Paddle Webhook] Signature verification failed');
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    const payload = req.body || {};
    const eventType = payload.event_type || payload.alert_name || payload.type || 'payment_succeeded';
    const data = payload.data || payload;

    const email = (data.customer && data.customer.email) ||
                  data.email ||
                  data.user_email ||
                  payload.email ||
                  null;

    const transactionId = data.id || data.order_id || data.checkout_id || ('PAD-' + Date.now().toString().slice(-6));
    const status = (eventType.includes('cancel') || eventType === 'subscription_canceled') ? 'canceled' : 'active';
    const plan = data.plan || data.product_id || (payload.price && String(payload.price).includes('47') ? 'yearly' : 'monthly');

    const subscriptionData = {
      email,
      status,
      plan,
      transactionId,
      eventType,
      method: data.method || payload.method || 'Paddle Gateway',
      updatedAt: new Date().toISOString()
    };

    if (email) {
      store.subscriptions[email] = subscriptionData;
      persist.subscriptions();
    }

    console.log(`[Paddle Webhook] ${eventType} | ${email} | ${status}`);
    res.json({ success: true, event_type: eventType, status, email });
  } catch (error) {
    console.error('[Paddle Webhook Error]', error);
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
