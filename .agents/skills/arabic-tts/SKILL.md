---
name: arabic-tts
description: "arabic-tts - MSA voiceover skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# arabic-tts  -  MSA voiceover skill

## Status
**CATALOGUED [CPU/FREE]  -  for the future Arabic channel (PeakoraEngine roadmap
Phase 2).** Reuses PeakoraEngine's existing Kokoro-ONNX CPU infrastructure.

## When to use
Invoke to synthesize Modern Standard Arabic (MSA) speech from (ideally
diacritized) text, with runtime selection of an open-source model. Recalled
automatically for Arabic voiceover tasks.

## Capabilities
- MSA TTS via open-source CPU models: Nabra (Kokoro MSA fine-tune) or
  Kokoro-ONNX with an Arabic voice pack.
- Tiered fallback (mirrors PeakoraEngine's `voice.py`): Kokoro-ONNX → edge-tts
  (Arabic voice) → gTTS. All CPU/free.
- Output one MP3 per scene/segment.

## Reference implementation (Kokoro-ONNX tier)
```python
import asyncio, os, edge_tts

def synth_kokoro_msa(text, out_path, model_path, voices_path, voice="ar"):
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(model_path, voices_path)
    samples, sr = kokoro.create(text, voice=voice)
    import soundfile as sf
    sf.write(out_path, samples, sr)

async def synth_edge_tts_ar(text, out_path, voice="ar-EG-SalmaNeural"):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)

def synth_gtts_ar(text, out_path):
    from gtts import gTTS
    gTTS(text=text, lang="ar").save(out_path)
```

## Env / install
- `pip install kokoro-onnx onnxruntime soundfile edge-tts gtts`
- Kokoro model files: `kokoro-v1.0.onnx` + `voices-v1.0.bin` (and an Arabic
  voice pack for MSA). PeakoraEngine's workflow pre-fetches these.

## Pair with
- `auto-diacritizer`  -  diacritize text first for accurate vocalization.
- `video-stitcher`  -  assemble voiceovers into the final video.
