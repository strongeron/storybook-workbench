# Wrapper Library — Storybook-only composition primitives

The unique value: **10 typed React components that ride on Storybook's native canvas iframe.** They replace hand-rolled grids, decision tracking, and shader/WebGL/3D setups that designers reinvent per project. Wrappers live in `.storybook/wrappers/` and never bundle to production.

## When to load this reference

- User asks for A/B / side-by-side / role-comparison / state-grid stories
- User wants to track design decisions in code ("which version did we pick?")
- User pastes a Figma URL and wants iteration + decision flow
- User needs animation/shader/WebGL experiments inside Storybook
- Setting up a new project — wizard prompts for wrapper scaffolding
- Reviewing existing stories — wrappers replace hand-rolled markup patterns

## The 19 wrappers — 5 categories (4 tiers + Flow)

| Wrapper | Tier | Category | One-line |
|---|---|---|---|
| `<ABCanvas>` | CORE | Compose | A/B/N variants side-by-side / stacked / tabbed |
| `<StateGrid>` | CORE | Compose | Every state of one component on one canvas |
| `<StateMatrix>` | CORE | Compose | Variants × states as a 2-D matrix |
| `<StorySet>` | EXT | Compose | Anton's `TagGallery` generalized — pull stories by tag/id/filter |
| `<StoryStrip>` | EXT | Compose | Ordered sequence of stories, horizontal or vertical |
| `<TrackedDecision>` | EXT | Track | Decision metadata banner (pending/chosen/rejected) — opt-in decision workflow |
| `<DecisionsDashboard>` | EXT | Track | Status board querying `decision:*` tagged stories — opt-in decision workflow |
| `<ShaderCanvas>` | ADV | Render | Fragment-shader playground with auto GL cleanup |
| `<R3FCanvas>` | ADV | Render | react-three-fiber wrapper (lazy-loaded) |
| `<MotionStage>` | ADV | Render | Keyframe-based motion via Web Animations API |
| `<TokensCanvas>` | DS | DesignSystem | Auto-discovers tokens from Tailwind v4 / shadcn / DTCG / CSS vars, renders swatches + scales |
| `<TokenMatrix>` | DS | DesignSystem | Semantic-token audit table: each role token's light + dark value (live), adoption, and health on one canvas. Adoption expands to the **components & pages** that use the token (resolved via `usage-index`, clickable to each story). |
| `<DesignSystemHealth>` | DS | DesignSystem | Reads validate-design-system.sh output, renders findings as a shadcn-style accordion |
| `<ProjectInventory>` | DS | DesignSystem | Reads inventory-project.json — stack, dominant design system, real/dead components, token usage, orphan stories |
| `<ComponentUsage>` | DS | DesignSystem | The component worklist: every real component ranked by call-site usage, the pages it renders on (role-coloured chips), and parent/child nesting. Reads `component-pages.json`. |
| `<UsageExplorer>` | DS | DesignSystem | The one "where is this used?" surface. Pick a token / component / page → full bidirectional context (token→components+pages · component→tokens+pages+nesting · page→components+tokens), every related name clickable to navigate the graph or open its story. The token tab carries an in-view **lane filter** (color · typography · scale …, derived from the data) so the whole type system or palette reads in one place — including Tailwind-default type utilities (`text-sm`, `font-medium`) surfaced from real className usage. Reads `component-pages.json` (`tokens[]` w/ `category` + `components[].tokens` + `fileIndex`). TokenMatrix's capped chips deep-link in via a `usageExplorerStoryId` + `&args=focus:<token>`. |
| `<IconMatrix>` | DS | DesignSystem | Live iconography coverage: which icons the app imports, which it renders (and how often), and at what pixel sizes (Tailwind `h-*`/`size-*` → px) — a size histogram + per-icon × size grid + "imported but not rendered". Scans `/src/**` raw at build time (`import.meta.glob`), **no JSON, no icon-pkg install**. Library-agnostic: the story passes `library` metadata + a `resolve(name)→component` fn (lucide-react / phosphor / heroicons / …). |
| `<AppFlowGraph>` | FLOW | Flow | Whole-app route map: role lanes, typed edges, coverage filter, click-to-story |
| `<JourneyGraph>` | FLOW | Flow | One flow's journey map; doubles as the Docs index for that flow |

### Orientation banners (support — auto-included like `icons.tsx`)

