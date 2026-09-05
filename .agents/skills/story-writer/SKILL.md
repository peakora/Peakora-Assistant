---
name: story-writer
description: "story-writer - Structured storyboard agent"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# story-writer  -  Structured storyboard agent

## Status
**CATALOGUED [CPU/FREE]  -  for the future Kids MSA Islamic long-form channel
(PeakoraEngine roadmap Phase 2).** Reference implementation ready; not yet
wired into a running channel.

## When to use
Invoke when a task needs a scene-by-scene JSON storyboard with narration  - 
especially child-friendly Modern Standard Arabic (MSA) storytelling with
authentic Islamic moral values. Recalled automatically for Arabic storytelling
/ long-form video tasks.

## Capabilities
- Generate a structured JSON storyboard: `{scenes: [{visual_prompt, voiceover,
  search_keyword, duration}], title, moral}`.
- Child-friendly MSA narration with authentic Islamic moral values.
- Ground topics in open-source Islamic story datasets
  (`mohammed-2-5/islamic-library-data`, Little_Muslim_Companion).
- Uses Gemini (Google AI Studio free tier)  -  CPU/free.

## Reference implementation
```python
import json, os
from google import genai

def generate_storyboard(topic, num_scenes=8, model="gemini-2.0-flash"):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    prompt = (
        "You are a children's storyteller. Produce a JSON storyboard for an "
        f"Arabic (MSA) Islamic story about: {topic}. Schema: "
        '{"title":str,"moral":str,"scenes":[{"visual_prompt":str,'
        '"voiceover":str(MSA),"search_keyword":str,"duration":float}]} '
        f"{num_scenes} scenes, 15-30s each. Authentic Islamic values, "
        "child-friendly. Return ONLY valid JSON."
    )
    resp = client.models.generate_content(model=model, contents=prompt)
    return json.loads(resp.text)
```

## Pair with
- `auto-diacritizer` (Tashkeel) before TTS.
- `arabic-tts` for MSA voiceover.
- `video-stitcher` for long-form 16:9 assembly.
