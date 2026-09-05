---
name: cognee-memory
description: >-
    Self-hosted Cognee recall/remember integration. Use at session start (recall cross-repo constraints) and session end (persist architectural decisions). Keeps memory private on the Oracle ARM VPS, never sent to a 3rd-party memory cloud.
metadata:
  version: 1.0.0
---

## When to use
Use at session start (recall cross-repo constraints) and at session end (persist
architectural decisions) for any project that consumes this hub. Keeps memory
private on the Oracle ARM VPS  -  never sent to a 3rd-party memory cloud.

## ⚠️ Corrected API contract
The original blueprint referenced `POST /api/v1/recall` and `POST /api/v1/remember`.
**These are NOT real Cognee REST endpoints**  -  they are names of the Python
`CloudClient` convenience methods. The real self-hosted Cognee REST API is:

| Action | Method + Path | Body |
|--------|---------------|------|
| Ingest (remember) | `POST /api/v1/add` | `{"data": "<text>", "datasetName": "global_user_memory"}` |
| Build graph | `POST /api/v1/cognify` | `{"datasets": ["global_user_memory"]}` |
| Recall (search) | `POST /api/v1/search` | `{"query": "...", "searchType": "GRAPH_COMPLETION", "datasets": ["global_user_memory"]}` |
| Forget | `DELETE /api/v1/datasets` | `{"datasets": ["global_user_memory"]}` |

Auth: `REQUIRE_AUTHENTICATION=true` is set on the VPS. The preferred, permanent
path is a **non-expiring API key** (created once, see below) sent via the
`X-Api-Key` header. This never rotates, so a lost local `.env` cannot lock us
out. The client falls back to email+password login (`Authorization: Bearer
<token>`) only when no API key is set.

## Permanent auth setup (one-time)
1. Register an admin user:
   `POST /api/v1/auth/register` `{"email","password"}` → 201.
2. Login (note: body is `application/x-www-form-urlencoded`, fields
   `username`+`password`, NOT JSON):
   `POST /api/v1/auth/login` → `{"access_token","token_type":"bearer"}`.
3. Create a non-expiring API key:
   `POST /api/v1/auth/api-keys` `{"name":"openhands-crossrepo"}` (Bearer
   auth) → `{"key": "<api_key>"}`.
4. Store as OpenHands secrets so they auto-inject every session (this is what
   makes the loss of a local `.env` non-fatal):
   - `COGNEE_API_URL`, `COGNEE_API_KEY` (preferred), and optionally
     `COGNEE_AUTH_EMAIL` + `COGNEE_AUTH_PASSWORD` as the login fallback.
   - The client uses `COGNEE_API_KEY` for the `X-Api-Key` header first; if
     empty, it logs in with email/password.
5. **Do not** keep these only in a local `.env`  -  local files get deleted on
   machine resets. OpenHands secrets are the durable store.

## Env
- `COGNEE_API_URL`  -  public Cloudflare tunnel URL of the Cognee server.
  Auto-discovered from `tunnel_url.txt` in this repo if unset. Quick (random,
  changes each run): `.\scripts\start-tunnel-auto.ps1`. Stable (persistent):
  run `scripts/setup-named-tunnel.ps1` once, then `docker compose -f
  docker-compose.cognee.yml -f docker-compose.tunnel.yml up -d` →
  `https://cognee.yourdomain.com`. Local-only testing: `http://localhost:8000`.
- `COGNEE_DATASET`  -  default `global_user_memory`
- `COGNEE_API_KEY`  -  non-expiring API key; sent as `X-Api-Key` (preferred path).
- `COGNEE_AUTH_EMAIL` / `COGNEE_AUTH_PASSWORD`  -  login fallback (used only when
  `COGNEE_API_KEY` is unset). Default email `peakora-admin@peakora.dev`.

## Reference client (`cognee_client.py`)
A stdlib-only HTTP client so any repo can use it without adding dependencies:

```python
import os, json, urllib.request

BASE = os.environ.get("COGNEE_API_URL", "").rstrip("/")
DATASET = os.environ.get("COGNEE_DATASET", "global_user_memory")
TOKEN = os.environ.get("COGNEE_API_KEY", "")

def _headers():
    h = {"Content-Type": "application/json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h

def _post(path, body):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(), headers=_headers())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def remember(text):
    """Ingest a fact and (re)build the knowledge graph for our dataset."""
    _post("/api/v1/add", {"data": text, "datasetName": DATASET})
    _post("/api/v1/cognify", {"datasets": [DATASET]})

def recall(query, search_type="GRAPH_COMPLETION"):
    """Search the knowledge graph for cross-repo context."""
    return _post("/api/v1/search", {
        "query": query,
        "searchType": search_type,
        "datasets": [DATASET],
    })
```

## Session lifecycle
1. **Start**: `recall("cross-repo architecture constraints, tech stack, and coding preferences")`
   → apply returned preferences to the current task.
2. **End**: summarize key decisions (API endpoints added, schema changes, stack
   choices) and call `remember(summary_text)`.
3. **Resilience**: if `COGNEE_API_URL` is unset or the call fails, log a warning
   and continue  -  memory sync must never block task completion.

## Verifying the VPS endpoint
```bash
# health check
curl -s "$COGNEE_API_URL/api/v1/health" || curl -s "$COGNEE_API_URL/"
# smoke recall
curl -s -X POST "$COGNEE_API_URL/api/v1/search" \
  -H 'Content-Type: application/json' \
  -d '{"query":"test","searchType":"CHUNKS","datasets":["global_user_memory"]}'
```