Force-copied with every scaffold, not counted in the 18. `ReportIntro` gives a first-time viewer of the
published Storybook **demo** the "what is this / where is it from" context — but that explains the
plugin's own plumbing, which is noise in a real client deliverable, so it is **OFF by default**.

**Reaching it on demand** (for when someone asks "where does this come from?"):
- `setProvenance(true)` — or set `globalThis.__SB_WB_PROVENANCE__ = true` in `.storybook/preview.ts`,
  a toolbar global, or at runtime → every banner appears.
- `<ReportIntro show />` — reveal a single one without the global switch.
- On the flow wrappers, `hideIntro` still **hard-suppresses** even when the global is on.

`ExperimentBanner` is unaffected — a lifecycle-status line is real deliverable content, not demo
orientation, so it shows as before.

| Banner | Used by | One-line |
|---|---|---|
| `<ReportIntro>` *(off by default)* | ProjectInventory, AppFlowGraph, DesignSystemHealth, ComponentUsage, TokenMatrix, DecisionsDashboard, usage MDX | One sentence (what this page answers) + `source: file ← skill` + how it refreshes. For **derived-report** surfaces. Hidden unless `setProvenance(true)` / `show`. |
| `<ExperimentBanner>` | ABCanvas (`experiment` prop), Explore sandboxes | Lifecycle status — "experiment from sb-explore, not shipped, decision pending" + graduation target. NOT a data-source line. |
| `usage-index` (`UsageDisclosure` / `UsageDetail` / `resolveUsage`) | TokenMatrix, Foundations swatches (Colors · Scales · Typography) | Resolves a token/size's raw `src/...` paths → the **components & pages** that use it, each clickable to its story (via Storybook `/index.json`), capped + alphabetized. Reads `component-pages.json` `fileIndex`. Collapses inside autodocs, open on the standalone audit page. |

> Deliberately **not** on plain component state grids (`StateGrid`/`StorySet`/`StateMatrix`) or
> individual stories — those are human-authored catalogs; a provenance block there is noise and untrue.

## Layout & previews — let the frame follow the story

A single global decorator that blanket-forces `minHeight: 100vh` on every story is the most common
preview bug: it buries a primitive (Badge, Button) alone in a viewport-tall box of whitespace, and
autodocs reads poorly. The frame must follow each story's intent, not override it. Two layers, kept
separate:

1. **Per-story `layout` parameter** — set it on the meta or the story:
   - `layout: 'centered'` → **primitives** (Badge, Button, Input). Shrink-wraps to content.
   - `layout: 'padded'` (Storybook default) → most component stories and `StateGrid`/`StateMatrix`/`ABCanvas`/`StorySet`/`StoryStrip` compositions.
   - `layout: 'fullscreen'` → **pages** and the **report wrappers** (`ProjectInventory`, `ComponentUsage`, `DesignSystemHealth`, `DecisionsDashboard`) and **flow maps** (`AppFlowGraph`, `JourneyGraph`).
2. **The `withLayoutFrame` global decorator** (`decorators/withLayoutFrame.tsx`, scaffolded into `.storybook/decorators/`) — fills the viewport **only** when the story wants it (`layout: 'fullscreen'`, or an explicit `parameters: { fillViewport: true }`); centered/padded stories shrink-wrap. Register it **last** in `preview.tsx` so it frames the already-provider-wrapped story:

   ```ts
   import { withLayoutFrame } from './decorators/withLayoutFrame';
   const preview = { decorators: [/* providers… */, withLayoutFrame], parameters: { layout: 'padded' } };
   ```

   The theme **background** is NOT this decorator's job — it is painted on the canvas ROOT in
   `preview-head.html` (sb-setup install-wizard item 9), so it shows under every layout including the
   shrink-wrap case. Painting a background here instead is what causes the "dark sliver in a white
   field" bug.

| Story type | `layout` | Frame |
|---|---|---|
| Primitive — Badge, Button | `centered` | Shrink-wraps to content; no forced height; autodocs reads cleanly. |
| Component states / A/B — `StateGrid`, `ABCanvas`, `StateMatrix` | `padded` | Sits in the padded canvas at content height. |
| Page / report — `ProjectInventory`, `DesignSystemHealth`, … | `fullscreen` | `withLayoutFrame` gives a `100dvh` frame so short reports still fill. |
| Flow map — `AppFlowGraph`, `JourneyGraph` | `fullscreen` | Self-sizes to `100dvh`; the frame agrees. |

