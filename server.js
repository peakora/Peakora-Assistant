import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser for JSON webhook payloads from Paddle
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory subscription storage for Paddle events
const userSubscriptions = new Map();
const paddleEventsLog = [];

// Paddle Webhook Endpoint Listener
app.post('/api/paddle-webhook', (req, res) => {
  try {
    const payload = req.body || {};
    const eventType = payload.event_type || payload.alert_name || payload.type || 'payment_succeeded';
    const data = payload.data || payload;
    
    const email = (data.customer && data.customer.email) || 
                  data.email || 
                  data.user_email || 
                  payload.email || 
                  'peakora.network@gmail.com';

    const transactionId = data.id || data.order_id || data.checkout_id || ('PAD-' + Date.now().toString().slice(-6));
    const status = (eventType.includes('cancel') || eventType === 'subscription_canceled') ? 'canceled' : 'active';
    const plan = data.plan || data.product_id || (payload.price && payload.price.includes('47') ? 'yearly' : 'monthly');

    const subscriptionData = {
      email,
      status,
      plan,
      transactionId,
      eventType,
      method: data.method || payload.method || 'Paddle Gateway',
      updatedAt: new Date().toISOString()
    };

    userSubscriptions.set(email, subscriptionData);
    paddleEventsLog.push({
      id: 'evt_' + Date.now(),
      eventType,
      email,
      timestamp: new Date().toISOString(),
      details: subscriptionData
    });

    console.log(`[Paddle Webhook Received] Event: ${eventType} | User: ${email} | Status: ${status}`);

    res.status(200).json({
      success: true,
      message: 'Paddle webhook event processed successfully',
      event_type: eventType,
      status: status,
      email: email,
      subscription: subscriptionData
    });
  } catch (error) {
    console.error('[Paddle Webhook Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Endpoint to check Subscription Status
app.get('/api/subscription-status', (req, res) => {
  const email = req.query.email || 'peakora.network@gmail.com';
  const sub = userSubscriptions.get(email);
  if (sub) {
    res.json({ success: true, ...sub });
  } else {
    res.json({
      success: true,
      email,
      status: 'free',
      isPlus: false,
      message: 'No active Paddle subscription recorded yet'
    });
  }
});

// API Endpoint to view logged Paddle webhook events
app.get('/api/paddle-events', (req, res) => {
  res.json({
    success: true,
    totalEvents: paddleEventsLog.length,
    events: paddleEventsLog.slice(-50)
  });
});

// Serve static assets with index fallback for clean directory serving
app.use(express.static(__dirname, { extensions: ['html', 'htm'] }));

// Fallback to index.html for page navigation (ignore static assets with file extensions)
app.get('*', (req, res, next) => {
  if (req.path.includes('.')) {
    return res.status(404).send('Not Found');
  }
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Peakora server listening on http://0.0.0.0:${PORT}`);
});

