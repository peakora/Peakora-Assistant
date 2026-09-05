---
name: video-stitcher
description: "video-stitcher - FFmpeg + MoviePy assembly skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# video-stitcher  -  FFmpeg + MoviePy assembly skill

## Status
**REAL / WORKING**  -  reference drawn from `PeakoraEngine/auto_pilot.py`
(`compile_video_built_in`). CPU/free (moviepy 2.x + ffmpeg). Runs on GitHub
Actions ubuntu-latest.

## When to use
Invoke when a task needs to composite scene clips into a final vertical (9:16)
or horizontal (16:9) video: concatenation, aspect-ratio resize/crop, captions,
logo overlay, CTA overlays, background music, and voiceover mix. Recalled
automatically for repos doing video generation.

## Capabilities
- Concatenate scene clips with `concatenate_videoclips(method="compose")`.
- Per-scene resize + center-crop to a target canvas (1080x1920 for 9:16).
- Static or per-word caption overlays via `TextClip` (method='caption').
- Persistent CTA overlays (bio link, "Follow for more") with timed starts.
- Logo overlay with `ImageClip`.
- Background music looped to match total duration, mixed under the voiceover.
- (FUTURE) dynamic audio ducking + kinetic word-level captions  -  see the
  PeakoraEngine roadmap Phase 1.

## Reference implementation (9:16 short, from PeakoraEngine)
```python
from moviepy import (VideoFileClip, AudioFileClip, TextClip, ImageClip,
    CompositeVideoClip, concatenate_videoclips, concatenate_audioclips,
    CompositeAudioClip)
from moviepy.audio.fx import MultiplyVolume

def generate_caption(text, duration, font_path):
    return TextClip(font=font_path, text=text, font_size=42, color='#FFFFFF',
        stroke_color='black', stroke_width=2.5, text_align='center',
        method='caption', size=(960, None)).with_duration(duration)\
        .with_position(('center', 1150))

def compile_video_built_in(workspace_dir, font_path, music_path=None):
    import json, os
    script = json.load(open(os.path.join(workspace_dir, "script.json")))
    video_scenes, audio_clips = [], []
    for i, scene in enumerate(script['scenes']):
        n = i + 1
        audio = AudioFileClip(os.path.join(workspace_dir, f"scene_{n}.mp3"))
        audio_clips.append(audio)
        raw = VideoFileClip(os.path.join(workspace_dir, f"video_{n}.mp4"))
        scale = max(1080 / raw.w, 1920 / raw.h)
        v = raw.resized(scale).cropped(x_center=raw.w*scale/2, y_center=raw.h*scale/2,
            width=1080, height=1920).with_duration(audio.duration)
        cap = generate_caption(scene.get('voiceover', '').strip(), audio.duration, font_path)
        video_scenes.append(CompositeVideoClip([v, cap], size=(1080, 1920)))
    full_loop = concatenate_videoclips(video_scenes, method="compose")
    voiceover_mix = concatenate_audioclips(audio_clips)
    if music_path and os.path.exists(music_path):
        music = AudioFileClip(music_path).with_effects([MultiplyVolume(0.12)])
        loops = int(full_loop.duration // music.duration) + 1
        bg = concatenate_audioclips([music] * loops).subclipped(0, full_loop.duration)
        final_audio = CompositeAudioClip([voiceover_mix, bg])
    else:
        final_audio = voiceover_mix
    return full_loop.with_audio(final_audio)
```

## Notes
- moviepy 2.x API: `from moviepy import ...` and `.with_effects([...])`.
- ffmpeg must be on PATH (on Actions: `sudo apt-get install -y ffmpeg`; locally
  use the imageio_ffmpeg bundled binary  -  see PeakoraEngine AGENTS.md).
- Output writes via `clip.write_videofile(out, fps=24, logger=None)`.
