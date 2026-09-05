---
name: peakora-design
description: >-
    The unified Peakora design system AND design director. One skill that does
    what three used to: (1) the Peakora brand spec (OKLCH tokens, landing +
    app grammars, motion presets), (2) token conformance (check + enforce
    against the Peakora system), and (3) the full design-direction command set
    (shape, critique, audit, polish, bolder, quieter, distill, harden,
    onboard, animate, colorize, typeset, layout, delight, overdrive, clarify,
    adapt, optimize, live, init, document, extract). Always recalled for any
    frontend repo so the agent knows the tokens and grammar. For Peakora
    repos, token conformance is the default mode. For non-Peakora or
    greenfield UI, the design-direction commands apply. Supersedes the
    peakora-design-system skill and the design-enforcer agent.
metadata:
  version: 1.0.0
---

# peakora-design - the unified Peakora design system + design director

This is the single entry point for frontend design at Peakora. It merges three
things that used to be separate:

1. **The Peakora brand spec** - the OKLCH token table, landing-page grammar,
   app/dashboard grammar, and motion presets. The single source of truth for
   the Peakora visual language. (Formerly the `peakora-design-system` skill.)
2. **Token conformance** - `check` (read-only audit) and `enforce` (fix drift)
   against the Peakora system. The machinery the SaaS Builder runs after
   building a frontend. (Formerly the `design-enforcer` agent.)
3. **Design direction + refinement** - 23 commands for shaping, critiquing,
   polishing, and refining any UI, plus the PRODUCT.md/DESIGN.md product
   context workflow. (From the `impeccable` skill; playbooks live in
   `skills/impeccable/reference/`.)

For non-trivial motion, delegate to the `emil-skills` collection (the
authoritative motion engineering layer). See the Motion section below.

## Cross-repo playbook access (lean - no hub-on-disk needed)

