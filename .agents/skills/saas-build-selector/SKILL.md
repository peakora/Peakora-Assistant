---
name: saas-build-selector
description: DECISION LAYER. When a SaaS app / software build task arrives, decide which build engine to use (OpenHands by default, CrewAI as the custom-crew escape hatch) by matching the build's profile to each engine's strengths, then hand off to the chosen engine. Auto-applied at the start of any "build X app" task. Always apply before selecting an engine; never bypass.
metadata:
  version: 1.0.0
---

# SaaS Build Selector

This skill is the decision layer for the Peakora build engines. When a
software/SaaS build task arrives, run this selection BEFORE picking an
engine. It matches the build's profile to each engine's strengths and
hands off to the winner.

The engine set is deliberately small: one default that ships real code,
one escape hatch for custom multi-agent collaboration. This replaces the
earlier 4-engine catalog (chatdev/metagpt/crewai-examples were dropped as
dead weight - the selector never routed to them for a real deployable
SaaS; their outputs always had to be ported into an OpenHands build to
ship anyway).

## The engines

| Engine | Best for | Style | Real execution? |
|--------|----------|-------|:---:|
| `openhands-engine` | Real multi-file SaaS that must run, pass tests, deploy | One autonomous agent loop against a real filesystem + shell | YES |
| `crewai-core` | Custom multi-agent collaboration no preset pipeline covers | You-design-it crew (roles/goals/tools/tasks/process) | Varies |

Source repos:
- OpenHands: github.com/All-Hands-AI/OpenHands
- CrewAI Core: github.com/crewAIInc/crewAI

## Decision procedure (run this, in order)

Answer each question about the build at hand, then follow the FIRST rule
that matches. Stop at the first match.

1. **Is this a real, deployable app that must run, pass tests, and ship to
   git with CI/CD (multi-tenant SaaS, full web app with auth/billing/RLS)?
   This is the overwhelming majority of Peakora builds.**
   -> YES: pick `openhands-engine`. It is the default. It drives the full
   Peakora lifecycle (Planner -> build -> Code Reviewer -> Security Auditor
   -> Test Runner -> Doc Writer -> Performance Profiler).

2. **Does the build need a CUSTOM multi-agent collaboration that no preset
   pipeline covers (bespoke roles/tools, integration-heavy, dynamic
   delegation between specialist agents you design)?**
   -> YES: pick `crewai-core`. Design a crew (roles/goals/tools/tasks/
   process), run it, then port its validated output into a real repo and
   harden with the OpenHands lifecycle agents before shipping.

3. **Unsure / mixed profile?**
   -> DEFAULT to `openhands-engine`. It is the most general and the only
   engine with real execution against the filesystem.

## Hard rules

- NEVER pick an engine by habit. Run the decision procedure every time a
  build task arrives; the build profile decides.
- A build that must deploy is OpenHands's by default. A CrewAI build's
  output gets ported into a real repo and verified by the lifecycle agents
  before shipping.
- CrewAI is only chosen when no preset pipeline fits. It is the escape
  hatch, not the default.

## How it hands off

After the decision, load the chosen engine skill (`openhands-engine` or
`crewai-core`) and follow its "Install and run" section. The selected
engine then drives the build; the Peakora lifecycle agents (Planner, Code
Reviewer, Security Auditor, Test Runner, Doc Writer, Performance Profiler)
apply during/after, regardless of engine.

## Output (decision record)

Before building, write a one-paragraph decision record in the task notes:

- Build profile (real deployable app / custom-collaboration / unsure).
- Chosen engine + the matched rule number.
- Whether a secondary engine will be used for a phase (rare; e.g. CrewAI
  for a custom research crew, OpenHands for the build).

This record is what the SaaS builder agent persists and audits later.
