# agents/  -  Sub-Agent Library

File-based sub-agents for the OpenHands agent. Each `.md` file here is an
autonomous agent definition (YAML frontmatter + system prompt) that the
parent agent delegates to via the `task` tool. They run their own
conversation loop with their own tools and return a result.

This is the counterpart to `../skills/`:
- **Skills** = knowledge injected into the parent agent's context.
- **Agents** = purpose-built workers the parent delegates to.

## How they become usable

OpenHands auto-scans `.agents/agents/*.md` at session start and registers
each as an invokable `subagent_type`. So:

1. **In this hub**  -  the same files are copied into `.agents/agents/` so
   they're live and testable here.
2. **In any consuming repo**  -  copy the ones you want from this `agents/`
   folder into `<repo>/.agents/agents/`. They auto-register on the next
   session. No install step.

```bash
# from a consuming repo:
mkdir -p .agents/agents
cp <this-hub>/agents/code-reviewer.md .agents/agents/
cp <this-hub>/agents/security-auditor.md .agents/agents/
```

## Inventory

### Generic (reusable by anyone)

| Agent | Tools | Use when |
|-------|-------|----------|
| `Planner` | terminal | START of any non-trivial build/fix. Read-only exploration, produces an approval-ready plan (approach, exact files, risks, verification) BEFORE code is written. JCODE plan-mode pattern. |
| `Code Reviewer` | terminal, file_editor | AFTER execution. Reviewing a PR/branch diff for correctness, security, simplicity, risk. Grounded, no hallucinated findings. |
| `Security Auditor` | terminal, file_editor | Auditing a repo/diff for OWASP vulns, secret leaks, insecure auth, supply-chain risk. Before deploy or after auth/billing changes. |
| `DB Architect` | terminal, file_editor | Designing schemas, writing idempotent+reversible migrations, RLS policies, reviewing queries for N+1/missing indexes. |
| `Test Runner` | terminal, file_editor | Writing and running real tests (no mocks unless justified), diagnosing failures to root cause. |
| `Doc Writer` | terminal, file_editor | READMEs, API docs, architecture overviews, docstrings  -  reads the code first, never documents unimplemented behavior. |
| `Performance Profiler` | terminal, file_editor | Finding hot paths, measuring before/after, proposing the smallest change with the biggest win. |

### Example (Peakora-specific  -  adapt the pattern to your stack)

| Agent | Tools | What it shows |
|-------|-------|---------------|
| `Billing Integrator` | terminal, file_editor | Dodo Payments subscription billing (client lib + HMAC webhook + status endpoint + plan gating). The security contract is reusable for any MoR. |
| `SaaS Builder` | terminal, file_editor, task | TOP-LEVEL ORCHESTRATOR. Builds, tests, or hardens a SaaS in THREE modes (detected from the input): BUILD ("Start from Scratch" / one-paragraph idea -> new deployable repo), TEST (existing repo -> full diagnostic: test-runner + security-auditor + db-architect + billing-integrator + code-reviewer + doc-writer + performance-profiler return a ranked report of what is missing/broken/wrong; does NOT rewrite), HARDEN (existing repo -> fix the findings until tests + audit are green). Delegates to every lifecycle agent above via the `task` tool. The `task` tool is what lets it delegate - it is the ONLY agent that needs `task`. Callable from any repo that copies it into `.agents/agents/`, or invoked from the hub with the target repo cloned locally (preferred: avoids stale agent copies). Hardcore-tested 2026-08-27, all 3 modes passed. |

Note: design conformance is owned by the `peakora-design` skill (check +
enforce), not a dedicated agent. The old `design-enforcer` agent was
removed; `peakora-design` absorbed its logic.

## Authoring your own

Copy any file here as a template. The format:

```yaml
---
name: my-agent
description: >-
    One line the parent agent reads to decide when to delegate to you.
    Be specific  -  this is the routing signal.
tools:
  - terminal
  - file_editor
---

You are ... (the system prompt  -  method, rules, output format)
```

Keep these principles:
- **Tools**  -  list only what the agent needs. Read-only agents (`code-explorer`)
  shouldn't get `file_editor`.
- **Description**  -  the routing signal. "Reviews X for Y" beats "Helps with code".
- **System prompt**  -  method (ordered steps), non-negotiable rules, a fixed
  output format. The agent returns exactly that structure.
- **Grounding**  -  every finding cites a real file:line the agent verified.

## See also
- `../skills/registry.md`  -  the master index of skills AND agents, with
  overlap-resolution rules (use X over Y when...).
- `../skills/skill-audit/SKILL.md`  -  auto-discovers relevant skills/agents
  for a repo at session start.
- OpenHands file-based agents docs: https://docs.openhands.dev/sdk/guides/agent-file-based
