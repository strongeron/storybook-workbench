# Storybook Install — defer the bootstrap, own the alignment

Load this reference when SKILL.md Step 1's pre-flight finds no `.storybook/` directory.

> ## Native-first: defer the bootstrap to Storybook (v1.13)
>
> **Storybook 10.4 ships agentic setup. Do NOT re-implement a bootstrap wizard — run theirs:**
>
> ```bash
> npx storybook ai setup     # detects framework/renderer/builder/addons, writes preview +
>                            # decorators + global styles, generates ~10 stories tagged for review
> ```
> Doc: `storybook.js.org/docs/ai/setup` — fetch it live (MCP `get-documentation` or WebFetch)
> rather than trusting this file; their onboarding moves faster than we can mirror.
>
> **What this reference is FOR (the parts docs under-cover) — the align + verify layer:**
> 1. **Detect** framework + MCP support, and whether Storybook already exists (scan & adopt — never impose).
> 2. **Defer** the install to `npx storybook ai setup` (or `npx storybook@latest init --yes` if the AI flow isn't available).
> 3. **Validate the result aligns** — the genuinely under-documented bits below: `viteFinal` plugin-strip (Phase 4b), provider-decorator detection (Phase 4), MCP wiring + restart (Phase 6), width-constraint + viewport presets (Phase 4c).
>
> The 5 interview questions below are now **optional** — only ask one if the AI setup left the
> choice open (taxonomy, Labs section). Skip anything `npx storybook ai setup` already decided.
> Wrapper tiers (old Q5) are **on-demand**, pulled in during Compose/Flow work — NOT an install question.

**Verified against:** Storybook 10.4.1 + Vite 8 + React 19 + Node 24 sandbox on 2026-05-26. See `docs/publishing/storybook-mcp-verification.md` for the live verification report.

## When to load this reference

- User asked for Storybook help in a project where Storybook is not installed
- User typed "set up Storybook", "add Storybook", "make a Storybook", "Storybook this app"
- SKILL.md Step 1 pre-flight check detected:
  - No `.storybook/main.ts` or `.storybook/main.js`
  - No `@storybook/*` packages in `package.json` devDependencies

If Storybook IS installed and just needs MCP wiring, skip Steps 3-5 and jump to Step 6.

## Phase 1 — Detect project state

Run these checks in parallel (one Bash call where possible):

```bash
# Framework + builder
cat package.json | python3 -c "import json,sys; d=json.load(sys.stdin); deps={**d.get('dependencies',{}),**d.get('devDependencies',{})}; print('react' if 'react' in deps else 'vue' if 'vue' in deps else 'svelte' if '@sveltejs/kit' in deps or 'svelte' in deps else 'unknown'); print('vite' if 'vite' in deps else 'webpack' if 'webpack' in deps else 'next' if 'next' in deps else 'unknown')"

# UI library
test -f components.json && echo "shadcn-detected"
grep -l "@radix-ui" package.json && echo "radix-detected"
grep -l "@mui/material" package.json && echo "mui-detected"

# CSS strategy — Tailwind v4 has NO JS config (config lives in CSS via @theme).
# Check dep first, then config files. Both must be considered.
grep -qE '"(@tailwindcss/vite|tailwindcss)"' package.json && echo "tailwind-detected" || echo "no-tailwind"
test -f tailwind.config.js -o -f tailwind.config.ts -o -f tailwind.config.mjs && echo "tailwind-v3-config-detected" || echo "no-tailwind-v3-config (may be Tailwind v4 with CSS-only config)"
grep -l "styled-components" package.json 2>/dev/null && echo "styled-components-detected" || echo "no-styled-components"

# Theme provider — explicit fallback so "nothing found" is unambiguous
THEME=$(grep -rEl "ThemeProvider|createTheme|<ThemeContext" src/ 2>/dev/null | head -3)
[ -n "$THEME" ] && echo "theme-provider-detected: $THEME" || echo "no-theme-provider"

# Router — explicit fallback
grep -lE 'react-router-dom|"next/router"|@tanstack/router|@inertiajs/react' package.json 2>/dev/null && echo "router-detected" || echo "no-router"

# Query client — explicit fallback
grep -lE '"@tanstack/react-query"|"swr"' package.json 2>/dev/null && echo "query-client-detected" || echo "no-query-client"

# Node version (Storybook 10 needs >= 20.16)
node --version

# Existing Storybook?
test -d .storybook && echo "STORYBOOK_EXISTS" || echo "NO_STORYBOOK"
grep -l "\"storybook\":" package.json && grep -oE '"storybook": *"\^?[0-9]+' package.json
```

Print a state summary to the user. Example:

```
✓ Project: React 19 + Vite 8 + TypeScript
✓ UI library: shadcn/ui detected (components.json present)
✓ CSS: Tailwind v4
✓ Theme provider: src/providers/theme-provider.tsx
✓ Router: react-router-dom
✓ Query client: @tanstack/react-query
✗ Storybook: NOT installed
✓ Node: v24.9.0 (compatible with Storybook 10+)

Ready to install Storybook 10.4 + addons.
```

## Phase 2 — Interview (only when state is ambiguous)

Skip questions whose answers you can infer. Ask only what's genuinely a designer / dev choice. Use `AskUserQuestion` for each — single-select for Q1/Q2/Q3, multi-select for Q4.

### Question 1 — Production taxonomy

Only ask if no `.storybook/preview.ts` storySort exists yet.

> What's the production structure for your Storybook? (Top-level sidebar groups, governed by `storySort.order`.)
> - **Foundations / Components / Pages / Flows** — design-system project, atomic-design vocabulary (recommended for shadcn / component-library work)
> - **UI / Features / Pages** — SaaS app, features mapped to product surface
> - **Sections / Blocks / Pages** — marketing site, section-based composition
> - **Custom** — type your own (e.g., `Atoms / Molecules / Organisms / Templates`)

Write the choice into `storySort.order` in `preview.ts` (see Phase 4). For full worked taxonomies see `references/directory-structure.md`.

### Question 2 — Playground / Labs section

Ask after Q1. The Labs section runs *alongside* production stories — disk-isolated, tag-isolated, hidden from autodocs + CI. It's where designers prototype interactions, motion experiments, and cleaned-up component variants without polluting app code.

> Do you want a playground section for experiments, motion prototyping, and Figma-replacement interaction sketches? If yes, what should it be called?
> - **`Labs/`** — neutral, widely understood (recommended)
> - **`Sandbox/`** — playful, common in design-tool teams
> - **`Playground/`** — most explicit about purpose
> - **`Experiments/`** — formal, common in research-driven teams
> - **Skip** — no playground section for now (you can add one later)
> - **Custom** — type your own (e.g., `WIP`, `Drafts`, `Spike`)

If the user picks a name, append it to `storySort.order` AFTER the production sections (so Labs appears at the bottom of the sidebar). Disk layout: `src/stories/labs/<topic>/<experiment>.stories.tsx`. Tag conventions and full workflow live in `references/labs-workflow.md` — load that file after install when the user starts using Labs.

### Question 2.5 — Galleries section

Ask after Q2. Galleries are tag-driven aggregator views — one canvas showing every story matching a tag (e.g., "every empty state across the app"). They turn Storybook into a cleanup-audit tool. Full workflow + Anton's wrapper code in `references/galleries-and-tags.md`.

> Add a `Galleries/*` section for tag-driven audit views? Galleries aggregate stories by tag (state / loading / error / etc.) on one canvas — turns Storybook into a consistency-audit tool.
> - **Yes — add Galleries** (recommended for projects with >20 stories or known consistency drift)
> - Skip — not now

If yes, append `'Galleries'` to `storySort.order` after Labs. The skill will scaffold `src/stories/TagGallery.tsx` and a starter `src/stories/galleries/EmptyStateGallery.stories.tsx` during Phase 4.

### Question 2.7 — Tag taxonomy strategy

Ask after Q2.5. Determines which tag layers the project uses (see `references/galleries-and-tags.md` for the 4-layer model). Multi-select.

> Which tag layers will your stories use? (Multi-select — most projects use 2-3.)
> - **`autodocs`** — controls whether a story appears in the auto-generated docs page (always recommended)
> - **Audience tags** — e.g., `'platform'` / `'public'` / `'admin'` — sidebar filter by user-segment (recommended for multi-audience apps)
> - **State tags** — e.g., `'empty-state'` / `'loading'` / `'error'` — feeds Galleries (recommended if Q2.5 = yes)
> - **Track tags** — e.g., `'labs'` / `'wip'` / `'ai-generated'` — production-vs-experiment (recommended if Q2 = yes)
> - **Layout tags** — e.g., `'list'` / `'form'` / `'detail'` — secondary audit layer (advanced)
> - **Flow tags** — e.g., `'onboarding'` / `'checkout'` — for multi-step galleries (advanced)

Write the chosen layers + example values into `.storybook/README.md` so the team uses the same convention.

### Question 3 — MCP wiring

Only ask if running Claude Code or another MCP-capable agent.

> Wire Storybook MCP to your AI agent? This unlocks 6 tools (`list-all-documentation`, `get-documentation`, `preview-stories`, `run-story-tests`, etc.) that make AI-assisted story authoring much faster.
> - **Yes** (recommended for React + Vite projects)
> - No / skip for now

### Question 4 — Optional addons

Only ask if no clear winner from detection. Multi-select.

> Additional Storybook addons to install? (init bundles a11y, docs, vitest, Chromatic.)
> **Optional — for interaction matrices only (the "full picture" bundle):**
> - `storybook-addon-pseudo-states` — hover/focus/active toggles in the toolbar. **OPTIONAL, not a prerequisite** for state coverage: every prop-based state story (disabled, loading, empty…) works without it; this addon only makes the hover/focus/active *columns* of a `<StateGrid>`/`<StateMatrix>` interaction matrix render real. Pull it in **only when you build an interaction matrix**, not by default. Use the **official** package `storybook-addon-pseudo-states` (maintained by the Storybook team, version-matched to your Storybook — verify with `npm view storybook-addon-pseudo-states maintainers`), NOT the third-party `@hover/storybook-addon-pseudo-states` fork.
> - `@storybook/addon-designs` — Figma frame embedded next to the story for side-by-side compare (used by `references/figma-to-storybook.md`)
> - `@storybook/addon-themes` — light/dark switcher. **Auto-wired in the align step (item 12) for ANY themed project** (next-themes / `.dark` / `data-theme`), not just a manual pick — only surfaces here for theme-less projects. `@storybook/addon-a11y` is already in the `storybook init` bundle (Phase 3) — confirm, don't re-add.
> - `@storybook/addon-measure` + `@storybook/addon-outline` — layout debug (box-model overlay + element outlines)
> - `msw-storybook-addon` — MSW handlers as Storybook parameters (production-grade data-layer mocking — see `references/factory-patterns.md`)
>
> **Other:**
> - `storybook-design-token` — token doc-blocks (if you have `.design-system/tokens.css`)
>
> **Candidate (pending project validation — DO NOT auto-install yet):**
> - `@geometricpanda/storybook-addon-badges` — visual sidebar/canvas badges for lifecycle tags. Original-maintainer scoped namespace. See `references/lifecycle-tags.md` for the validation tasks before recommending. The skill defaults to tag-only + optional decorator banner (zero new dependencies).
>
> **⚠️ Do NOT install `storybook-addon-badges` (unscoped)** — that package is under a different maintainer (`tetarchus`), not the original `geometricpanda` namespace. Run `socket-scan` if you need to evaluate it.

### Question 5 — Wrapper library (v1.7)

Optional but recommended for Compose-mode-heavy projects:

> Scaffold the Storybook-only wrapper library? The wrappers (`ABCanvas`, `StateGrid`, `TrackedDecision`, `DecisionsDashboard`, etc.) replace hand-rolled A/B grids and provide consistent decision tracking. They live in `.storybook/wrappers/` — never bundle to your app.
>
> - **Tier 1 (CORE, 3 wrappers):** ABCanvas, StateGrid, StateMatrix — the universal structural views
> - **Tier 2 (+ EXTENDED, 7 wrappers):** add StorySet (Anton extension), StoryStrip, plus the opt-in decision pair TrackedDecision + DecisionsDashboard
> - **Tier 3 (+ ADVANCED, 10 wrappers):** add ShaderCanvas (WebGL), R3FCanvas (requires `@react-three/fiber`), MotionStage
> - **Skip** — opt out for now

Run after Storybook is installed:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 1   # or --tier 2 / --tier 3
```

The scaffolder auto-generates a barrel `index.ts`. Re-run anytime with `--force` to update. See `references/wrapper-library.md` for the full API.

## Phase 3 — Install Storybook

### Path A — Fresh install (no Storybook present, Vite + React, Node ≥ 20.16)

```bash
# This takes ~3 minutes — Playwright browser binaries dominate the time.
# Set user expectation explicitly before running.
npx storybook@latest init --yes
```

After completion, verify what got installed:

```bash
grep -E "\"@storybook|storybook" package.json | head -20
ls .storybook/
```

Expected (10.4.1 init bundles these — DO NOT re-add separately):

```
storybook@^10.4.1
@storybook/react-vite@^10.4.1
@storybook/addon-mcp@^0.6.0           ← bundled, no separate install needed
@storybook/addon-vitest@^10.4.1
@storybook/addon-a11y@^10.4.1
@storybook/addon-docs@^10.4.1
@chromatic-com/storybook@^5.2.1
```

### Path B — Add optional addons selected in Phase 2 Q4

Only run the ones the user explicitly opted into. **Default recommendation for "full picture" interactive prototyping** is the four lines below — they don't pull in the badges addon (which stays opt-in pending validation).

```bash
# "Full picture" recommended bundle:
npm install --save-dev storybook-addon-pseudo-states   # official Storybook-team package; only if building interaction matrices
npx storybook@latest add @storybook/addon-designs
npx storybook@latest add @storybook/addon-themes
npx storybook@latest add @storybook/addon-measure
npx storybook@latest add @storybook/addon-outline

# Optional / less common:
npm install --save-dev storybook-design-token
npm install --save-dev msw-storybook-addon
```

Notes:
- **Pseudo-states package correction (field-verified 2026-06-01):** use the **official** `storybook-addon-pseudo-states` (npm shows it at the Storybook version, maintainers `ndelangen`/`ghengeveld`/`jreinhold`/`storybook-bot` = the Storybook team). The `@hover/storybook-addon-pseudo-states` fork (v1.x, hover.to) is the third-party one — do NOT use it. (Earlier drafts of this wizard had these inverted.) It's **optional**, for interaction matrices only.
- `@geometricpanda/storybook-addon-badges` is intentionally NOT in this list yet — see Phase 2 Q4 above. Use the tag-only default or the decorator banner pattern in `references/lifecycle-tags.md` until the addon is validated on a real project.

### Path C — Storybook already present but stale (< 10.3)

```bash
npx storybook@latest upgrade
```

If upgrade fails or user prefers, recommend `npx storybook@latest migrate csf-2-to-3` first.

### Path D — Non-Vite project (Webpack, Next App Router) or non-React (Vue/Angular/WC)

Webpack still works for Storybook itself, but MCP requires Vite. Run init, skip MCP wiring in Phase 5, route the user to the Without-MCP path in `references/without-mcp.md` for story authoring.

```bash
npx storybook@latest init --yes  # detects framework + builder automatically
```

### Path E — Node too old (< 20.16)

Bail. Don't try to install — Storybook 10 will fail or break later in subtle ways.

```
✗ Node v18.x detected — Storybook 10 requires v20.16+, v22.19+, or v24+.
  Run: brew install node@22 (or your Node manager equivalent).
  Then come back and try again.
```

## Phase 4 — Configure preview.tsx with detected decorators

Read the existing `.storybook/preview.tsx` (init creates one with minimal parameters). Augment it with decorators based on detected providers.

**Detection → decorator mapping (framework-agnostic):**

The pattern is the same regardless of which provider is present: detect it, generate a decorator that wraps the story in that provider, then include only decorators for providers actually detected.

| Detected (by import / config / file) | Decorator pattern |
|---|---|
| Theme provider — `next-themes`, `@mui/material/styles`, `@chakra-ui/react`, custom `ThemeProvider` | Wrap in the detected theme provider; expose `theme` global if dual-theme exists |
| Router — `react-router-dom`, `react-router` v7 | `MemoryRouter` decorator |
| Router — `next/router`, `next/navigation` | `next-router-mock` OR `@storybook/nextjs-vite`'s built-in mock |
| Router — `@tanstack/react-router` | Manual route stub (TanStack doesn't have a Storybook addon yet) |
| Router — `@inertiajs/react` | Mock `useForm`/`usePage` via Inertia-aware decorator (project-specific) |
| Query client — `@tanstack/react-query`, `swr` | Wrap in the client's Provider with a fresh client per story |
| Portal-using UI lib — Radix UI, headless UI, shadcn, Ariakit | Ensure portal root exists OR attach portals to `canvasElement.ownerDocument.body` |
| Global CSS — Tailwind, vanilla CSS, CSS Modules root, styled-components ThemeProvider | Import the project's global CSS into preview.tsx (path varies — detect from main App entry) |
| i18n — `react-intl`, `react-i18next`, `next-intl` | Wrap in `IntlProvider` / `I18nextProvider` with a default locale; expose `locale` global if multi-locale |
| Auth — `next-auth`, custom AuthContext | Provide a mock authenticated session; expose `authState` global if you want logged-in/out variants |

**Docs-page composition — put the real-usage band on top (the audit answer before the playground).**
Autodocs lets you define the Docs layout via `parameters.docs.page`. Compose the standard blocks and drop
the `UsageSection` block (scaffolded with the wrappers; reads `component-usage.json` + `project-inventory.json`)
**near the top** so every component's Docs — and the `Foundations/Colors` / `Foundations/Typography` Docs —
open with "Real usage in this app", then the playground:

```tsx
// .storybook/preview.tsx
import { Title, Subtitle, Description, Primary, Controls, Stories } from '@storybook/addon-docs/blocks';
import { UsageSection } from './wrappers/UsageSection';
// parameters.docs.page = () => (<><Title/><Subtitle/><UsageSection/><Description/><Primary/><Controls/><Stories/></>)
// Order is yours: UsageSection here = top status band; move it last for the bottom. It renders nothing
// until the usage JSONs exist (run inventory + extract-component-usage), so it's safe to wire at setup.
```

**Ten non-obvious things to get right** when generating `preview.tsx` (items 1–6 verified against a real production setup, 191 stories; 7–8 adopted from Storybook's own `npx storybook ai setup` prompt; 9 from a real dark-theme canvas bug — centered stories rendered a dark sliver in a white field; 10 from a real layout bug — a global decorator forced every story to 100vh, burying primitives in whitespace):

1. **Import the project's global CSS** (`import '../src/index.css'` or wherever the entry stylesheet lives — detect from the main `App.tsx`/`main.tsx` import). Without this, Tailwind / CSS Modules / any styled project renders stories *unstyled*. This is the #1 silent failure.
2. **Wrap in detected providers innermost-first** in the `decorators` array, using each provider's actual import path. For dual-theme projects, expose `theme` as a global so the toolbar can switch. For TanStack Query, instantiate `new QueryClient({ defaultOptions: { queries: { retry: false } } })` outside the decorator (one client across stories).
3. **Set `storySort.order` from the Phase 2 Q1 + Q2 choices.** Production sections first, the Labs name (if chosen in Q2) appended at the end. Example for Foundations/Components/Pages/Flows + Labs:

```ts
options: {
  storySort: {
    order: ['Foundations', 'Components', 'Pages', 'Flows', 'Labs'],
    method: 'alphabetical',
  },
}
```

If the user picked Sandbox/Playground/Experiments/Custom in Q2, substitute that name for `Labs`. If they skipped Q2, drop the final entry. If the user added Galleries via Q2.5 (see Phase 2), append `'Galleries'` after `'Labs'`.

4. **Viewport presets.** Mobile / mobile-large / tablet / desktop. Designers reach for these constantly:

```ts
parameters: {
  viewport: {
    options: {
      mobile: { name: 'Mobile', styles: { width: '375px', height: '667px' } },
      mobileLarge: { name: 'Mobile Large', styles: { width: '414px', height: '896px' } },
      tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } },
      desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' } },
    },
  },
}
```

5. **a11y test mode = `'todo'` (non-blocking).** Three valid values: `'todo'` shows violations in test UI but doesn't fail CI; `'error'` fails CI on any violation; `'off'` skips entirely. Default to `'todo'` — projects with a backlog can adopt accessibility iteratively without CI gridlock. Switch to `'error'` once the codebase is clean.

```ts
parameters: { a11y: { test: 'todo' } }
```

6. **`! Prefix` sort hack for "force to bottom."** Storybook's storySort sorts alphabetically within each group; to push a specific item to the END (e.g., Legal pages, archived docs), prefix the title with `! ` — `! Legal` sorts after `Z`:

```ts
storySort: {
  order: ['Public Pages', ['Blog', 'Instructors', '! Legal']],
  method: 'alphabetical',
}
```

The skill's job is to detect what's there and generate the right wrapper, not to assume a specific stack — MUI uses `MuiThemeProvider`, Chakra uses `ChakraProvider`, Emotion uses `ThemeProvider from @emotion/react`. Strip wrappers you didn't detect.

7. **Pin determinism the *app itself* reads, in a `beforeEach`.** If discovery found a component reading `Date.now()` / `new Date()` for a relative label, or `localStorage`/`sessionStorage` on mount, you can't lift that to a prop without forking the component. Seed it once, globally, and seed **only** what the app actually reads:

```ts
const preview: Preview = {
  // ...decorators, loaders, parameters...
  async beforeEach() {
    localStorage.setItem('theme', 'dark')        // only the key the app reads
    MockDate.set('2024-04-10T12:00:00Z')         // pin "now" so relative dates are literal
    return () => MockDate.reset()                 // restore after each story
  },
}
```

This is what lets a relative-date or theme-aware `play` assert literal text (`"Added 2 days ago"`, `aria-pressed="true"`) without flaking run-to-run. (Pairs with `anti-patterns.md` #26 — that one covers nondeterminism the *story* introduces; this covers nondeterminism the *component* introduces.) Requires `mockdate` as a dev dep; skip the `MockDate` line if no component reads the clock.

8. **`Edit` the init-generated `preview.tsx`, never `Write` over it — and emit exactly one `CssCheck`.** `storybook init` already created `.storybook/preview.tsx`; treat it as existing (read it, then `Edit` to augment) so you don't clobber the storySort or parameters init seeded. Separately, the strongest single signal that this whole preview is wired correctly is **one** `CssCheck` story (see `anti-patterns.md` #33): a `play` asserting a concrete `getComputedStyle` token value. Add exactly one, typically on the primary Button. If `index.css` didn't reach the iframe (the #1 silent failure, item 1), that one story goes red and tells you immediately — every other story would have silently rendered unstyled-but-green.

9. **A class-based dark theme must theme the CANVAS ROOT, not just a decorator `<div>`.** When the theme toggles a class (`.dark` on `<html>`) and colors come from CSS vars, a decorator that paints only its own wrapper leaves the Storybook canvas (`body` / `.sb-show-main`) at its default white. Two layout-dependent bugs result: `layout: 'centered'` stories show a **dark sliver in a white field** (the wrapper shrinks to content width), and `padded`/`fullscreen` stories show a **white frame around dark content** (the canvas padding/body shows through). The decorator already puts `.dark` on `<html>`, so fix it once at the root in `.storybook/preview-head.html`:

```html
<style>
  /* Theme the canvas itself so dark mode fills every layout, not just the story wrapper. */
  html, body, .sb-show-main { background: var(--color-background); color: var(--color-foreground); }
  html.dark { color-scheme: dark; }  /* native scrollbars / select dropdowns follow the theme */
