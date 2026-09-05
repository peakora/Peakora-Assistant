# Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
"""Source text extraction for the open_source engine.

Reads the Position-1 source document at `source_path` and returns clean plain
text the LLM can turn into a dialogue. Supports PDF, DOCX, HTML, Markdown, and
plain text. URLs and YouTube links are deferred to the google_native engine
(which ingests them natively); for the open_source engine a URL is fetched
with a plain HTTP GET and parsed as HTML.

This is deliberately dependency-light: each loader imports its parser lazily so
a missing optional dependency gives a clear, actionable error instead of a
crash on import.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

__all__ = ["extract_text", "UnsupportedSourceError", "truncate_for_llm"]

_MAX_INPUT_CHARS = 100_000  # keep the LLM context sane on the free tier


class UnsupportedSourceError(ValueError):
    """Raised when the source_path has no usable text extractor."""


def _read_file(path: Path) -> bytes:
    if not path.exists():
        raise FileNotFoundError(f"Source not found: {path}")
    if not path.is_file():
        raise UnsupportedSourceError(f"Source is not a regular file: {path}")
    return path.read_bytes()


def _from_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - install hint
        raise UnsupportedSourceError(
            "pypdf is required to read PDF sources. Install it: pip install pypdf"
        ) from exc
    reader = PdfReader(str(path))
    parts = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            parts.append(text)
    return "\n\n".join(parts).strip()


def _from_docx(path: Path) -> str:
    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover
        raise UnsupportedSourceError(
            "python-docx is required to read .docx sources. Install it: pip install python-docx"
        ) from exc
    doc = Document(str(path))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip()).strip()


def _from_html_bytes(raw: bytes) -> str:
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:  # pragma: no cover
        raise UnsupportedSourceError(
            "beautifulsoup4 is required to read HTML sources. Install it: pip install beautifulsoup4"
        ) from exc
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _from_markdown(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace").strip()


def _from_url(url: str) -> str:
    import urllib.request

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsupportedSourceError(f"Unsupported URL scheme: {parsed.scheme}")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; PeakoraNotebookLMGenerator/1.0; "
                "+https://peakora.life)"
            )
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - audited URL
        raw = resp.read()
    return _from_html_bytes(raw)


def extract_text(source_path: str) -> str:
    """Extract clean plain text from a Position-1 source.

    Args:
        source_path: Path to a local file (PDF/DOCX/HTML/MD/TXT) or an
            http(s) URL.

    Returns:
        The extracted text, stripped of boilerplate. Empty string if the
        source had no extractable text.

    Raises:
        FileNotFoundError, UnsupportedSourceError.
    """
    if source_path.startswith(("http://", "https://")):
        return _from_url(source_path)

    path = Path(source_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        text = _from_pdf(path)
    elif suffix in (".docx",):
        text = _from_docx(path)
    elif suffix in (".html", ".htm"):
        text = _from_html_bytes(_read_file(path))
    elif suffix in (".md", ".markdown"):
        text = _from_markdown(path)
    elif suffix in (".txt", ""):
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    else:
        # Last resort: try to decode as text.
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip()
        except Exception as exc:
            raise UnsupportedSourceError(
                f"No extractor for source type {suffix!r}: {path}"
            ) from exc

    if not text:
        raise UnsupportedSourceError(f"Source produced no text: {source_path}")
    return text


def truncate_for_llm(text: str, max_chars: int = _MAX_INPUT_CHARS) -> str:
    """Truncate extracted text to stay within LLM context limits."""
    if len(text) <= max_chars:
        return text
    head = text[: max_chars - 200]
    return head + "\n\n[... source truncated to fit context ...]"