**`fillViewport` prop (report wrappers).** `ProjectInventory`, `ComponentUsage`, `DesignSystemHealth`,
and `DecisionsDashboard` accept `fillViewport?: boolean` (default `true`). The default keeps the
standalone full-page report behavior; pass `fillViewport={false}` when **embedding** one inside
another view (a tab, a section, an `ABCanvas` variant) so it shrink-wraps and the parent controls
height instead of forcing `100dvh`.

## Scaffolding into a project

```bash
# CORE only (3 wrappers — recommended start: the universal structural views)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 1

# CORE + EXTENDED (7 wrappers)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 2

# CORE + EXTENDED + DESIGN-SYSTEM (the common case — inventory, health, tokens; 11 wrappers)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 4

# + ADVANCED/3D (opt-in; ShaderCanvas/R3FCanvas/MotionStage need three / @react-three/fiber)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 3

# The whole-app maps (AppFlowGraph + JourneyGraph)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --flow

# Selective
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh ABCanvas TrackedDecision StateMatrix

# Re-run with --force to overwrite (e.g., after updates to source)
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 3 --force
```

Copies into `.storybook/wrappers/` by default; pass `--target src/stories/wrappers` to use a different location. Auto-generates a barrel `index.ts` so all wrappers import from one path.

## API reference

### `<ABCanvas>` — A/B/N comparison

```tsx
import { ABCanvas } from '../../.storybook/wrappers';

<ABCanvas
  variants={[
    { label: 'V1 (current)',   node: <Hero />,   note: 'Button-driven' },
    { label: 'V2 (candidate)', node: <HeroV2 />, note: 'Inline CTA' },
  ]}
  layout="side-by-side"   // | 'stacked' | 'tabs'
  decisionId="hero-v2-2026-05-27"
  experiment              // true, or { skill, status, note, target } — shows the "not shipped" banner on top
/>
```

**Props:** `variants: ABVariant[]`, `layout?: 'side-by-side' | 'stacked' | 'tabs'`, `decisionId?: string`, `experiment?: boolean | ExperimentBannerProps`

### `<StateGrid>` — every state on one canvas

```tsx
<StateGrid
  component={Button}
  cols={4}
  states={[
    { label: 'Default',     props: { children: 'Click' } },
    { label: 'Hover',       props: { children: 'Click' }, pseudo: { hover: true } },
    { label: 'Disabled',    props: { children: 'Click', disabled: true } },
    { label: 'Loading',     props: { children: 'Click', loading: true } },
  ]}
/>
```

**Props:** `component: ComponentType<P>`, `states: StateEntry<P>[]`, `cols?: number` (default 4). The `pseudo` field on each entry feeds the official `storybook-addon-pseudo-states` if installed (not the third-party `@hover/` fork — see sb-setup install-wizard).

