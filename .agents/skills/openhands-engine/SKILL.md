---
name: openhands-engine
description: Drive the OpenHands agent platform (github.com/All-Hands-AI/OpenHands) as the build engine for real, production-grade software. Use when the build needs a general-purpose autonomous coding agent that runs tools, edits files, runs tests, and ships to git, especially multi-file SaaS apps with real CI/CD.
metadata:
  version: 1.0.0
---

# OpenHands Engine

OpenHands (github.com/All-Hands-AI/OpenHands) is the general-purpose
autonomous software-engineering agent platform this whole hub runs on. It is
the DEFAULT build engine for Peakora SaaS apps: a single agent loop that
plans, edits files, runs shell commands, runs tests, and pushes to git, all
backed by an LLM you choose.

## When to use

Pick OpenHands as the build engine when the job is a real, multi-file
production app that must run, pass tests, and deploy:

- A multi-tenant SaaS web app (frontend + backend + DB + auth + billing).
- Greenfield codebases where the agent must explore, decide structure, and
  iterate against real test runs.
- Work that needs the full Peakora lifecycle agents (Planner -> build ->
  Code Reviewer -> Security Auditor -> Test Runner -> Doc Writer), because
  those agents ARE OpenHands sub-agents.
- Anything that must end as a deployable git repo with CI/CD.

OpenHands is the right call when you want one agent that owns the whole
loop against a real filesystem and a real shell, not a simulated
software-company roleplay.

## Strengths

- Real execution: the agent actually runs commands, runs tests, reads real
  output, and edits real files. No simulated file system.
- LLM-portable: bring your own model (Gemini free tier via LiteLLM is the
  Peakora default; any OpenAI/Anthropic/local model works).
- Composable: sub-agents (this hub's Planner, Code Reviewer, etc.) extend
  it with specialized, grounded passes.
- Skills inject expert knowledge on demand (this hub's whole value prop).
- Cloud + local runtimes; agent-server API for delegation/automation.
- Mature, well-maintained, large community (~85K stars).

## When NOT to pick it (pick another engine instead)

- You want a structured multi-agent "software company" roleplay with
  defined roles (CEO/CTO/Programmer/Tester) and a turn-based pipeline ->
  pick `chatdev`.
- You want a SOP-driven multi-agent framework with built-in roles
  (Product Manager / Architect / Engineer / QA) and humanized/JSON output
  -> pick `metagpt`.
- You want role-based COLLABORATION (a crew of specialist agents that
  reason + hand tasks to each other) more than a single autonomous loop ->
  pick `crewai-core`.
- You need a reference crew/workflow EXAMPLE to copy and adapt fast ->
  pick `crewai-examples`.

## Install and run

```bash
# Local runtime (Docker required)
pip install openhands-ai
openhands

# Or run in the cloud
# https://app.all-hands.dev
```

Point the repo's `AGENTS.md` at the Peakora Cortex hub so skills + agents
auto-load. The build then follows the standard lifecycle:

```
Planner -> (build with OpenHands) -> Code Reviewer -> Security Auditor
   -> Test Runner -> Doc Writer -> Performance Profiler
```

## How it hands off

OpenHands IS the orchestrator. The other engines are either alternatives to
it (ChatDev, MetaGPT, CrewAI) or reference material for it (CrewAI
examples). When a build task arrives, the `saas-build-selector` skill
decides whether OpenHands itself drives, or whether a specialized engine is
a better fit.
