---
name: notebooklm_generator
description: "notebooklm_generator - NotebookLM-style long-form video/audio generation"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# notebooklm_generator  -  NotebookLM-style long-form video/audio generation

## Status
**REAL / WORKING**  -  Position 2 of the Peakora content pipeline. Two
pluggable engines: a Google-native path (real NotebookLM audio/video overviews
via `notebooklm-py`) and a fully open-source fallback (LLM script + multi-voice
TTS + moviepy video). CPU/free-first; runs on GitHub Actions ubuntu-latest.

## When to use
Invoke when a task needs to turn a source document (PDF, DOCX, HTML, Markdown,
text, or a URL/YouTube link) into a long-form **audio overview** (podcast MP3)
and/or **video overview** (MP4) in the NotebookLM style. Recalled automatically
for long-form content generation, podcast generation, and "turn this into a
video explainer" tasks.

This is Position 2 of the pipeline: it consumes the source produced at
Position 1 and writes a `manifest.json` of output file paths that Position 3
(distribution/upload) consumes.

## Pipeline contract
```
Position 1 (source)  ->  notebooklm_generator (Position 2)  ->  Position 3 (distribute)
   source_path              renders audio + video                  reads manifest.json
```
- **Input**: `--source-path` (local file or URL) + `--output-dir`.
- **Output**: `<output_dir>/manifest.json` plus the rendered media. The
  manifest `files` map always contains `audio_overview` and (unless
  `--skip-video`) `video_overview`, each pointing at an absolute path. The
  open_source engine also emits `subtitles` (SRT), `dialogue_script` (JSON),
  and `source_text` (TXT).

## Engines

### `google_native` (real Google NotebookLM)
Drives Google's native Audio Overview and Video Overview through the
[`notebooklm-py`](https://github.com/teng-lin/notebooklm-py) library (MIT, v0.8.1,
actively maintained, 19k stars). Produces genuine Google-quality podcasts and
explainer videos. Uses reverse-engineered RPC over httpx (NOT browser automation
for operations - Playwright is only for the initial login).

Flow (mirrors the notebooklm-py README):
1. `NotebookLMClient.from_storage(state_path)`  -  authenticated session.
2. `notebooks.create(title)`  ->  new notebook.
3. `sources.add_file` / `sources.add_url` (YouTube + Drive supported).
4. `artifacts.generate_audio(instructions=, format=)`  ->  audio overview.
5. `artifacts.wait_for_completion(...)`  ->  bounded poll (Google takes 2-45 min).
6. `artifacts.download_audio(out.mp3)`.
7. (optional) `artifacts.generate_video(style=)` + `download_video(out.mp4)`.

Audio formats: `deep_dive | brief | critique | debate`.
Video styles: `explainer | brief | cinematic | short | auto`.

Auth (3 methods, in order of preference for headless/CI):
1. **Master-token (fully headless, no browser)**: `notebooklm login
   --master-token --account you@gmail.com` with the `[headless]` extra
   (`gpsoauth`). Mints fresh cookies on demand, self-heals expired sessions.
   Use a DEDICATED Google account (the master token is a full-account
   credential). Best for GitHub Actions / CI.
2. **Browser cookie import (no Playwright download)**: `notebooklm login
   --browser-cookies chrome` with the `[cookies]` extra (rookiepy, Python
   <=3.12 only). Extracts cookies from an already-signed-in local browser.
3. **Interactive Playwright login (default)**: `notebooklm login` with the
   `[browser]` extra. Opens Chromium, user signs into Google, cookies saved to
   `~/.notebooklm/profiles/default/storage_state.json`.

Cookie recovery: 7-layer ladder (per-call rotation poke -> periodic keepalive ->
Playwright re-auth -> master-token re-mint -> external refresh script -> manual
re-login -> external scheduler). The google_native engine treats cookie expiry
as recoverable; if all layers fail, re-run `notebooklm login`.

The library also exposes an **MCP server** (`notebooklm mcp` with `[mcp]` extra,
for Claude Desktop/Code) and an experimental **REST server** (`[server]` extra,
FastAPI). These are not used by the Position-2 pipeline but are available for
agent-driven automation.

