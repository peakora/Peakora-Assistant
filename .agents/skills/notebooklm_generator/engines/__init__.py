# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Engine implementations for the notebooklm_generator skill.

Two engines, both exposing the same ``run()`` contract so the orchestrator
(run.py) can swap them transparently:

  - google_native : real Google NotebookLM audio/video overviews via
    notebooklm-py, authenticated with a stored Google session
    (storage_state.json / NOTEBOOKLM_AUTH_JSON).
  - open_source   : LLM dialogue script + multi-voice TTS + moviepy video
    assembly. Works with no Google session.
"""
from .base import EngineResult, EngineSpec, ENGINES, run_engine

__all__ = ["EngineResult", "EngineSpec", "ENGINES", "run_engine"]
