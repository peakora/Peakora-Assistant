# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Shared engine contract.

Both engines return an EngineResult describing the media they produced and the
absolute file paths Position 3 of the pipeline will consume.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Dict, Optional

__all__ = ["EngineResult", "EngineSpec", "run_engine", "ENGINES"]


@dataclass
class EngineResult:
    """Output of one engine run.

    `files` maps a logical artifact name to its absolute path. Position 3 of
    the pipeline reads this to find the media it needs.
    """

    engine: str
    source_path: str
    files: Dict[str, str] = field(default_factory=dict)
    notebook_id: Optional[str] = None
    duration_seconds: Optional[float] = None
    transcript: Optional[str] = None
    notes: str = ""

    def to_manifest(self) -> dict:
        d = asdict(self)
        d["files"] = {k: str(v) for k, v in self.files.items()}
        return d


EngineSpec = Callable[..., "EngineResult"]


def run_engine(name: str, **kwargs) -> EngineResult:
    """Dispatch to a registered engine by name."""
    from . import google_native, open_source  # local import to avoid hard deps

    engines: Dict[str, EngineSpec] = {
        "google_native": google_native.run,
        "open_source": open_source.run,
    }
    if name not in engines:
        raise ValueError(
            f"Unknown engine {name!r}. Choose one of: {sorted(engines)}"
        )
    return engines[name](**kwargs)


ENGINES = ("google_native", "open_source")
