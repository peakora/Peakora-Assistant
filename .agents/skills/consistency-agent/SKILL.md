---
name: consistency-agent
description: "consistency-agent - Character consistency agent [EXCLUDED]"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# consistency-agent  -  Character consistency agent [EXCLUDED]

## Status
**EXCLUDED  -  requires GPU.** Documented for honesty/completeness so recall
surfaces it, but NOT built or run under the owner's "no paid APIs, no GPU" rule.
Reactivate only if a free-tier GPU or local GPU becomes available.

## Intended purpose
Track a master character reference image and generate visually consistent
character keyframes across scene prompts (Phase 2 Kids Islamic long-form).

## Why excluded
The intended models  -  Flux with a reference adapter, or IP-Adapter  -  are
GPU-heavy. No free CPU path produces consistent character keyframes at usable
quality. Adopting a cloud paid API (Replicate, etc.) violates the no-paid rule.

## Current fallback (what we WILL do, CPU/free)
- Deterministic-seed image generation on a free CPU image endpoint (e.g.
  Pollinations with a fixed seed + a textual character description) for
  scene-to-scene approximate consistency.
- Reuse a single master reference image with light ken-burns / pan moves rather
  than re-generating the character each scene.
- This is lower fidelity than Flux/IP-Adapter but stays in the zero-cost lane.

## Reference (CPU/free fallback only)
```python
import requests
def consistent_keyframe(character_desc, scene_prompt, seed=42):
    # Pollinations free CPU endpoint with fixed seed for reproducibility
    prompt = f"{character_desc}. {scene_prompt}"
    url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt)}?seed={seed}&nologo=true"
    r = requests.get(url, timeout=30)
    return r.content  # PNG bytes
```

## Reactivation criteria
- A free-tier GPU runner or local GPU is available, AND
- Flux/IP-Adapter can run within that budget.
