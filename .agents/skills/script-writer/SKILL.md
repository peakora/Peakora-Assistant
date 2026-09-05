---
name: script-writer
description: "script-writer - Educational script agent with drawing trigger tags"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# script-writer  -  Educational script agent with drawing trigger tags

## Status
**CATALOGUED [CPU/FREE]  -  for the future Pencil & Stickman channel
(PeakoraEngine roadmap Phase 3).** Reference implementation ready; not yet
wired into a running channel.

## When to use
Invoke when a task needs an educational script enriched with explicit visual
drawing trigger tags that align a whiteboard/pencil animation timeline with the
voiceover. Recalled automatically for drawing/whiteboard animation tasks.

## Capabilities
- Generate a narration script with inline visual trigger tags, e.g.
  `[draw:triangle]`, `[draw:label "A"]`, `[pause 2s]`, `[erase]`.
- Tags are parsed by `procedural-drawing` / `headless-blender` to sync stroke
  animation to voiceover timestamps.
- Uses Gemini free tier  -  CPU/free.

## Reference implementation
```python
import json, os, re
from google import genai

TAG_RE = re.compile(r"\[(draw|label|pause|erase|move)(?:[^\]]*)\]")

def generate_script(topic, model="gemini-2.0-flash"):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    prompt = (
        "Write an educational script (English or Arabic MSA) teaching: "
        f"{topic}. Insert inline drawing trigger tags to pace a whiteboard "
        "animation: [draw:<shape>], [label \"<text>\"], [pause <s>], [erase], "
        "[move <x> <y>]. Output JSON: "
        '{"title":str,"segments":[{"voiceover":str,"tags":[...],"duration":float}]}.'
        " Return ONLY valid JSON."
    )
    resp = client.models.generate_content(model=model, contents=prompt)
    return json.loads(resp.text)

def parse_trigger_tags(script):
    """Return [(tag_type, payload, segment_index)] for animation syncing."""
    out = []
    for i, seg in enumerate(script["segments"]):
        for m in TAG_RE.finditer(seg["voiceover"]):
            out.append((m.group(1), m.group(0), i))
    return out
```

## Pair with
- `procedural-drawing` or `headless-blender` to render the tagged animation.
- `video-stitcher` for final assembly with audio ducking.
