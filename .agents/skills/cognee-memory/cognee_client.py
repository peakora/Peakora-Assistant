# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Stdlib-only Cognee client for self-hosted memory (Gemini-backed, via tunnel).

Real Cognee REST API (verified against v1.4.2-local OpenAPI spec):
  register  POST /api/v1/auth/register   {email, password}        -> user
  login     POST /api/v1/auth/login       form: username,password  -> {access_token}
  add       POST /api/v1/add              multipart: data(file)+datasetName (fast ingest)
  cognify   POST /api/v1/cognify          {datasets}               (slow; builds graph)
  datasets  GET  /api/v1/datasets                                  -> [{id,name,...}]
  status    GET  /api/v1/datasets/status                           -> {id: <state>}
  recall    POST /api/v1/recall           {query, searchType, datasets}
  search    POST /api/v1/search           {query, searchType, datasets}

Key design choices (from debugging the live stack):
  - `add` is instant; `cognify` is slow (many LLM calls) and frequently exceeds
    the Cloudflare quick-tunnel 100s cap (HTTP 524). cognify keeps running
    server-side regardless, so we fire it and tolerate the timeout.
  - `recall` with searchType=CHUNKS is a vector lookup (no LLM) and is fast once
    the dataset is processed. GRAPH_COMPLETION needs another LLM call and is slow.
  - Auth is optional; if REQUIRE_AUTHENTICATION=true the client logs in once and
    caches the Bearer token.
