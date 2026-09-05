# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""notebooklm_generator skill.

Unified NotebookLM-style long-form video/audio generation for the Peakora
content pipeline. Position 2: accepts a source document from Position 1,
produces rendered media (audio overview MP3 + video overview MP4), and writes
a manifest of output file paths ready for Position 3.

Two engines:
  - google_native : drives Google NotebookLM via the notebooklm-py library
    (real Google audio/video overviews using a stored Google session).
  - open_source   : generates a multi-speaker dialogue script with an LLM,
    renders it with multi-voice TTS, and assembles a video (fallback when
    there is no Google session).
"""