> **Role / permission comparison** is just StateGrid with `role` as the varied prop — there's no
> separate wrapper, and you should reach for it only *after* an audit shows the app actually has
> role-gated components (the toolkit is structural; don't assume a `role` axis exists up front):
> ```tsx
> <StateGrid component={CTA} cols={1} states={[
>   { label: 'Public', props: { role: 'public' } },
>   { label: 'Member', props: { role: 'member' } },
> ]} />
> ```

### `<TrackedDecision>` — decision metadata banner

```tsx
<TrackedDecision
  id="hero-v2-2026-05-27"
  status="pending"
  rationale="Static image vs animated shader"
  reviewers={['design-lead', 'pm-marketing']}
  target="2026-06-03"
>
  <ABCanvas variants={[...]} />
</TrackedDecision>

// After decision:
<TrackedDecision id="hero-v2-2026-05-27" status="chosen" winner="V2" date="2026-05-29" ...>
```

**Props:** `id: string`, `status: 'pending' | 'chosen' | 'rejected'`, `rationale?`, `reviewers?: string[]`, `target?`, `winner?`, `date?`

**Tag the story to feed the dashboard:**
```tsx
tags: ['decision:pending']  // or 'decision:chosen' | 'decision:rejected'
```

### `<DecisionsDashboard>` — status board

```tsx
// src/stories/decisions/Dashboard.stories.tsx
import { DecisionsDashboard } from '../../.storybook/wrappers';

const meta = { title: 'Decisions/Dashboard', tags: ['!autodocs'] } satisfies Meta;
export default meta;
export const All: Story = { render: () => <DecisionsDashboard /> };
```

Queries all stories via `import.meta.glob`, filters by `decision:*` tags, renders pending/chosen/rejected columns. **Adjust glob paths inside the wrapper to match your project layout** (defaults assume `src/**/*.stories.tsx` and `stories/**/*.stories.tsx`).

### `<StorySet>` — Anton extension

```tsx
// By tag (Anton's original use case)
<StorySet tag="empty-state" layout="grid" />

// By explicit IDs in order
<StorySet
  ids={['pages-onboarding--welcome', 'pages-onboarding--profile', 'pages-onboarding--verify']}
  layout="strip"
/>

// By predicate
<StorySet
  filter={(e) => e.title.startsWith('Explore/Hero')}
  layout="tabs"
/>

// Custom cell rendering
<StorySet
  tag="decision:pending"
  renderCell={(entry) => (
    <TrackedDecision id={entry.id} status="pending">
      {entry.Component && <entry.Component {...entry.args} />}
    </TrackedDecision>
  )}
/>
```

**Layouts:** `grid` (default) · `strip` · `timeline` · `tabs`
**Selection (pick one):** `tag`, `ids`, `filter`
**Optional:** `ordered: true` sorts by `parameters.flowOrder`, `renderCell` for full control

> **Select arg-based stories.** The default cell renders `<meta.component {...mergedArgs} />`, so it only shows real state for stories that set `args`. A story using a custom `render()` (a `--states`/`--variants` story that hand-builds its own JSX) carries no args and collapses to the bare default component — point `ids`/`tag`/`filter` at the arg-based stories, or pass a `renderCell` that mounts the story itself. (`StoryStrip` has the same constraint.)

### `<StoryStrip>` — ordered sequence

```tsx
<StoryStrip
  ids={['pages-onboarding--welcome', ..., 'pages-onboarding--complete']}
  direction="row"   // 'row' | 'column'
  numbered
/>
```

Lighter than `StorySet` — for known IDs in known order.

### `<ShaderCanvas>` — fragment shader

```tsx
const aurora = `
  precision highp float;
  uniform float u_time;
  uniform vec2  u_resolution;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0,2,4));
    gl_FragColor = vec4(col, 1.0);
  }
`;

<ShaderCanvas
  fragment={aurora}
  uniforms={{ u_mouse: { type: 'vec2', value: [0.5, 0.5] } }}
  vrtSafe
  height={400}
>
  <Hero variant="overlay" />
</ShaderCanvas>
```

Provides `u_time` and `u_resolution` automatically. Children render in an absolute overlay above the canvas. `vrtSafe` renders one frame at `u_time = 1.0` and pauses.

### `<R3FCanvas>` — react-three-fiber

```tsx
<R3FCanvas camera={{ position: [0, 0, 5] }} controls={['orbit']}>
  <ambientLight intensity={0.6} />
  <directionalLight position={[5, 5, 5]} />
  <mesh>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="hotpink" />
  </mesh>
</R3FCanvas>
```

**Requires** `@react-three/fiber` (and optionally `@react-three/drei` for `OrbitControls`). Lazy-loads via dynamic import — if not installed, renders a placeholder warning instead of crashing.

### `<TokensCanvas>` — design tokens source-of-truth

Auto-discovers design tokens from **four industry-standard sources** simultaneously, classifies them into categories (Colors / Typography / Spacing / Radii / Shadows / Motion / Breakpoints), and renders them as a Storybook story. No configuration needed — the wrapper uses Vite's glob imports to scan CSS files and JSON files in the project at build time.

```tsx
// src/stories/foundations/Tokens.stories.tsx
import { TokensCanvas } from '../../.storybook/wrappers/TokensCanvas';

const meta = { title: 'Foundations/Tokens', tags: ['autodocs'] } satisfies Meta;
export default meta;
export const All: StoryObj = { render: () => <TokensCanvas /> };
```

**Detection order** (multiple sources combine, never conflict):

| Priority | Source | Pattern | Triggered by |
|---|---|---|---|
| 1 | **Tailwind v4** | `@theme { --color-foo: ...; --spacing-md: ... }` | `@theme` block in any `.css` |
| 2 | **shadcn cssVars** | `:root { --background: 0 0% 100% }` HSL channels | `components.json` present in project |
| 3 | **Plain CSS** | `:root { --any-name: value }` | Any `:root` block (fallback) |
| 4 | **DTCG tokens.json** | `{ "color": { "primary": { "$value": "#..." } } }` W3C format | Any `tokens.json` or `*.tokens.json` |

