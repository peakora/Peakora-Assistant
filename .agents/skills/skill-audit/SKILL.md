---
name: skill-audit
description: >-
    Discover useful skills for the current repo at session start. Inspects the repository stack and recommends the hub skills plus any installed OpenHands skills that are relevant, so each session knows what is available instead of reinventing it. Auto-runs on session start for hubs that consume the central skills hub.
metadata:
  version: 1.0.0
---

## When to use
Run automatically at the **start of every OpenHands session** on any repo that
consumes the central skills hub (see `AGENTS.md` → "Skill audit protocol").
Also invoke manually when the user asks "which skills can I use here?" or
"what skills apply to this project?".

It inspects the current repository's stack and recommends the hub skills
(under `skills/`) and any installed OpenHands skills that are relevant to the
build. This keeps every session aware of the reusable tools already available
instead of reinventing them.

## How it works
1. Detect the repo's stack by scanning well-known files (see detection table).
2. Match detected signals against the skill registry below.
3. Report a concise table: `Skill | Why it applies | Trigger file/signal`.
4. Do NOT modify the repo. This is read-only discovery.

## Detection table (stack signal → file/pattern)

| Signal | Detection | Relevant hub skills |
|--------|-----------|---------------------|
| Python | `requirements.txt`, `pyproject.toml`, `setup.py`, `*.py` | cognee-memory, llm-console, uv |
| Node/JS | `package.json`, `*.ts`, `*.js`, `tsconfig.json` | cognee-memory, npm, vercel |
| Deno | `deno.json`, `mod.ts`, `*.deno` | deno |
| Docker | `Dockerfile`, `docker-compose*.yml` | docker, cognee-memory |
| Kubernetes | `k8s.yaml`, `*.yaml` with `kind:` | kubernetes |
| GitHub Actions | `.github/workflows/*.yml` | github-actions, github, github-pr-review |
| GitLab CI | `.gitlab-ci.yml` | gitlab |
| Bitbucket | `bitbucket-pipelines.yml` or remote origin `bitbucket.org` | bitbucket |
| Azure DevOps | `azure-pipelines.yml` or remote origin `dev.azure.com` | azure-devops |
| Database/SQL | `*.sql`, `prisma/schema.prisma`, `supabase/` | (gstack DB conventions) |
| Payments | `dodo`, `paddle`, `stripe`, `DODO_PAYMENTS_`, `PADDLE_` env keys | gstack (monetization layer), billing-integrator agent |
| Email | `resend`, `RESEND_API_KEY` | gstack (email layer) |
| Auth | `supabase`, `NEXT_PUBLIC_SUPABASE_`, JWT libs | security, gstack |
| API server | `PORT`, `app.listen`, `uvicorn`, `express` | security, datadog |
| Frontend | `tailwind`, `shadcn`, `radix`, `*.tsx` components | peakora-design (merged: tokens + conformance + direction), better-ui, better-accessibility, better-layout, better-typography, better-colors, better-writing |
| React / Next.js | `package.json` with `react`, `next`, `hooks` in `src/`, `useEffect` | no-use-effect, vercel-react-best-practices, vercel-composition-patterns, typescript-advanced-types |
| TypeScript | `tsconfig.json`, `*.ts` files | typescript-advanced-types |
| UI audit / design review | "review my UI", "check accessibility", "audit design" | better-interface, web-design-guidelines |
| UX flow planning | flow design, user journeys, onboarding flows | ux-flow-plan |
| SEO | `sitemap.xml`, `robots.txt`, `next-seo`, "why am I not ranking" | seo-audit |
| Marketing work | "write copy", "marketing email", "sales page", "opt-in page", "facebook ad", "lead magnet", "funnel", "marketing strategy", `sitemap.xml`? no: any marketing brief | peakora-marketing (read principles + matching playbook BEFORE writing) |
| Analytics | `posthog`, `PostHog`, "add tracking", "instrument events" | posthog-instrumentation |
| Code reuse / refactor review | "check code reuse", "does this fit the codebase", "refactor for composition" | code-refactor-review, pit-of-success, zero-tech-debt |
| Repo engineering standards | ANY repo review/build | codebase-standards (distilled, always-consider) |
| Video editing (general) | `ffmpeg`, `moviepy`, "edit this video", "cut this video" | video-use |
| Math/technical animation | `manim`, "animated explanation", "3Blue1Brown style" | manim-video |
| AI-slop removal / draft editing | "less AI-sounding", "make it sound human", draft de-slopping | no-ai-slop |
| Skill safety / install review | Downloading/importing any skill, ".agents/skills/ add", "is this skill safe" | skill-inspector |
| Phone control | `adb`, iPhone Mirroring, "control my phone" | phone-harness |
| Landing / signup page | `LandingPage`, `landing/`, `auth/`, `index.html` + vite | peakora-design, frontend-design, taste (for reference research) |
| Motion / animation | `framer-motion`, `motion`, `@keyframes`, `transition`, `animate` | emil-skills (animate, review-animations, improve-animations) |
| Design tokens / theme | `DESIGN.md`, `theme.ts`, `tokens.css`, `tailwind.config` | peakora-design (extract/document + conformance) |
| Notebooks | `*.ipynb` | jupyter |
| Java/Kotlin | `pom.xml`, `build.gradle`, `*.kt`, `*.java` | add-javadoc, spark-version-upgrade (if Spark) |
| Swift | `Package.swift`, `*.swift` | swift-linux |
| LaTeX | `*.tex` | pdflatex |
| Docs/Markdown | `README.md`, `docs/` | plain-english-content, technical-writing |
| Video generation | `auto_pilot*.py`, `moviepy`, `ffmpeg`, `peakora_schedule.py` | youtube-uploader, video-stitcher |
| Arabic / Islamic channel | `camel-tools`, `mishkal`, `kokoro`, `arabic`, `islamic` | story-writer, auto-diacritizer, arabic-tts |
| Drawing / whiteboard anim | `manim`, `opencv`, `blender`, `grease` | script-writer, procedural-drawing, headless-blender |
| Multi-platform posting | `instagram`, `facebook`, `meta`, `graph.facebook.com` | youtube-uploader, video-stitcher |
| Bioinformatics / genomics | `scanpy`, `anndata`, `biopython`, `pysam`, `gget`, `bioservices`, `bulk-rnaseq`, `cellxgene-census`, `scvi-tools`, `pydeseq2`, `pathway-enrichment`, `tiledbvcf` | scientific import: `scanpy`, `anndata`, `biopython`, `pysam`, `gget`, `bioservices`, `bulk-rnaseq`, `cellxgene-census`, `scvi-tools`, `pydeseq2`, `pathway-enrichment`, `tiledbvcf`, `genomic-coordinates` |
| Single-cell / omics | `scanpy`, `anndata`, `scvi-tools`, `scvelo`, `lamindb`, `cellxgene-census` | scientific import: `scanpy`, `anndata`, `scvi-tools`, `scvelo`, `lamindb`, `cellxgene-census` |
| Drug discovery / cheminformatics | `rdkit`, `deepchem`, `datamol`, `molfeat`, `torchdrug`, `pytdc`, `diffdock`, `medchem` | scientific import: `rdkit`, `deepchem`, `datamol`, `molfeat`, `torchdrug`, `pytdc`, `diffdock`, `medchem` |
| Clinical / bioimaging | `pydicom`, `histolab`, `pathml`, `deepspot-m`, `pyhealth` | scientific import: `pydicom`, `histolab`, `pathml`, `deepspot-m`, `pyhealth` |
| Neuroscience | `neurokit2`, `neuropixels-analysis`, `bids` | scientific import: `neurokit2`, `neuropixels-analysis`, `bids` |
| Scientific ML / statistics | `scikit-learn`, `statsmodels`, `pytorch-lightning`, `transformers`, `shap`, `pymc`, `aeon`, `statistical-analysis` | scientific import: `scikit-learn`, `statsmodels`, `pytorch-lightning`, `transformers`, `shap`, `pymc`, `aeon`, `statistical-analysis`, `statistical-power` |
| Materials / chemistry / physics | `pymatgen`, `astropy`, `cobrapy`, `qiskit`, `pennylane`, `cirq`, `qutip` | scientific import: `pymatgen`, `astropy`, `cobrapy`, `qiskit`, `pennylane`, `cirq`, `qutip` |
| Data analysis / visualization | `polars`, `dask`, `vaex`, `matplotlib`, `seaborn`, `geopandas`, `networkx` | scientific import: `polars`, `dask`, `vaex`, `matplotlib`, `seaborn`, `geopandas`, `networkx`, `scientific-visualization` |
| Scientific writing / research | `literature-review`, `paper-lookup`, `paperclip`, `scientific-writing`, `citation-management`, `research-grants` | scientific import: `literature-review`, `paper-lookup`, `paperclip`, `scientific-writing`, `citation-management`, `research-grants` |
| Lab automation | `opentrons-integration`, `pylabrobot`, `protocolsio-integration`, `nextflow`, `modal` | scientific import: `opentrons-integration`, `pylabrobot`, `protocolsio-integration`, `nextflow`, `modal` |