</style>
```

Verify by opening any `centered` story (e.g. Badge) in dark mode — the whole canvas should be dark, not a strip. Skip this item for projects with no dark theme. **Gate it:** fold a `.sb-show-main` background assertion into the one `CssCheck` play so this can't regress silently — see the dark-mode canvas criterion in `native-ai-setup-prompt.md` §3 (Done when).

10. **The global frame decorator must FOLLOW the story's `layout`, never force `100vh` on everything.** A decorator that blanket-applies `minHeight: 100vh` buries primitives (Badge, Button) in a viewport-tall box of whitespace and reads badly in autodocs. Ship **`withLayoutFrame`** (`.storybook/decorators/withLayoutFrame.tsx`, scaffolded by `scaffold-wrapper.sh` alongside the wrappers) and register it **last** in `decorators`: it fills the viewport only when the story opts in (`layout: 'fullscreen'` or `parameters: { fillViewport: true }`) and lets `centered`/`padded` stories shrink-wrap. Set per-story `layout`: `'centered'` for primitives, `'fullscreen'` for pages and the report wrappers (ProjectInventory / DesignSystemHealth / …), `'padded'` (the default) for the rest.

   ```ts
   import { withLayoutFrame } from './decorators/withLayoutFrame';
   const preview = { decorators: [/* providers… */, withLayoutFrame], parameters: { layout: 'padded' } };
   ```

   The theme **background** is item 9's job (the canvas root), NOT this decorator — painting a bg here for `centered` stories re-creates the dark-sliver bug. Full layout matrix + the `fillViewport` prop for embedding report wrappers inside another view: `references/wrapper-library.md` "Layout & previews". **Gate it:** a `centered` primitive (e.g. Badge) must not be forced to viewport height — assert it in the `CssCheck` play (see `native-ai-setup-prompt.md` §3, Done when).

11. **A bare-OKLCH / shadcn-channel project needs a `--color-*` bridge** (the #1 "first run looked broken" gap on OKLCH design systems). The workbench wrappers theme via the Tailwind-v4 `--color-*` namespace (`--color-background`, `--color-surface`, `--color-border-subtle`, …). A project that stores colors as **bare channel triplets under shadcn's own names** — `:root { --background: 0.99 0.003 234; --card: 0.97 0.004 234; --foreground: 0.30 0.02 234 }` (no `oklch()` wrapper, no `--color-*`) — leaves every `--color-*` ref undefined, so surfaces render unstyled and inputs go invisible. The wrappers carry literal fallbacks so they *degrade* readably, but to render the **project's real theme** you must bridge the namespaces.

    **Detect** (don't assume — verify all three):

    ```bash
    test -f components.json && echo "shadcn"                                   # shadcn project
    grep -qE '^\s*--background:\s*[0-9.]+\s+[0-9.]+\s+[0-9.]+' src/**/*.css 2>/dev/null \
      && echo "bare-channel-tokens"                                            # values are L C H triplets, not oklch(...)
    grep -rqE '^\s*--color-background:' src/ 2>/dev/null && echo "has-color-namespace" || echo "NO-color-namespace"
    ```

    If `shadcn` + `bare-channel-tokens` + `NO-color-namespace` → generate the bridge into `.storybook/preview-head.html` (same file as item 9). One `:root` block covers **both** modes: custom-property substitution is lazy, so `--color-background: oklch(var(--background))` declared once at `:root` automatically picks up `.dark`'s redefined `--background` for elements under `.dark` (shadcn already swaps the bare tokens there — don't duplicate the block).

    ```html
    <style>
      /* Bridge bare shadcn channel tokens → the Tailwind-v4 --color-* namespace the wrappers theme on.
         oklch(var(--x)) wraps a bare "L C H" triplet into a valid color. One :root block = both modes
         (the bare --* already swap under .dark; substitution is resolved at use, so this inherits it). */
      :root {
        --color-background: oklch(var(--background));        --color-foreground: oklch(var(--foreground));
        --color-card: oklch(var(--card));                    --color-card-foreground: oklch(var(--card-foreground));
        --color-popover: oklch(var(--popover));              --color-popover-foreground: oklch(var(--popover-foreground));
        --color-primary: oklch(var(--primary));              --color-primary-foreground: oklch(var(--primary-foreground));
        --color-secondary: oklch(var(--secondary));          --color-secondary-foreground: oklch(var(--secondary-foreground));
        --color-muted: oklch(var(--muted));                  --color-muted-foreground: oklch(var(--muted-foreground));
        --color-accent: oklch(var(--accent));                --color-accent-foreground: oklch(var(--accent-foreground));
        --color-destructive: oklch(var(--destructive));
        --color-border: oklch(var(--border));                --color-input: oklch(var(--input));   --color-ring: oklch(var(--ring));
      }
    </style>
    ```

    Emit only the lines whose bare token the project actually declares (grep `:root` first; a missing `--popover` makes `oklch(var(--popover))` empty → that surface stays transparent). If the project already wraps its values in `oklch()` (`--background: oklch(0.99 0.003 234)`), it's NOT this dialect — `oklch(oklch(...))` is invalid; skip the bridge (the native `@theme` already exposes `--color-*`). **Gate it:** fold a `--color-background` resolution check into the one `CssCheck` play so a regressed/missing bridge goes red instead of silently rendering generic.

12. **Theme switching — wire `@storybook/addon-themes` for any themed project (not an optional extra).** A themed app with no toolbar switch opens stuck in one mode — the reviewer then hand-adds a `globalTypes.theme` + `forcedTheme`, which is exactly what the official addon does, version-matched. Detect a theme mechanism, then register the decorator that toggles the **same class** items 9 + 11 paint on (so one switch re-skins the canvas, the bridge, and the wrappers' live re-read together — no parallel theme state).

    **Detect** (any one → wire it):

    ```bash
    grep -rqE "next-themes|ThemeProvider|attribute=\"class\"" src/ 2>/dev/null && echo "class-theme (.dark)"
    grep -rqE "data-theme" src/ 2>/dev/null && echo "data-attr theme"
    ```

    **Wire** — `@storybook/addon-themes` in `.storybook/main.ts` `addons`, then in `preview.tsx` (class-based `.dark`, the common case):

    ```ts
    // .storybook/preview.tsx
    import { withThemeByClassName } from '@storybook/addon-themes'

    export const decorators = [
      withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
      // …withLayoutFrame stays LAST (item 10)
    ]
    ```

    It toggles `class="dark"` on the preview `<html>` — the identical hook the canvas-root theming (item 9) and the `--color-*` bridge (item 11) key off, so they all flip together; the wrappers' `MutationObserver` re-reads token values on the switch with no extra wiring. For `data-theme` projects use `withThemeByDataAttribute` instead. Don't ALSO define a `globalTypes.theme` — that's a second, conflicting switch. `@storybook/addon-backgrounds` is a separate, optional add for surface-on-surface contrast checks; viewport presets are item 4, not this. **Gate it:** the one `CssCheck` play already asserts the dark canvas (item 9) — that doubles as proof the toggle re-skins.

## Phase 4b — `viteFinal` adapter for Storybook-vs-project Vite quirks

Storybook builds with its own Vite config. Many production projects have Vite plugins that **break Storybook's standalone build** — Rails (`vite-plugin-ruby`), React Compiler (`vite:react` with React 19), Next.js plugins for Server Components. The fix is `viteFinal` in `.storybook/main.ts`:

```ts
// .storybook/main.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  // ... stories, addons, framework ...
  viteFinal: async (config) => {
    // Remove project-specific plugins that break Storybook's standalone build.
    config.plugins = config.plugins?.flat().filter((plugin) => {
      if (!plugin || typeof plugin !== 'object' || !('name' in plugin)) return true;
      const name = plugin.name as string;
      return (
        !name.startsWith('vite:react') &&        // strip React Compiler — works differently in Storybook
        !name.startsWith('vite-plugin-ruby')     // strip Rails plugin — breaks Storybook output
      );
    });

    // Re-add plain React plugin (without compiler) + SVGR support.
    config.plugins?.push(react());
    config.plugins?.push(svgr());

    // Alias project paths for Storybook resolution.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@': path.resolve(__dirname, '../app/frontend'),
      // Alias data-layer SDKs to Storybook mocks (see factory-patterns.md):
      '@inertiajs/react': path.resolve(__dirname, './mocks/inertia-react'),
      '@plausible-analytics/tracker': path.resolve(__dirname, './mocks/plausible-tracker'),
    };

    return config;
  },
};