**Each token shows its source** via a badge (`tailwind-v4` / `shadcn` / `css-vars` / `dtcg`) so multi-source projects stay transparent.

If no tokens are found, the wrapper renders a helpful empty state explaining where to add tokens.

### `<DesignSystemHealth>` — validation findings

Reads `.storybook/design-system-health.json` (produced by `scripts/validate-design-system.sh`) and renders the full catalog of detectable kinds as a **shadcn-style accordion** — each row is a severity dot + foreground label + count badge + check-source badge, with a right-aligned chevron that rotates on open (hover underlines the label, focus is keyboard-visible, the panel fades in and respects `prefers-reduced-motion`). Kinds with findings sit on top (expand for the source list); clean kinds render below with an example of what the check catches:

```tsx
// src/stories/foundations/Health.stories.tsx
import { DesignSystemHealth } from '../../.storybook/wrappers/DesignSystemHealth';

const meta = { title: 'Foundations/Health', tags: ['!autodocs'] } satisfies Meta;
export default meta;
export const All: StoryObj = { render: () => <DesignSystemHealth /> };
```

**Validator categories** (all run by `validate-design-system.sh`):
- `raw-color` — hex/rgba literals in component source (should use tokens) — *warning*
- `undefined-token` — references to `var(--foo)` where `--foo` isn't declared — *error*
- `scale-gap` — spacing/type scale has unexpected jumps (>2x) — *info*
- `unused-token` — declared but never referenced — *info*
- `stylelint` — runs stylelint if a config is present — *warning*
- `naming-drift` / `semantic-vs-presentational` — LLM-detected (via `--emit-prompt` flag, agent dispatches a sub-agent) — *warning/info*

Generate the report with:
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/validate-design-system.sh
# or: --quick (skip stylelint + LLM), --no-stylelint, --emit-prompt
```

The wrapper auto-refreshes when the JSON changes (Vite HMR).

### `<ProjectInventory>` — Setup-phase ground truth

Reads `.storybook/project-inventory.json` (produced by `scripts/inventory-project.sh`) and renders the Setup-phase ground truth as a Storybook story: library stack, dominant design system (1-of-4 or `mixed` warning), real vs dead components, used vs orphan tokens, and orphan stories. Replaces "trust the AGENTS.md / CLAUDE.md" with "see what's actually in the project" — agent and designer share one view (`Foundations/Inventory`).

```tsx
// src/stories/foundations/Inventory.stories.tsx
import { ProjectInventory } from '../../.storybook/wrappers/ProjectInventory';

const meta = { title: 'Foundations/Inventory', tags: ['!autodocs'] } satisfies Meta;
export default meta;
export const All: StoryObj = { render: () => <ProjectInventory /> };
```

Run `inventory-project.sh` first (Setup gate) to produce the JSON. Exported type: `ProjectInventoryReport`.

Stats and section headers share **one semantic color legend** (the same grammar `DesignSystemHealth` uses, so the two views read as one surface): `good` = green (real, used, top components), `warn` = amber (orphan tokens, benign), `bad` = red (dead components, orphan stories), neutral = gray (totals/denominators). Numbers use the legible `-text` shade; dots and count badges use the vibrant base. Section headers are a dot + foreground label + count badge + descriptor (not whole-heading color).

### `<MotionStage>` — keyframe timeline

```tsx
<MotionStage
  timeline={[
    { at:    0, transform: 'translateY(40px) scale(0.95)', opacity: 0 },
    { at:  200, transform: 'translateY(0) scale(1)',       opacity: 1 },
    { at: 1000, transform: 'translateY(0) scale(1)',       opacity: 1 },
    { at: 1200, transform: 'translateY(-20px)',            opacity: 0 },
  ]}
  loop
  easing="ease-in-out"
>
  <Card>Animated content</Card>
</MotionStage>
```

Uses Web Animations API (`Element.animate`). `vrtSafe` seeks to `vrtFrame` (default 200ms) and pauses.

## Composition examples

Wrappers nest. Three patterns worth memorising:

### Decision-tracked A/B

```tsx
<TrackedDecision id="..." status="pending" ...>
  <ABCanvas variants={[
    { label: 'V1', node: <Hero /> },
    { label: 'V2', node: <HeroV2 /> },
  ]} />
