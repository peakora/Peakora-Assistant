#!/usr/bin/env python3
# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Bootstrap Cognee memories from a repository.

Walks a repo, extracts architectural facts (stack, dependencies, schemas,
endpoints, conventions, env keys), and ingests them into the self-hosted
Cognee memory engine so future OpenHands sessions on ANY repo can recall
cross-repo context.

Stdlib-only (like cognee_client.py) so it runs anywhere with python3.

Usage:

    # Seed from local repo path(s)
    python3 skills/cognee-memory/seed_memories.py /path/to/some-repo

    # Seed ALL your GitHub repos (clones each to temp, analyzes, cleans up)
    python3 skills/cognee-memory/seed_memories.py --github-user peakora

    # Seed specific GitHub repos by name
    python3 skills/cognee-memory/seed_memories.py --github-user peakora \\
        --repos adaptive-minds PeakoraEngine

    # Dry run (print what would be ingested, don't call Cognee)
    python3 skills/cognee-memory/seed_memories.py --github-user peakora --dry-run

Requires env vars (see .env.example):
    COGNEE_API_URL, and COGNEE_AUTH_EMAIL/COGNEE_AUTH_PASSWORD if auth is on.

Design notes:
- NO-WIPE RULE (Ala, 2026-08-27): wiping Cognee memories is NEVER allowed.
  Re-seed is ADDITIVE: add() appends to a dataset, it does not clear it.
  The seeder NEVER calls delete_dataset(). On cognify ERRORED the dataset
  is LEFT IN PLACE and can be re-cognified on a fresh quota day; a future
  add() rewrites over it. delete_dataset() in cognee_client is hard-gated
  (needs COGNEE_ALLOW_WIPE=1 + _allow_wipe=True + a named dataset) so it
  cannot be triggered casually or by accident. There is no "delete all"
  path anywhere.
- Each repo is seeded into its OWN dataset (repo_<name>), NOT one shared
  dataset. recall(dataset=None) searches ALL datasets at once, so
  cross-repo recall still works across the per-repo datasets.
- cognify is REQUIRED for recall to work. It performs chunking + embedding
  (creates the LanceDB vector collection), not just graph extraction.
  Without cognify, recall returns 404 NoDataError.
- cognify runs PER REPO (add -> cognify -> wait -> verify). On ERRORED
  (LLM burst-rate 429s) the dataset is left in place (NOT deleted); the
  script stops that repo and other repos are untouched.
- Gemini 3.6 Flash free tier: 5 RPM, 20 RPD, 250K TPM. The DAILY limit
  (20 req/day) is the hard cap (~7 LLM calls/repo = ~2-3 repos/day).
  Cognee's rate limiter (LLM_RATE_LIMIT_REQUESTS=4 in
  docker-compose.cognee.yml) paces cognify under it. Use --max-repos to
  limit per run (default: 3, conservative).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Import the sibling client. Works whether run from the hub root or copied.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import cognee_client  # noqa: E402

DATASET = os.environ.get("COGNEE_DATASET", "global_user_memory")

# Files whose mere presence tells us about the stack. (filename, label)
STACK_FILES = [
    ("package.json", "Node.js (package.json)"),
    ("tsconfig.json", "TypeScript (tsconfig.json)"),
    ("requirements.txt", "Python (requirements.txt)"),
    ("pyproject.toml", "Python (pyproject.toml)"),
    ("setup.py", "Python (setup.py)"),
    ("Pipfile", "Python (Pipfile)"),
    ("uv.lock", "Python with uv (uv.lock)"),
    ("deno.json", "Deno (deno.json)"),
    ("Dockerfile", "Docker (Dockerfile)"),
    ("docker-compose.yml", "Docker Compose"),
    ("docker-compose.yaml", "Docker Compose"),
    (".gitlab-ci.yml", "GitLab CI"),
    ("azure-pipelines.yml", "Azure DevOps CI"),
    ("bitbucket-pipelines.yml", "Bitbucket CI"),
    ("pom.xml", "Java/Maven (pom.xml)"),
    ("build.gradle", "Java/Gradle (build.gradle)"),
    ("Package.swift", "Swift (Package.swift)"),
    ("go.mod", "Go (go.mod)"),
    ("Gemfile", "Ruby (Gemfile)"),
    ("Cargo.toml", "Rust (Cargo.toml)"),
    ("composer.json", "PHP (composer.json)"),
]