### `open_source` (no Google session required)
A self-hosted NotebookLM alternative, inspired by
[`gabrielchua/open-notebooklm`](https://github.com/gabrielchua/open-notebooklm)
(Apache-2.0) and [`lfnovo/open-notebook`](https://github.com/lfnovo/open-notebook).
Adapted for the Peakora pipeline and made dependency-light.

Source project status (Aug 2026):
- `lfnovo/open-notebook` (37k stars): actively maintained, last commit Aug 2026.
  Self-hosted Docker app: FastAPI REST API on port 5055, Next.js UI on 8502,
  SurrealDB backend. 20+ AI providers via the Esperanto abstraction. Full CRUD
  API for notebooks, sources, notes, chat, search, transformations, podcasts.
  Async pattern: POST returns a command_id, poll `GET /commands/{id}` for status.
  Auth: `OPEN_NOTEBOOK_PASSWORD` as Bearer token (optional), Fernet encryption
  for stored credentials. If you self-host this server, the open_source engine
  can route through its REST API instead of the built-in pipeline (set
  `OPEN_NOTEBOOK_API_URL` + `OPEN_NOTEBOOK_PASSWORD`).
- `gabrielchua/open-notebooklm` (2.6k stars): effectively unmaintained (last
  commit Dec 2024). Gradio web app only, no CLI, hardcoded to Fireworks AI +
  Llama 3.3 70B + MeloTTS. We use its dialogue-scripting approach (two-pass
  LLM with structured Pydantic output) but NOT its runtime - our engine uses
  Gemini free tier + edge-tts/ElevenLabs + moviepy instead.

Flow:
1. **Extract** source text (`text_extraction.py`): PDF (pypdf), DOCX
   (python-docx), HTML (BeautifulSoup), Markdown, TXT, or a fetched URL.
2. **Script** a Host/Guest dialogue (`script_gen.py`): structured Pydantic
   output via `instructor`. Gemini free tier by default (`google-genai`),
   OpenAI as fallback. Length tiers `brief` (11-17 turns) / `deep_dive`
   (19-29 turns) map to NotebookLM's Brief and Deep Dive.
3. **Render** each turn to MP3 (`tts.py`): ElevenLabs multi-voice if a key is
   present, else edge-tts (free, no key, 8 languages with distinct host/guest
   voices).
4. **Concatenate** per-turn audio into one podcast MP3 (`media.concat_audio`).
5. **Assemble** a long-form MP4 (`media.render_video`): branded dark-luxury
   background, episode title card, and per-turn caption slides synced to the
   audio. Emits an SRT subtitle file for Position-3 captions.

## Credentials (required, by engine)

| Credential | Engine | Purpose | How to set |
|------------|--------|---------|------------|
| `storage_state.json` | google_native | Google session cookies for notebooklm-py | `--storage-state <path>` OR the raw JSON via `NOTEBOOKLM_AUTH_JSON` env var OR `NOTEBOOKLM_STORAGE_STATE` path env var. Create locally with `notebooklm login`, then copy `~/.notebooklm/profiles/default/storage_state.json`. |
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | open_source (optional) | Encryption key if you self-host the lfnovo/open-notebook server and route through its API instead of the built-in pipeline. Not required for the default built-in open_source flow. | Env var. Generate with `python -c "import secrets;print(secrets.token_urlsafe(32))"`. |
| `GEMINI_API_KEY` | open_source (LLM) | Default LLM for dialogue script generation (free tier). Preferred. | Env var. Google AI Studio key. LiteLLM `gemini/` prefix not needed here (uses `google-genai` directly). |
| `OPENAI_API_KEY` | open_source (LLM, fallback) | Used only if `GEMINI_API_KEY` is absent. | Env var. |
| `ELEVENLABS_API_KEY` | open_source (TTS, premium) | Multi-voice TTS. If absent, the engine auto-falls back to free edge-tts. | Env var. |
| `EDGE_HOST_VOICE` / `EDGE_GUEST_VOICE` | open_source (TTS, tuning) | Override the default edge-tts host/guest voice ids. | Env var (optional). |
| `ELEVEN_HOST_VOICE` / `ELEVEN_GUEST_VOICE` | open_source (TTS, tuning) | Override ElevenLabs voice names/ids. | Env var (optional). |
| `NOTEBOOKLM_HL` | google_native | Output language for Google artifacts (set automatically from `--language`). | Env var (auto). |

**Minimum viable configs:**
- google_native: `storage_state.json` (or `NOTEBOOKLM_AUTH_JSON`) only.
- open_source: `GEMINI_API_KEY` only (edge-tts needs no key, video uses
  free moviepy+ffmpeg). Add `ELEVENLABS_API_KEY` for premium voices.

## Env / install
```bash
pip install -r skills/notebooklm_generator/requirements.txt
# ffmpeg must be on PATH (moviepy backend):
#   sudo apt-get install -y ffmpeg        # Linux / GitHub Actions
# google_native only:
pip install notebooklm-py && notebooklm install-browser   # Playwright Chromium
```

## Usage
```bash
# Open-source engine (no Google session)  -  default
python skills/notebooklm_generator/run.py \
  --source-path ./research.pdf \
  --output-dir ./out \
  --engine open_source --length deep_dive --language en

# Google native engine (real NotebookLM overviews)
python skills/notebooklm_generator/run.py \
  --source-path ./research.pdf \
  --output-dir ./out \
  --engine google_native \
  --storage-state ./storage_state.json \
  --audio-format deep_dive --video-style explainer

# Audio-only (skip the video)
python skills/notebooklm_generator/run.py \
  --source-path https://example.com/article \
  --output-dir ./out --engine open_source --skip-video
```

Output manifest (`./out/manifest.json`):
```json
{
  "engine": "open_source",
  "source_path": "./research.pdf",
  "files": {
    "audio_overview": "/abs/out/audio_overview.mp3",
    "video_overview": "/abs/out/video_overview.mp4",
    "subtitles": "/abs/out/audio_overview.srt",
    "dialogue_script": "/abs/out/dialogue_script.json",
    "source_text": "/abs/out/source_text.txt"
  },
  "duration_seconds": 312.5,
  "transcript": "Host: ... Guest: ..."
}
```

## Programmatic use
```python
from skills.notebooklm_generator.engines import run_engine

result = run_engine(
    "open_source",
    source_path="./research.pdf",
    output_dir="./out",
    length="deep_dive",
    language="en",
)
print(result.files["video_overview"])
```

## Notes
- moviepy 2.x API: `from moviepy import ...`, `.with_duration()`,
  `.with_position()`, `concatenate_videoclips(method="compose")`.
- Google rate-limits audio/video/quiz/flashcard generation; the google_native
  engine treats video failure as best-effort and still returns the audio.
- The open_source video is intentionally image-light (CPU/free): a branded
  background + caption slides, like NotebookLM's minimal explainer. Pair with
  `headless-blender` or `procedural-drawing` for richer visuals if needed.
- No emoji anywhere (repo convention). No long dashes.

## Pair with
- **Position 1** (upstream): `script-writer` / `story-writer` produce the
  source document this skill consumes.
- **Position 3** (downstream): `video-stitcher` for further compositing,
  `youtube-uploader` for distribution  -  both read `manifest.json`.
- `arabic-tts` / `auto-diacritizer` for Arabic-language open_source runs.
