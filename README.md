<p align="center">
  <img src="assets/social profile image.png" alt="Peakora Assistant" width="200">
</p>

<h1 align="center">Peakora Assistant</h1>

# Peakora — peakora.life

> Gentle guidance. Real momentum.

Peakora is a dark-luxury wellness and personal-growth companion web app. It shapes a gentle, realistic **7-day reset** plan around a person's energy, schedule, and current headspace — small daily steps, no streaks to break, nothing to feel guilty about. The app pairs a conversational assistant with a dashboard of mood logging, guided breathing, Solfeggio soundscapes, and analytics, all delivered as an installable, offline-capable Progressive Web App.

This repository holds the public marketing site, the full assistant/dashboard PWA, the Node/Express backend, and the Docker + CI configuration.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Backend API reference](#backend-api-reference)
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

**Backend (`server.js`)**
- JSON-file persistence (no external database required)
- Email capture, feedback, and lightweight usage telemetry
- Dodo Payments billing webhook with Standard Webhooks HMAC-SHA256 signature verification
- Web Push (VAPID) with subscribe, unsubscribe, and admin broadcast
- Admin-gated endpoints protected by an `ADMIN_TOKEN`

**Legal and supporting pages**
- About, Contact, Privacy, Terms, Refund & Guarantee, Thank-you, and Offline fallback

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20 (ES modules) |
| Server | Express 4 |
| Push notifications | web-push (VAPID) |
| Payments | Dodo Payments hosted checkout + webhook verification |
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
├── script.js               # Landing-page assistant modal + knowledge base
├── server.js               # Express API + static host + Dodo/Push
├── dodo-billing.js         # Dodo Payments checkout-session + webhook verifier (hub-portable)
├── service-worker.js       # PWA caching + push handling
├── manifest.json           # PWA manifest
├── css/
│   └── styles.css          # Landing site styles
├── assistant.css           # Dashboard styles + theme tokens
├── aboutus.html  contactus.html  privacy.html  terms.html
├── refund.html   thankyou.html  offline.html
├── assets/                # Logo, icons, social SVGs, imagery
├── src/assets/images/     # Hero and soundscape imagery
├── Dockerfile             # Production container image
├── .env.example           # Required environment variables
├── package.json           # Scripts and dependencies
└── .github/workflows/ci.yml
```

The active sources are plain HTML, CSS, and JS with no build step — all files referenced by the entry points above are tracked in version control.

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
| `npm run dev` | Start the Express server (`node server.js`) |
| `npm start` | Alias for the dev script |
| `npm run build` | No-op (the project ships static assets directly) |

## Environment variables

All variables are optional for local browsing but required for the corresponding feature to function. Copy `.env.example` to `.env` and fill them in.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port the server binds to (default `3000`) |
| `ADMIN_TOKEN` | Protects `/api/stats`, `/api/subscribers`, `/api/feedback`, `/api/push-broadcast` |
| `DODO_PAYMENTS_API_KEY` | Dodo Payments API key (server-side only) |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` or `live_mode` |
| `DODO_MONTHLY_PRODUCT_ID` | Dodo product ID for the monthly $4.99 plan |
| `DODO_YEARLY_PRODUCT_ID` | Dodo product ID for the yearly $47.99 plan |
| `DODO_PAYMENTS_WEBHOOK_SECRET` | Standard Webhooks secret to verify Dodo webhook signatures |
| `APP_PUBLIC_URL` | Public base URL for the checkout `return_url` |
| `VAPID_SUBJECT` | `mailto:` contact for web push (VAPID) |

## Backend API reference

All endpoints are served by the same Express app that hosts the static site.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/subscribe` | Public | Capture an email for the launch list |
| `GET` | `/api/subscribers` | Admin | List captured emails |
| `POST` | `/api/feedback` | Public | Submit feedback (message, optional rating, page, email) |
| `GET` | `/api/feedback` | Admin | Read recent feedback |
| `POST` | `/api/event` | Public | Record a lightweight usage telemetry event |
| `GET` | `/api/stats` | Admin | Aggregated counts (subscribers, feedback, active 24h, top actions) |
| `POST` | `/api/dodo/checkout` | Public | Create a Dodo hosted checkout session, returns `checkout_url` |
| `POST` | `/api/dodo/webhook` | Signature | Dodo billing webhook (verified via Standard Webhooks HMAC-SHA256) |
| `GET` | `/api/dodo-config` | Public | Public-safe Dodo checkout config (no secrets) |
| `GET` | `/api/subscription-status` | Public | Look up subscription status by `?email=` |
| `GET` | `/api/push-key` | Public | Returns the public VAPID key |
| `POST` | `/api/push-subscribe` | Public | Store a push subscription |
| `POST` | `/api/push-unsubscribe` | Public | Remove a push subscription |
| `POST` | `/api/push-broadcast` | Admin | Send a push notification to all subscribers |

Admin endpoints accept the token via the `?token=` query string or the `x-admin-token` header. When `ADMIN_TOKEN` is unset or the token does not match, the endpoint returns `403`.

## Design system

Peakora uses a documented "Dark Luxury Wellness" design system: deep-midnight glassmorphism cards, warm terracotta/honey/amethyst accent glows, Plus Jakarta Sans headings, Inter body text, and six switchable mood themes bound via `data-theme`. The full specification — CSS variables, the `.peakora-modal-standard` modal component, responsive grid rules, and a master style prompt — lives in [`AGENTS.md`](./AGENTS.md). Treat that file as the source of truth when building new components or applets.

## Deployment

### Docker
The repo ships a minimal, non-root `Dockerfile`:
```bash
docker build -t peakora-assistant .
docker run -p 3000:3000 \
  -e ADMIN_TOKEN=... \
  -e DODO_PAYMENTS_API_KEY=... \
  -e DODO_PAYMENTS_WEBHOOK_SECRET=... \
  -e VAPID_SUBJECT=mailto:you@example.com \
  peakora-assistant
```
The container writes its JSON "database" to `/app/data` (owned by the `node` user). Mount a volume at `/app/data` to persist state across restarts.

### Plain Node
On any Node 20+ host, set the environment variables above and run `npm install && npm start` behind a reverse proxy that terminates TLS.

## Data persistence

The backend uses small JSON files in `./data/` (gitignored) as its datastore — no external database is required:

| File | Contents |
| --- | --- |
| `subscribers.json` | Launch-list email captures |
| `subscriptions.json` | Dodo subscription records keyed by email |
| `feedback.json` | User feedback entries |
| `events.json` | Usage telemetry events |
| `push-subscriptions.json` | Web Push subscription objects |
| `vapid.json` | Generated VAPID keypair |

Writes are atomic (write to a `.tmp` file then rename). Back up the `data/` directory to preserve state.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`/`master`. It installs dependencies, runs the build, verifies that `index.html` and `server.js` exist, and scans the tree for accidentally committed secrets (API keys, tokens) — failing the build if any are found.

## Contact

Questions, feedback, or subscription support are welcome at **peakora.network@gmail.com** (see `contactus.html`). A response is typically sent within 24–48 hours.

---