"""
import json
import os
import time
import urllib.parse
import urllib.request
import urllib.error


def _load_env_file():
    """Populate os.environ from a .env file (only keys not already set in the
    real environment). Looks in: the repo root (parent of this skills dir),
    then the current working directory. Stdlib-only  -  no python-dotenv dep.

    This is what makes the scripts "just work" for automation: edit .env once
    and every cognee_client / seed_memories invocation picks it up.
    """
    from pathlib import Path

    candidates = []
    # repo root = two levels up from skills/cognee-memory/cognee_client.py
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent  # /.../Peakora-Cortex
    candidates.append(repo_root / ".env")
    candidates.append(Path.cwd() / ".env")
    seen = set()
    for env_path in candidates:
        env_path = env_path.resolve()
        if not env_path.is_file() or env_path in seen:
            continue
        seen.add(env_path)
        try:
            for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                if not key:
                    continue
                # strip inline comments and surrounding quotes
                val = val.strip()
                if "#" in val and not (val.startswith('"') or val.startswith("'")):
                    val = val.split("#", 1)[0].rstrip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                if key not in os.environ:  # real env vars always win
                    os.environ[key] = val
        except Exception:
            pass


_load_env_file()

# Where the local start-tunnel-auto.ps1 publishes the current quick-tunnel URL.
# Used by the cloud agent (no local .env) to discover Cognee's public address.
_TUNNEL_URL_REPO = os.environ.get("COGNEE_TUNNEL_REPO", "peakora/Peakora-Cortex")
_TUNNEL_URL_FILE = os.environ.get("COGNEE_TUNNEL_FILE", "tunnel_url.txt")


def _fetch_published_tunnel_url():
    """Fetch the current Cognee tunnel URL published to the GitHub repo by
    start-tunnel-auto.ps1. Returns the URL string, or '' on any failure.

    Used only when COGNEE_API_URL is not set (e.g. the cloud agent). On the
    user's PC the URL is already in .env, so this is skipped.

    Uses the GitHub contents API (not raw.githubusercontent.com) because raw
    has long/variable propagation lag for freshly-updated files on small repos.
    """
    import json as _json
    import base64 as _b64
    token = os.environ.get("GITHUB_TOKEN", "")
    api = (
        f"https://api.github.com/repos/{_TUNNEL_URL_REPO}/"
        f"contents/{_TUNNEL_URL_FILE}?ref=master"
    )
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        req = urllib.request.Request(api, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = _json.loads(r.read().decode("utf-8", "replace"))
            return _b64.b64decode(data["content"]).decode("utf-8", "replace").strip()
    except Exception:
        return ""


_BASE_FROM_ENV = os.environ.get("COGNEE_API_URL", "").rstrip("/")
BASE = _BASE_FROM_ENV or _fetch_published_tunnel_url().rstrip("/")
DATASET = os.environ.get("COGNEE_DATASET", "global_user_memory")
# Preferred auth: a non-expiring API key created once via
# POST /api/v1/auth/api-keys. It authenticates with the X-Api-Key header and
# never rotates, so losing a local .env cannot lock us out. This is the
# permanent path for OpenHands sessions.
_API_KEY = os.environ.get("COGNEE_API_KEY", "")
# Fallback auth (only used when no API key is set): email+password login.
AUTH_EMAIL = os.environ.get("COGNEE_AUTH_EMAIL", "peakora-admin@peakora.dev")
AUTH_PASSWORD = os.environ.get("COGNEE_AUTH_PASSWORD", "")
_TOKEN = os.environ.get("COGNEE_TOKEN", "")

# Cloudflare quick tunnels return 524 after ~100s; cognify legitimately runs
# longer, so a 524 / socket timeout on cognify is not a failure.
_COGNIFY_TIMEOUT = 110


def _auth_enabled():
    return bool(_API_KEY or AUTH_PASSWORD)


def _login():
    """Log in and cache a Bearer token. Only used when no API key is set."""
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    form = (
        f"username={urllib.parse.quote(AUTH_EMAIL)}"
        f"&password={urllib.parse.quote(AUTH_PASSWORD)}"
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/api/v1/auth/login",
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        _TOKEN = json.loads(r.read().decode())["access_token"]
    return _TOKEN


def _auth_headers(content_type="application/json"):
    """Build auth headers. Prefers the non-expiring API key (X-Api-Key),
    falling back to a Bearer login token when no key is configured."""
    h = {"Content-Type": content_type}
    if _API_KEY:
        h["X-Api-Key"] = _API_KEY
    elif AUTH_PASSWORD:
        h["Authorization"] = f"Bearer {_login()}"
    return h


def _request(method, path, body=None, timeout=60, content_type="application/json", auth=True):
    data = json.dumps(body).encode() if body is not None else None
    h = _auth_headers(content_type) if auth else {"Content-Type": content_type}
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, headers=h, method=method
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def _multipart(fields, file_field, file_name, file_bytes, auth=True):
    boundary = "----cognee" + str(int(time.time() * 1000))
    crlf = b"\r\n"
    parts = []
    for name, value in fields:
        parts.append(f"--{boundary}{crlf.decode()}".encode())
        parts.append(f'Content-Disposition: form-data; name="{name}"{crlf.decode()}{crlf.decode()}'.encode())
        parts.append(str(value).encode())
        parts.append(crlf)
    parts.append(f"--{boundary}{crlf.decode()}".encode())
    parts.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"{crlf.decode()}'
        f"Content-Type: text/plain{crlf.decode()}{crlf.decode()}".encode()
    )
    parts.append(file_bytes)
    parts.append(crlf)
    parts.append(f"--{boundary}--{crlf.decode()}".encode())
    body = b"".join(parts)
    h = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if auth:
        if _API_KEY:
            h["X-Api-Key"] = _API_KEY
        elif _auth_enabled():
            h["Authorization"] = f"Bearer {_login()}"
    req = urllib.request.Request(
        f"{BASE}/api/v1/add",
        data=body,
        headers=h,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def health():
    """Best-effort health check (no auth required)."""
    try:
        with urllib.request.urlopen(f"{BASE}/health", timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"status_code": e.code, "ok": e.code < 500}
    except Exception as e:
        return {"error": str(e), "ok": False}


def add(text, dataset=None):
    """Fast ingest of a text fact into the dataset (no graph build)."""
    data = text.encode()
    return _multipart(
        [("datasetName", dataset or DATASET)], "data", "memory.txt", data
    )


def cognify(dataset=None):
    """Trigger graph + embedding build. Slow; a 524/timeout is expected and
    tolerated because processing continues server-side."""
    try:
        return _request(
            "POST", "/api/v1/cognify",
            {"datasets": [dataset or DATASET]},
            timeout=_COGNIFY_TIMEOUT,
        )
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        # 524 from Cloudflare or a socket timeout means the request was cut off,
        # not that processing failed. Surface it as non-fatal.
        return {"status": "processing_in_background", "note": str(e)}


def dataset_status():
    """Map of dataset_id -> processing state (e.g. DATASET_PROCESSING_STARTED)."""
    return _request("GET", "/api/v1/datasets/status", timeout=20)


def datasets():
    """List all datasets (id, name)."""
    return _request("GET", "/api/v1/datasets", timeout=20)


# Hard gate: wiping Cognee memories is NEVER allowed by default (Ala's rule,
# 2026-08-27). delete_dataset() refuses unless the caller passes
# _allow_wipe=True AND the env var COGNEE_ALLOW_WIPE=1 is set. Re-seed is
# additive (add() appends to a dataset; it does not clear it). The ONLY way
# to wipe is an explicit, deliberate, two-factor act by Ala.
_WIPE_BLOCKED = (
    "DELETE refused: wiping Cognee memories is not allowed (Ala's rule). "
    "Re-seed is additive. To wipe a SPECIFIC dataset, Ala must set "
    "COGNEE_ALLOW_WIPE=1 AND pass _allow_wipe=True with the exact dataset name. "
    "Never wipe all datasets."
)


def delete_dataset(dataset=None, _allow_wipe=False):
    """Delete a WHOLE dataset by name. HARD-GATED by default.

    BLOCKED unless BOTH (a) env COGNEE_ALLOW_WIPE=1 is set AND (b) the
    caller passes _allow_wipe=True. This is Ala's no-wipe rule: wiping
    memories is never allowed; re-seed is additive/rewrite only.

    Why the gate exists: a delete_dataset() call with a single dataset name
    was sent to DELETE /api/v1/datasets and the server ignored the body and
    wiped EVERY dataset at once. That must never happen again. The function
    also refuses if dataset is None (no name = would wipe all).

    Even when unlocked, this deletes ONE named dataset only. There is no
    "delete all" path anymore.
    """
    import os
    if not _allow_wipe or os.environ.get("COGNEE_ALLOW_WIPE") != "1":
        return {"error": _WIPE_BLOCKED, "wiped": False}
    if not dataset:
        return {"error": "Refused: no dataset name given (would wipe all). "
                         "Pass a specific dataset name.", "wiped": False}
    try:
        return _request(
            "DELETE", "/api/v1/datasets",
            {"datasets": [dataset]}, timeout=30,
        )
    except Exception as e:
        return {"error": str(e)}



def is_ready(dataset=None):
    """True once the dataset finished processing (graph + embeddings built)."""
    try:
        st = dataset_status() or {}
    except Exception:
        return False
    states = [v for v in st.values()]
    if not states:
        return False
    return any(s in ("DATASET_PROCESSED", "DATASET_READY") for s in states) \
        and not any("ERRORED" in s for s in states)


def recall(query, search_type="CHUNKS", dataset=None):
    """Search memory. CHUNKS = fast vector lookup (no LLM); GRAPH_COMPLETION =
    slow LLM completion over the graph.

    dataset can be:
      - None  : search ALL datasets (cross-repo recall). This is the default
                and the whole point of per-repo datasets: one ERRORED repo can
                never wipe the others, yet recall still spans all of them.
      - str   : search that one dataset.
      - list  : search the named datasets.
    """
    if dataset is None:
        ds = _all_dataset_names()
    elif isinstance(dataset, (list, tuple)):
        ds = list(dataset)
    else:
        ds = [dataset]
    if not ds:
        return []
    return _request("POST", "/api/v1/recall", {
        "query": query,
        "searchType": search_type,
        "datasets": ds,
    }, timeout=95)


def _all_dataset_names():
    """Return the list of dataset names that exist in Cognee.

    Used by cross-repo recall (recall(dataset=None)) so we query every repo's
    dataset without hardcoding names. Returns [] if the API call fails.
    """
    try:
        out = []
        for d in datasets() or []:
            name = d.get("name") if isinstance(d, dict) else None
            if name:
                out.append(name)
        return out
    except Exception:
        return []


def remember(text, cognify_now=False, dataset=None):
    """Ingest a fact. add() is instant. cognify() (chunking+embedding+graph
    build) is SLOW and burns Gemini LLM calls. On the free tier the DAILY limit
    is a hard 20 RPD per day (the real killer); the per-MINUTE cap is 5 RPM. Without Cognee.s rate
    limiter a cognify bursts past 15/min -> 429 -> ERRORED. The limiter is on by
    default in docker-compose.cognee.yml (LLM_RATE_LIMIT_REQUESTS=4). Even so, the daily cap is the binding constraint; the limiter only prevents burst 429s, not daily quota exhaustion.
    cognify is OFF by default here: automatic session-end saves must NOT cognify,
    because a save could still ERRORED that repo's dataset. Cognify is a manual,
    deliberate step.

    dataset: per-repo dataset name (recommended: repo_<name>). Defaults to the
    legacy shared DATASET for backward compat. Per-repo datasets isolate
    failures: one ERRORED repo never wipes the others.

    Set cognify_now=True ONLY for a deliberate, quota-aware manual build (run by
    a human/agent that has confirmed the daily quota is fresh). Automatic
    callers should use remember_safe(), which never cognifies.
    """
    add(text, dataset=dataset)
    if cognify_now:
        cognify(dataset=dataset)


def recall_safe(query, search_type="CHUNKS", dataset=None):
    """Recall that never raises  -  memory sync must not block tasks.

    dataset=None (default) searches ALL datasets for cross-repo recall.
    Pass a name/list to restrict. NOTE: recall only returns results after each
    dataset has been cognified. On the free tier, if cognify hasn't run (or
    ERRORED for a repo), that repo returns nothing  -  but it can no longer
    poison the others (per-repo datasets). The GUARANTEED layer is MEMORY.md.
    """
    if not BASE:
        return {"error": "COGNEE_API_URL not set", "results": []}
    try:
        return recall(query, search_type, dataset=dataset)
    except Exception as e:
        return {"error": str(e), "results": []}


def remember_safe(text, dataset=None):
    """Remember that never raises. Does add() ONLY  -  never cognifies  -  so it is
    safe to call at every session end without risking an ERRORED dataset.

    dataset: per-repo dataset name (recommended). Defaults to the legacy shared
    DATASET. The ingested text is stored raw but not chunked/embedded until a
    deliberate cognify() run. The GUARANTEED memory path is MEMORY.md; this just
    feeds the best-effort Cognee layer for whenever cognify is next run manually.
    """
    if not BASE:
        return False
    try:
        add(text, dataset=dataset)  # add only  -  NO cognify (see remember())
        return True
    except Exception as e:
        print(f"[cognee] remember_safe failed: {e}")
        return False


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "health"
    if cmd == "health":
        print(json.dumps(health(), indent=2))
    elif cmd == "status":
        print(json.dumps(dataset_status(), indent=2))
    elif cmd == "datasets":
        print(json.dumps(datasets(), indent=2))
    elif cmd == "recall":
        # recall <query> [dataset]
        q = sys.argv[2] if len(sys.argv) > 2 else "cross-repo architecture constraints"
        ds = sys.argv[3] if len(sys.argv) > 3 else None
        print(json.dumps(recall_safe(q, dataset=ds), indent=2))
    elif cmd == "remember":
        # remember <dataset> <text...>  OR  remember <text...> (legacy shared)
        # If first arg after 'remember' looks like repo_<name>, treat as dataset.
        args2 = sys.argv[2:]
        ds = None
        if args2 and args2[0].startswith("repo_"):
            ds = args2[0]
            args2 = args2[1:]
        text = " ".join(args2)
        ok = remember_safe(text, dataset=ds)
        print("ok" if ok else "failed")
    elif cmd == "cognify":
        # cognify [repo_<name>]  -> manual, quota-aware build of one repo dataset.
        # This is the Option B step: session-end remember_safe() calls add() only;
        # run this periodically (manually, when quota is fresh) to make them
        # searchable. Paced by the Cognee rate limiter (12 RPM < Gemini 15 cap).
        ds = sys.argv[2] if len(sys.argv) > 2 else None
        if not ds:
            print("usage: cognee_client.py cognify <repo_dataset_name>")
            sys.exit(1)
        try:
            r = cognify(dataset=ds)
            print(json.dumps(r, indent=2))
        except Exception as e:
            print(f"error: {e}")
    else:
        print("usage: cognee_client.py [health|status|datasets|recall <query> [dataset]|"
              "remember [repo_<name>] <text>|cognify <repo_dataset_name>]")
