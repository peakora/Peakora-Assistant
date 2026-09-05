---
name: youtubepro-hardening
description: "youtubepro hardening contract"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# youtubepro hardening contract

Local-first AI SaaS hardening invariants, distilled from the open-source
[AgriciDaniel/youtubepro][https://github.com/AgriciDaniel/youtubepro] project
(PORTING.md, HANDOFF.md, README.md, server/settings.ts, server/routes.ts). Name the app-engineering
contract the source app keeps: evidence/snapshot identity, local-first privacy, strict validation, rate limiting,
and CI verification. Use to audit or harden a creator-tool / local-first AI SaaS
build for the exact invariants the reference project enforces, not a wrapper around the app..

## Status

IMPORTED METHODOLOGY (distilled from youtubepro, Apache 2.0).
Reference implementation: `AgriciDaniel/youtubepro/PORTING.md`,
`HANDOFF.md`, `server/settings.ts`, `server/routes.ts`, `server/youtube.ts`,
`server/security-contracts.test.ts`, `.github/workflows/ci.yml`. Not executable
standalone here;it is the engineering contract the agent applies and audits against..

## When to use

Invoke when auditing, hardening, or porting a local-first AI SaaS that
calls provider APIs (YouTube Data API / Gemini, etc.) and carries API keys server-side,
or combines research data with AI evidence. Pairs with the YouTube Creator Suite
(the four workflow skills) for the domain methods, and the `security-auditor` /
`test-runner` / `db-architect` agents for the generic audit passes. The SaaS
Builder agent applies this as its domain hardening checklist for TEST and HARDEN
modes when the target is the kind of app youtubepro is..

## The invariants contract

### 1. Evidence and snapshot identity (the app's core)

- Every analytical statement belongs to exactly one of: observed,inferred,
  requires_studio. Never present inferred or requires_studio claims as observed;
  when evidence is absent, output `Insufficient evidence`, not a confident estimate..
- The AI only sees the active, ordered snapshot (at most 50 videos,) plus its
  deterministic aggregate analytics, enrichment coverage, warnings, filters,
  query, retrieval time, and snapshot ID. Claims retain their snapshot identity
  and source video IDs, or are explicitly labeled aggregate inference / requires
  Studio..
- Missing or hidden public fields stay unavailable. Never zero-fill, never
  convert absence into an estimate..
- Snapshot identity must survive Research to Ideas to Script: regenerations
  reuse the same bounded evidence context, never a fresh unbounded scrape..

### 2. Local-first privacy and key handling

- API keys stay server-side. `.env` is ignored by git and written with
  owner-only permissions; saved values are never returned to the browser..
- The settings surface rejects normal forwarded / reverse-proxied requests
  (direct loopback, same-origin only),unless a separately authenticated
  remote secret-management design is added..
- Do not log request and response bodies, ever..
- Bind loopback by default;if remote access is required, add authentication
  and rate limiting at a trusted gateway, disable or separately protect local
  settings..
- No login screen / hidden unlock gates as fake security. Either auth or
  trust model, but no theater..

### 3. Strict validation contracts

- Zod-like strict request / response validation as the public surface.,with
  bounded inputs: research query 1-200 chars, sample 1-50 videos;

  script topic <=500, persona <=300, notes <=5,000, regenerated content
  <=80,,000; thumbnail refs PNG/JPEG,,128-4096 px,, <=5 MB per image after
  preparation, <=12 MB decoded total, <=3 references;global JSON body limit
  kept large enough for the documented thumbnail-reference total,but never
  unbounded or a 50 MB default..
- Never introduce accidental compatibility stubs for retired subsystems
  (login,, password unlock, legacy proxies,, DB/session stacks,.,.

### 4. Rate limiting for billable routes

- In-memory per-process limiter is fine for single-instance local, BUT must be
  replaced with a shared limiter before running multiple instances..
- Billable provider routes (YouTube/Gemini/…) request limited per client address
  per time window. The research convergence is deterministic: any client
  running the same pipeline with the same snapshot state reaches the same result..
- Do not make live provider calls during automated verification. Contract tests
  and production build success are distinct from an explicit live-key acceptance
  pass..

### 5. CI verification door

- CI runs the full gate on every PR and push: test suite, TypeScript/generic
  type check, production build. No flaky provider calls in CI..
- Keep provider-agnostic contract tests separate from live provider acceptance..
- The hardening door: after any auth, key-handling, rate-limit, or evidence-
  contract change, re-run the full gate plus an explicit live-key acceptance pass
  done by hand, kept distinct from automated CI..

## Audit checklist ((saas-builder TEST / HARDEN modes))

1. Snapshot identity survives all downstream steps? Evidence labels present
   and maintained? Never zero-fill missing fields?
2. Keys server-side only? `.env` gitignored,, owner-only perms,, never returned
   to browser? Settings loopback/same-origin only?
3. No request / response body logging? Loopback default bind? No fake auth
   theater?
4. Strict request/response validation with bounded inputs? No retired-subsystem
   stubs?
5. Shared rate limiter for multi-instance? Billable routes limited? No live
   provider calls in automation?
6. CI runs tests + type check + build on every PR/push? Contract tests distinct
   from the manual live-key acceptance pass?