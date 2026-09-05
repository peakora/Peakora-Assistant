---
name: gstack
description: >-
    Zero-cost SaaS production stack reference. The canonical Peakora layering (Dodo Payments + Cloudflare + Gemini + SQLite/D1 + Resend + Docker) and the env keys each layer needs, plus an Alternatives table for single-row swaps. Apply when auditing, scaffolding, or hardening a project to the standard stack.
metadata:
  version: 1.0.0
---

## When to use
Apply this skill whenever auditing, scaffolding, or hardening a project to our
standard production stack. It encodes the canonical zero-cost layering and the
env keys that satisfy each layer.

## Standard Stack (Peakora default - Dodo / Cloudflare / Gemini)

This is the DEFAULT for Peakora builds. Every layer is a free tier. Swap a
layer only when a builder explicitly asks to change it (see "Alternatives"
below) - then update that one row and its env keys, keep the rest.

| Layer | Default (Peakora) | Canonical env keys |
|-------|-------------------|---------------------|
| Version control / CI | GitHub | `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| LLM | Google AI Studio (Gemini) | `GEMINI_API_KEY` / `GEMINI_KEY`, `GEMINI_MODEL` (LiteLLM `gemini/` prefix MANDATORY) |
| Embeddings | Gemini | `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS=768` |
| Self-hosted memory | Cognee (Docker) | `COGNEE_API_URL`, `COGNEE_API_KEY`, `COGNEE_DATASET` |
| Runtime / containers | Docker | `DOCKER_REGISTRY`, `DOCKER_IMAGE_NAME`, `DOCKER_TAG` |
| DB / BaaS | Per-project choice (Supabase by default; Postgres/SQLite valid) | `DATABASE_URL` / `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Payments (Merchant of Record) | Dodo Payments | `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_LIVE_API_KEY`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_*_PRODUCT_ID` (per tier) |
| Transactional email | Resend | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| DNS / edge / tunnel / security | Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID` (named tunnels recommended) |
| Hosting | Cloudflare tunnel to local Docker (always-on VPS optional, deferred) | `TUNNEL_TOKEN` / named-tunnel creds |
| Observability | Sentry + PostHog (optional) | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |

## Alternatives (swappable when a builder asks to change a layer)

Each alternative is valid; use it only when explicitly requested, then swap
that single row + its env keys. Never mix providers for the same layer.

| Layer | Alternative | Env keys (when swapped in) |
|-------|-------------|----------------------------|
| Payments | Paddle | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` |
| Payments | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| DB / BaaS | Supabase (full) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` |
| DB | Plain Postgres | `DATABASE_URL`, `POSTGRES_URL` (alias of `DATABASE_URL`) |
| Auth | Firebase | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID` |
| Hosting (always-on) | Oracle Cloud Always Free ARM VPS | `ORACLE_VPS_HOST`, `ORACLE_VPS_USER`, `ORACLE_SSH_KEY_PATH` |
| Edge / deploy | Vercel | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| Email | Nodemailer / SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |

## Env alias de-duplication rules
Before adding any key, scan existing `.env`, `.env.example`, and source for:
- `GEMINI_KEY` → alias of `GEMINI_API_KEY` (do not add both)
- `POSTGRES_URL` / `DATABASE_URL` → alias of `SUPABASE_DB_URL`
- Any service satisfied under a different name → mark "Existing Alias Found", do not duplicate.

Only keys genuinely missing get appended to `.env.example`.

## Multi-tenant isolation
Use Row Level Security (RLS) policies for tenant separation at the database
level (Supabase/Postgres both support RLS). Write idempotent SQL migrations
with proper FKs, indexes, CASCADE. For non-RLS stores (SQLite), enforce tenant
isolation at the query layer with a mandatory `tenant_id` filter on every read.