The impeccable direction playbooks (`skills/impeccable/reference/<cmd>.md`) and
the emil-skills sub-skills live in this hub (private repo). When you recall
this skill in a consuming repo, read a playbook via the GitHub Contents API:

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/peakora/Peakora-Cortex/contents/skills/impeccable/reference/<cmd>.md" \
| python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())"
```

Then apply the playbook. The impeccable scripts (`context.mjs`, `pin.mjs`,
`live.mjs`) are a convenience for a LOCAL hub checkout only - they are NOT
required cross-repo. The agent reads PRODUCT.md / DESIGN.md directly (just
`cat` the files) and reads the playbook via the API fetch above. Do not copy
skills into the consuming repo; the hub is the single source of truth.

## Reference analysis (replaces the taste Playwright capture)

To make a build "feel like" a reference site, use the agent's built-in browser
tool - no Playwright install, no scripts, no 100MB chromium download:

1. `browser_navigate` to the reference URL.
2. `browser_get_state` (with `include_screenshot: true`) to capture the page.
3. Read the screenshot: extract the palette (dominant + accent colors),
   typography (font feel, size hierarchy), spacing rhythm, radii, and the
   overall vibe (dense vs airy, playful vs serious).
4. Map those onto the Peakora tokens where possible (the reference's accent
   onto `--primary`, its neutrals onto `--background`/`--muted`), and note
   the deliberate divergences.

This is qualitative, not token-exact. That is usually enough for "feel like
Linear" or "make the hero as bold as Vercel's". Reserve the heavy `taste`
Playwright capture (exact oklch/font/spacing extraction) for the rare case
where you need pixel-level token cloning AND the hub is local with Playwright
installed - it is not the default path.

## When to use (always recalled; what you DO depends on the repo)

This skill is ALWAYS recalled (by `skill-audit`) for any frontend repo, so the
agent knows the tokens and grammar. What it does with that knowledge depends
on the repo:

- **New Peakora-branded build** (scaffolded from scratch, e.g. by the SaaS
  Builder): the frontend is built TO this spec, then `check` (verify
  conformance) and `enforce` (fix any drift) both run automatically. Following
  the design IS the goal of a new build.
- **Existing repo with its own design**: `check` mode (read-only, always safe)
  reports how the repo compares to the canonical system and flags intentional
  divergences. It does NOT enforce. `enforce` runs only if Ala explicitly asks.
- **Non-Peakora / greenfield creative UI**: use the design-direction commands
  (shape, critique, polish, bolder, quieter, distill, etc.) instead of token
  conformance. There is no Peakora brand to conform to.

Repos with their own deliberate design (enforce only if Ala asks):
- **Peakora-Assistant** (the former peakora-site repo, renamed) - its own
  design, deliberately different from the canonical system.
- Any repo with an established, deliberate visual language.

## The command router

Two command families. The agent picks the family from the repo context above.

### Family A - conformance (Peakora repos; the former design-enforcer logic)

| Command | What it does |
|---------|--------------|
| `check` | Read-only audit of the built frontend against the Peakora tokens + grammar. Produces a conformance report. Never edits. Always safe. |
| `enforce` | Fix the drift `check` found, in place: replace literals with tokens, add missing theme tokens, collapse duplicate components, add missing states. Opt-in for existing repos; automatic for new builds. |

The conformance logic + output format is in the "Token conformance" section
below.

### Family B - design direction + refinement (any repo; the impeccable commands)

Each command has a playbook in `skills/impeccable/reference/<cmd>.md`. Read it
via the API fetch in "Cross-repo playbook access" above, then apply it.
Product context (PRODUCT.md/DESIGN.md) comes first via `init` - read those
files directly with `cat`.

| Command | Family | What it does | Playbook |
|---------|--------|--------------|---------|
| `init` | Build | Capture durable product context in PRODUCT.md | impeccable/reference/init.md |
| `shape [feature]` | Build | Plan UX/UI before writing code | impeccable/reference/shape.md |
| `document` | Build | Generate DESIGN.md from existing project code | impeccable/reference/document.md |
| `extract [target]` | Build | Pull reusable tokens/components into the design system | impeccable/reference/extract.md |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | impeccable/reference/critique.md |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | impeccable/reference/audit.md |
| `polish [target]` | Refine | Final quality pass before shipping | impeccable/reference/polish.md |
| `bolder [target]` | Refine | Amplify safe or bland designs | impeccable/reference/bolder.md |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | impeccable/reference/quieter.md |
| `distill [target]` | Refine | Strip to essence, remove complexity | impeccable/reference/distill.md |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | impeccable/reference/harden.md |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | impeccable/reference/onboard.md |
| `animate [target]` | Enhance | Add purposeful animations and motion | impeccable/reference/animate.md |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | impeccable/reference/colorize.md |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | impeccable/reference/typeset.md |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | impeccable/reference/layout.md |
| `delight [target]` | Enhance | Add personality and memorable touches | impeccable/reference/delight.md |
| `overdrive [target]` | Enhance | Push past conventional limits | impeccable/reference/overdrive.md |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | impeccable/reference/clarify.md |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | impeccable/reference/adapt.md |
| `optimize [target]` | Fix | Diagnose and fix UI performance | impeccable/reference/optimize.md |
| `live` | Iterate | Visual variant mode: pick elements in the browser, generate alternatives | impeccable/reference/live.md |

Impeccable's own scripts (PRODUCT.md/DESIGN.md loader, live browser mode,
image generation) live at `skills/impeccable/scripts/`. They run with Node.js;
run `node skills/impeccable/scripts/context.mjs` in the project dir to load
product context. The impeccable SKILL.md (resolved by
`skills/impeccable/scripts/resolve-skill.mjs`) has the full command detail.

## Product context (PRODUCT.md / DESIGN.md)

Before `shape`, `init`, or a from-scratch build, capture product context.
Impeccable's `init` command (playbook: `impeccable/reference/init.md`) runs a
short interview and writes `PRODUCT.md`. `document` generates `DESIGN.md`
from existing code. These two files are the durable product + design
authority; every direction command reads them via `context.mjs`.

## Design tokens (OKLCH, shadcn/ui style)

Single source of truth in `index.css`. Toggling `.dark` on `<html>` flips the
palette. Copy these CSS variables verbatim into the consuming repo's global CSS:

```css
@import "tailwindcss";
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.52 0.105 223.128);
  --primary-foreground: oklch(0.984 0.019 200.873);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.865 0.127 207.078);
  --chart-2: oklch(0.715 0.143 215.221);
  --chart-3: oklch(0.609 0.126 221.723);
  --chart-4: oklch(0.52 0.105 223.128);
  --chart-5: oklch(0.45 0.085 224.283);
  --radius: 0.625rem;
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.609 0.126 221.723);
  --sidebar-primary-foreground: oklch(0.984 0.019 200.873);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}
