# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""LLM dialogue script generation for the open_source engine.

Uses instructor for structured Pydantic output. Two providers are supported,
chosen by which API key is present:

  - Gemini (google-genai)  -> default, free tier. Key: GEMINI_API_KEY.
  - OpenAI                 -> fallback / premium.  Key: OPENAI_API_KEY.

The system prompt is adapted from gabrielchua/open-notebooklm (Apache-2.0),
generalized so the host is "Host" and the guest is "Guest" (the schema carries
a display name). Length tiers map to NotebookLM "brief" and "deep_dive".
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

# Support both package import and direct script import.
_SKILL_ROOT = Path(__file__).resolve().parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))

from schema import DialogueScript  # noqa: E402

__all__ = ["generate_script", "ScriptGenerationError"]

# Length guidance injected into the prompt. Turn ranges mirror the
# gabrielchua/open-notebooklm ShortDialogue/MediumDialogue field docs.
_LENGTH_GUIDANCE = {
    "brief": (
        "Keep the conversation concise: aim for 11 to 17 dialogue turns. This "
        "matches NotebookLM's 'Brief' audio overview format."
    ),
    "deep_dive": (
        "Go deep: aim for 19 to 29 dialogue turns. This matches NotebookLM's "
        "'Deep Dive' audio overview format, with room for examples and nuance."
    ),
}


class ScriptGenerationError(RuntimeError):
    """Raised when no LLM provider is configured or the call fails."""


def _system_prompt(topic: str, length: str, language: str, instructions: str) -> str:
    guide = _LENGTH_GUIDANCE.get(length, _LENGTH_GUIDANCE["deep_dive"])
    lang_line = (
        f"Write ALL spoken dialogue in this language: {language}."
        if language and language.lower() != "en"
        else "Write all spoken dialogue in English."
    )
    extra = f"\n\nAdditional direction from the producer:\n{instructions.strip()}\n" if instructions.strip() else ""
    return f"""You are a world-class podcast producer and writer. You turn a source
document into an engaging, natural two-speaker podcast dialogue between a Host
and a Guest expert. The conversation must be informative and entertaining, PG
rated, with no marketing or self-promotion from the guest.

Topic / focus: {topic}
{lang_line}
{guide}{extra}

Follow these rules for the dialogue:
- The Host always opens with a strong hook and closes the episode.
- Ask thoughtful questions that guide the discussion.
- Explain complex topics clearly for a general audience.
- Include natural speech patterns: occasional verbal fillers ("um", "well"),
  brief interruptions, and back-and-forth between Host and Guest.
- Ground the guest's claims in the source text. Do not invent unsupported facts.
- Weave a casual summary of key takeaways into the closing, not a formal recap.
- Each line of dialogue should stay under 220 characters (about 5-8 seconds).
- Pick a plausible guest display name (e.g. "Dr. Maya Chen") that fits the topic.

Use the scratchpad to plan: the hook, the 3-5 key points to cover, a creative
bridge or two, and the closing question or call-to-action. The scratchpad is
never spoken aloud."""


def _provider() -> str:
    """Decide which LLM provider to use based on available keys."""
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    raise ScriptGenerationError(
        "No LLM provider configured. Set GEMINI_API_KEY (preferred, free tier) "
        "or OPENAI_API_KEY to generate dialogue scripts with the open_source engine."
    )


def _generate_with_gemini(
    system_prompt: str, source_text: str, model: Optional[str]
) -> DialogueScript:
    import instructor
    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    model_name = model or "gemini-2.5-flash"
    # instructor.from_gemini returns a client whose .chat.completions.create
    # supports response_model structured output.
    structured = instructor.from_gemini(client)
    return structured.messages.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": source_text},
        ],
        response_model=DialogueScript,
    )


def _generate_with_openai(
    system_prompt: str, source_text: str, model: Optional[str]
) -> DialogueScript:
    import instructor
    from openai import OpenAI

    client = instructor.from_openai(OpenAI(api_key=os.environ["OPENAI_API_KEY"]))
    model_name = model or "gpt-4o-mini"
    return client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": source_text},
        ],
        response_model=DialogueScript,
    )


def generate_script(
    source_text: str,
    *,
    topic: str = "the provided source material",
    length: str = "deep_dive",
    language: str = "en",
    instructions: str = "",
    model: Optional[str] = None,
) -> DialogueScript:
    """Generate a structured Host/Guest podcast dialogue from source text.

    Args:
        source_text: Clean text extracted from the Position-1 source.
        topic: One-line focus passed to the LLM (e.g. the document title).
        length: "brief" or "deep_dive".
        language: BCP-47-ish language code for the spoken dialogue.
        instructions: Free-form producer notes (customization instructions).
        model: Override the default model id for the chosen provider.

    Returns:
        A validated DialogueScript.

    Raises:
        ScriptGenerationError on missing config or call failure.
    """
    if not source_text.strip():
        raise ScriptGenerationError("Cannot generate a script from empty source text.")

    provider = _provider()
    system_prompt = _system_prompt(topic, length, language, instructions)

    try:
        if provider == "gemini":
            return _generate_with_gemini(system_prompt, source_text, model)
        return _generate_with_openai(system_prompt, source_text, model)
    except ScriptGenerationError:
        raise
    except Exception as exc:
        raise ScriptGenerationError(
            f"LLM script generation failed via {provider}: {exc}"
        ) from exc
