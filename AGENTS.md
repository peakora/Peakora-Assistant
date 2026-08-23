# Peakora Dark Luxury Wellness — Master Style System & Guidelines

This document details the complete **Dark Luxury Wellness** visual design system, CSS variables, utility classes, and dynamic theme architecture. Use this specification as the master style setup for all applet components and pop-up modals.

---

## 1. Master Style Philosophy & Design System

- **Aesthetic**: Deep Midnight / Obsidian Canvas with Warm Terracotta, Honey Amber, and Amethyst Glow Accents.
- **Glassmorphism**: Soft background blurs (`backdrop-filter: blur(12px)`), layered translucent cards, and high-contrast light text against deep dark backgrounds.
- **Typography**:
  - Headings & Brand: `'Plus Jakarta Sans'`, sans-serif, bold/extra-bold, generous tracking.
  - Body Text: `'Inter'`, system-ui, sans-serif, high legibility (`--theme-text-main: #f8fafc`, `--theme-text-muted: #a0aec0`).
- **Responsive Layout**: Fluid CSS Grid architecture that automatically scales from small mobile screens (320px) to ultra-wide desktop displays without clipping, horizontal scrollbars, or overlapping elements.

---

## 2. Core CSS Variables & Color Tokens

Add these root CSS custom properties to ensure full theme compatibility across all components:

```css
:root {
  /* Default Theme: Sunrise (Warm Amber / Terracotta) */
  --theme-bg: #0c0a15;
  --theme-card-bg: #151122;
  --theme-card-border: rgba(255, 255, 255, 0.08);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #a0aec0;
  --theme-heading: #ffffff;
  --theme-accent: #f4a261;
  --theme-accent-glow: rgba(224, 122, 95, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #e07a5f 0%, #f4a261 50%, #a78bfa 100%);
  --theme-card-glow: rgba(224, 122, 95, 0.18);
  --theme-card-glow-hover: rgba(224, 122, 95, 0.38);
}

/* Dynamic Mood & Color Space Palettes */
body[data-theme="sunrise"], [data-theme="sunrise"] {
  --theme-bg: #0c0a15;
  --theme-card-bg: #151122;
  --theme-card-border: rgba(224, 122, 95, 0.25);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #a0aec0;
  --theme-heading: #ffffff;
  --theme-accent: #f4a261;
  --theme-accent-glow: rgba(224, 122, 95, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #e07a5f, #f4a261, #a78bfa);
  --theme-card-glow: rgba(224, 122, 95, 0.2);
  --theme-card-glow-hover: rgba(224, 122, 95, 0.4);
}

body[data-theme="sage"], [data-theme="sage"] {
  --theme-bg: #08140e;
  --theme-card-bg: #112218;
  --theme-card-border: rgba(52, 211, 153, 0.25);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #a7f3d0;
  --theme-heading: #ffffff;
  --theme-accent: #34d399;
  --theme-accent-glow: rgba(52, 211, 153, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #34d399, #10b981, #f59e0b);
  --theme-card-glow: rgba(52, 211, 153, 0.2);
  --theme-card-glow-hover: rgba(52, 211, 153, 0.4);
}

body[data-theme="amethyst"], [data-theme="amethyst"] {
  --theme-bg: #140d21;
  --theme-card-bg: #1d1230;
  --theme-card-border: rgba(192, 132, 252, 0.25);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #e9d5ff;
  --theme-heading: #ffffff;
  --theme-accent: #c084fc;
  --theme-accent-glow: rgba(192, 132, 252, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #c084fc, #a855f7, #ec4899);
  --theme-card-glow: rgba(192, 132, 252, 0.2);
  --theme-card-glow-hover: rgba(192, 132, 252, 0.4);
}

body[data-theme="twilight"], [data-theme="twilight"] {
  --theme-bg: #0b0f24;
  --theme-card-bg: #121835;
  --theme-card-border: rgba(129, 140, 248, 0.25);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #c7d2fe;
  --theme-heading: #ffffff;
  --theme-accent: #818cf8;
  --theme-accent-glow: rgba(129, 140, 248, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #818cf8, #4f46e5, #38bdf8);
  --theme-card-glow: rgba(129, 140, 248, 0.2);
  --theme-card-glow-hover: rgba(129, 140, 248, 0.4);
}

body[data-theme="solar"], [data-theme="solar"] {
  --theme-bg: #1a1506;
  --theme-card-bg: #282008;
  --theme-card-border: rgba(250, 204, 21, 0.3);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #fef08a;
  --theme-heading: #ffffff;
  --theme-accent: #facc15;
  --theme-accent-glow: rgba(250, 204, 21, 0.4);
  --theme-primary-grad: linear-gradient(135deg, #facc15, #eab308, #f97316);
  --theme-card-glow: rgba(250, 204, 21, 0.22);
  --theme-card-glow-hover: rgba(250, 204, 21, 0.45);
}

body[data-theme="sunset"], [data-theme="sunset"] {
  --theme-bg: #180a14;
  --theme-card-bg: #261121;
  --theme-card-border: rgba(251, 113, 133, 0.25);
  --theme-text-main: #f8fafc;
  --theme-text-muted: #fecdd3;
  --theme-heading: #ffffff;
  --theme-accent: #fb7185;
  --theme-accent-glow: rgba(251, 113, 133, 0.35);
  --theme-primary-grad: linear-gradient(135deg, #f43f5e, #fb7185, #f4a261);
  --theme-card-glow: rgba(251, 113, 133, 0.2);
  --theme-card-glow-hover: rgba(251, 113, 133, 0.4);
}
```

