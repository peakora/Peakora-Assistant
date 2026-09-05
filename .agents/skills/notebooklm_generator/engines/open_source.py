# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Open-source engine.

A fully self-hosted NotebookLM-style fallback: no Google session required.

Pipeline:
  1. Extract text from the Position-1 source (text_extraction).
  2. Generate a structured Host/Guest dialogue with an LLM (script_gen):
     Gemini free tier by default, OpenAI as fallback.
  3. Render each turn to MP3 with multi-voice TTS (tts): ElevenLabs if a key
     is present, else edge-tts (free, no key).
  4. Concatenate the per-turn audio into one podcast MP3 (media.concat_audio).
  5. Assemble a long-form video with caption slides synced to the audio
     (media.render_video) and emit an SRT subtitle file.

Inspired by gabrielchua/open-notebooklm (Apache-2.0) and lfnovo/open-notebook,
generalized for the Peakora content pipeline and made dependency-light so it
runs CPU/free on GitHub Actions.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

# Ensure the skill root (this file's parent dir) is on sys.path so the
# sibling modules (schema, media, script_gen, tts, text_extraction) are
# importable whether this module is run as a package member or as a script.
_SKILL_ROOT = Path(__file__).resolve().parent.parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))

from .base import EngineResult  # noqa: E402
from media import concat_audio, render_video, write_subtitle_srt  # noqa: E402
from schema import DialogueScript  # noqa: E402
from script_gen import generate_script  # noqa: E402
from text_extraction import extract_text, truncate_for_llm  # noqa: E402
from tts import render_audio  # noqa: E402

__all__ = ["run"]


def _topic_from_source(source_path: str) -> str:
    base = os.path.basename(source_path.rstrip("/"))
    name, _ = os.path.splitext(base)
    return name.replace("_", " ").replace("-", " ") or "the provided source"


def run(
    source_path: str,
    output_dir: str,
    *,
    topic: Optional[str] = None,
    length: str = "deep_dive",
    language: str = "en",
    instructions: str = "",
    llm_model: Optional[str] = None,
    tts_provider: Optional[str] = None,
    aspect: str = "16:9",
    skip_video: bool = False,
) -> EngineResult:
    """Run the open-source engine synchronously.

    Args:
        source_path: Position-1 source (local file or http URL).
        output_dir: Directory to write media into (created if missing).
        topic: One-line focus for the LLM. Defaults to the source filename.
        length: "brief" or "deep_dive" (turn-count guidance).
        language: Spoken dialogue language code.
        instructions: Free-form producer notes passed to the LLM.
        llm_model: Override the LLM model id.
        tts_provider: "elevenlabs" or "edge" to force TTS; None auto-selects.
        aspect: Video aspect ratio, "16:9" or "9:16".
        skip_video: If True, only produce the audio overview + SRT.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    turns_dir = out / "turns"
    turns_dir.mkdir(parents=True, exist_ok=True)

    # 1. Extract source text.
    raw_text = extract_text(source_path)
    source_text = truncate_for_llm(raw_text)
    focus = topic or _topic_from_source(source_path)

    # Persist the extracted text for Position-3 / debugging.
    (out / "source_text.txt").write_text(raw_text, encoding="utf-8")

    # 2. Generate the dialogue script.
    script: DialogueScript = generate_script(
        source_text,
        topic=focus,
        length=length,
        language=language,
        instructions=instructions,
        model=llm_model,
    )
    script_json_path = out / "dialogue_script.json"
    script_json_path.write_text(
        json.dumps(script.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 3. Render per-turn audio.
    turn_paths = render_audio(
        script, turns_dir, language=language, prefer_provider=tts_provider
    )

    # 4. Concatenate into one podcast audio file.
    audio_path = out / "audio_overview.mp3"
    duration = concat_audio(turn_paths, audio_path)

    # Subtitles for Position-3 captions.
    srt_path = out / "audio_overview.srt"
    write_subtitle_srt(script, turn_paths, srt_path)

    files = {
        "audio_overview": str(audio_path),
        "subtitles": str(srt_path),
        "dialogue_script": str(script_json_path),
        "source_text": str(out / "source_text.txt"),
    }

    # 5. Assemble the video (optional).
    if not skip_video:
        video_path = out / "video_overview.mp4"
        try:
            render_video(
                script,
                turn_paths,
                audio_path,
                video_path,
                aspect=aspect,
                title=script.title,
            )
            files["video_overview"] = str(video_path)
        except Exception as exc:
            files["_video_error"] = str(exc)

    transcript = "\n".join(
        f"{item.speaker}: {item.text}" for item in script.dialogue
    )

    return EngineResult(
        engine="open_source",
        source_path=source_path,
        files=files,
        duration_seconds=round(duration, 2),
        transcript=transcript,
        notes=(
            f"Generated {script.turn_count} turns (~{script.approx_duration_seconds:.0f}s). "
            f"Guest: {script.name_of_guest}. Title: {script.title}."
        ),
    )
