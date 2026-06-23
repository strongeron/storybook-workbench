# Storybook CSF3 — Anti-patterns

Universal anti-patterns to refuse when writing or reviewing stories. Most are well-known; this file's value is the **MCP-catches-vs-skill-must-enforce split** plus the designer-grade items at the bottom that MCP and most checklists miss entirely.

## Legend

- 🛡️ **MCP catches** — if `@storybook/addon-mcp` is wired, the injected instructions or `run-story-tests` will surface this automatically
- 📕 **Skill catches** — you must enforce this; MCP won't help

Out of 28 items below, **MCP automatically catches 5** (~18%); the rest are judgment, project-level decisions, or designer/prototype concerns — that's the value-add of this skill regardless of MCP.

## Code-level (one-liners — these are textbook)

1. 📕 **CSF2 (`storiesOf`, `.story` properties)** — convert via `npx storybook@latest migrate csf-2-to-3`. Refuse new ones.
2. 📕 **Imports from `@storybook/addon-essentials` / `@storybook/blocks`** — both empty in SB10. Use `@storybook/addon-docs/blocks`, `storybook/test`, `@storybook/react-vite`.
3. 🛡️📕 **Inline mock data inside `render`** instead of `args` — breaks Controls panel.
4. 📕 **All-props-as-args dumps** — only meaningful visual props in `args`; refs and internal callbacks clutter Controls.
5. 🛡️ **Hallucinated props** — always read the component's TypeScript interface (or call `get-documentation`) before writing args.
6. 🛡️📕 **Arbitrary Tailwind/inline-style values in component source** — clean up the component (replace `bg-[#3b82f6]` with `bg-primary`); the story is a symptom.
7. 📕 **Repeating the same `parameters.msw.handlers` per story** — lift shared handlers to `preview.tsx`; only override per-story for story-specific responses.
8. 📕 **Mocking at the wrong level** — auth/session/theme/locale → `preview.tsx`; API responses for *this* story's data → `parameters.msw.handlers`; component-internal `useState` defaults → story `args`.
9. 📕 **Stories tightly coupled to real app routing** — mock the router via decorator (`MemoryRouter`, `next-router-mock`, `parameters.router`); never import the real one.
10. 🛡️ **Missing `tags: ['autodocs']`** at meta level — no Docs page, no autodocs aggregation.
11. 📕 **Interactive component without a `play` function** — at least one story per interactive component needs a play that exercises the interaction; otherwise visual regression catches nothing functional.
12. 🛡️ **`getBy*` inside `play` for async assertions** — use `findBy*` (retries) or wrap in `waitFor`.
13. 📕 **Replicating the component's internal `useState` in the story** — the story becomes a fork of the component. Drive via `play` clicks, or use `useArgs` for two-way Controls sync (see `templates/controlled-component-story.tsx`).

## Workflow-level

14. 📕 **Co-locating `*.stories.*` in a published npm bundle** — exclude `src/stories/**` (or `*.stories.*`) from the build output.
15. 📕 **Writing stories before foundation phase** — theme/router/auth/queryclient/portal-root decorators must exist in `preview.tsx` first, or stories fail with cryptic provider errors.
16. 📕 **Extracting too many components in one session** — Storybook's official agentic-setup caps at 10 per session; Backend.AI's case study landed on 5–8 as the comfort zone. More than that compresses context and starts batching errors.
17. 📕 **Mega-stories with knobs for every prop** — write one story per behaviorally-distinct state. Visual regression needs named stories, not "AllVariants."
18. 📕 **Imposing a universal tag (e.g. blanket `'ai-generated'`)** — propose a taxonomy from project signals; don't stamp one tag on every story. A `'needs-work'` flag on genuinely-unreviewed output is fine because it *distinguishes*; `'ai-generated'` on 100% of a single-author repo distinguishes nothing → drop it. See item 32 (tag-as-noise) for the rule.

## Designer-grade — MCP won't catch these, and most agent checklists miss them

These are the ones worth slowing down for.

### 19. 📕 `disabled` as a pseudo-class toggle (the designer trip-up)

```ts
// ✗ Trying to surface :disabled via pseudo-states addon — won't work
parameters: { pseudo: { disabled: true } }

// ✓ disabled is an HTML attribute / prop
args: { disabled: true }
```

Designers reach for the pseudo-states toolbar expecting it to control `disabled`. The pseudo-states toolbar only covers CSS pseudo-classes: `:hover`, `:focus`, `:focus-visible`, `:active`. `disabled` is structural, not visual state.

### 20. 📕 Hardcoding title taxonomy before reading existing `preview.ts`

Before picking `Components/Form/Button`, read `.storybook/preview.ts` for `parameters.options.storySort.order`. If the project already uses `UI/Forms/Button` or `Atoms/Button`, match it. Inconsistent prefixes fragment the sidebar and lose designer trust immediately.