</TrackedDecision>
```

### Decision-tracked A/B with shader background on V2

```tsx
<TrackedDecision id="..." status="pending" ...>
  <ABCanvas variants={[
    { label: 'V1 (static)', node: <Hero /> },
    { label: 'V2 (shader)',  node: (
      <ShaderCanvas fragment={aurora} vrtSafe>
        <Hero variant="overlay" />
      </ShaderCanvas>
    )},
  ]} />
</TrackedDecision>
```

### Full flow surface — 3 wrappers composed

```tsx
<TrackedDecision id="onboarding-2026-Q2" status="pending" ...>
  <ABCanvas layout="stacked" variants={[
    { label: 'Current (3 steps)',  node: <StorySet ids={[s1, s2, s3]} layout="strip" /> },
    { label: 'Proposed (2 steps)', node: <StorySet ids={[sA, sB]} layout="strip" /> },
  ]} />
</TrackedDecision>
```

### `<AppFlowGraph>` — field-fixed layout invariants (do NOT regress)

Four bugs were found and fixed by driving the live map in a browser (clicking nodes, fitting, panning). They are silent — the graph still *renders* — so they recur easily if the wrapper is rewritten. Preserve all four; each lists the symptom → cause → fix so you can re-diagnose.

1. **Focus mode renders a blank canvas.** Symptom: clicking a node switches to focus mode (toolbar shows "← Map | <screen>") but the canvas is empty. Cause: the root used `height: 100%`, but Storybook's `#storybook-root` is **content-sized** (the iframe body collapses to its content). In map mode the tall graph forces the container open and content is top-aligned, so it looks fine; in focus mode the small ego graph lets the container collapse, and focus mode centers vertically → the cards fall past the `overflow:hidden` bottom edge. Fix: root container **`height: "100dvh"` (+ a `minHeight`)** so it fills the iframe viewport regardless of content. NEVER `height: 100%` here.
2. **Edges are clipped.** Symptom: bezier curves get cut at the canvas edge. Cause: the `<svg>` is sized to exactly `layout.width × layout.height` and edges bow *past* those bounds (e.g. same-lane curves bow `+52px`). SVG roots clip by default. Fix: **`overflow: "visible"` on the graph `<svg>`**.
3. **Lanes have huge vertical gaps.** Symptom: with many role lanes, nodes sit far down their lane with empty space above, the graph is absurdly tall, and "Fit all" zooms way out. Cause: node `y` was `n.order * ROW_H` using the **global** route index. Fix: **pack each lane from the top** — `row` = position WITHIN the lane (a per-lane counter), iterating nodes sorted by `order`. See `mapLayout`.
4. **Duplicate neighbor cards in focus view.** Symptom: a neighbour appears 2–3× (e.g. "Home" twice) because there are N parallel call-site edges to the same target. Cause: ego layout rendered one card per edge. Fix: **collapse parallel edges to the same neighbour** into one card (`groupByNeighbor`), keep a representative edge, merge distinct labels, and append `×N` to the connector label.

Related (the data side, owned by `extract-app-graph.mjs`, not the wrapper): **role lanes must come from the app's real access gate, not a path heuristic.** The generic extractor classifies `node.role` by path (`/admin/*` → admin, else user) — wrong for apps that gate by permission/membership. When the app has a route-access service (`routeAccessService` + role→permission resolution), replace the heuristic with the real model: assign each route the lane of the **minimum persona** that can reach it, and tag routes whose *content* differs by role (not separate routes) with a `roleVariant` so the card can show a "VARIES BY ROLE" badge (it means content-differs-by-role, NOT role-restricted — the lane already conveys the access floor). Keep the lane sets in sync with the gate source file.

### `<JourneyGraph>` — step-state coverage & length handling

One curated journey as a vertical step map for a `Flows/*` Docs page. `journey.steps[]` is the data; each step is `{ label, kind, detail?, storyId? }`.