---

## 3. Standardized Pop-Up Modal Component Class (`.peakora-modal-standard`)

All pop-up windows in the application use a unified overlay container and `.peakora-modal-standard` card class to ensure consistent 24px corner radius, backdrop-filter blur, ambient card glow, padding, close buttons, and dynamic theme inheritance:

```css
/* Backdrop Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(8, 6, 14, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
  animation: modalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Standardized Pop-up Card */
.modal-card, .peakora-popup-card, .peakora-modal-standard {
  background: var(--theme-card-bg) !important;
  color: var(--theme-text-main) !important;
  border-radius: 24px !important;
  max-width: 540px;
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: 32px 28px !important;
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 40px var(--theme-card-glow) !important;
  border: 1px solid var(--theme-card-border) !important;
  position: relative;
  transition: all 0.35s ease;
  text-align: center;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.peakora-modal-standard h1,
.peakora-modal-standard h2,
.peakora-modal-standard h3,
.peakora-modal-standard h4 {
  color: var(--theme-heading, #ffffff) !important;
}

/* Modal Close Button */
.modal-close, .modal-close-btn, .peakora-popup-close {
  position: absolute;
  top: 18px;
  right: 20px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  transition: all 0.25s ease;
  z-index: 10;
}

.modal-close:hover, .modal-close-btn:hover, .peakora-popup-close:hover {
  background: var(--theme-primary-grad);
  color: #ffffff !important;
  border-color: transparent;
  transform: scale(1.1) rotate(90deg);
  box-shadow: 0 4px 16px var(--theme-accent-glow);
}
```

### Dynamic Theme Propagation for Modals (JavaScript)

Whenever a pop-up modal is opened, pass the active theme key to the modal overlay element:

```javascript
function openAnyModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    const currentTheme = localStorage.getItem("peakora_theme") || "sunrise";
    modal.setAttribute("data-theme", currentTheme);
    modal.style.display = "flex";
  }
}
```

---

## 4. Responsive CSS Grid Layout Rules

The dashboard layout utilizes auto-fitting flex-grid columns to guarantee cards adapt fluidly from 320px mobile screens up to 4K displays:

```css
.dash-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 24px;
  margin-bottom: 24px;
  width: 100%;
}

.dash-grid-equal {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 24px;
  margin-bottom: 24px;
  width: 100%;
}

.dash-card {
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-card-border);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  position: relative;
  transition: all 0.3s ease;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  overflow-wrap: break-word;
}
```

---

## 5. Master Style Setup Prompt (Save for AI Studio)

Copy and save the exact prompt below when generating new components or entire applets to automatically enforce this master visual design setup:

> **Master Style Prompt**:
> "Always apply the Peakora 'Dark Luxury Wellness' master design system. Build all cards and components using dark glassmorphism backgrounds (`background: var(--theme-card-bg); border: 1px solid var(--theme-card-border); border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); padding: 24px;`), high-contrast light typography, and ambient theme accent glows (`var(--theme-accent)`). Build all responsive layouts using CSS Grid (`grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr))`). Use `.peakora-modal-standard` for all pop-ups with `backdrop-filter: blur(12px)` overlay backdrops, and dynamically bind theme attributes via `data-theme`."

---

## Cross-Repo Memory Protocol (MANDATORY — from the peakora/peakora-cortex hub)

This repo consumes the central skills hub: **github.com/peakora/peakora-cortex**
(branch: master). The hub holds the master system blueprint, the shared skills,
and the cross-repo memory layers. User preference: call the owner **Ala**. No
emoji anywhere (chat, code, copy, commits).

### Session start — recall (NEVER SKIP)
1. Fetch and read `MEMORY.md` from the hub (guaranteed layer, plain text):
   `https://raw.githubusercontent.com/peakora/peakora-cortex/master/MEMORY.md`
2. Read this repo's `AGENTS.md` in full.
3. Best-effort Cognee recall (semantic layer, may be empty on the free tier):
   use `skills/cognee-memory/cognee_client.py` from the hub —
   `recall_safe("cross-repo architecture constraints, tech stack, coding preferences")`.

### Session end — remember (NEVER SKIP, before finishing)
1. GUARANTEED: append a dated entry to the Session Log in the hub's `MEMORY.md`
   (commit to peakora/peakora-cortex master, via git or GitHub API)
   summarizing decisions, API/schema changes, and gotchas for this repo.
2. Best-effort: `cognee_client.remember_safe(summary)` — add-only. NEVER call
   cognify automatically (burns the 20/day Gemini free quota; cognify is a
   manual, deliberate run).
3. Memory sync never blocks task completion — the MEMORY.md write is the
   fallback that always works.

### Cognee access (cloud agent — no local .env needed)
- URL auto-discovered from `tunnel_url.txt` in the hub repo.
- Auth: registered secret `COGNEE_API_KEY` sent as `X-Api-Key` header
  (fallback: `COGNEE_AUTH_EMAIL` / `COGNEE_AUTH_PASSWORD` Bearer login).
- Dataset: `global_user_memory`.
