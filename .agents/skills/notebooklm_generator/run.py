#!/usr/bin/env python3
# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""notebooklm_generator orchestrator (Position 2 of the Peakora pipeline).

Accepts a Position-1 source document, renders long-form media (audio overview
MP3 + video overview MP4), and writes a manifest of output file paths that
Position 3 consumes.

Usage
-----
Run as a module:

    python -m skills.notebooklm_generator.run \
        --source-path ./research.pdf \
        --output-dir ./out \
        --engine open_source \
        --length deep_dive --language en

Or as a script:

    python skills/notebooklm_generator/run.py \
        --source-path https://example.com/article \
        --output-dir ./out \
        --engine google_native \
        --storage-state ./storage_state.json

The manifest is written to ``<output_dir>/manifest.json`` and contains, at
minimum::

    {
      "engine": "google_native" | "open_source",
      "source_path": "...",
      "files": { "audio_overview": "...", "video_overview": "..." },
      ...
    }
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Make the skill importable whether invoked as a module or a script.
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent  # repo root (skills/.. )
for p in (str(_HERE.parent), str(_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from notebooklm_generator.engines import run_engine  # noqa: E402

__all__ = ["main", "build_parser", "run"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="notebooklm_generator",
        description=(
            "Generate NotebookLM-style long-form audio/video overviews. "
            "Position 2 of the Peakora content pipeline."
        ),
    )
    parser.add_argument(
        "--source-path",
        required=True,
        help=(
            "Position-1 source: local file (PDF/DOCX/HTML/MD/TXT) or an "
            "http(s) URL. The google_native engine also accepts YouTube URLs."
        ),
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write rendered media and the manifest into.",
    )
    parser.add_argument(
        "--engine",
        choices=("google_native", "open_source"),
        default="open_source",
        help=(
            "google_native = real Google NotebookLM overviews via "
            "notebooklm-py (needs a stored Google session). "
            "open_source = LLM script + multi-voice TTS + moviepy video "
            "(no Google session needed). Default: open_source."
        ),
    )

    # Shared generation options.
    parser.add_argument("--title", default=None, help="Episode/notebook title.")
    parser.add_argument(
        "--instructions", default="", help="Custom instructions / producer notes."
    )
    parser.add_argument(
        "--language", default="en", help="Output language (e.g. en, ar, fr)."
    )
    parser.add_argument(
        "--skip-video",
        action="store_true",
        help="Only produce the audio overview (and SRT/subtitles).",
    )

    # open_source engine options.
    parser.add_argument(
        "--length",
        choices=("brief", "deep_dive"),
        default="deep_dive",
        help="[open_source] Dialogue length tier (Brief vs Deep Dive).",
    )
    parser.add_argument(
        "--llm-model",
        default=None,
        help="[open_source] Override the LLM model id (Gemini/OpenAI).",
    )
    parser.add_argument(
        "--tts-provider",
        choices=("elevenlabs", "edge"),
        default=None,
        help="[open_source] Force a TTS provider. Default auto-selects ElevenLabs if a key is set, else edge-tts (free).",
    )
    parser.add_argument(
        "--aspect",
        choices=("16:9", "9:16"),
        default="16:9",
        help="[open_source] Video aspect ratio.",
    )

    # google_native engine options.
    parser.add_argument(
        "--storage-state",
        default=None,
        help=(
            "[google_native] Path to storage_state.json OR its raw JSON "
            "contents. Falls back to NOTEBOOKLM_AUTH_JSON / "
            "NOTEBOOKLM_STORAGE_STATE env vars."
        ),
    )
    parser.add_argument(
        "--audio-format",
        choices=("deep_dive", "brief", "critique", "debate"),
        default="deep_dive",
        help="[google_native] NotebookLM audio overview format.",
    )
    parser.add_argument(
        "--video-style",
        default="explainer",
        help="[google_native] NotebookLM video visual style (explainer|brief|cinematic|short|auto).",
    )
    parser.add_argument(
        "--poll-timeout",
        type=int,
        default=2700,
        help="[google_native] Max seconds to wait for Google to finish generating.",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=20,
        help="[google_native] Seconds between status polls.",
    )

    parser.add_argument(
        "--manifest-name",
        default="manifest.json",
        help="Filename for the output manifest written into --output-dir.",
    )
    return parser


def _engine_kwargs(args: argparse.Namespace) -> dict:
    common = dict(
        source_path=args.source_path,
        output_dir=args.output_dir,
        instructions=args.instructions,
        language=args.language,
        skip_video=args.skip_video,
    )
    if args.engine == "google_native":
        common.update(
            title=args.title or "Peakora Audio Overview",
            audio_format=args.audio_format,
            video_style=args.video_style,
            storage_state=args.storage_state,
            poll_timeout=args.poll_timeout,
            poll_interval=args.poll_interval,
        )
    else:
        common.update(
            topic=args.title,
            length=args.length,
            llm_model=args.llm_model,
            tts_provider=args.tts_provider,
            aspect=args.aspect,
        )
    return common


def run(args: argparse.Namespace) -> dict:
    """Execute the chosen engine and write the manifest. Returns the manifest dict."""
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    kwargs = _engine_kwargs(args)
    result = run_engine(args.engine, **kwargs)

    manifest = result.to_manifest()
    manifest_path = output_dir / args.manifest_name
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Echo a concise summary for pipeline logs.
    print(
        f"[notebooklm_generator] engine={args.engine} "
        f"files={list(result.files.keys())} "
        f"manifest={manifest_path}",
        file=sys.stderr,
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest = run(args)
    except Exception as exc:  # surface a clear error to the pipeline.
        print(f"[notebooklm_generator] FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
