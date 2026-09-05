---
name: llm-console
description: "llm-console - Gemini orchestration helper"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# llm-console  -  Gemini orchestration helper

## When to use
Use when the app needs Google AI Studio (Gemini 2.0 Flash) integration: prompt
isolation, dynamic context limits, structured JSON output, and graceful
degradation under rate limits.

## Env
- `GEMINI_API_KEY` (or alias `GEMINI_KEY`)
- `GEMINI_MODEL`  -  default `gemini-2.0-flash`

## Guidelines
1. **Prompt isolation**  -  keep system instructions, user content, and tools in
   distinct message roles. Never concatenate untrusted content into the system
   prompt.
2. **Dynamic context limits**  -  cap input tokens well under the model limit;
   chunk long inputs and retrieve context selectively.
3. **Structured output**  -  request `response_mime_type=application/json` with a
   `response_schema` (JSON schema) to prevent parsing errors downstream.
4. **Retry with backoff**  -  on 429/503, retry with exponential backoff
   (base 1s, factor 2, cap 30s) and a bounded number of attempts.
5. **Fallback**  -  on persistent failure, degrade gracefully (cached/stub
   response) rather than hard-crashing the request path.
6. **No secrets in prompts**  -  never embed `GEMINI_API_KEY` or user PII into
   prompt text. Keep the key in the Authorization header only.

## Minimal Python snippet
```python
import os, time, json, google.generativeai as genai

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel(os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"))

def call(prompt, schema=None, attempts=4):
    kwargs = {"response_mime_type": "application/json"}
    if schema:
        kwargs["response_schema"] = schema
    for i in range(attempts):
        try:
            r = model.generate_content(prompt, generation_config=genai.GenerationConfig(**kwargs))
            return json.loads(r.text)
        except Exception as e:
            if i == attempts - 1:
                raise
            time.sleep(min(30, 2 ** i))
```