### 21. 📕 Missing state coverage on interactive primitives

The minimum coverage for the components designers actually inspect:

- **Button:** Default · Hover · Focus · Focus-visible · Active · Disabled · Loading · Destructive
- **Input:** Default · Hover · Focus · Filled · Error (with message) · Disabled · Read-only · Required
- **Modal:** Closed · Open-default · Open-scrollable · Loading · Destructive-confirmation
- **Nav item:** Default · Hover · Active/Current · Collapsed

Less coverage = silent regressions when a designer adjusts one state.

### 22. 📕 No Figma link in `parameters.design`

```ts
parameters: {
  design: { type: 'figma', url: 'https://www.figma.com/file/.../?node-id=...' },
}
```

Without a Figma link (or Storybook Connect), designers reviewing the story can't side-by-side compare to the source.

### 23. 📕 No token reference for color/spacing values

If a story has `style={{ marginTop: 13 }}` or `style={{ color: '#111827' }}`, that magic number isn't traceable to a design token. Either use the token class (`mt-3`, `text-foreground`) or the token CSS variable (`var(--spacing-3)`, `var(--color-foreground)`).

### 24. 📕 Stale stories silently consuming old token values

When a designer updates a token, Storybook needs a rebuild for the change to take effect. Stories don't update automatically. Document this expectation — designers reviewing visual changes need to know "rebuild after token edit."

### 25. 📕 No do/don't blocks in the component's MDX docs

This is `storybook-doc-blocks` skill territory but flag during story review: components shipped without designer-authored do/don't blocks ship without intent documentation. Stories show *what it does*, do/don't blocks show *when to reach for it*.

## Determinism & prototype hygiene — observed in practice

These three recur in real story-first prototyping and aren't in most checklists.

### 26. 📕 Nondeterministic state inside a story or preview component

```ts
// ✗ Every snapshot differs — visual regression is now useless
const now = new Date();                      // also Date.now(), new Date().toISOString()
const featured = items[Math.floor(Math.random() * items.length)];
const collapsed = localStorage.getItem('sidebar') === '1';
useEffect(() => { const t = setTimeout(...) }, []);

// ✓ Accept the value as a prop with a STATIC default
function Preview({ now = '2026-01-15T10:00:00Z', collapsed = false, featured = items[0] }) { … }
```

A story is a fixture, not a runtime. `new Date()` / `Date.now()`, `Math.random()`, `localStorage` / `sessionStorage`, `setTimeout` / `setInterval` all make the render differ run-to-run, which silently breaks Chromatic/visual regression and makes "looks the same" unprovable. **Do:** lift the nondeterministic value to a prop with a fixed default (static ISO date strings, a seeded pick, a `collapsed` boolean). **Don't:** read wall-clock, storage, or randomness from inside the story body or its preview component.

> **The other half — when the *component* (not the story) reads the clock or storage.** If a real component reads `Date.now()` for a relative "added 2 days ago" label, or reads `localStorage.theme` on mount, you can't lift that to a prop without forking it (anti-pattern 27). Instead pin the source **globally in `.storybook/preview.tsx` `beforeEach`** — `MockDate.set('2024-04-10T12:00:00Z')` (return `() => MockDate.reset()`) and `localStorage.setItem('theme','dark')` — seeding **only** the state the app actually reads. That's how `storybook ai setup` makes a relative-date or theme-aware `play` assert literal text (`"Added 2 days ago"`, `aria-pressed`) deterministically. Wiring lives in `references/install-wizard.md`.

### 27. 📕 Hand-rolling a component the app already has (prototype drift)

When a story-first prototype needs a sub-component the real app already ships (a sidebar, a card, a nav), **import the real one** — don't reimplement a local look-alike. A local `RealisticFoo` that duplicates a real `<Foo>` drifts: the prototype keeps stale styling the real component has since fixed, and a reviewer signs off on a frame that doesn't match production.

- ✓ **Do:** `import { Sidebar } from '@/components/...'` and feed it mock data, even inside an Explore/prototype story.
- ✓ **Do:** only inline a local variant when the real component *doesn't exist yet* — and mark it `// TODO: replace with <RealComponent> once it exists`.
- ✗ **Don't:** keep a story-first prototype *alive* after its component graduates to production. Two live copies = two sources of truth that drift. Preserve the prototype as decision history (`archived` tag), point new work at the production component — never maintain both.

### 28. 📕 Deriving a story's share URL/slug from the filename or component name

The Storybook URL slug comes from the **`title:`** field, not the file name or component name. Guessing it from the filename produces 404 share links sent to stakeholders.

```
slug = kebab(title.replaceAll('/', '-')) + '--' + kebab(exportName)
// title: 'Components/Marketing/Hero', export const LongBio  →  components-marketing-hero--long-bio
```