# Env keys whose presence indicates a service integration (name, service).
ENV_SIGNALS = [
    ("SUPABASE", "Supabase (DB/Auth/Storage)"),
    ("DODO", "Dodo Payments (monetization)"),
    ("PADDLE", "Paddle (monetization  -  legacy)"),
    ("RESEND", "Resend (transactional email)"),
    ("GEMINI", "Google Gemini (LLM)"),
    ("COGNEE", "Cognee (self-hosted memory)"),
    ("SENTRY", "Sentry (error tracking)"),
    ("POSTHOG", "PostHog (product analytics)"),
    ("CLOUDFLARE", "Cloudflare (DNS/edge/tunnel)"),
    ("STRIPE", "Stripe (payments)"),
    ("OPENAI", "OpenAI (LLM)"),
    ("ANTHROPIC", "Anthropic (LLM)"),
]

# Conventional places to look for DB schemas / migrations.
SCHEMA_GLOBS = [
    "**/migrations/**/*.sql",
    "**/schema.sql",
    "**/schema.prisma",
    "**/supabase/**/*.sql",
    "**/db/**/*.sql",
]

# Files that usually encode project conventions / architecture.
DOC_FILES = [
    "AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
    "ARCHITECTURE.md",
    "docs/ARCHITECTURE.md",
]

MAX_FILE_BYTES = 200_000  # don't read enormous files


def _read(path: Path) -> str:
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return f"[file too large: {path.name}, {path.stat().st_size} bytes]"
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"[unreadable: {e}]"


def _deps_from_package_json(text: str) -> list:
    try:
        pkg = json.loads(text)
    except Exception:
        return []
    deps = []
    for section in ("dependencies", "devDependencies"):
        for name in (pkg.get(section) or {}).keys():
            deps.append(name)
    return deps


def _deps_from_requirements(text: str) -> list:
    deps = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # strip version specifiers
        name = re.split(r"[=<>!\[ ]", line)[0]
        if name:
            deps.append(name)
    return deps


def _deps_from_pyproject(text: str) -> list:
    # Lightweight parse without tomllib dependency (works on py3.6+)
    deps = []
    in_deps = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("dependencies") or s.startswith("[project.dependencies"):
            in_deps = True
            continue
        if in_deps:
            if s.startswith("]") or (s.startswith("[") and "dependencies" not in s):
                in_deps = False
                continue
            m = re.search(r'["\']([^"\']+)["\']', s)
            if m:
                deps.append(m.group(1))
    return deps


def _endpoints(text: str) -> list:
    """Crudely extract route definitions from common frameworks."""
    eps = []
    patterns = [
        r'@(?:app|router)\.(?:get|post|put|patch|delete)\(\s*[\'"]([^\'"]+)[\'"]',
        r'\b(?:router|app)\.(?:get|post|put|patch|delete)\(\s*[\'"]([^\'"]+)[\'"]',
        r'@\w+\.(?:Get|Post|Put|Patch|Delete)\(\s*[\'"]([^\'"]+)[\'"]',
        r'\bpath\s*=\s*[\'"]([^\'"]+)[\'"]',
        r'@(?:app|blueprint)\.route\(\s*[\'"]([^\'"]+)[\'"]',
    ]
    for p in patterns:
        eps.extend(re.findall(p, text))
    return eps


def _env_keys(env_text: str) -> list:
    keys = []
    for line in env_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Z0-9_]+)=", line)
        if m:
            # mask the value  -  never ingest secrets
            keys.append(m.group(1))
    return keys


def _gh_api(path):
    """Call GitHub REST API. Returns parsed JSON. Uses GITHUB_TOKEN if set."""
    import urllib.request
    token = os.environ.get("GITHUB_TOKEN", "")
    url = f"https://api.github.com{path}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "cognee-seed"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _list_github_repos(user):
    """List repo names for a GitHub user or org (owner + organization_member,
    not forks). affiliation=owner alone EXCLUDES org repos the token is a
    member of (peakora is an org), so we query both affiliations and union
    them so org repos are never silently skipped."""
    repos = []
    seen = set()
    for affiliation in ("owner", "organization_member"):
        page = 1
        while True:
            batch = _gh_api(
                f"/user/repos?per_page=100&page={page}"
                f"&affiliation={affiliation}&sort=updated"
            )
            if not batch:
                break
            for r in batch:
                if r.get("fork"):
                    continue
                name = r["name"]
                if name in seen:
                    continue
                seen.add(name)
                repos.append(name)
            if len(batch) < 100:
                break
            page += 1
    return sorted(repos)


def _clone_repo(user, name, dest):
    """Shallow-clone a GitHub repo into dest (temp). Token embedded for auth."""
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        url = f"https://{token}@github.com/{user}/{name}.git"
    else:
        url = f"https://github.com/{user}/{name}.git"
    res = subprocess.run(
        ["git", "clone", "--depth", "1", url, str(dest)],
        capture_output=True, text=True, timeout=180,
    )
    if res.returncode != 0:
        raise RuntimeError(f"git clone failed for {name}: {res.stderr.strip()}")