- **Four step kinds, each with its own icon + badge ring** — `kind ∈ screen · action · modal · end`. Defaults are zero-dependency inline SVGs (monitor · pointer-click · layers · check); override per kind via the `icons` prop (`icons={{ screen, action, modal, end, link }}`, e.g. lucide). **NO emoji** — kinds render through the icon slots only.
- **Clickable vs static** — a step with a `storyId` renders its label as an underlined link with the open-in-Storybook arrow (the `link` icon) and deep-links to that exact state; without one it's plain text. Both must render cleanly.
- **Length is handled, not capped** — a long `label` wraps inside the narrow Docs column (`overflow-wrap: anywhere`; the number/label/kind row is `flex-wrap`), and a long `detail` wraps onto multiple lines via `<Chip wrap>` (`white-space: normal`) instead of overflowing as one nowrap line. Header chips (role/entry) stay single-line. A step with no `detail` renders no empty chip.
- **Scale** — the vertical rail connects N steps linearly with no breakage; the rail segment is hidden on the last step. For the narrow Docs column, keep a *curated* journey readable (≈3–12 steps is the sweet spot); for the full app at scale use `AppFlowGraph` (the whole route map) and link out, rather than a giant single journey.
- **Coverage demo** — `Skill/Wrappers → JourneyGraph` (`skill-wrappers--journey-graph`) renders one synthetic journey exercising every kind, the link affordance, and short → long label/detail lengths plus a generated tail, above a coverage table. Use it to verify the default view after editing the wrapper.

## Lifecycle decision tags

Three decision tags extend the 5-layer tag taxonomy:

| Tag | When | Pairs with |
|---|---|---|
| `'decision:pending'` | Option being evaluated | `TrackedDecision status="pending"` |
| `'decision:chosen'` | Winning option, ready for Ship | `TrackedDecision status="chosen"` |
| `'decision:rejected'` | Explored, declined; kept for archive | `TrackedDecision status="rejected"` |

The agent updates the tag whenever the decision flips. `DecisionsDashboard` queries all three.

## VRT-safe modes

Visual regression tests (Chromatic, Lost Pixel) capture one frame. The render wrappers cause flake unless time/motion is frozen.

| Wrapper | Default | `vrtSafe` |
|---|---|---|
| `ShaderCanvas` | Continuous render with advancing `u_time` | One frame at `u_time = 1.0`, then pauses |
| `R3FCanvas` | `frameloop="always"` | `frameloop="demand"` — scene drives invalidation |
| `MotionStage` | Loops timeline | Seeks to `vrtFrame` (default 200ms), pauses |

Activate via prop (`vrtSafe`), or set `parameters.vrt = true` on the story and wrappers detect it (when wired).

## Anti-patterns

1. **Importing wrappers from app code.** Wrappers are story-only. Anything in `src/components/` or `src/pages/` must NEVER import from `.storybook/wrappers/`. Verify with: `grep -rE "from ['\"](\.\.\/)*\.storybook\/wrappers\/" src/ --include='*.tsx' --include='*.ts' | grep -v '\.stories\.'`
2. **Inlining `<div className="grid grid-cols-2">` instead of `<ABCanvas>`.** Once the wrappers are scaffolded, hand-rolled A/B markup is drift.
3. **Skipping `decisionId` on `<ABCanvas>` when wrapped in `<TrackedDecision>`.** They coordinate via this id; missing it breaks the dashboard linkage.
4. **`<R3FCanvas>` without R3F installed.** The wrapper gracefully degrades to a placeholder, but stories that depend on 3D content will look broken. Install `@react-three/fiber` first.
5. **`<ShaderCanvas>` with `u_time` referenced but no `vrtSafe` mode for VRT.** Visual regression will flake on every run.
6. **`<AppFlowGraph>` root with `height: 100%`.** Collapses in focus mode → blank canvas (see "field-fixed layout invariants"). Use `height: 100dvh`. Same section covers the SVG `overflow:visible`, per-lane packing, and neighbour dedup invariants — all four are silent regressions.

## Verification record

- Wrapper APIs derived from 191 production stories' hand-rolled patterns (especially an animation-heavy story at ~1600 lines and a multi-flow page story at ~2700 lines, both of which would shrink dramatically with these wrappers).
- `StorySet` generalizes Anton's `TagGallery` from `references/galleries-and-tags.md`.
- `ShaderCanvas` shader cleanup pattern derived from standard WebGL teardown idiom + Storybook re-render concerns.
- `R3FCanvas` lazy-load pattern keeps Tier 3 optional (R3F is a heavy dep many projects don't need).
- All wrappers smoke-tested via `scripts/scaffold-wrapper.sh` into a clean dir; barrel index regenerates correctly.
