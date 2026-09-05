---
name: lipsync-motion
description: "lipsync-motion - Lip-sync & motion transfer agent [EXCLUDED]"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# lipsync-motion  -  Lip-sync & motion transfer agent [EXCLUDED]

## Status
**EXCLUDED  -  requires paid cloud APIs or GPU.** Documented for
honesty/completeness so recall surfaces it, but NOT built or run under the
owner's "no paid APIs, no GPU" rule. Reactivate only if a free-tier GPU or a
free lip-sync API becomes available.

## Intended purpose
Coordinate character reference frames and voiceover audio through talking-head /
motion-transfer engines to produce speaking 2D character clips (Phase 2 Kids
Islamic long-form).

## Why excluded
- Hedra API  -  paid cloud API.
- Viggle AI API  -  paid cloud API.
- LivePortrait  -  GPU-heavy open-source model.
All three violate the no-paid / no-GPU rule.

## Current fallback (what we WILL do, CPU/free)
- No lip-sync. Use static character keyframes with subtle ken-burns / pan / zoom
  motion over the narration, plus the `video-stitcher` audio-ducked assembly.
- Acceptable for the first CPU-only long-form cut; revisit when budget exists.

## Reference (fallback only  -  no lip-sync)
```python
def fallback_scene_clip(keyframe_path, audio_path, out_path, duration):
    # Ken-burns over a still keyframe, synced to the voiceover duration.
    # Use moviepy/cv2 to generate a slow zoom/pan; mux audio via ffmpeg.
    pass  # implemented with video-stitcher primitives when Phase 2 starts
```

## Reactivation criteria
- A free-tier GPU runner runs LivePortrait within budget, OR
- A free lip-sync API quota becomes available.