def analyze_repo(repo: Path) -> str:
    """Return a structured memory text block describing the repo."""
    lines = []
    name = repo.name
    lines.append(f"# Repo memory: {name}")
    lines.append(f"path: {repo}")
    lines.append("")

    # --- Stack detection (files present) ---
    stack = []
    for fname, label in STACK_FILES:
        if (repo / fname).exists():
            stack.append(label)
    # GitHub actions
    if (repo / ".github" / "workflows").is_dir():
        stack.append("GitHub Actions CI")
    if stack:
        lines.append("## Stack")
        lines.append("\n".join(f"- {s}" for s in stack))
        lines.append("")

    # --- Dependencies ---
    deps = []
    pj = repo / "package.json"
    if pj.exists():
        deps = _deps_from_package_json(_read(pj))
        lines.append("## Node dependencies (package.json)")
    req = repo / "requirements.txt"
    if req.exists():
        deps = _deps_from_requirements(_read(req))
        lines.append("## Python dependencies (requirements.txt)")
    pp = repo / "pyproject.toml"
    if pp.exists() and not deps:
        deps = _deps_from_pyproject(_read(pp))
        lines.append("## Python dependencies (pyproject.toml)")
    if deps:
        lines.append("\n".join(f"- {d}" for d in sorted(set(deps))))
        lines.append("")

    # --- Env / service integrations (keys only, values masked) ---
    env_files = [repo / ".env", repo / ".env.example", repo / ".env.local"]
    env_text = "\n".join(_read(e) for e in env_files if e.exists())
    if env_text:
        keys = _env_keys(env_text)
        services = set()
        for k in keys:
            for sig, label in ENV_SIGNALS:
                if sig in k.upper():
                    services.add(label)
        lines.append("## Environment / service integrations (keys only)")
        if services:
            lines.append("Services detected:")
            lines.append("\n".join(f"- {s}" for s in sorted(services)))
        lines.append("Env keys (values never ingested):")
        lines.append(", ".join(sorted(keys)) if keys else "(none)")
        lines.append("")

    # --- Schema / migrations summary ---
    schema_files = []
    for g in SCHEMA_GLOBS:
        schema_files.extend(repo.glob(g))
    # de-dup + limit
    schema_files = sorted(set(schema_files))[:20]
    if schema_files:
        lines.append("## Database schema / migration files")
        for f in schema_files:
            rel = f.relative_to(repo)
            lines.append(f"- {rel}")
        lines.append("")

    # --- Endpoints (best-effort scan of source dirs) ---
    src_dirs = []
    for d in ("src", "app", "api", "server", "routes", "backend"):
        p = repo / d
        if p.is_dir():
            src_dirs.append(p)
    endpoints = set()
    if src_dirs:
        for d in src_dirs:
            for f in d.rglob("*"):
                if f.suffix in (".js", ".ts", ".py", ".go", ".rb"):
                    try:
                        for ep in _endpoints(_read(f)):
                            endpoints.add(ep)
                    except Exception:
                        pass
        if endpoints:
            lines.append("## API endpoints (best-effort extraction)")
            for ep in sorted(endpoints)[:50]:
                lines.append(f"- {ep}")
            lines.append("")

    # --- Docs / conventions (first lines only) ---
    for doc in DOC_FILES:
        p = repo / doc
        if p.exists():
            lines.append(f"## {doc} (first 60 lines)")
            head = "\n".join(_read(p).splitlines()[:60])
            lines.append(head)
            lines.append("")

    # --- Git remote (host info, no secrets) ---
    git_cfg = repo / ".git" / "config"
    if git_cfg.exists():
        txt = _read(git_cfg)
        m = re.search(r"url\s*=\s*(\S+)", txt)
        if m:
            url = m.group(1)
            # strip any embedded token
            url = re.sub(r"https://[^@]+@", "https://", url)
            lines.append(f"## Git remote\n{url}\n")

    lines.append("---")
    return "\n".join(lines)