.dark {
  /* mirror with dark variants - see Peakora-Designer/src/index.css for the
     full .dark block. Primary accent stays oklch(0.52 0.105 223.128). */
}
```
Brand color identity: **indigo-blue primary** `oklch(0.52 0.105 223.128)` with
a 5-step chart gradient from `--chart-1` (light) to `--chart-5` (deep). Radius
0.625rem.

## Theme controller (useTheme hook)

Light/dark toggle, persisted to localStorage (`peakora-theme`), reads OS
`prefers-color-scheme` on first load. Applies/removes `.dark` on `<html>`.
Reference: `Peakora-Designer/src/theme.ts`.

## Landing-page section grammar

The canonical landing is composed of these sections (in order). Reproduce the
structure + motion presets; swap copy/features per product:

1. **Nav** - sticky, `backdrop-blur-xl`, `bg-white/75 dark:bg-slate-950/75`,
   border-b. Logo = gradient square (`from-[var(--primary)] to-[var(--chart-3)]`)
   with "P" + "Peakora" wordmark + uppercase product tag. Right: nav links +
   "Sign in" (ghost) + "Get started" (solid `bg-slate-900 dark:bg-white`).
2. **Hero** - centered, `max-w-4xl`. Two atmospheric blurred radial blobs
   (indigo + amber, `blur-[100-120px]`). H1 `text-5xl md:text-6xl font-extrabold
   tracking-tight leading-[1.05]` with a gradient-clipped second line
   (`from-[var(--primary)] via-[var(--chart-3)] to-[var(--primary)] bg-clip-text
   text-transparent`). Subhead `text-lg text-slate-600 dark:text-slate-400`.
   Two CTAs: primary solid + secondary outline. Stats strip (2x2 / 4-col grid).
3. **Hero preview mock** - rounded-2xl card with `shadow-2xl`, faux browser
   chrome (3 traffic-light dots + monospace URL), 3-col grid mock of the product.
4. **Features** - `grid md:grid-cols-2 lg:grid-cols-3 gap-5`. Cards: `p-5
   rounded-xl bg-white dark:bg-slate-900 border` + `hover:shadow-lg`. Icon tile
   `bg-[var(--accent)]` with `text-[var(--primary)]` lucide icon.
5. **How it works / Pipeline** - 4-step horizontal grid with arrow connectors
   (`ArrowRight` between steps, md+ only). Steps on `bg-slate-50/50` tiles.
6. **Final CTA** - centered card, `bg-gradient-to-br from-[var(--primary)]
   to-violet-700 dark:to-violet-900 text-white shadow-xl`. White button with
   `text-[var(--primary)]`.
7. **Footer** - logo + "Billing via Dodo" / "Edge via Cloudflare" labels
   (or omit provider labels; they are optional branding, not required).

## Motion presets (Framer Motion / `motion/react`)

These presets cover branded micro-interactions. For anything more than a
micro-interaction (should it animate at all? which tool? which curve?
duration? interruption? exit?), delegate to the `emil-skills` collection - it
is the authoritative motion engineering layer.

- Hero entrance: `initial={{opacity:0,y:16}} animate={{opacity:1,y:0}}`
  staggered delays 0.05 -> 0.12 -> 0.18 -> 0.3.
- Hero preview: `y:30`, delay 0.35, duration 0.7.
- Feature cards: `whileInView` with `viewport={{once:true, margin:'-50px'}}`,
  per-card delay `i * 0.06`, duration 0.4.

## Layout primitives

- Container: `max-w-6xl mx-auto px-6` (content `max-w-4xl` / `max-w-5xl`).
- Section rhythm: `py-20 px-6`, dividers `border-t border-slate-200/60
  dark:border-slate-800/60`.
- Base canvas: `bg-[#F9F9FB] dark:bg-slate-950 text-slate-900 dark:text-slate-100`.
- Font: system sans, `antialiased`, `overflow-x-hidden` on root.

## App / dashboard component grammar (the functional SaaS UI)

The landing grammar above is the marketing surface. A full functional SaaS
also needs the authenticated app. Reproduce these components from the same
token set so the app and the landing are one design system.

### App shell
- **Sidebar** (fixed, `w-64`, collapsible to `w-16` icon-only): `bg-[var(--sidebar)]
  dark:bg-slate-900 border-r border-[var(--sidebar-border)]`. Logo block at top
  (gradient square + wordmark). Nav items: `lucide-react` icon + label, active
  state `bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]` with left
  accent bar. Section dividers + uppercase section labels (`text-xs uppercase
  text-slate-400`). Footer: user menu (avatar + name + email, dropdown with
  Settings / Sign out).
- **Topbar** (sticky, `h-14`, `border-b`): page title (left), search
  (`w-64`, muted placeholder), theme toggle (`useTheme`), notifications bell
  with badge. Mobile: hamburger toggles sidebar via a `Sheet` (Radix).
- **Content area**: `p-6 md:p-8`, `max-w-7xl mx-auto`. Page header row:
  title + subtitle (left), primary action button (right).

### Cards + surfaces
- **`.dash-card`** base: `rounded-xl border bg-white dark:bg-slate-900 p-5
  shadow-sm`. Header row: title `font-semibold` + optional action (link or
  icon button). Body: slot. Reuse this for every panel; do not build parallel
  card variants (the `enforce` command collapses duplicates).
- **Stat card**: dash-card with a big number (`text-3xl font-bold`), a label
  (`text-sm text-slate-500`), a delta (`text-xs`, green up / red down via
  `--chart-` tokens, never raw red/green), and a sparkline or `lucide` icon.

### Data tables
- Container: dash-card, no inner border. Header row: `text-xs uppercase
  text-slate-500 border-b`. Rows: `border-b border-slate-100 dark:border-slate-800
  hover:bg-[var(--accent)]`. Sticky header on scroll. Pagination footer:
  "Showing 1-10 of 42" + prev/next (ghost buttons). Row actions behind a
  `lucide MoreHorizontal` dropdown (Radix `DropdownMenu`). Empty state inline
  (see states below). Sortable columns show a `lucide ArrowUpDown` that flips.

### Forms
- Label: `text-sm font-medium`. Input/select/textarea: `h-10 rounded-md border
  border-[var(--input)] bg-transparent px-3 focus:ring-2 focus:ring-[var(--ring)]`.
- Validation: error text `text-sm text-[var(--destructive)]` under the field,
  error border on the input. Submit button: solid `bg-slate-900 dark:bg-white`
  primary; destructive actions use `bg-[var(--destructive)]`.
- Use Radix primitives for selects, dialogs, date pickers so overlay behavior
  (focus trap, escape, portal) is correct, not hand-rolled.

### Charts
- Use the 5-step `--chart-1` through `--chart-5` gradient for series, in order.
  Never invent a sixth color. Chart container: dash-card. Legend: `text-xs
  text-slate-500` with a colored dot. Recharts or visx both fit; the tokens
  are framework-agnostic.

### Settings + profile
- Two-column: nav rail (left, `w-48`, section links) + form panel (right,
  dash-card). Sections: Account, Billing (tier + manage-subscription link to
  Dodo portal), Notifications, Appearance (theme toggle + density), Danger
  zone (delete account, `bg-[var(--destructive)]` outlined).

### Auth pages
- Centered single card (`max-w-md mx-auto mt-20`), dash-card style. Logo at
  top, heading, form, divider "or", OAuth buttons (full-width ghost), footer
  link to the alternate mode (Sign in <-> Sign up). Error/alert banner above
  the form on failure (`bg-[var(--destructive)]/10 text-[var(--destructive)]`).
  Magic-link + password both supported; password fields show a `lucide Eye`
  toggle.

### States (mandatory on every async surface)
- **Loading**: skeleton (`animate-pulse bg-[var(--muted)] rounded-md`) matching
  the final layout shape, never a full-screen spinner except initial app boot.
- **Empty**: illustration or `lucide` icon + headline + one-line helper + a
  primary CTA to create the first item.
- **Error**: dash-card with `lucide AlertTriangle`, the error message (generic,
  no stack/internal leak), and a retry button.

### Motion (app)
- Subtle only. Page/route transition: `initial={{opacity:0}} animate={{opacity:1}}`
  duration 0.15. List item stagger: `whileInView` per-item delay `i * 0.03`.
  No large y-translates inside the app (they feel janky in a data-dense UI).
  Reserve the bigger motion presets (above) for the landing page.

## Stack (consuming repos must match)

Vite + React + Tailwind v4 (`@import "tailwindcss"`) + `lucide-react` +
`motion` (Framer Motion). Radix UI primitives for overlays. Auth + billing
are wired at the hub stage (Dodo Payments + Cloudflare by default; see the
`gstack` skill for the stack and swappable alternatives), not required to
reproduce the style.

## Token conformance (the `check` / `enforce` logic)

### Hard constraints
1. **`check` is always read-only.** It never edits, never enforces. It only
   reports. This is what makes it safe to auto-run everywhere.
2. **`enforce` is opt-in for existing repos.** Never run `enforce` on a repo
   with its own deliberate design unless Ala explicitly asks. Notable repos
   with their own design (do not enforce unless Ala asks):
   - **Peakora-Assistant** - its own design, deliberately different (the
     former peakora-site repo, renamed).
   - Any repo with an established, deliberate visual language.
   If delegated `enforce` on one of these without explicit Ala sign-off, STOP
   and return a report instead, asking for confirmation.
3. **Tokens over literals.** Colors, spacing, radii, shadows, font sizes,
   z-index - all via CSS custom properties / Tailwind tokens. A hardcoded
   `#3b82f6` or `padding: 14px` is a violation unless it is a one-off
   intentional exception (documented).
4. **Theme consistency.** Light/dark (or brand variants) must derive from
   the same token set. A component that hardcodes light-mode colors breaks
   in dark mode. Theme tokens (`--theme-card-bg`, `--theme-heading`) not
   raw values.
5. **Responsive by default.** Mobile-first. Every layout works at 375px
   before 1440px. No fixed widths on containers; use `max-width` + fluid
   units. Touch targets >= 44px.
6. **Accessible contrast.** Text/background pairs meet WCAG AA (4.5:1
   normal, 3:1 large). Use the token pairings the design system declares
   safe - do not invent new combinations.
7. **Component reuse over re-implementation.** If a card/button/input
   exists in the design system, use it. Do not build a parallel one.
8. **Loading/empty/error states.** Every async surface has all three. A
   component without them is incomplete.

### When auditing a frontend
1. Read the design system's token file (`tokens.css`, `tailwind.config`, the
   token table above). Know the canonical token names.