export default config;
```

**When to add this:**

| Detected plugin in project's `vite.config.ts` | Action in `viteFinal` |
|---|---|
| `vite-plugin-ruby` (Rails) | Strip — breaks Storybook bundling |
| `vite:react` with React Compiler enabled (`babel: { plugins: [['babel-plugin-react-compiler', ...]] }`) | Strip + re-add plain `@vitejs/plugin-react` |
| `next/vite-plugin` (Next.js App Router) | Strip — Storybook has its own Next.js framework integration via `@storybook/nextjs-vite` |
| `@vitejs/plugin-react-swc` | Usually keep, but verify React Compiler isn't on |
| SVG imports via `?react` syntax | Add `svgr()` |
| Path aliases (`@/`, `@components/`) | Mirror in `config.resolve.alias` |
| Data-layer SDK that needs Storybook mock | Alias in `config.resolve.alias` to `.storybook/mocks/<sdk>.tsx` |

This is genuinely under-documented — Storybook's docs cover `viteFinal` but don't list the common project-specific patches needed. The detection-and-patch flow is project-by-project; this table is the cheat sheet.

## Phase 4c — Width-constraint decorator recipe

Production projects routinely need a story to render at a constrained width (a component that's normally on a 1200px-wide page but should be reviewed at the actual page width, not the full Storybook canvas). The minimal recipe:

```tsx
// Per story:
const meta = {
  // ...
  decorators: [
    (Story) => <div className="mx-auto max-w-3xl">{Story()}</div>,
  ],
} satisfies Meta<typeof MyComponent>;
```

Or for a specific story only:

```tsx
export const InContext: Story = {
  decorators: [
    (Story) => <div className="mx-auto max-w-3xl px-4">{Story()}</div>,
  ],
  args: { /* ... */ },
};
```

**Why this beats `parameters: { layout: 'padded' }`:** layout sets the *Storybook canvas chrome* (centered / padded / fullscreen). The width-constraint decorator sets the *story container width* independent of canvas chrome. Designers reviewing a card-on-a-list-page can see "this card at the width it ships at" without changing canvas behavior. a production app uses this pattern in 65 of 191 stories — it's worth documenting in the project's `.storybook/README.md` as the standard.

## Phase 4d — `manager.ts` so the Controls panel shows by default

Storybook ships **no `manager.ts`**, so panel visibility is purely browser-stored UI state. One
accidental `A` keypress (or a dragged-closed divider) hides the addons panel — Controls, Actions,
Interactions, Accessibility — and persists "hidden" in localStorage. The story still renders, so a
reviewer or agent sees a component with no Controls and wrongly concludes the stories aren't wired.
Write a `manager.ts` to make the panel the enforced default:

```ts
// .storybook/manager.ts
import { addons } from "storybook/manager-api"

