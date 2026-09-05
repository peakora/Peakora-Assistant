---
name: readme-keeper
description: >-
    Auto-updates a repo's README at task completion when the task merits it.
    Detects whether a finished task changed something a reader/user would care
    about (new features, new skills/agents, config changes, breaking changes,
    new env vars) and, if so, updates the README in place  -  accurately,
    grounded in the actual diff. Skips trivial tasks (typos, refactor, docs).
    Run at the END of a task before finishing.
license: MIT
metadata:
  version: 1.0.0
---

# readme-keeper  -  Automatic README maintenance

## Status
REAL  -  run at task completion, before `finish`.

## When to use
At the END of every non-trivial task, before finishing. The skill decides
whether the README actually needs updating  -  most tasks don't. When it does,
the README gets updated in the same commit as the work, so docs and code
never drift.

## How it works
1. **Inspect the task's actual diff.** `git diff origin/<branch>...HEAD` (or
   `git diff --staged` / `git show HEAD`). Read what really changed.
2. **Classify the change** against the table below. Decide: README-worthy or
   not.
3. **If README-worthy:** read the current README, update ONLY the affected
   section(s) to match the new reality, and include the README change in the
   task's commit. Never rewrite the whole README for a small change.
4. **If NOT README-worthy:** do nothing. Say "README unchanged  -  task is
   internal" and finish.
5. **If this is the Peakora-Cortex (peakora-cortex) hub** AND the task added
   a new skill or agent: also update `skills/registry.md` with the new row
   (name, availability, purpose, overlap rule).

## README-worthy classification

| Change type | Update README? | What to change |
|-------------|----------------|----------------|
| New feature / capability | YES | "What it does" + quickstart example |
| New skill or agent (hub) | YES | inventory table + registry.md |
| New env var / config option | YES | configuration section / env table |
| Breaking change (API, config, behavior) | YES | prominently, with migration note |
| New dependency required to run | YES | install/quickstart section |
| Removed feature | YES | remove from README, note if breaking |
| New endpoint / CLI command | YES | API/usage section |
| Bug fix (user-visible) | YES (sometimes) | only if README claimed wrong behavior |
| Internal refactor (no behavior change) | NO |  -  |
| Test-only changes | NO |  -  |
| Typo / comment / docs-only | NO |  -  |
| CI/workflow tweak (no user impact) | NO |  -  |
| Dependency version bump (no API change) | NO |  -  |
| Code style / formatting | NO |  -  |

## Rules
- **Ground in the diff.** Only document what actually changed. If the README
  already describes the new behavior, don't touch it.
- **Minimal edit.** Update the affected section, not the whole file. A README
  rewrite for a one-line feature is noise.
- **No marketing creep.** Don't add "now even better!" or emoji. State the
  change factually.
- **Keep it scannable.** Tables stay tables. Code examples stay runnable.
- **If unsure, lean toward NOT updating.** A slightly stale README is better
  than a noisy commit history full of README churn. Only update when a
  reader/user would actually be misled or miss something without it.
- **Hub registry rule:** in the peakora-cortex hub, any new skill or agent
  ALWAYS triggers a registry.md update  -  no exceptions. The registry is the
  source of truth and must never lag behind the actual files.

## Output
Either:
- "README unchanged  -  task is internal (refactor/tests/docs)."  -  and do
  nothing, OR
- "README updated: <section>  -  <what changed>."  -  and the README edit is
  included in the task commit.

## When NOT to run
- The repo has no README (don't create one unprompted  -  ask first).
- The task was explicitly "update the README" (it's already the task).
- The task is on a branch that will be squash-merged and the README change
  isn't worth preserving separately (rare; usually just include it).