2. Scan components for violations:
   - Hardcoded color/spacing/radius/shadow/font values.
   - Raw `rgba()`/hex where a token exists.
   - Fixed pixel widths on responsive containers.
   - Missing dark/variant theme support.
   - Duplicated component variants that should reuse a base.
   - Missing loading/empty/error states on async surfaces.

2b. **Correlate theme picker vs theme definitions.** Find every place the
   app offers theme choices (a JS/HTML theme picker, URL query,
   documented variants,`data-theme` values in markup). List the offered
   theme names. Then enumerate the actual theme blocks defined in the
   CSS (e.g. `[data-theme="x"]`, `.theme-x`, a `switch` statement
   or token map). Flag (i) theme OFFERED in the picker but NOT defined
   in CSS (silently does nothing when selected), and (ii) theme defined
   in CSS but never offered (dead weight). Check all pages that share
   a persisted theme key (e.g. localStorage) so a theme chosen on one
   page does not break the next.
3. Classify each violation: token-literal (easy fix), theme-gap (needs a
   token added), structural (needs refactor), accessibility (contrast),
   missing-state (needs loading/empty/error).
4. **Motion audit** - for any animation/transition in the codebase, delegate
   to the `emil-skills` sub-skills: `review-animations` to critique existing
   motion against the standards, `improve-animations` to audit the whole
   codebase's motion. The Peakora presets above cover branded
   micro-interactions; emil-skills covers the engineering layer (should it
   animate at all, which tool, which curve, duration, interruption, exit).