// Controls / Actions / Interactions / Accessibility visible by default. The Controls panel is where
// sb-stories' argTypes surface, so this is what makes that authoring work reviewable.
addons.setConfig({
  showPanel: true,
  panelPosition: "bottom",
})
```

Note: `setConfig` sets the *default*; a browser that already stored "panel hidden" keeps that until the
user presses `A` once (or clears the manager's localStorage). New clones, incognito, and agents get the
panel from the start. `sb-audit`'s `audit-controls.sh` warns when this file is missing or omits `showPanel`.

## Phase 5 — Configure main.ts addons + toolset

If user opted into addons in Phase 2 Q3, ensure they're in `.storybook/main.ts`. The init already added the bundled ones — only modify if the user added something.

Toolset toggle for `@storybook/addon-mcp` (optional, all on by default):

```ts
// .storybook/main.ts
addons: [
  '@chromatic-com/storybook',
  '@storybook/addon-vitest',
  '@storybook/addon-a11y',
  '@storybook/addon-docs',
  {
    name: '@storybook/addon-mcp',
    options: { toolsets: { dev: true, docs: true, test: true } },
  },
],
```

## Phase 6 — Wire MCP to Claude Code (if Vite + React + user opted in at Phase 2 Q2)

Skip this entire phase if:
- User declined MCP at Phase 2 Q2
- Project is non-Vite (Webpack)
- Project is non-React (Vue/Angular/WC — MCP not supported yet)

### Start Storybook in background, read the actual port

```bash
# Start in background, redirect output so we can parse the banner
npm run storybook -- --ci > /tmp/sb-banner.log 2>&1 &
SB_PID=$!