**Do:** read `title:` and the export name to build the slug. **Don't:** assume `Hero.stories.tsx` → `hero--…`; the title may namespace it as `components-marketing-hero--…`.

## Flow / page / audit-level — the connection half (v1.13)

### 29. 📕 Auditing only page bodies — missing the persistent nav
An "audit all connections" that sweeps page bodies + the components they render but never the **layout chrome** (sidebar / header / footer) is incomplete — that chrome links from *every* screen and is invisible to a page-body sweep. This was the field's #1 miss. `extract-flows.sh` emits `navSources[]` and prints a sweep reminder; act on it. Enumerate every **source of navigation** (page links · server redirects · modal triggers · layout chrome · card/widget deep-links) — see `references/flow-capture.md` Step 1.

### 30. 📕 Flow/page story rendered at component (narrow, centered) width
Pages and flows are not components. `layout: 'centered'` in the narrow canvas misrepresents how the app ships and is unreadable. Use `layout: 'fullscreen'` + a desktop viewport, and offer a mobile view. (`flow-capture.md` Step 6.)

### 31. 📕 Interactive flow story that never reaches its documented states
If the journey documents `modal-open → filled → confirmation`, the interactive `play` must actually drive through to `confirmation`. A flow story that stops at `loading` and never advances is incomplete — and reviewers sign off on a state the flow never demonstrates. Document each state as its own full-width story; make the interactive story reach all of them. (`flow-capture.md` Step 7.)

### 32. 📕 A tag that lands on >~80% of stories (tag-as-noise)
The skill should **propose** a tag taxonomy from project signals, never **impose** a universal tag. Blanket-applying `ai-generated` to ~100% of stories filters nothing — it's pure noise (a stable, done story should carry *zero* custom tags). For single-author vibe-code, drop `ai-generated` entirely; for "what changed", use Storybook's built-in **git New/Modified** filters, not a custom tag. Record the chosen vocabulary in `.storybook/audit/tag-system.md`. *(Supersedes the older "always tag ai-generated" guidance in item 18.)*

## Story-as-proof — adopted from `npx storybook ai setup` (v2.1)

These two come straight from Storybook's own emitted setup prompt (the live `Prompts/` catalog). They're the difference between stories that *render* and stories that *prove the preview is wired*.

### 33. 📕 No `CssCheck` — no proof the shared preview actually loaded the app's CSS

`toBeVisible()` passes on a completely unstyled component. So a suite where every `play` only asserts visibility has **no evidence** the global stylesheet reached the Storybook iframe — and "the #1 silent failure" (preview missing the CSS import) renders every story unstyled while every test stays green.

The fix is one dedicated proof story, project-wide:

```tsx
// exactly ONE story across the whole project — typically on Button
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: /add to cart/i })
    const bg = getComputedStyle(button).backgroundColor
    // --accent resolves to #aa3bff (light) / #c084fc (dark); either proves CSS loaded
    await expect(['rgb(170, 59, 255)', 'rgb(192, 132, 252)']).toContain(bg)
  },
}
```

- ✓ **Do:** write **exactly one** `CssCheck` asserting a concrete `getComputedStyle` value that resolves a real design token. If `index.css` failed to load, the token is unset and this story — and only this story — goes red, pinpointing the wiring fault.
- ✗ **Don't:** sprinkle `getComputedStyle` probes across many stories (redundant, brittle to token changes) — or omit it entirely and trust `toBeVisible`. `validate-stories.sh` tallies `getComputedStyle` stories across a multi-file scan and warns on 0 or >1.

### 34. 📕 A `play` that proves nothing the render already showed (no-op play)

A `play` whose entire body is `getByRole('button').toBeVisible()` (or `toBeInTheDocument`) adds a green check that asserts what the render already guarantees. It inflates the suite, slows headless runs, and creates false confidence. A `play` earns its place **only** when it asserts one of: an **interaction** (click/type → state change), **async data** (`findBy*` after MSW resolves), a **portal** (querying `canvasElement.ownerDocument.body`), a **CSS-driven state** (computed style — but see #33, exactly one), or **accessibility** (focus order, `aria-pressed` flip).

- ✓ **Do:** leave variant-only stories (Primary/Secondary/Danger) with **no** `play` — the render *is* the test. Reserve `play` for the states that need driving or awaiting.
- ✗ **Don't:** add a `play` to every story for symmetry. `validate-stories.sh` check 13 warns when a `play` body shows no interaction / async / portal / computed-style signal. (Inverse of #11: #11 says an interactive component needs *at least one* real play; #34 says don't pad the rest with no-ops.)

## Verification record

Trimmed 2026-05-27 from 312 → ~120 lines. Cut verbose code blocks for textbook items (1–13); kept the MCP/skill legend, the workflow items, and the designer-grade items that are this skill's actual differentiator.