5. **`check` mode**: STOP here. Produce the report (output format below).
   Do not edit. **`enforce` mode**: fix in place - replace literals with
   tokens, add missing theme tokens, collapse duplicates into the shared
   base, add missing states. Do not leave a TODO. For motion, apply the
   fixes emil-skills `review-animations` flagged (right tool, right
   properties, right curve and duration, reduced-motion + hover gating).
   For general design direction + refinement commands (bolder, quieter,
   distill, harden, delight, overdrive, shape, live), read the matching
   playbook in `skills/impeccable/reference/` and apply it.

### Output format

#### `check` mode (read-only report)
```
## Design conformance check - <scope> [CHECK, read-only]

## Token source
<file the canonical tokens live in>

## Conformance summary
- Overall: <CONFORMS | DRIFT | INTENTIONAL-DIVERGENCE>
- Matched: <count> - Drift: <count> - Missing: <count>

## Drift (does not match the design system)
### <component/file>
- Violation: <hardcoded value / theme gap / missing state / etc.>
- Expected: <the token / grammar / state the system requires>
- Suggested fix: <one line - NOT applied in check mode>
(repeat)

## Intentional divergence (repo has its own design - NOT a violation)
<for repos like Peakora-Assistant: list where it deliberately differs, and
confirm it is intentional, not drift to fix>

## Accessibility
- <component>: <contrast ratio> -> <pass/fail>

## Confirmed consistent
<what you checked and found clean - be specific>
```

