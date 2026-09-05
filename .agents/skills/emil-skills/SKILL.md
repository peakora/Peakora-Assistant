---
name: emil-skills
description: >-
 Motion + design-engineering skill collection by Emil Kowalski (MIT,
 imported from github.com/emilkowalski/skills). 12 sub-skills based on his
 Vercel and Linear experience: the authoritative layer for animation
 engineering (animate, review-animations, improve-animations,
 find-animation-opportunities, animation-vocabulary) plus design-eng
 helpers (pick-ui-library, prototype, emil-design-eng, apple-design,
 ask-sonner, write-swift, animate-expo). Each sub-skill has its own
 SKILL.md in a subdirectory below. The animation discipline here is far
 deeper than the motion presets in peakora-design-system.
license: MIT
source: github.com/emilkowalski/skills
metadata:
  version: 1.0.0
---

# Emil Kowalski's Skills - Motion + Design Engineering

Imported from github.com/emilkowalski/skills (MIT). A collection of 12
sub-skills for designers and engineers to build better user interfaces,
focused on motion and animation craft. Based on years of work at Vercel and
Linear.

## When to use

The motion discipline here is the authoritative layer. The peakora-design-system
skill defines Peakora's motion PRESETS; this collection defines the full
animation engineering process: whether to animate at all, what purpose the
motion serves, which tool is cheapest, which properties, which curve and
duration, how it interrupts and exits.

## Sub-skills (each is a subdirectory with its own SKILL.md)

| Sub-skill | Purpose |
|-----------|---------|
| `animate` | Build an animation from scratch with the right decisions in order. The core construction skill. |
| `review-animations` | Critique existing motion against Emil's standards (the bar `animate` builds to). |
| `improve-animations` | Audit a whole codebase's motion and produce an improvement plan. |
| `find-animation-opportunities` | Hunt for places that COULD animate but don't yet. |
| `animation-vocabulary` | The shared motion language (terms, patterns). |
| `pick-ui-library` | Choose the right UI component library for a component need (toasts, drawers, dropdowns). |
| `prototype` | Rapid prototyping guidance. |
| `emil-design-eng` | General design-engineering principles. |
| `apple-design` | Apple-platform design conventions. |
| `ask-sonner` | Sonner (toast library) usage guidance. |
| `animate-expo` | React Native (Expo) animation. |
| `write-swift` | Swift/iOS native guidance. |

## Cross-repo playbook access

Each sub-skill's `SKILL.md` lives in this skill's subdirectory in the
Peakora-Cortex hub (private repo). When recalled in a consuming repo, read a
sub-skill via the GitHub Contents API:

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/peakora/Peakora-Cortex/contents/skills/emil-skills/<sub-skill>/SKILL.md" \
| python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())"
```

No hub-on-disk needed, no skill copy - the hub is the single source of truth.

## Overlap with Peakora tools (see skills/registry.md)

- `peakora-design` defines Peakora's motion PRESETS (a few). This
 collection is the full motion ENGINEERING layer. For Peakora repos, use
 the peakora-design presets for the branded micro-interactions, and this
 collection for any non-trivial animation decision (should it animate,
 which tool, which curve).
- The `peakora-design` skill's `check` mode delegates to
 `review-animations` / `improve-animations` when auditing motion.
- `pick-ui-library` complements (does not conflict with) the
 peakora-design component grammar.
