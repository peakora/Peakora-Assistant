---
name: auto-diacritizer
description: "auto-diacritizer - Arabic Tashkeel skill"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# auto-diacritizer  -  Arabic Tashkeel skill

## Status
**CATALOGUED [CPU/FREE]  -  for the future Arabic channel (PeakoraEngine roadmap
Phase 2).** Runs pre-TTS. Reference implementation ready.

## When to use
Invoke before Arabic text-to-speech to inject vocalization diacritics (Tashkeel)
into raw undiacritized Arabic text, ensuring correct pronunciation. Recalled
automatically for Arabic NLP / Arabic TTS tasks.

## Capabilities
- Diacritize raw Arabic text using `camel-tools` (preferred) or `mishkal`
  (fallback)  -  both CPU/free/FOSS.
- Graceful fallback: if neither is installed, return the text unchanged with a
  warning (TTS will still run, just less accurate vocalization).

## Reference implementation
```python
def diacritize_camel(text):
    from camel_tools.diacritizer import CharDiacritizer
    return CharDiacritizer().diacritize_text(text)

def diacritize_mishkal(text):
    import subprocess
    # mishkal CLI: echo "text" | python -m mishkal
    out = subprocess.run(["python", "-m", "mishkal", "--cli", "--text", text],
                         capture_output=True, text=True)
    return out.stdout.strip() or text

def diacritize(text):
    try:
        return diacritize_camel(text)
    except Exception:
        try:
            return diacritize_mishkal(text)
        except Exception as e:
            print(f"⚠️ diacritizer unavailable ({e}); passing raw text to TTS")
            return text
```

## Env / install
- `pip install camel-tools` (note: pulls a large model data download on first
  use). Or run `mishkal` from source. Both CPU-only.

## Pair with
- `arabic-tts`  -  feed the diacritized text into MSA voiceover generation.
