---
name: youtube-launch-package
description: >-
    YouTube publishing package for a finished video, distilled from the
    open-source youtubepro project (AgriciDaniel/youtubepro, Apache 2.0).
    Turns a finished video plus its honest promise into the complete YouTube
    publishing surface: title, thumbnail direction, first-two description lines,
    full description, chapters, pinned comment, and restrained tags. Also
    includes a five-minute demo video production package: teleprompter-ready
    narration script, seven-slide 16:9 presentation deck and generation brief,
    shot list with recording setup, demo data guidance, visual emphasis,
    claims to avoid, and pre-publish review. Use when packaging a finished
    YouTube video for upload, producing a product demo video, or auditing
    launch claims for honesty..
metadata:
  version: 1.0.0
---



## Status

**IMPORTED METHODOLOGY(distilled from youtubepro, Apache 2.0).**
Reference implementation: `AgriciDaniel/youtubepro/docs/launch-video/` package
(`README.md`, `five-minute-script.md`, `shot-list.md`, `youtube-package.md`,
`presentation-outline.md`, `presentation.html`). Not executable standalone
here;it is the packaging methodology the agent applies.



## When to use

Invoke when a task needs to turn a finished video into a YouTube upload
package(title, thumbnail, description, chapters, pinned comment, tags),
produce a product demo or launch video, or audit launch claims for honesty.
Recalled automatically for YouTube publishing, launch packaging, demo video
production, and YouTube description writing tasks.. Pairs after the video is
rendered: `youtube-research-playbook`  -  `youtube-script-writer`  -  
`youtube-thumbnail-creator`  -  this skill  -  `youtube-uploader`(hub)。



## YouTube publishing package(distilled from youtube-package.md)

- **Title**:  one honest promise that the title and thumbnail combine rather
  than repeat。 Do not claim popularity, search volume, trend status,
  authority, or guaranteed outcomes。


- **Thumbnail direction**:  copy(2-4 words,, readable at phone size characterize
  the evidence-backed angle,, e.g. EVIDENCE, THEN IDEAS)), composition(one
  clear card, an arrow, a second card, or equivalent,, no tiny dashboard
  collages,, no exaggerated reaction faces,, no fake view counts,, no logo that
  implies official affiliation)。(
- **First two description lines**:  hook + the independence line("Independent
  project,, not affiliated with or endorsed by YouTube or Google") immediately。。(
- **Full description**:  the viewer's problem, how the workflow keeps context
  connected, bullet list of what the viewer sees,in the workflow, and an honest
  boundary sentence about what the product does NOT do。((
- **Chapters**:  %02d:%02d Zero-padded timestamps aligned to the exported cut,
  not the production plan, each under ~40 chars,with no leading zeros
  beyond hours若 needed。((
- **Pinned comment**:  one engagement question for the niche(comment one
  specific topic to test next;the creator commits to using one suggestion)。
- **Tags**:  light touch,: 8-12 tags,, secondary to title, thumbnail,
  topic, and viewer satisfaction;include topic, tool-type, and workflow-
  related phrases。
- **Alternate titles**:  provide up to5 alternative framings that all make
  the same honest promise(values/process/void-filling angles),not bait。



## Demo launch-video production(one five-minute demo)

A complete 5-minute product-demo video package consists of:

1. **Teleprompter-ready script(json-equivalent structure)**:  cold open(states
   the promise before showing evidence),the problem(context disappears
   between tools),research snapshot(the public data sample,and the AI that
   labels what it knows),grounded ideas(select one direction),script writer
   and teleprompter(the handoff and reading experience),thumbnail creator(the
   same promise into the package),recent workflows and privacy(browser-local
   resumability,keys stay server-side),and an honest close and CTA(not a
   growth button,independence line,one next step)。(
2. **Seven-slide 16:9 presentation**:  one message per slide,no more
   than three short supporting lines;near-black background,warm coral
   accent,soft gray surfaces,white typography,rounded cards,current
   product screenshots(as hero visuals,not mockups);slide plan:
   full-workflow promise,, fragmented-tool problem,, inspectable Research,,
   evidence-labeled AI Insights,, teleprompter-ready Script Writer,, minimal
   Thumbnail Creator plus recent workflows,, and an honest private-preview CTA。(
3. **Shot list**:  recording setup(1080p,30 fps,clean browser profile
   with notifications,bookmarks,credentials hidden,prepared workflow with
   stable results,browser zoom 100%,deliberate cursor,voice recorded
   separately),timecoded visual-by-second table,good demo topics(a
   defined creator problem,a comparison,a format trend),visual emphasis
   (zoom into one decision at a time,text overlays to six words or
   fewer,favor product motion),claims to avoid("this analyzes the
   YouTube algorithm","this predicts virality","includes private YouTube
   Analytics","guarantees views or CTR","already open source",
   "reference images stored"),and pre-publish review(no API keys,
   account identifiers,private browser data,or local filesystem paths
   visible;every spoken claim matches the build;repository and license
   status current;assets permitted;independence line present;watch with
   sound off,and listen without the screen;review export on a phone)。(
4. **Canva generation brief**:  reusable exact brief for regenerating the deck
   (theme,,,,narrative,,,,visuals,,,,avoid list)。(



## Honesty guardrails(publishing)

- Never claim algorithm insight,prediction,virality,guaranteed views or
  CTR,private analytics access,or open-source status unless it is
  true on recording day。
- Never claim reference images are stored with every project(they are
  intentionally not retained)。
- Include the independence line in the narration or description。


## Pair with

- `youtube-research-playbook`  -  provides the honest promise the package
  must keep。
- `youtube-script-writer`  -  provides the script to record,and the
  narration text for TTS。
- `youtube-thumbnail-creator`  -  provides the generated thumbnail the
  package references。
- `youtube-uploader`(hub))  -  uploads the packaged video,title,
  description,tags,comment headlessly。
- `peakora-design`(hub))  -  applies Peakora design direction to custom
  demo decks when the demo is for a Peakora product。



## License and provenance

Distilled from `AgriciDaniel/youtubepro`(Apache License 2.0**, notably
`docs/launch-video/`)。Independent project,not affiliated with or endorsed
by YouTube or Google。
