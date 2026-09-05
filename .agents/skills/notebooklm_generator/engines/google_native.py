# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Google Native engine.

Drives real Google NotebookLM audio and video overviews through the
notebooklm-py library (teng-lin/notebooklm-py, MIT). Authentication uses a
stored Google session. Two equivalent auth inputs are supported:

  - storage_state.json file path  (passed as ``storage_state``)
  - NOTEBOOKLM_AUTH_JSON env var  (the raw JSON contents; preferred for CI)

The flow mirrors the notebooklm-py README:

    async with NotebookLMClient.from_storage() as client:
        nb = await client.notebooks.create(title)
        await client.sources.add_file(nb.id, source_path)   # or add_url
        await client.artifacts.generate_audio(nb.id, instructions=...)
        await client.artifacts.wait_for_completion(nb.id, task_id)
        await client.artifacts.download_audio(nb.id, out.mp3)
        # video overview is optional:
        await client.artifacts.generate_video(nb.id, style=...)
        await client.artifacts.download_video(nb.id, out.mp4)

Generation is fire-and-forget on Google's side and takes 2-45 minutes, so this
engine polls ``wait_for_completion`` with a bounded timeout.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Optional

from .base import EngineResult

__all__ = ["run", "GoogleNativeError"]

_DEFAULT_POLL_TIMEOUT = 60 * 45  # 45 minutes
_DEFAULT_POLL_INTERVAL = 20      # seconds


class GoogleNativeError(RuntimeError):
    """Raised when the Google native engine cannot complete."""


def _resolve_storage_state(storage_state: Optional[str]) -> Optional[str]:
    """Return a path to a storage_state.json file.

    Priority:
      1. explicit ``storage_state`` argument (path or raw JSON)
      2. NOTEBOOKLM_AUTH_JSON env var (raw JSON -> written to a temp file)
      3. NOTEBOOKLM_STORAGE_STATE env var (path)
    """
    if storage_state:
        if os.path.isfile(storage_state):
            return storage_state
        # Treat as raw JSON contents.
        return _write_temp_state(storage_state)

    raw = os.environ.get("NOTEBOOKLM_AUTH_JSON")
    if raw:
        return _write_temp_state(raw)

    path = os.environ.get("NOTEBOOKLM_STORAGE_STATE")
    if path and os.path.isfile(path):
        return path
    return None


