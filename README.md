<p align="center">
  <img src="assets/social profile image.png" alt="Peakora Assistant" width="200">
</p>

<h1 align="center">Peakora Assistant</h1>

> Gentle guidance. Real momentum.

Peakora is a dark-luxury wellness and personal-growth companion web app. It shapes a gentle, realistic **7-day reset** plan around a person's energy, schedule, and current headspace - small daily steps, no streaks to break, nothing to feel guilty about. The app pairs a conversational assistant with a dashboard of mood logging, guided breathing, Solfeggio soundscapes, and analytics, all delivered as an installable, offline-capable Progressive Web App.

This repository holds the public marketing site, the full assistant/dashboard PWA, the Cloudflare Worker backend (D1 database + affiliate engine + billing), the optional Node/Express backend, and the Docker + CI configuration.

Peakora Assistant runs on two complementary halves:
- **The Cloudflare Worker + D1** (production): `worker/` contains the edge API that receives Dodo payment webhooks, runs affiliate attribution, stores subscriptions in D1 (SQLite), and serves the public affiliate portal. This is the live deployment at `peakora-api.peakora.workers.dev` and is the single source of truth for billing and subscription state.
- **The Node/Express server** (`server.js`): an alternative self-hosted backend for the marketing-site endpoints (email capture, feedback, telemetry, web push). It proxies billing and subscription-status through the Worker so the two paths never diverge.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Backend API reference](#backend-api-reference)
- [Affiliate program](#affiliate-program)
- [Design system](#design-system)
- [Deployment](#deployment)
- [Data persistence](#data-persistence)
- [Continuous integration](#continuous-integration)
- [Contact](#contact)

---

## Features

**Landing site (`index.html`)**
- Hero, "Why Peakora", "Designed for Real Life", dashboard showcase, and stories sections
- Embedded conversational assistant modal with a knowledge base for anxiety, overwhelm, focus, sleep, routine, and pricing (`script.js`)
- Responsive navigation with mobile menu, social links, and Dodo Payments checkout integration

**Assistant PWA (`assistant.html` + `assistant.css`)**
- Installable, standalone PWA with a custom manifest and offline support (`service-worker.js`)
- 7-day reset plan with a visual timeline and onboarding flow (`assistant-onboarding.html`, `assistant-home.html`)
- Mood tracking with a bubble-canvas visualizer and analytics bars showing brightest moments
- Guided breathing exercises with animated breathing rings
- Solfeggio soundscape player (ocean, rainforest, fireplace, night crickets, wind, om chant)
- Dynamic theming across six mood palettes (sunrise, sage, amethyst, twilight, solar, sunset)
- Peakora Plus upsell and subscription status checks

**Backend - Cloudflare Worker + D1 (`worker/`)**
- Edge API at `peakora-api.peakora.workers.dev`, deployed via `wrangler`
- D1 (SQLite) database for subscriptions, affiliates, referral clicks, commissions, and payouts
- Dodo Payments webhook receiver (Standard Webhooks HMAC-SHA256 verified, idempotent on transaction id)
- Affiliate attribution engine: pays the affiliate whose referral code the customer used at checkout (carried in Dodo metadata), validated against a stored click within the cookie window; no code = no commission
- Server-authoritative subscription status (`isPlus` derived from D1 `status === 'active'`); refunds revoke access
- Google sign-in (OAuth) with self-signed state (CSRF-verified)
- Public affiliate portal + admin partner management (HMAC-signed portal tokens)

**Backend - Node/Express (`server.js`, optional self-host)**
- JSON-file persistence for marketing-site data (no external database required)
- Email capture, feedback, and lightweight usage telemetry
- Web Push (VAPID) with subscribe, unsubscribe, and admin broadcast
- Proxies billing checkout and subscription-status through the Worker (no parallel billing state)
- Admin-gated endpoints protected by a timing-safe `ADMIN_TOKEN` compare

**Legal and supporting pages**
- About, Contact, Privacy, Terms, Refund & Guarantee, Thank-you, and Offline fallback

## Tech stack

| Layer | Technology |
| --- | --- |
| Edge runtime | Cloudflare Workers (production API + affiliate engine) |
| Edge database | Cloudflare D1 (SQLite) |
| Node runtime | Node.js 20, ES modules (optional self-hosted server) |
| Server | Express 4 (self-hosted backend) |
| Push notifications | web-push (VAPID) |
| Payments | Dodo Payments hosted checkout + Standard Webhooks verification |
| Auth | Google OAuth (CSRF-verified state) + PBKDF2 password hashing |
| Frontend | Vanilla HTML, CSS, and JavaScript (no framework, no build step) |
| PWA | Web App Manifest, service worker, offline shell |
| Container | Docker (node:20-alpine) |
| CI | GitHub Actions |

## Repository structure

```
peakora-assistant/
├── index.html              # Marketing landing page (entry point)
├── assistant.html          # Full assistant dashboard PWA
├── assistant-home.html     # Assistant home view
├── assistant-onboarding.html
├── pricing.html            # Peakora Plus pricing + checkout
├── thankyou.html           # Post-checkout confirmation (sets verified flag)
├── script.js               # Landing-page assistant modal + knowledge base
├── server.js               # Express API + static host + billing proxy to Worker
├── dodo-billing.js         # Dodo checkout-session + webhook verifier (Node fallback)
├── service-worker.js       # PWA caching + push handling
├── manifest.json           # PWA manifest
├── worker/                 # Cloudflare Worker (PRODUCTION API + affiliate engine)
│   ├── src/index.js        # Edge routes: Dodo webhook, checkout, subscription-status
│   ├── src/affiliate.js    # Attribution engine, portal tokens, admin, OAuth
│   ├── schema.sql          # D1 schema (subscribers, subscriptions, affiliates, commissions)
│   └── wrangler.toml       # Worker config + D1 binding + public product ids
├── css/
│   └── styles.css          # Landing site styles
├── assistant.css           # Dashboard styles + theme tokens
├── aboutus.html  contactus.html  privacy.html  terms.html
├── refund.html   thankyou.html  offline.html
├── assets/                # Logo, icons, social SVGs, imagery
├── src/assets/images/     # Hero and soundscape imagery
├── tests/                 # node:test suite (affiliate engine + web push)
├── Dockerfile             # Production container image (Node path)
├── .env.example           # Required environment variables
├── package.json           # Scripts and dependencies
└── .github/workflows/ci.yml
```

The active sources are plain HTML, CSS, and JS with no build step - all files referenced by the entry points above are tracked in version control.

## Getting started

### Prerequisites
- Node.js 20+ (the Docker image pins `node:20-alpine`)
- npm

### Install and run locally
```bash
# 1. Install dependencies
npm install

# 2. Configure environment (required for billing, push, and admin)
cp .env.example .env
#   then fill in DODO_*, ADMIN_TOKEN, and VAPID_SUBJECT

# 3. Start the dev server
npm run dev          # or: npm start   (both run: node server.js)
```
The server listens on `http://0.0.0.0:3000` by default, or `$PORT` when set.

### Useful scripts
| Command | Description |
| --- | --- |
| `npm run dev` | Start the Express server (`node server.js`) on port 3000 |
| `npm start` | Alias for the dev script |
| `npm run build` | No-op (the project ships static assets directly) |
| `npm run deploy:worker` | Deploy the Cloudflare Worker (`wrangler deploy` in `worker/`) |
| `npm run deploy:pages` | Deploy static assets to Cloudflare Pages |
| `npm run db:init` | Apply `worker/schema.sql` to the D1 database (run after schema changes) |
| `npm test` | Run the `node --test` suite (`tests/`) |

## Environment variables

All variables are optional for local browsing but required for the corresponding feature to function. Copy `.env.example` to `.env` and fill them in.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port the Node server binds to (default `3000`) |
| `ADMIN_TOKEN` | Protects admin endpoints on both halves (timing-safe compare; fails closed when unset) |
| `DODO_PAYMENTS_API_KEY` | Dodo Payments API key, test mode (server-side only) |
| `DODO_PAYMENTS_LIVE_API_KEY` | Dodo Payments API key, live mode (used when `DODO_ENVIRONMENT=live_mode`) |
| `DODO_ENVIRONMENT` | `test_mode` or `live_mode` |
| `DODO_MONTHLY_PRODUCT_ID` | Dodo product ID for the monthly $9.99 plan |
| `DODO_YEARLY_PRODUCT_ID` | Dodo product ID for the yearly $95.88 plan |
| `DODO_PAYMENTS_WEBHOOK_SECRET` | Standard Webhooks secret to verify Dodo webhook signatures |
| `APP_PUBLIC_URL` | Public base URL for the checkout `return_url` |
| `WORKER_ORIGIN` | The Worker origin the Node server proxies billing + subscription-status through (default `https://peakora-api.peakora.workers.dev`) |
| `VAPID_SUBJECT` | `mailto:` contact for web push (VAPID) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials for sign-in (Worker) |

## Backend API reference

The Worker (production) and the Node server (self-host) expose parallel endpoint surfaces. The Node server proxies billing and subscription-status to the Worker, so the two agree on who is Plus.

### Node server (`server.js`)
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/subscribe` | Public | Capture an email for the launch list |
| `GET` | `/api/subscribers` | Admin | List captured emails |
| `POST` | `/api/feedback` | Public | Submit feedback (message, optional rating, page, email) |
| `GET` | `/api/feedback` | Admin | Read recent feedback |
| `POST` | `/api/event` | Public | Record a lightweight usage telemetry event |
| `GET` | `/api/stats` | Admin | Aggregated counts (subscribers, feedback, active 24h, top actions) |
| `POST` | `/api/dodo/checkout` | Public | Proxy to the Worker's `/dodo/create-checkout` (carries affiliate `via` code) |
| `POST` | `/api/dodo/webhook` | Signature | Dodo webhook (local-dev only; production webhooks go to the Worker) |
| `GET` | `/api/dodo-config` | Public | Public-safe Dodo checkout config (no secrets) |
| `GET` | `/api/subscription-status` | Public | Proxy to the Worker (D1 authoritative) by `?email=` |
| `GET` | `/api/push-key` | Public | Returns the public VAPID key |
| `POST` | `/api/push-subscribe` | Public | Store a push subscription |
| `POST` | `/api/push-unsubscribe` | Public | Remove a push subscription |
| `POST` | `/api/push-broadcast` | Admin | Send a push notification to all subscribers |

### Cloudflare Worker (`worker/src/index.js`)
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/dodo/create-checkout` | Public | Create a Dodo hosted checkout with affiliate `via` in metadata |
| `POST` | `/dodo/webhook` | Signature | Dodo webhook (HMAC verified, idempotent; runs attribution) |
| `GET` | `/subscription-status` | Public | Subscription status from D1 (`isPlus` = `status === 'active'`) |
| `GET` | `/click` | Public | Record an affiliate referral click (transparent GIF pixel) |
| `GET/POST` | `/affiliate/*` | Public | Partner portal (sign-up, login, dashboard, commission export) |
| `GET/POST` | `/affiliate/admin/*` | Admin | Partner management (create, approve, adjust commission, payouts) |
| `GET` | `/api/v1/*` | Public | Affiliate public API (referral code lookup, etc.) |

Admin endpoints accept the token via the `?token=` query string or the `x-admin-token` header (Node) / `ADMIN_TOKEN` env (Worker). When unset or mismatched, the endpoint returns `403`.

## Affiliate program

Peakora Assistant ships a complete, reusable affiliate engine in the Worker + D1. It is designed to be portable across all of Peakora's SaaS apps.

- **Attribution**: a converting customer's payment is credited to the affiliate whose referral code the customer used at checkout. The code rides in the Dodo checkout `metadata.via` and is read back in the webhook. No code = no commission (pay no one, not the wrong person). The attribution is validated against a stored click within the affiliate's cookie window (last-click-wins).
- **Idempotency**: commissions dedup on a deterministic transaction id (Dodo's stable ids), so a replayed webhook never double-accrues.
- **Commission types**: percentage (recurring) or flat (one-time per customer). Flat commissions accrue only on the first qualifying conversion per customer. Admin adjustments clamp flat rates to [0, 1000] and percentage to [0, 1].
- **Self-referral block**: a customer cannot earn commission on their own subscription.
- **Payouts**: 30-day hold before a commission is auto-approved; payouts are batched and recorded against each commission.
- **Tables** (D1): `affiliates`, `referral_clicks`, `commissions`, `payouts` (see `worker/schema.sql`).

To make a new SaaS app reuse this engine, copy the `worker/` directory, point it at the app's D1, and set the Dodo product ids. The attribution pattern (`metadata.via` + cookie-window click validation + deterministic txn id + no-code-no-pay) is the reusable template.

## Design system

Peakora uses a documented "Dark Luxury Wellness" design system: deep-midnight glassmorphism cards, warm terracotta/honey/amethyst accent glows, Plus Jakarta Sans headings, Inter body text, and six switchable mood themes bound via `data-theme`. The full specification - CSS variables, the `.peakora-modal-standard` modal component, responsive grid rules, and a master style prompt - lives in [`AGENTS.md`](./AGENTS.md). Treat that file as the source of truth when building new components or applets.

## Deployment

Peakora Assistant deploys in two parts: the Cloudflare Worker (production API + affiliate engine) and the static frontend (Cloudflare Pages). The Node/Docker path is an optional self-host alternative for the marketing-site backend.

### Cloudflare Worker + Pages (production)
1. **Create the D1 database** (one-time):
   ```bash
   cd worker
   npx wrangler d1 create peakora-db
   # paste the database_id into wrangler.toml's [[d1_databases]] section
   npx wrangler d1 execute peakora-db --remote --file=schema.sql
   ```
2. **Set Worker secrets** (never commit these):
   ```bash
   cd worker
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put DODO_PAYMENTS_API_KEY
   npx wrangler secret put DODO_PAYMENTS_LIVE_API_KEY
   npx wrangler secret put DODO_PAYMENTS_WEBHOOK_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   Public product ids and `DODO_ENVIRONMENT` live in `wrangler.toml` (not secret).
3. **Deploy the Worker**:
   ```bash
   npm run deploy:worker
   ```
4. **Deploy the static frontend** to Cloudflare Pages:
   ```bash
   npm run deploy:pages
   ```
5. **Register the Dodo webhook** in the Dodo dashboard pointing at the Worker:
   `https://peakora-api.peakora.workers.dev/dodo/webhook`

> Push-to-deploy gotcha: pushing to `main` triggers the Pages deploy, but the Worker deploys only via `npm run deploy:worker` (or the `deploy:worker` GitHub Action if configured). A frontend push does NOT update the Worker. Run both after touching `worker/`.

### Docker (Node self-host)
The repo ships a minimal, non-root `Dockerfile`:
```bash
docker build -t peakora-assistant .
docker run -p 3000:3000 \
  -e ADMIN_TOKEN=... \
  -e DODO_PAYMENTS_API_KEY=... \
  -e DODO_PAYMENTS_WEBHOOK_SECRET=... \
  -e WORKER_ORIGIN=https://peakora-api.peakora.workers.dev \
  -e VAPID_SUBJECT=mailto:you@example.com \
  peakora-assistant
```
The container writes its JSON "database" to `/app/data` (owned by the `node` user). Mount a volume at `/app/data` to persist state across restarts.

### Plain Node
On any Node 20+ host, set the environment variables above and run `npm install && npm start` behind a reverse proxy that terminates TLS.

## Data persistence

Billing, subscription, and affiliate state lives in **Cloudflare D1** (the Worker is the only writer of subscription status). The Node/Docker backend uses small JSON files in `./data/` (gitignored) only for marketing-site data - it does not hold subscription state of its own (it proxies the Worker for that).

### D1 (production, authoritative)
The Worker's D1 database (`peakora-db`) holds: `subscribers`, `subscriptions`, `affiliates`, `referral_clicks`, `commissions`, `payouts`, and `feedback`. Apply schema changes with `npm run db:init`. Back up via `wrangler d1 export`.

### JSON files (Node self-host, marketing-site data only)
| File | Contents |
| --- | --- |
| `subscribers.json` | Launch-list email captures |
| `feedback.json` | User feedback entries |
| `events.json` | Usage telemetry events |
| `push-subscriptions.json` | Web Push subscription objects |
| `vapid.json` | Generated VAPID keypair |

Writes are atomic (write to a `.tmp` file then rename). Back up the `data/` directory to preserve state.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`/`master`. It installs dependencies, verifies the entry points and Worker syntax, runs the test suite (`npm test`), and scans the tree for accidentally committed secrets (API keys, tokens) - failing the build if any are found.

## Contact

Questions, feedback, or subscription support are welcome at **peakora.network@gmail.com** (see `contactus.html`). A response is typically sent within 24-48 hours.

---
