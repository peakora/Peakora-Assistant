# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Media assembly for the open_source engine.

Takes the per-turn MP3s from the TTS step and produces:
  - a single concatenated podcast audio file (MP3), and
  - a long-form video (MP4) with a static/title card and per-turn caption
    overlays timed to the audio.

Uses pydub for audio concatenation and moviepy 2.x + Pillow for the video.
ffmpeg must be on PATH (it is the moviepy/imageio-ffmpeg backend).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Support both package import and direct script import.
_SKILL_ROOT = Path(__file__).resolve().parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))

from schema import DialogueScript  # noqa: E402

__all__ = [
    "concat_audio",
    "render_video",
    "write_subtitle_srt",
    "MediaError",
]

# Default canvas for the long-form video. 16:9 landscape for "explainer"-style
# overviews; callers can request 9:16 for vertical shorts.
_CANVAS = {
    "16:9": (1280, 720),
    "9:16": (720, 1280),
}


class MediaError(RuntimeError):
    """Raised when audio/video assembly fails."""


def concat_audio(turn_paths: Dict[int, Path], out_path: Path) -> float:
    """Concatenate per-turn MP3s into one podcast audio file.

    Returns the total duration in seconds.
    """
    try:
        from pydub import AudioSegment
    except ImportError as exc:  # pragma: no cover
        raise MediaError(
            "pydub is required for audio concatenation. pip install pydub"
        ) from exc

    if not turn_paths:
        raise MediaError("No audio turns to concatenate.")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    ordered = [turn_paths[i] for i in sorted(turn_paths)]
    combined = AudioSegment.empty()
    for p in ordered:
        seg = AudioSegment.from_file(str(p))
        combined += seg

    combined.export(str(out_path), format="mp3")
    return len(combined) / 1000.0


def write_subtitle_srt(
    script: DialogueScript, turn_paths: Dict[int, Path], out_path: Path
) -> Path:
    """Write an SRT subtitle file timed to the per-turn audio durations."""
    try:
        from pydub import AudioSegment
    except ImportError as exc:  # pragma: no cover
        raise MediaError("pydub required for subtitle timing.") from exc

    def _fmt(ts: float) -> str:
        h = int(ts // 3600)
        m = int((ts % 3600) // 60)
        s = int(ts % 60)
        ms = int((ts - int(ts)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines: List[str] = []
    cursor = 0.0
    for i, item in enumerate(script.dialogue):
        seg = AudioSegment.from_file(str(turn_paths[i]))
        dur = len(seg) / 1000.0
        start, end = cursor, cursor + dur
        lines.append(str(i + 1))
        lines.append(f"{_fmt(start)} --> {_fmt(end)}")
        lines.append(f"{item.speaker}: {item.text}")
        lines.append("")
        cursor = end

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def render_video(
    script: DialogueScript,
    turn_paths: Dict[int, Path],
    audio_path: Path,
    out_path: Path,
    *,
    aspect: str = "16:9",
    title: Optional[str] = None,
    bg_color: Tuple[int, int, int] = (12, 10, 21),
    text_color: Tuple[int, int, int] = (248, 250, 252),
    accent_color: Tuple[int, int, int] = (244, 162, 97),
) -> Path:
    """Assemble a long-form MP4: title card + per-turn caption slides synced
    to the concatenated audio.

    The video has no external imagery by design (CPU/free), so it behaves like
    NotebookLM's minimal explainer: a branded background, the episode title,
    and the current speaker + line as an overlay.
    """
    try:
        from moviepy import (
            AudioFileClip,
            ColorClip,
            CompositeVideoClip,
            TextClip,
            concatenate_videoclips,
        )
        from pydub import AudioSegment
    except ImportError as exc:  # pragma: no cover
        raise MediaError(
            "moviepy and pydub are required for video assembly. "
            "pip install moviepy pydub"
        ) from exc

    if aspect not in _CANVAS:
        raise MediaError(f"Unsupported aspect ratio: {aspect}. Use 16:9 or 9:16.")
    w, h = _CANVAS[aspect]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    episode_title = title or script.title or "Audio Overview"

    # Font: fall back to a commonly available font. moviepy uses PIL under the
    # hood; if the named font is missing it raises, so we try a short list.
    font_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "DejaVu-Sans-Bold.ttf",
    ]

    def _make_text_clip(text: str, duration: float, font_size: int) -> TextClip:
        last_err = None
        for font in font_candidates:
            try:
                return (
                    TextClip(
                        font=font,
                        text=text,
                        font_size=font_size,
                        color=text_color,
                        stroke_color="black",
                        stroke_width=2,
                        text_align="center",
                        method="caption",
                        size=(int(w * 0.86), None),
                        interline=14,
                    )
                    .with_duration(duration)
                    .with_position(("center", "center"))
                )
            except Exception as exc:  # pragma: no cover - font availability
                last_err = exc
        raise MediaError(f"No usable font for TextClip: {last_err}")

    # Title card.
    title_clip = _make_text_clip(episode_title, 3.0, 52)
    title_card = CompositeVideoClip(
        [ColorClip(size=(w, h), color=bg_color).with_duration(3.0), title_clip],
        size=(w, h),
    )

    # Per-turn slides synced to each turn's audio duration.
    slides = [title_card]
    cursor = 3.0  # after title card
    for i, item in enumerate(script.dialogue):
        seg = AudioSegment.from_file(str(turn_paths[i]))
        dur = max(0.5, len(seg) / 1000.0)
        label = f"{item.speaker}" if not script.name_of_guest else (
            f"{item.speaker}" if item.speaker == "Host"
            else script.name_of_guest
        )
        body = f"{label}\n\n{item.text}"
        body_clip = _make_text_clip(body, dur, 34)
        bg = ColorClip(size=(w, h), color=bg_color).with_duration(dur)
        # Accent bar at the top to match Peakora's dark-luxury accent.
        bar = ColorClip(size=(w, 6), color=accent_color).with_duration(dur).with_position(("center", 0))
        slide = CompositeVideoClip([bg, bar, body_clip], size=(w, h)).with_start(cursor)
        slides.append(slide)
        cursor += dur

    video = concatenate_videoclips(slides, method="compose")
    audio = AudioFileClip(str(audio_path))
    # The title card (3s) sits before the spoken audio; offset audio start.
    final = video.with_audio(audio.with_start(3.0))
    final.write_videofile(str(out_path), fps=24, logger=None, codec="libx264")
    return out_path