def _write_temp_state(raw: str) -> str:
    # Validate it parses as JSON before writing.
    try:
        json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GoogleNativeError(
            "NOTEBOOKLM_AUTH_JSON / storage_state is not valid JSON: "
            f"{exc.msg}"
        ) from exc
    fd, tmp = tempfile.mkstemp(prefix="nbm_state_", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(raw)
    return tmp


async def _run_async(
    source_path: str,
    output_dir: Path,
    *,
    title: str,
    instructions: str,
    language: str,
    audio_format: str,
    video_style: str,
    storage_state: Optional[str],
    poll_timeout: int,
    poll_interval: int,
    skip_video: bool,
) -> EngineResult:
    try:
        from notebooklm import NotebookLMClient
    except ImportError as exc:  # pragma: no cover
        raise GoogleNativeError(
            "notebooklm-py is not installed. Install it: pip install notebooklm-py"
        ) from exc

    state_path = _resolve_storage_state(storage_state)
    if not state_path:
        raise GoogleNativeError(
            "No Google session found. Provide storage_state.json (path or raw "
            "JSON) or set NOTEBOOKLM_AUTH_JSON. Run `notebooklm login` locally "
            "to create one, then copy ~/.notebooklm/profiles/default/storage_state.json."
        )

    files: dict[str, str] = {}
    notebook_id: Optional[str] = None
    transcript_lines = []

    client_kwargs = {}
    if language and language.lower() != "en":
        # notebooklm-py reads NOTEBOOKLM_HL for artifact language; set it so
        # generate_* honors the requested language.
        os.environ.setdefault("NOTEBOOKLM_HL", language)

    try:
        async with NotebookLMClient.from_storage(state_path, **client_kwargs) as client:
            nb = await client.notebooks.create(title)
            notebook_id = getattr(nb, "id", None)

            # Ingest the Position-1 source. URLs/YouTube go through add_url;
            # local files through add_file.
            if source_path.startswith(("http://", "https://")):
                await client.sources.add_url(nb.id, source_path, wait=True)
            else:
                await client.sources.add_file(nb.id, source_path, wait=True)

            # --- Audio overview ---
            audio_status = await client.artifacts.generate_audio(
                nb.id, instructions=instructions or None, format=audio_format
            )
            task_id = getattr(audio_status, "task_id", None)
            await client.artifacts.wait_for_completion(
                nb.id, task_id, timeout=poll_timeout, interval=poll_interval
            )
            audio_out = output_dir / "audio_overview.mp3"
            await client.artifacts.download_audio(nb.id, str(audio_out))
            files["audio_overview"] = str(audio_out)

            # --- Video overview (optional) ---
            if not skip_video:
                try:
                    video_status = await client.artifacts.generate_video(
                        nb.id, style=video_style or None
                    )
                    vtask_id = getattr(video_status, "task_id", None)
                    await client.artifacts.wait_for_completion(
                        nb.id, vtask_id, timeout=poll_timeout, interval=poll_interval
                    )
                    video_out = output_dir / "video_overview.mp4"
                    await client.artifacts.download_video(nb.id, str(video_out))
                    files["video_overview"] = str(video_out)
                except Exception as exc:
                    # Video is best-effort; Google rate-limits it frequently.
                    transcript_lines.append(
                        f"Video overview skipped/failed: {exc}"
                    )

            # Best-effort transcript via chat for Position-3 captions.
            try:
                answer = await client.chat.ask(nb.id, "Provide a short transcript of the audio overview.")
                transcript = getattr(answer, "answer", None)
            except Exception:
                transcript = None

    except GoogleNativeError:
        raise
    except Exception as exc:
        raise GoogleNativeError(f"Google native engine failed: {exc}") from exc

    return EngineResult(
        engine="google_native",
        source_path=source_path,
        files=files,
        notebook_id=notebook_id,
        transcript=transcript,
        notes="\n".join(transcript_lines) if transcript_lines else "",
    )


def run(
    source_path: str,
    output_dir: str,
    *,
    title: str = "Peakora Audio Overview",
    instructions: str = "",
    language: str = "en",
    audio_format: str = "deep_dive",
    video_style: str = "explainer",
    storage_state: Optional[str] = None,
    poll_timeout: int = _DEFAULT_POLL_TIMEOUT,
    poll_interval: int = _DEFAULT_POLL_INTERVAL,
    skip_video: bool = False,
) -> EngineResult:
    """Run the Google native engine synchronously.

    Args:
        source_path: Position-1 source (local file path or URL/YouTube).
        output_dir: Directory to write the downloaded MP3/MP4 into.
        title: NotebookLM notebook title.
        instructions: Custom instructions for the audio overview.
        language: Output language (BCP-47-ish). Sets NOTEBOOKLM_HL.
        audio_format: One of deep_dive|brief|critique|debate.
        video_style: One of explainer|brief|cinematic|short (or "auto").
        storage_state: Path to storage_state.json or its raw JSON contents.
        poll_timeout / poll_interval: Generation polling bounds (seconds).
        skip_video: If True, only produce the audio overview.
    """
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    return asyncio.run(
        _run_async(
            source_path,
            output,
            title=title,
            instructions=instructions,
            language=language,
            audio_format=audio_format,
            video_style=video_style,
            storage_state=storage_state,
            poll_timeout=poll_timeout,
            poll_interval=poll_interval,
            skip_video=skip_video,
        )
    )
