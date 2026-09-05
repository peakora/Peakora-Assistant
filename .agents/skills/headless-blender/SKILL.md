---
name: headless-blender
description: "headless-blender - 2D Grease Pencil rigging skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# headless-blender  -  2D Grease Pencil rigging skill

## Status
**CATALOGUED [CPU/FREE but heavy install]  -  for the future Pencil & Stickman
channel (PeakoraEngine roadmap Phase 3).** Headless Blender execution.

## When to use
Invoke to manipulate 2D Grease Pencil armatures and render stickman movements
programmatically without a GUI. Recalled automatically for 2D rigging / Blender
automation tasks.

## Capabilities
- Drive Blender headlessly via command-line arguments (`blender -b -P script.py`)
  to manipulate Grease Pencil rigs and render MP4 frames.
- Timed action syncing: consume trigger tags from `script-writer`.
- Runs on GitHub Actions (Blender is apt-installable on ubuntu-latest; render is
  CPU/Eevee  -  no GPU required for 2D Grease Pencil).

## Reference implementation
```python
import subprocess, os

def render_blender_script(blend_file, py_script, out_dir, blender_bin="blender"):
    # Headless: -b = background, -P = run python, --render-output
    subprocess.run([
        blender_bin, "-b", blend_file,
        "-P", py_script,
        "--", out_dir,
    ], check=True)

# Example Grease Pencil driver (py_script.py run inside Blender):
"""
import bpy, sys
out_dir = sys.argv[-1]
gp = bpy.data.grease_pencils[0]
# animate armature bones / stroke frames here...
bpy.context.scene.render.filepath = f"{out_dir}/frame_"
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(animation=True)
"""
```

## Env / install
- On Actions: `sudo apt-get install -y blender`.
- Locally: install Blender and ensure `blender` is on PATH.

## Notes
- 2D Grease Pencil renders on Eevee work on CPU (slower than GPU but functional).
- For pure vector stroke animation, prefer `procedural-drawing` (lighter).

## Pair with
- `script-writer` for the trigger-tagged narration.
- `video-stitcher` for final assembly.
