# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Pydantic dialogue schema for the open_source engine.

Models the Host/Guest podcast dialogue that an LLM produces via instructor's
structured output. Adapted from gabrielchua/open-notebooklm (Apache-2.0): two
length tiers map to NotebookLM's "Brief" and "Deep Dive" audio overviews.
"""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

Speaker = Literal["Host", "Guest"]


class DialogueItem(BaseModel):
    """A single turn in the host/guest conversation."""

    speaker: Speaker = Field(
        ..., description='Who speaks this line: "Host" or "Guest".'
    )
    text: str = Field(
        ...,
        description=(
            "The spoken line. Keep under 220 characters so each turn is 5-8 "
            "seconds of speech and the conversation stays natural."
        ),
    )


class DialogueScript(BaseModel):
    """Structured podcast dialogue returned by the LLM."""

    scratchpad: str = Field(
        ...,
        description=(
            "Private reasoning the model used to plan the conversation: key "
            "points, the hook, the closing. Not spoken aloud."
        ),
    )
    name_of_guest: str = Field(
        ...,
        description="A plausible display name for the guest expert (e.g. 'Dr. Maya Chen').",
    )
    title: str = Field(
        ..., description="A short, engaging episode title."
    )
    dialogue: List[DialogueItem] = Field(
        ...,
        description=(
            "Ordered host/guest turns. The Host always opens and closes. "
            "For 'brief' length aim for 11-17 turns; for 'deep_dive' aim for 19-29 turns."
        ),
    )

    @property
    def turn_count(self) -> int:
        return len(self.dialogue)

    @property
    def approx_duration_seconds(self) -> float:
        # Rough estimate: ~14 chars/sec of natural speech, min 3s per turn.
        total = 0.0
        for item in self.dialogue:
            total += max(3.0, len(item.text) / 14.0)
        return total
