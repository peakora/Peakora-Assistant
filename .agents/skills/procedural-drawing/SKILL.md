---
name: procedural-drawing
description: "procedural-drawing - Vector stroke animation skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# procedural-drawing  -  Vector stroke animation skill

## Status
**CATALOGUED [CPU/FREE]  -  for the future Pencil & Stickman channel
(PeakoraEngine roadmap Phase 3).** CPU render via Manim/OpenCV.

## When to use
Invoke to render line-art / whiteboard / pencil-sketch animation frames from
vector paths or stroke descriptions. Recalled automatically for drawing-based
educational video tasks.

## Capabilities
- Animate SVG/vector paths stroke-by-stroke into frames using Manim (ManimCE).
- Convert line art to pencil-sketch frames via OpenCV contour drawing filters.
- Timed action syncing: consume trigger tags from `script-writer` to align
  drawing timelines with voiceover timestamps.
- Headless render (no GUI)  -  runs on GitHub Actions ubuntu-latest.

## Reference implementation (Manim stroke animation)
```python
from manim import Scene, Create, Write, SVGMobject, config
config.format = "mp4"
config.pixel_height = 1080
config.pixel_width = 1920

class DrawScene(Scene):
    def construct(self):
        # svg_path points to a line-art SVG; Create animates the stroke
        shape = SVGMobject("drawing.svg")
        self.play(Create(shape), run_time=4)
        self.wait(2)
```

## Reference implementation (OpenCV pencil sketch)
```python
import cv2, numpy as np

def to_pencil_sketch(img_bgr):
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    inv = 255 - gray
    blur = cv2.GaussianBlur(inv, (21, 21), 0)
    return cv2.divide(gray, 255 - blur, scale=256.0)

def progressive_draw(frames_dir, out_video, fps=24):
    # animate stroke order by alpha-compositing incremental contour segments
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    h, w = 1080, 1920
    writer = cv2.VideoWriter(out_video, fourcc, fps, (w, h))
    # ... iterate frames, write ...
    writer.release()
```

## Env / install
- `pip install manim` (ManimCE; needs ffmpeg + a few system libs).
- `pip install opencv-python`.

## Pair with
- `script-writer` for the trigger-tagged narration.
- `video-stitcher` for final assembly with audio.