#### `enforce` mode (fixes applied)
```
## Design conformance enforcement - <scope> [ENFORCE, edits applied]

## Token source
<file the canonical tokens live in>

## Violations (fixed)
### <component/file>
- Violation: <hardcoded value / theme gap / etc.>
- Fix: <token applied - before -> after>
(repeat)

## Theme gaps (tokens added)
- <new token>: <value> - <why it was missing>

## Accessibility
- <component>: <contrast ratio> -> <pass/fail + fix if fail>

## Structural (flagged, not auto-fixed)
<refactors that need caller sign-off - e.g. "collapse 3 card variants into
the shared .dash-card base">

## Confirmed consistent
<what you checked and found clean - be specific>
```

### Rules
- **`check` is always safe.** It is read-only and may auto-run on any repo,
  including new builds and repos with their own design. It only reports.
- **`enforce` is opt-in for existing repos.** It runs automatically only on
  a NEW Peakora-branded build (scaffolded from scratch). For an existing repo
  with its own design (Peakora-Assistant, the former peakora-site), it runs
  ONLY when Ala explicitly asks. If delegated `enforce` on such a repo
  without sign-off, return a `check` report instead and ask for confirmation.
- Never introduce a new raw color/spacing value when a token exists. If
  you genuinely need a new one, add it to the token file first.
- Never "fix" a deliberate exception without confirming it is a violation.
  Read the surrounding context.
- This skill is written against the Peakora design system. To adapt: point
  the conformance logic at your token file and your component library. The
  check/enforce logic is identical; the direction commands are brand-agnostic.

## Source of truth files (Peakora-Designer)
- `src/index.css` - full token table (light + dark + legacy `--peakora-*` aliases)
- `src/theme.ts` - useTheme light/dark controller
- `src/components/landing/LandingPage.tsx` - canonical landing implementation