# Wait for the banner — try for up to 90s
for i in $(seq 1 45); do
  if grep -q "Storybook ready" /tmp/sb-banner.log 2>/dev/null; then break; fi
  sleep 2
done

# Extract the actual port (handles auto-fallback from 6006 → 6007 → ...)
PORT=$(grep -oE "localhost:[0-9]+" /tmp/sb-banner.log | head -1 | cut -d: -f2)

echo "Storybook running on port $PORT (PID $SB_PID)"
```

### Wire to your agent — detect first

```bash
# Detect which agent is running the wizard
which claude 2>/dev/null && echo "CLAUDE_CODE_PRESENT"
which codex 2>/dev/null && echo "CODEX_PRESENT"
test -d .cursor 2>/dev/null && echo "CURSOR_PROJECT_PRESENT"
```

| Agent | Command |
|---|---|
| **Claude Code** | `claude mcp add storybook-mcp --transport http http://localhost:$PORT/mcp --scope project` |
| **Codex CLI** | `codex mcp add storybook-mcp --transport http http://localhost:$PORT/mcp` (Codex's `mcp` subcommand manages external MCP servers) |
| **Cursor** | Edit `~/.cursor/mcp.json` (or `<project>/.cursor/mcp.json`) and add: `{"mcpServers":{"storybook":{"type":"http","url":"http://localhost:<PORT>/mcp"}}}` |
| **None of the above** | Skip — tell the user to fall back to `references/without-mcp.md` |

Run the command for whichever agent is detected. If multiple are present, ask the user which one they're working in (use `AskUserQuestion` if available).

### Tell the user

> Storybook MCP is wired to `http://localhost:$PORT/mcp`. **Restart your agent (Claude Code / Codex / Cursor) in this project directory** to load the 6 MCP tools (`list-all-documentation`, `get-documentation`, `preview-stories`, `run-story-tests`, etc.). Until you restart, this session won't see the new tools — but the wiring will persist.

## Phase 7 — Verify

### MCP path

After restarting the agent in this directory, ask it to list its tools — you should see `list-all-documentation`, `get-documentation`, `preview-stories`, `run-story-tests`, plus 2 more. If those don't appear, see "Storybook starts but `/mcp` endpoint returns 404" under failure modes.

### Smoke test a story

If Storybook init created the demo Button/Header/Page stories, they should already render:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/iframe.html?id=example-button--primary"
# Expect 200
```

## Phase 8 — Report + hand off

Print a structured summary:

```
✓ Storybook 10.4.1 installed (~3 min)
✓ Addons: @storybook/addon-mcp, addon-vitest, addon-a11y, addon-docs, Chromatic
✓ Decorators wired: ThemeProvider, MemoryRouter, QueryClientProvider
✓ Story sort: Foundations → Components → Pages → Flows → Labs
✓ MCP wired: http://localhost:6007/mcp (6 tools available after Claude Code restart)
✓ Demo stories present at /iframe.html?id=example-button--primary

What's next:
• Restart Claude Code in this project directory for MCP tools to load
• Write component stories: this skill handles it (SKILL.md Step 2 onward)
• For design system extraction (audit + tokens + components): run `/ds-runbook`
• For test infrastructure (VRT + a11y + interaction): run `/ds-test-setup`
• Delete the demo Button/Header/Page stories after you write real ones
```

## Failure modes — what to do when things break

### "Storybook init failed midway"

Check the logs Storybook printed. Most common causes:
- Network failure during Playwright download → re-run, the install is idempotent
- Pre-existing `.storybook/` from a previous attempt → `rm -rf .storybook/` then retry
- Permissions issue → check `node_modules/` ownership

### "Port 6006 taken, banner shows different port"

Expected — Storybook auto-falls back. Always use the port from `grep "localhost" /tmp/sb-banner.log`, never hardcode 6006.

### "`claude mcp add` says command not found"

The user doesn't have Claude Code installed or it's not in PATH. Skip Phase 6. Tell the user: "MCP wiring requires Claude Code. Without it, use `references/without-mcp.md` for manual story authoring."

### "Storybook starts but `/mcp` endpoint returns 404"

The addon isn't loaded. Check `.storybook/main.ts` — `@storybook/addon-mcp` must be in the `addons` array. If missing (shouldn't happen with 10.4 init), add it and restart.

### "Existing `.storybook/preview.tsx` conflicts with our decorator template"

Read it, MERGE — don't overwrite. Preserve user's existing parameters and decorators. Only add what's missing.

### "Detection says no theme provider but user insists they have one"

Ask the user for the path. The detection grep is best-effort. Common locations:
- `src/providers/theme.tsx`, `src/providers/theme-provider.tsx`
- `src/lib/theme.tsx`
- `src/components/theme-provider.tsx`

### "User says they're on Vue / Angular / Web Components"

Storybook installs fine, MCP doesn't. Skip Phase 6. Tell the user MCP support for non-React frameworks is on the Storybook roadmap. They'll be in the Without-MCP path; route to `references/without-mcp.md` after install.

## Verification record

This wizard's commands and behavior are derived from:
- Live sandbox run on 2026-05-26 (Storybook 10.4.1 + Vite 8 + React 19 + Node 24)
- Findings: `docs/publishing/storybook-mcp-verification.md`
- 3 specific corrections to older docs (addon-mcp bundled, .mcp.json manual, port fallback)
- Vault note: `Efforts/Agent Skills Studio/2026-05-26-storybook-mcp-verification.md`

When the wizard's behavior diverges from these findings, re-run a sandbox verification before patching the wizard — don't trust description drift.
