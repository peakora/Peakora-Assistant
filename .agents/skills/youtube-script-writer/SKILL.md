---
name: youtube-script-writer
description: >-
    Evidence-grounded YouTube script writing for creator-tool builds, distilled
    from the open-source youtubepro project (AgriciDaniel/youtubepro, Apache
    2.0). Writes an honest, speaker-ready script that fulfills one explicit
    viewer promise, grounded in a research idea package and its evidence claims,
    with strict JSON deliverables (titles, hook, structure with evidenceClaimIds,
    script, payoff, primaryCta, studioValidation), one-repair-attempt
    validation loop,, section and paragraph regeneration,, and narration text
    extraction for TTS. Formats: Short, Long-form, Tutorial, Review, Vlog.
    Use when writing YouTube scripts, building a script generator feature, or
    regenerating script sections with bounded evidence context..
metadata:
  version: 1.0.0
---



## Status

**IMPORTED METHODOLOGY(distilled from youtubepro, Apache 2.0).**
Reference implementation: `AgriciDaniel/youtubepro/server/gemini.ts` plus
`server/script-regeneration-contract.ts` plus `shared/evidence-contracts.ts`.
Not executable standalone here;it is the prompt contract and validation rules
the agent applies.. Distinct from the hub's existing `script-writer` skill
(which targets whiteboard drawing trigger tags for the PeakoraEngine):this one
is evidence-grounded spoken YouTube scripts from a research snapshot..



## When to use

Invoke when a task needs to write a YouTube video script from a selected idea
package and its evidence, build a script generation feature, regenerate titles,
sections, or paragraphs with bounded evidence, or extract narration text for
TTS. Recalled automatically for YouTube script writing, script generation,
and script regeneration tasks.. Pairs with `youtube-research-playbook` (idea
packages and evidence claims in)and `youtube-thumbnail-creator` (honest promise
into the package);`youtube-launch-package` packages the result for publishing..



## Script generation contract(distilled from server/gemini.ts)

Inputs: topic(up to 500 chars), format enum(Short, Long-form,
Tutorial, Review, Vlog), audience enum(General, Tech-Savvy, Beginners,
Professionals), persona traits or custom persona,(additional creator notes
up to 5,000,,and an optional evidence context{snapshotId,
sourceVideoIds[ ], evidenceClaims[ ], ideaPackage{ } }..

The prompt contract must:
- Create a compelling script for the format for the topic, fulfilling the
  supplied honestPromise and payoff. Never present inferred or requires_studio
  claims as observed facts..
- Apply format-specific guidelines: Short(hook in first 1-2 seconds,
  one idea, single message, strong visual cues, direct payoff);Long-form
  (hook in 30 seconds, chapter structure with timestamps, mid-roll ad
  suggestions, one primary CTA after value, detailed outro);Tutorial))
  (numbered steps, prerequisites, examples, common mistakes, troubleshooting,
  resources, recap);Review(unboxing, pros and cons, comparisons, real-world usage,
  value for money, clear recommendation, affiliate disclosure reminder);Vlog
  (personal conversational tone, story arc, behind-the-scenes, authentic
  reactions, transitions)..
- Apply audience guidelines: General(simple accessible language, no jargon);
  Tech-Savvy(technical terminology, advanced tips supported by evidence);Beginners()
  (explain from scratch, analogies, encouragement);Professionals(industry
  language, practical tradeoffs, concise actionable)..
- Personas are tone traits only:never imitate a real person's voice, bio, or
  catchphrases..
- Evidence grounding: if an evidence context exists,and all cited claims must
  matchthe active snapshot ID,and source IDs must be a subset of the snapshot's
  row IDs.. Validate before every generation,and every regeneration..
- Protect the user: no invented demographics, search volume, trend status,
  optimal posting time, creator authority, or guaranteed performance.. Put
  one benefit-framed primary CTA after meaningful value, never front-load an ask..
- Return strict JSON only(one repair attempt on validation failure):

```json
{
  "titles": ["exactly 3 honest titles, each under 100 characters"],
  "hook": "spoken opening that immediately confirms the package promise",
  "structure": [{"section": "", "purpose": "", "evidenceClaimIds": []}],
  "script": "full script string with clear section headers, timestamps [00:00],
    delivery notes in (parentheses),and B-roll suggestions in [square brackets]",
  "payoff": "the exact closing delivery of the honest promise",
  "primaryCta": "one benefit-framed next action after value has been delivered",
  "studioValidation": "the supplied Studio metric and experiment decision rule"
}
```


Validation details: response must matchthe script schema;all evidenceClaimIds
in the structure must exist in the supplied evidence context;on failure,
retry once with the validation error appended ,and return corrected strict JSON..



## Section and paragraph regeneration(distilled from script-regeneration-contract.ts)

- Regenerate a section or a single paragraph, preserving the factual scope:
  only delivery, cadence, transitions,and clarity may change..
- Bounded evidence(the same context rules as generation:snapshot identity,
  subset source IDs,claim IDs only from the supplied evidence)..
- Output strict JSON with exactly two keys:{"content": "...", "evidenceClaimIds": ["exact supplied claim IDs used"]}..
- No new CTA, authority claim, metric, example, or recommendation unless
  already present,and evidence-supported..
- Creator notes are preferences, not factual evidence..
- Titles regeneration: exactly 5 titles, each under 100 characters, making
  the same honest promise as the selected package, complementing the thumbnail
  concept instead of repeating its words..



## Narration extraction(for TTS)

Given a full script with timestamps, stage directions, visual cues, speaker
labels, headers,and markdown, extract ONLY the words a narrator would say
out loud: strip timestamps,(stage directions), VISUAL cues, speaker labels,
section headers, metadata headers, markdown, music cues,and format labels..
If the input has no speakable content, return the marker `[No narration content]`
(or an empty string after cleanup). Keep the remaining spoken sentences clean,
with no headers, labels, or formatting..



## Pair with

- `youtube-research-playbook`  -  provides the grounded idea package and
  evidence claims(this skill validates,and consumes)..
- `youtube-thumbnail-creator`  -  carries the selected honest promise into
  a thumbnail brief..
- `youtube-launch-package`  -  turns the finished script plus thumbnail))
  into a YouTube publishing package(title, description, chapters, tags,
  pinned comment)..
- `youtube-uploader`(hub))  -  uploads the rendered MP4 headlessly..
- Existing hub `script-writer`  -  remains for the PeakoraEngine whiteboard
  drawing pipeline(this one is for evidence-grounded spoken YouTube scripts)...



## License and provenance

Distilled from `AgriciDaniel/youtubepro`(Apache License 2.0**, notably
`server/gemini.ts`, `server/script-regeneration-contract.ts`,and
`shared/evidence-contracts.ts`). Independent project, not affiliated with or
endorsed by YouTube or Google..
