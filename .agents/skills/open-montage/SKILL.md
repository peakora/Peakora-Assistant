---
name: open-montage
description: "open-montage - Agentic video production system"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# open-montage - Agentic video production system

## Status
**REFERENCE / INTEGRATION** - wraps the
[`calesthio/OpenMontage`](https://github.com/calesthio/OpenMontage) project (MIT,
50k stars, actively maintained). OpenMontage is a full agentic video production
system with 12 production pipelines. This skill documents how to integrate it
into the Peakora content pipeline and when to choose it over `notebooklm_generator`.

## When to use
Invoke when a task needs **agentic video production** - not just a podcast or a
single explainer, but a full multi-pipeline video production workflow driven by
AI agents. OpenMontage is video-first: every pipeline outputs a finished video.

Use OpenMontage (not `notebooklm_generator`) when the task is:
- "Turn this podcast/topic into a video" (the Podcast Repurpose pipeline)
- "Generate a video with AI narration and background music"
- "Produce a multi-segment video with TTS, music, and FFmpeg compositing"
- Any video production task that needs composition + narration + music in one pass

Use `notebooklm_generator` instead when:
- The task is specifically a NotebookLM-style audio overview (podcast MP3)
- You need the open_source engine (LLM script + edge-tts, no Google session)
- The output is a single explainer video, not a multi-pipeline production

## What OpenMontage is

OpenMontage is an agentic video production system. It orchestrates 12
production pipelines, each a different video format:

| Pipeline | What it produces |
|----------|-----------------|
| Podcast Repurpose | Converts an existing podcast (audio/video) into a video |
| TTS Narration | AI-narrated video from a script |
| Music Generation | AI-generated background music for video |
| (and 9 more) | See the OpenMontage repo for the full list |

### Tech stack
- **Language**: Python (69.6%) + TypeScript
- **Composition engines**: Remotion and/or HyperFrames (programmatic video)
- **Post-production**: FFmpeg
- **AI**: pluggable LLM + TTS + music generation
- **Install**: `make setup`

### How it differs from notebooklm_generator
- `notebooklm_generator` is **audio-first** (podcast MP3) with optional video
  (caption slides over a branded background). One source in, one media out.
- OpenMontage is **video-first** with multi-pipeline orchestration. An agent
  selects and chains pipelines. One or more sources in, a finished video out.

They are complementary, not overlapping:
- Position 2 (`notebooklm_generator`) produces the podcast/explainer.
- OpenMontage can repurpose that podcast into a video (Podcast Repurpose
  pipeline), or produce a video from scratch with narration + music.

## Pipeline contract (Peakora integration)
```
Position 1 (source)  ->  notebooklm_generator (Position 2)  ->  open-montage
   source_path              renders podcast MP3                  repurposes to video
                                                                      OR
Position 1 (source)  ->  open-montage (direct)  ->  Position 3 (distribute)
   script/text               agentic video             reads output video
```

When chained after `notebooklm_generator`: feed the `manifest.json`
`audio_overview` path to OpenMontage's Podcast Repurpose pipeline.

When used standalone: feed a script or topic directly to the TTS Narration or
other pipeline.

## Install
```bash
git clone https://github.com/calesthio/OpenMontage.git
cd OpenMontage
make setup
```

OpenMontage runs locally. Check its repo for current dependency requirements
(Python version, Node version, FFmpeg, and any model downloads).

## Usage (agent-driven)
OpenMontage is agentic - an LLM agent selects pipelines and chains them. The
typical flow:

1. The agent reads the source (script, topic, or existing podcast path).
2. The agent selects the appropriate pipeline (e.g. Podcast Repurpose if the
   input is a podcast MP3 from `notebooklm_generator`).
3. OpenMontage runs the pipeline: composition (Remotion/HyperFrames) + TTS
   narration + music generation + FFmpeg post-production.
4. Output: a finished MP4.

Refer to the OpenMontage repo for the exact CLI/API surface, as it evolves
rapidly. The key integration point for Peakora is the Podcast Repurpose
pipeline, which takes an audio file and produces a video.

## Credentials
OpenMontage uses pluggable AI providers (LLM, TTS, music). Check its repo for
the current set of supported providers and env vars. Likely candidates:
- An LLM API key (for agent orchestration and script generation)
- A TTS provider key (for narration) - or local TTS
- A music generation API key - or local generation

No Peakora-specific credentials are needed beyond what OpenMontage requires.

## Notes
- OpenMontage is video-first. If the task only needs audio (podcast MP3), use
  `notebooklm_generator` instead - it is lighter and runs on GitHub Actions
  ubuntu-latest without the Remotion/HyperFrames stack.
- OpenMontage's Remotion/HyperFrames composition may need a Node.js runtime and
  a display or headless browser for rendering. Verify this works in the target
  environment (local Docker, GitHub Actions, or a VPS) before relying on it.
- No emoji anywhere (repo convention). No long dashes.
- OpenMontage is an external project. Pin to a specific commit/tag for
  reproducibility - the API surface changes as it evolves.

## Pair with
- **Upstream**: `notebooklm_generator` (Position 2) produces the podcast that
  OpenMontage's Podcast Repurpose pipeline converts to video.
- **Downstream**: `video-stitcher` for further compositing,
  `youtube-uploader` for distribution.
- `script-writer` / `story-writer` (Position 1) produce the source script for
  direct-to-video pipelines (TTS Narration).