def _dataset_for_repo(name: str) -> str:
    """Per-repo dataset name. Each repo lives in its own dataset so recall
    is scoped and one repo's ERRORED never affects the others. Per the
    NO-WIPE rule the seeder never deletes a dataset; ERRORED is left in
    place and re-cognified later."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", name)
    return f"repo_{safe}"


def _wait_for_processing(dataset: str, max_wait=240):
    """Poll the status of ONE dataset until COMPLETED/ERRORED or timeout.

    Per-repo polling (not the whole status map) so an ERRORED on repo B is not
    misread as the state of repo A. Returns status string."""
    import time as _t
    for _ in range(max_wait // 10):
        _t.sleep(10)
        try:
            st = cognee_client.dataset_status() or {}
        except Exception:
            st = {}
        # match by dataset name OR by id->state where the id belongs to this ds
        vals = []
        if isinstance(st, dict):
            # st is {dataset_id: state}; resolve which ids belong to our dataset
            my_ids = set()
            for d in _list_my_datasets():
                if d.get("name") == dataset and d.get("id"):
                    my_ids.add(d["id"])
            for did, state in st.items():
                if did in my_ids or not my_ids:
                    vals.append(state)
            # also accept a direct name->state mapping if the API returns one
            if dataset in st:
                vals.append(st[dataset])
        if not vals:
            continue
        if any("COMPLETED" in v or "READY" in v or "PROCESSED" in v for v in vals):
            return "COMPLETED"
        if any("ERRORED" in v for v in vals):
            return "ERRORED"
    return "TIMEOUT"


def _list_my_datasets():
    """Cached list of datasets as dicts (id, name). Empty list on error."""
    try:
        return cognee_client.datasets() or []
    except Exception:
        return []


def ingest(repo: Path, dry_run: bool, run_cognify: bool = True) -> str:
    """Add a repo's memory to Cognee in its OWN dataset (repo_<name>).
    If run_cognify, run cognify on that one dataset only (REQUIRED for chunking
    + embedding  -  without it, recall returns 404).
    Returns: 'OK', 'ERRORED', 'FAILED', or 'DRY'.

    On ERRORED the dataset is LEFT IN PLACE (NO-WIPE rule); a future add()
    rewrites over it and it can be re-cognified on a fresh quota day. Other
    repos are untouched.
    """
    text = analyze_repo(repo)
    ds = _dataset_for_repo(repo.name)
    if dry_run:
        print(f"\n===== DRY RUN: {repo} (dataset: {ds}) =====\n")
        print(text)
        return "DRY"
    print(f"[cognee] adding memory for {repo} into dataset '{ds}' ...")
    try:
        cognee_client.add(text, dataset=ds)
        print("[cognee] add OK")
    except Exception as e:
        print(f"[cognee] add FAILED: {e}")
        return "FAILED"

    if not run_cognify:
        print(f"[cognee] WARNING: skipping cognify  -  data ingested but NOT chunked/embedded.")
        print("[cognee] recall will return 404 until cognify is run. Use --no-cognify only")
        print("[cognee] if you plan to run cognify separately later.")
        return "OK"

    print(f"[cognee] running cognify on dataset '{ds}' (chunking + embedding + graph) ...")
    print("[cognee] ~6-7 LLM calls/repo. Gemini free tier: 20 RPD per day (the hard cap), 5 RPM.")
    try:
        cognee_client.cognify(dataset=ds)
    except Exception as e:
        print(f"[cognee] cognify request error (may still process server-side): {e}")

    print(f"[cognee] waiting for processing of '{ds}' to complete ...")
    status = _wait_for_processing(ds)
    print(f"[cognee] processing status: {status}")

    if status == "ERRORED":
        print(f"[cognee] ERRORED on dataset '{ds}'  -  likely a 429 daily-quota exhaustion.")
        print(f"[cognee] NO-WIPE RULE: leaving dataset '{ds}' in place (not deleting).")
        print(f"[cognee] Re-seed is additive: a future add() will rewrite over this.")
        print(f"[cognee] The dataset can be re-cognified on a fresh quota day. Other repos are SAFE.")
        return "ERRORED"

    # Verify recall works on this repo's dataset
    try:
        import time as _t
        _t.sleep(3)
        results = cognee_client.recall(repo.name.replace("-", " "), dataset=ds)
        n = len(results) if isinstance(results, list) else 0
        print(f"[cognee] recall verify on '{ds}': {n} chunks found")
    except Exception as e:
        print(f"[cognee] recall verify failed: {e}")

    return "OK"


def main():
    ap = argparse.ArgumentParser(description="Seed Cognee memories from repo(s).")
    ap.add_argument("repos", nargs="*", help="local repo path(s) to analyze")
    ap.add_argument("--github-user", help="GitHub username  -  clone & seed all (non-fork) repos")
    # dest must differ from the positional or argparse clobbers --repos with the
    # positional's empty list (falls back to seeding ALL repos)
    ap.add_argument("--repos", dest="gh_repos", nargs="+",
                    help="specific GitHub repo names (with --github-user)")
    ap.add_argument("--dry-run", action="store_true", help="print, don't ingest")
    ap.add_argument(
        "--no-cognify",
        action="store_true",
        default=False,
        help="skip cognify (data will NOT be chunked/embedded  -  recall returns 404). "
             "Only use if you plan to run cognify separately later.",
    )
    ap.add_argument(
        "--max-repos",
        type=int,
        default=3,
        help="max repos to seed per run (default: 3, conservative. Gemini free tier "
             "is 20 RPD = ~2-3 repos/day, so this is caution, not a hard limit)",
    )
    args = ap.parse_args()

    if not args.github_user and not args.repos:
        ap.error("provide local repo paths, or use --github-user")

    # Build the list of repos to process as (name, Path) pairs.
    repo_list = []
    tmp_root = None
    if args.github_user:
        if not os.environ.get("GITHUB_TOKEN"):
            print("ERROR: GITHUB_TOKEN not set (needed to clone private repos).",
                  file=sys.stderr)
            sys.exit(2)
        if args.gh_repos:
            names = args.gh_repos
        else:
            print(f"[github] listing repos for {args.github_user} ...")
            names = _list_github_repos(args.github_user)
        print(f"[github] {len(names)} repo(s): {', '.join(names)}")
        tmp_root = Path(tempfile.mkdtemp(prefix="cognee-seed-"))
        for name in names:
            dest = tmp_root / name
            print(f"[github] cloning {name} ...")
            try:
                _clone_repo(args.github_user, name, dest)
                repo_list.append((name, dest))
            except Exception as e:
                print(f"[github] WARN: skip {name}: {e}", file=sys.stderr)
    else:
        for r in args.repos:
            repo = Path(r).expanduser().resolve()
            repo_list.append((repo.name, repo))

    # COGNEE_API_URL may be set directly, or auto-discovered by cognee_client
    if not cognee_client.BASE and not args.dry_run:
        print("ERROR: COGNEE_API_URL is not set and the published tunnel URL "
              "could not be fetched. Set it (see .env.example).", file=sys.stderr)
        sys.exit(2)

    if not args.dry_run:
        h = cognee_client.health()
        if not h.get("ok", True) and h.get("status_code", 500) >= 500:
            print(f"ERROR: Cognee health check failed: {h}", file=sys.stderr)
            if tmp_root:
                shutil.rmtree(tmp_root, ignore_errors=True)
            sys.exit(3)
        print(f"[cognee] health OK: {h.get('version', h)}")

    run_cognify = not args.no_cognify
    if run_cognify:
        print(f"[cognee] cognify ON (per-repo). Max {args.max_repos} repos this run.")
        print("[cognee] Gemini free tier: 20 RPD per day (the hard cap), 5 RPM. Rate limiter paces burst under 5 RPM.")
    else:
        print("[cognee] cognify OFF (--no-cognify). WARNING: data will NOT be searchable!")

    seeded = 0
    for name, path in repo_list:
        if seeded >= args.max_repos:
            print(f"\n[info] reached --max-repos limit ({args.max_repos}). Stopping.")
            print("[info] Raise --max-repos to seed more (daily limit is 20 req/day, the real hard cap).")
            break
        if path is None or not path.is_dir():
            print(f"WARN: not a directory, skipping: {name}", file=sys.stderr)
            continue
        result = ingest(path, args.dry_run, run_cognify=run_cognify)
        if result == "ERRORED":
            print("\n[error] A repo ERRORED (likely 429 daily-quota). NO-WIPE RULE: that repo's")
            print("[error] dataset was LEFT IN PLACE (not deleted); re-cognify it on a fresh quota day.")
            print("[error] Every other repo's memory is SAFE. Stopping the run.")
            break
        if result == "FAILED":
            print("\n[error] add() failed (auth/infra, not quota). Fix Cognee access first.")
            print("[error] Check COGNEE_API_URL reachability and COGNEE_API_KEY validity.")
            break
        if result == "OK" or result == "DRY":
            seeded += 1

    # Clean up cloned repos
    if tmp_root:
        shutil.rmtree(tmp_root, ignore_errors=True)
        print("[github] temp clones cleaned up")

    if args.dry_run:
        print("\n(dry run  -  nothing was sent to Cognee)")
        return

    print(f"\nDone. {seeded} repo(s) seeded. Each repo lives in its OWN dataset (repo_<name>).")
    if run_cognify and seeded > 0:
        print("[cognee] Memories are chunked, embedded, and searchable via recall().")
        print("[cognee] recall(dataset=None) searches ALL repo datasets at once (cross-repo).")
        print("[cognee] An ERRORED repo can now only wipe itself  -  never the others.")


if __name__ == "__main__":
    main()
