# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Multi-voice TTS for the open_source engine.

Renders each DialogueItem to its own audio file using a per-speaker voice,
then the media module concatenates them into the final podcast audio.

Voice providers (in priority order):
  1. ElevenLabs (premium, multi-voice) - only if ELEVENLABS_API_KEY is set.
  2. edge-tts (free, no key)            - default. Excellent multi-voice
     support across languages via Microsoft Edge online voices.

The voice map is configurable; sensible defaults are provided for English and
a handful of other languages. Voice ids can be overridden via env vars
EDGE_HOST_VOICE / EDGE_GUEST_VOICE for advanced use.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Dict, Optional

# Support both package import (skills.notebooklm_generator.tts) and direct
# script import by ensuring the skill root is on sys.path.
_SKILL_ROOT = Path(__file__).resolve().parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))

from schema import DialogueScript  # noqa: E402

__all__ = ["render_audio", "TTSProviderError"]

# Default edge-tts voice ids per language (host, guest).
# Two distinct voices so the listener can tell speakers apart.
_DEFAULT_EDGE_VOICES: Dict[str, Dict[str, str]] = {
    "en": {"Host": "en-US-AriaNeural", "Guest": "en-US-GuyNeural"},
    "ar": {"Host": "ar-EG-SalmaNeural", "Guest": "ar-EG-ShakirNeural"},
    "fr": {"Host": "fr-FR-DeniseNeural", "Guest": "fr-FR-HenriNeural"},
    "es": {"Host": "es-ES-ElviraNeural", "Guest": "es-ES-AlvaroNeural"},
    "de": {"Host": "de-DE-KatjaNeural", "Guest": "de-DE-ConradNeural"},
    "pt": {"Host": "pt-BR-FranciscaNeural", "Guest": "pt-BR-AntonioNeural"},
    "hi": {"Host": "hi-IN-SwaraNeural", "Guest": "hi-IN-MadhurNeural"},
    "ja": {"Host": "ja-JP-NanamiNeural", "Guest": "ja-JP-KeitaNeural"},
}

# Default ElevenLabs voice names per speaker. Replace with your preferred
# voice ids/names via env overrides (see _eleven_voices).
_DEFAULT_ELEVEN_VOICES = {
    "Host": "Rachel",
    "Guest": "Antoni",
}


class TTSProviderError(RuntimeError):
    """Raised when TTS rendering fails for all providers."""


def _edge_voices(language: str) -> Dict[str, str]:
    lang = language.lower()
    base = _DEFAULT_EDGE_VOICES.get(lang) or _DEFAULT_EDGE_VOICES.get(
        lang.split("-")[0], _DEFAULT_EDGE_VOICES["en"]
    )
    return {
        "Host": os.environ.get("EDGE_HOST_VOICE", base["Host"]),
        "Guest": os.environ.get("EDGE_GUEST_VOICE", base["Guest"]),
    }


def _eleven_voices() -> Dict[str, str]:
    return {
        "Host": os.environ.get("ELEVEN_HOST_VOICE", _DEFAULT_ELEVEN_VOICES["Host"]),
        "Guest": os.environ.get("ELEVEN_GUEST_VOICE", _DEFAULT_ELEVEN_VOICES["Guest"]),
    }


def _use_elevenlabs() -> bool:
    return bool(os.environ.get("ELEVENLABS_API_KEY"))


# --- edge-tts (free) --------------------------------------------------------

async def _edge_synth(text: str, voice: str, out_path: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(out_path))


def _render_edge(script: DialogueScript, out_dir: Path, language: str) -> Dict[int, Path]:
    voices = _edge_voices(language)
    paths: Dict[int, Path] = {}
    loop = asyncio.new_event_loop()
    try:
        for idx, item in enumerate(script.dialogue):
            out_path = out_dir / f"turn_{idx:03d}_{item.speaker.lower()}.mp3"
            loop.run_until_complete(
                _edge_synth(item.text, voices[item.speaker], out_path)
            )
            paths[idx] = out_path
    finally:
        loop.close()
    return paths


# --- ElevenLabs (premium) ---------------------------------------------------

def _render_eleven(script: DialogueScript, out_dir: Path) -> Dict[int, Path]:
    from elevenlabs import ElevenLabs, save

    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    voices = _eleven_voices()
    paths: Dict[int, Path] = {}
    for idx, item in enumerate(script.dialogue):
        out_path = out_dir / f"turn_{idx:03d}_{item.speaker.lower()}.mp3"
        audio = client.text_to_speech.convert(
            text=item.text,
            voice_id=voices[item.speaker],
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        save(audio, str(out_path))
        paths[idx] = out_path
    return paths


def render_audio(
    script: DialogueScript,
    out_dir: Path,
    *,
    language: str = "en",
    prefer_provider: Optional[str] = None,
) -> Dict[int, Path]:
    """Render every dialogue turn to its own MP3 file.

    Args:
        script: The DialogueScript to voice.
        out_dir: Directory to write per-turn MP3s into (created if missing).
        language: Language code used to pick edge-tts voices.
        prefer_provider: "elevenlabs" or "edge" to force a provider; None to
            auto-select (ElevenLabs if a key is present, else edge-tts).

    Returns:
        Mapping of turn index -> path to that turn's MP3, in dialogue order.

    Raises:
        TTSProviderError if rendering fails.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    use_eleven = (
        prefer_provider == "elevenlabs"
        or (prefer_provider is None and _use_elevenlabs())
    )

    try:
        if use_eleven:
            if not _use_elevenlabs():
                raise TTSProviderError(
                    "ElevenLabs requested but ELEVENLABS_API_KEY is not set."
                )
            return _render_eleven(script, out_dir)
        return _render_edge(script, out_dir, language)
    except TTSProviderError:
        raise
    except Exception as exc:
        # If ElevenLabs fails, fall back to free edge-tts before giving up.
        if use_eleven:
            try:
                return _render_edge(script, out_dir, language)
            except Exception as fallback_exc:
                raise TTSProviderError(
                    f"ElevenLabs failed ({exc}); edge-tts fallback also failed ({fallback_exc})."
                ) from fallback_exc
        raise TTSProviderError(f"TTS rendering failed: {exc}") from exc
