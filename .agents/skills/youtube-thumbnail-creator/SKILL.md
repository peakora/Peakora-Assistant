---
name: youtube-thumbnail-creator
description: >-
    Evidence-honest YouTube thumbnail generation for creator-tool builds, distilled
    from the open-source youtubepro project (AgriciDaniel/youtubepro, Apache
    2.0). Generates a readable 16:9 thumbnail from a viewer promise,
    optional thumbnail concept, creator direction, and up to three permitted
    reference images, via Gemini image models(Nano Banana family). Styles,
    compositions, camera angles, lighting, color schemes, text positions,
    reference roles, validation limits(128-4096 px, 5 MB per image,
    12 MB decoded total, max 3 references),and the prompt integrity contract
    (no fabricated proof, no guarantees, no imitating named creators, no
    reproducing thumbnails, mobile-readable hierarchy). Also generates thumbnail
    text suggestions. Use when building a thumbnail creator feature, generating
    thumbnails, or auditing an image generation prompt for honesty..
metadata:
  version: 1.0.0
---



## Status

**IMPORTED METHODOLOGY(distilled from youtubepro, Apache 2.0).**
Reference implementation: `AgriciDaniel/youtubepro/server/thumbnail-contract.ts`
plus `server/gemini.ts`(`buildThumbnailPrompt`, `generateThumbnail`,
`generateThumbnailSuggestions`).. Not executable standalone here;it is the
prompt contract, validation limits,and integrity rules the agent applies.



## When to use

Invoke when a task needs to generate a YouTube thumbnail from a selected idea's
honest promise, build a thumbnail creator feature, generate thumbnail text
suggestions, or audit an image-generation prompt for honest packaging. Recalled
automatically for thumbnail creation, thumbnail generation, and thumbnail
text tasks. Pairs with `youtube-research-playbook` and `youtube-script-writer`:
the selected idea's honestPromise and thumbnailConcept flow into this skill's
brief, and `youtube-launch-package` packages the finished thumbnail with the title,
description, chapters, tags,and pinned comment.



## Thumbnail brief inputs

- Topic(up to 500 chars)。
- Viewer promise(the honest promise from the selected idea)。
- Selected idea thumbnail concept。
- Creator direction(description、,variation direction)。
- Style preset: bold,minimal,gaming,vlog,tutorial,cinematic,tech,lifestyle。
- Composition: centered,rule-of-thirds,close-up,wide-shot,split-screen,
  diagonal。
- Camera angle: eye-level,low-angle,high-angle,dutch-angle,overhead,
  three-quarter。
- Lighting: natural,dramatic,golden-hour,studio,neon,backlit,soft。
- Color scheme: vibrant,muted,warm,cool,monochrome,complementary,
  brand-colors。((
- Text position: left,right,center,top,bottom,none。
- References: up to 3 PNG/JPEG images, each 128-4096 px, 5 MB per
  image after preparation, 12 MB decoded total, roles:subject, style,
  background,composition。((
- Mode: new concept or variation of a prior result。



## Prompt contract(distilled from buildThumbnailPrompt)

The prompt must:
- Create ONE original 16:9 thumbnail that truthfully packages the video。
- Carry the viewer promise and thumbnail concept;render only the supplied text
  if any(main text, sub text:no invented extra words;reserve the chosen
  text position area for readable text, clear of faces and key objects;prioritize
  mobile-size legibility,and accurate spelling;use a readable heavy sans-serif
  only when it fits the selected style)。
- If no text is requested,render NO words,letters,logos,watermarks,or
  interface text。
- Apply style descriptions(e.g. bold:strong contrast,clear focal point,
  restrained dramatic emphasis“;minimal:clean simple background,ample
  negative space,one clear focal point;gaming:energetic game-inspired
  lighting,strong depth,readable visual action;etc.)。(
- Reference treatment:autoBlend?integrate the permitted references coherently
  into one original scene:use them only as directional context,not a literal
  collage。 For each reference state its role constraint:subject(preserve
  recognizable features where the model supports it,without implying endorsement),
  style(broad visual direction only,no protected logos,text,or a creator's
  distinctive composition),background(environmental reference,adapt it rather
  than reproduce it exactly),composition(spatial-layout reference while creating
  original visual content)。
- Integrity: matchthe viewer promise without unsupported claims,fabricated
  proof,deceptive before-after results,or false urgency;build one obvious focal
  point and a visual hierarchy understandable on a phone;do NOT imitate a named​
  creator or reproduce another thumbnail;do NOT guarantee views,clicks,
  revenue,or any outcome。



## Validation limits(port from thumbnail-contract.ts)

- Image formats: PNG or JPEG only。
- Dimensions: 128 to  ​4096 pixels per side(checked per image before use)。
- Per-image size:  up to  ​5 MB after preparation(server-side re-encode)。
- Total decoded size:  up to  ​12 MB。
- Reference count: max 3。
- Browser side:raw source files over 10 MB are rejected before preparation。
- Request body budget:the 12 MB decoded total drives the server body limit(not an unboundedor 50 MB default)。
- Output:data URL with mimeType image/png or image/jpeg。

(



## Thumbnail text suggestions(distilled from generateThumbnailSuggestions

Generate exactly 5 short text options for a thumbnail:
each 2-5 words,and no more than 40 characters;complement the title and
promise instead of repeating them;plain, specific language readable on a
phone;no invented results,proof,urgency,secrets,danger,or exclusivity;
no promises of views,money,transformation,or guaranteed outcomes;normal
title casing unless capitalization is necessary for a name or acronym;return
only a JSON array of exactly 5 strings。





## Pair with

- `youtube-research-playbook`  -  supplies the idea package with its honest
  promise,and thumbnail concept。
- `youtube-script-writer`  -  supplies the topic,format,and promise the
  thumbnail must match。
- `youtube-launch-package`  -  packages the generated thumbnail with title,
  description,chapters,tags,and pinned comment for publishing。
- `youtube-uploader`(hub))  -  uploads the finished video headlessly。





## License and provenance

Distilled from `AgriciDaniel/youtubepro`(Apache License 2.0**, notably
`server/thumbnail-contract.ts` and `server/gemini.ts`)。Independent project,not
affiliated with or endorsed by YouTube or Google。