## Hub skill registry (always-consider)
These are repo-agnostic and relevant to most sessions:

| Skill | Use when |
|-------|----------|
| humanizer | ALWAYS  -  every repo, every session. Warm/human/passionate voice, NO emoji, no flat/robotic copy (in chat AND generated content) |
| cognee-memory | ALWAYS  -  recall cross-repo memory at start, persist summary at end |
| gstack | Project touches the zero-cost production stack (Supabase/Paddle/Resend/Cloudflare) |
| last30days | Need git-history context for recent changes |
| llm-console | Orchestrating Gemini LLM calls |
| security | Handling auth, secrets, payments, or sensitive data |
| code-review | Reviewing a PR / merge request |
| code-simplifier | User asks to clean up / simplify recent code |
| frontend-design | Building any web UI / component / landing page |
| github / gitlab / bitbucket / azure-devops | Interacting with the repo's git host |
| github-actions | Building CI/CD pipelines |
| youtube-uploader | Publishing/uploading video to YouTube, OAuth refresh, Brand Account routing |
| video-stitcher | Compositing scenes into a final video (captions, music, aspect ratio) |
| peakora-design-system | Building/refreshing a Peakora-branded landing or signup page (canonical style) |
| story-writer / script-writer / auto-diacritizer / arabic-tts / procedural-drawing / headless-blender | The future multi-channel video work (CPU/FREE)  -  recalled when those channels start |
| consistency-agent / lipsync-motion | [EXCLUDED] surfaced only to document the GPU/paid gap; do not build |
| no-ai-slop | Editing/finishing ANY draft or generated copy  -  de-sloop AFTER voice compliance;do not sound-like-AI(imported,MIT) |
| video-use | Editing a video by conversation:transcribe,cut,grade,subtitles(imported,MIT) |
| manim-video | Math/technical animated explainers:3Blue1Brown-style(imported,MIT) |
| codebase-standards | EVERY review/build  -  repository engineering lens:constants-in-config,parse-at-boundary,one-convention(distilled,MIT) |
| code-refactor-review | Reviewing code for reuse,composition,consistency,slop(imported,MIT) |
| pit-of-success | Designing APIs/component props or reviewing signatures for footguns(imported,MIT) |
| zero-tech-debt | Re-cutting a rushed change back to intended architecture(imported,MIT) |
| vercel-react-best-practices / vercel-composition-patterns | Writing/reviewing React/Next.js perf and composition(imported,MIT) |
| typescript-advanced-types | Implementing type-safe TypeScript:advanced generics,mapped/conditional types(imported,MIT) |
| no-use-effect | Writing/reviewing React components:enforce no-useEffect rule(imported,MIT) |
| better-ui / better-accessibility / better-layout / better-typography / better-colors / better-writing / better-interface / web-design-guidelines | Building or auditing any web UI:A11Y,layout,type,color,UX copy,holistic interface review(imported,MIT) |
| ux-flow-plan | Planning the UX/user-flow shape BEFORE building a multi-step flow(imported,MIT) |
| seo-audit | User asks why not ranking / SEO audit(imported,MIT) |
| peakora-marketing | ANY marketing work:copy,ads,emails,sales/opt-in pages,lead magnets,funnels,strategy. Read principles + matching playbook BEFORE producing output(imported,CC-BY-SA-4.0) |
| posthog-instrumentation | Adding tracking,events,or feature flags to a product(imported,MIT) |
| skill-inspector | Installing/trusting ANY skill  -  pre-install safety gate(imported,Apache  2.0). |
| phone-harness | Controlling the user's phone:iPhone Mirroring or adb(imported,MIT) |

## Output format
Report a short markdown table, then a one-line "next step" suggestion, e.g.:

```
Recommended skills for this repo:
| Skill | Why | Signal |
|-------|-----|--------|
| cognee-memory | Cross-repo memory (mandatory at session start) | hub loaded |
| uv | Python project, uses uv lockfile | uv.lock |
| github | Repo hosted on GitHub | remote origin |

Next: recall cross-repo memory via cognee-memory, then proceed with the task.
```

## Notes
- This skill is read-only. It never installs anything or edits the repo.
- Installed OpenHands skills (loaded as `<available_skills>`) should also be
  surfaced if they match a detected signal  -  they are usable via
  `invoke_skill(name=...)`.
- If no signals match, still recommend the always-consider set (cognee-memory
  at minimum).
