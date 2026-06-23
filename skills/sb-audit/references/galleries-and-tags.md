# Galleries and Tags — Storybook as an Auditable Workflow Surface

The reframe this reference owns: **tags are not a taxonomy slot. They are workflow scenarios.** A tag like `'empty-state'` answers a question ("show me every empty state across the app"), not a category ("where does this story live"). The `TagGallery` wrapper projects existing stories into a single canvas filtered by a tag — a *view* over the catalog, not a copy.

This unlocks two compounding capabilities:

1. **Audit-by-aggregation** — surface drift across the app on one screen. Cleanup work becomes targeted.
2. **Agent-driven scenario composition** — the agent can answer "show me X" or "build a flow of Y" by adding tags + rendering a gallery, no manual file authoring per request.

This pattern was developed by Anton (head of design, Evil Martians) for the Rememba project. It is **not native to Storybook**. Storybook has sidebar tag-filtering, but no built-in cross-cutting canvas. The ~50-LOC wrapper below fills the gap.

## Why this matters — proof from real codebases

Survey of a production codebase (191 production stories, no Anton-style galleries in use):

```
17 export const Empty: Story = {
14 export const EmptyState: Story = {
 6 export const WithError: Story = {
 3 export const Loading: Story = {
 2 export const EmptyStateView / EmptyName / EmptyLesson / ResourcesEmpty / InteractiveEmpty
 1 ScheduleEmpty / WidgetInEmptyState / TeacherEmpty / StudentsEmpty / StudentEmpty / ...
```

**17+ different names for "empty state" across 191 stories.** This drift is invisible until aggregated. A single `tags: ['empty-state']` + a 3-line `EmptyStateGallery.stories.tsx` would expose it in one canvas — and the canonical version can be picked, the others updated to match.

This is what makes galleries a *workflow* tool, not a docs pattern.

## The five tag layers — orthogonal taxonomies

Tags compose. A single story declaration can carry tags from multiple layers; each layer answers a different question.

| Layer | Examples | Question it answers | Where applied |
|---|---|---|---|
| **`autodocs`** | `'autodocs'`, `'!autodocs'` | Should this story appear in the auto-generated docs page? | Meta (most stories) |
| **Audience** | `'platform'`, `'public'`, `'admin'`, `'mobile'` | Which user-segment does this story serve? Sidebar filter. (production pattern.) | Meta |
| **State** | `'empty-state'`, `'loading'`, `'error'`, `'success'`, `'permission-denied'` | Which UI state? Gallery aggregator. (Anton pattern.) | Story (or meta if all stories share the state) |
| **Track** | `'labs'`, `'motion'`, `'wip'`, `'needs-work'` | Is this story in Labs / a motion experiment / mid-iteration? | Meta |
| **Lifecycle** | `'experimental'`, `'v2-preview'`, `'deprecated'`, `'ai-generated'`, `'needs-design-review'` | What's the story's maturity in the design lifecycle? See `references/lifecycle-tags.md` for the full taxonomy + optional decorator banner + badges-addon. | Story (sometimes meta if all stories share status) |

Optional extensions a project may add:

| Layer | Examples | Question |
|---|---|---|
| **Layout** | `'list'`, `'grid'`, `'form'`, `'detail'`, `'card'` | Which layout pattern? |
| **Flow** | `'onboarding'`, `'checkout'`, `'auth-flow'` | Part of a multi-step flow? |
| **Feature** | `'billing'`, `'course-builder'`, `'messaging'` | Which product feature? |

A story can declare any combination:

```ts
const meta = {
  title: 'Pages/Platform/Student/Dashboard',
  tags: ['autodocs', 'platform'],   // meta-level: docs + audience
} satisfies Meta<typeof Dashboard>;

export const EmptyState: StoryObj<typeof meta> = {
  tags: ['empty-state', 'list'],    // story-level: state + layout (merged with meta tags)
  args: { courses: [], enrollments: [] },
};
```

Story-level tags **merge** with meta-level. Prefix with `!` to subtract a meta-level tag at the story level.

## Anton's `TagGallery` wrapper — verbatim + project-agnostic adaptation

The wrapper Anton wrote for Rememba (use as-is if your folder layout matches; adapt the globs otherwise):

```tsx
// src/stories/TagGallery.tsx
import type { ComponentType } from 'react';
import type { StoryFn } from '@storybook/react-vite';

const modules = {
  ...import.meta.glob('../screen/**/*.stories.tsx', { eager: true }),
  ...import.meta.glob('../components/**/*.stories.tsx', { eager: true }),
} as Record<string, Record<string, StoryFn & { tags?: string[]; args?: Record<string, unknown> }>>;

function collectByTag(tag: string) {
  return Object.entries(modules).flatMap(([path, mod]) => {
    const Component = (mod.default as any)?.component as ComponentType<Record<string, unknown>>;
    return Object.entries(mod)
      .filter(([name, story]) => name !== 'default' && story?.tags?.includes(tag))
      .map(([name, story]) => ({ name, path, Component, args: story.args ?? {} }));
  });
}

export function TagGallery({ tag }: { tag: string }) {
  const stories = collectByTag(tag);
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height: '100vh',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 48,
        padding: 40,
      }}
    >
      {stories.map(({ name, path, Component, args }) => {
        const label = path.split('/').slice(-2, -1)[0];
        return (
          <div key={`${path}-${name}`}>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#888' }}>
              {label} / {name}
            </div>
            <div
              style={{
                padding: 40,
                borderRadius: 16,
                backgroundColor: 'var(--color-canvas-raised)',
                width: 640,
                height: 360,
                overflow: 'auto',
              }}
            >
              <Component {...args} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Three production-ready variants** the original snippet doesn't ship — write whichever matches the project. All maintain zero duplication (galleries are projections, not copies):

### Variant A — multi-tag intersection

When you want stories that match **all** the tags (e.g., "every empty state on platform pages"):

```tsx
export function TagGallery({ tags }: { tags: string[] }) {
  const stories = collectByAllTags(tags);
  // ...same render
}

function collectByAllTags(tags: string[]) {
  return Object.entries(modules).flatMap(([path, mod]) => {
    const Component = (mod.default as any)?.component;
    const metaTags = (mod.default as any)?.tags ?? [];
    return Object.entries(mod)
      .filter(([name, story]) => {
        if (name === 'default') return false;
        const allTags = new Set([...metaTags, ...(story?.tags ?? [])]);
        return tags.every((tag) => allTags.has(tag));
      })
      .map(([name, story]) => ({ name, path, Component, args: story.args ?? {} }));
  });
}
```

### Variant B — ordered gallery for flows

When stories represent steps of a flow (onboarding, checkout, auth), respect explicit ordering:

```tsx
// On the story:
export const Step1Welcome: Story = {
  tags: ['onboarding'],
  parameters: { flowOrder: 1 },
  args: { ... },
};
export const Step2Profile: Story = {
  tags: ['onboarding'],
  parameters: { flowOrder: 2 },
};

// In the wrapper:
function collectByTagSorted(tag: string) {
  return Object.entries(modules)
    .flatMap(([path, mod]) => /* ...collect... */)
    .sort((a, b) => (a.flowOrder ?? Infinity) - (b.flowOrder ?? Infinity));
}
```

Without `flowOrder`, fall back to alphabetical sort by story name — which works if you prefix step stories `Step1`, `Step2`, etc.

### Variant C — grid layout for visual scanning

The default vertical-stack layout is good for in-depth review. For visual scanning across many states, switch to a CSS grid:

```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 640px)', gap: 32, padding: 40 }}>
  {stories.map(...)}
</div>
```

## Wiring galleries — the standard pattern

One gallery file per cross-cutting scenario. Live under a `Galleries/*` top-level title so they cluster in the sidebar.

```tsx
// src/stories/galleries/EmptyStateGallery.stories.tsx
import type { Meta } from '@storybook/react-vite';
import { TagGallery } from '../TagGallery';

export default {
  title: 'Galleries/Empty State',
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],   // galleries are tools, not documentation
} satisfies Meta;

export const All = () => <TagGallery tag="empty-state" />;
```

Three lines per gallery. Add one for every workflow scenario the team wants to audit.

**Suggested starter set** for a project starting from scratch:

```
src/stories/galleries/
├── EmptyStateGallery.stories.tsx       (tag: 'empty-state')
├── LoadingGallery.stories.tsx          (tag: 'loading')
├── ErrorGallery.stories.tsx            (tag: 'error')
├── FormStatesGallery.stories.tsx       (tag: 'form')
└── OnboardingFlowGallery.stories.tsx   (tag: 'onboarding', sorted by flowOrder)
```

## Agent workflow — galleries as a callable primitive

The reframe that the user introduced and this section captures: **the agent doesn't need to invent a workflow per request. It uses tags + galleries as a query mechanism.**

When the user asks "show me X" or "build a flow of Y":

### Pattern 1 — "Show me all [state]"

Example: "show me all empty states"

```
1. Survey existing tags:
   grep -rE "tags:" stories/**/*.stories.tsx | grep -oE "'[a-z-]+'" | sort | uniq -c
2. Identify the matching tag (or coin one if it doesn't exist):
   If 'empty-state' tag already exists → step 4.
   If only 'Empty' story names exist (no tag) → step 3.
3. Tag the relevant stories — find all stories named Empty / EmptyState / *Empty*:
   add `tags: ['empty-state']` to the story-level declaration.
4. Generate the gallery story file (if not present):
   src/stories/galleries/EmptyStateGallery.stories.tsx → 3 lines, tag="empty-state".
5. Tell the user where it is + the URL:
   "Open http://localhost:6006/?path=/story/galleries-empty-state--all"
```

The agent can do steps 1–4 unattended. Step 5 is the handoff.

### Pattern 2 — "Build a flow of [feature]"

Example: "build me the onboarding flow"

```
1. Identify the steps — survey stories or screens involved in onboarding
   (use file paths, story names, or component imports as hints).
2. Tag each step story with the flow tag + the order:
   tags: ['onboarding'], parameters: { flowOrder: 1 }
   tags: ['onboarding'], parameters: { flowOrder: 2 }
   ...
3. Generate an ordered gallery using TagGallery Variant B (flowOrder sort).
4. Hand back the URL.
```

The flow gallery shows every step in order — designer can walk through the onboarding without running the live app.

### Pattern 3 — "Audit [scenario]"

Example: "audit all our list pages on mobile"

```
1. Use multi-tag intersection (Variant A): tags={['list', 'mobile']}
2. If only one of the tags exists, add the missing one to the relevant stories.
3. Generate the gallery + hand back URL.
```

### Pattern 4 — "What scenarios do we have right now?"

```
1. Scan all tag values: grep -rE "tags:" stories/**/*.stories.tsx | extract tags | sort | uniq -c
2. Report: "You have 47 stories tagged 'empty-state' (3 of them on platform pages),
   12 tagged 'loading', 18 tagged 'onboarding' (across 4 sub-flows)."
3. Suggest galleries to create for tags >5 occurrences if no gallery exists yet.
```

## The audit workflow — what to do with a gallery once it exists

1. **Open the gallery.** All matches on one canvas.
2. **Look for drift.** Inconsistency in spacing, color, copy, illustration style, button labels, icon usage. The visual scan is the audit.
3. **Pick the canonical version.** Usually the most recent, most complete, or most aligned with the design system.
4. **Plan cleanup.** List the variants that need to match the canonical. Often: rename, retag, update component to share a primitive (e.g., `<EmptyState>` component), retire one-off variants.
5. **Iterate.** Apply cleanup. Optionally: build a Labs/ variant exploring a redesigned empty state, get designer approval, graduate to Components/.
6. **Re-open the gallery.** Confirm drift is gone. Or surface new drift you missed.

This loop is the recurring use case. It's why Anton's pattern exists — and why baking it into the skill matters.

## Where galleries live in the production sidebar

Two valid placements:

### Pattern (a) — Top-level `Galleries/*` section

Storybook taxonomy adds `Galleries` as a top-level group, appears in the sidebar like Foundations / Components / Pages / Flows / Labs / **Galleries**.

```ts
// .storybook/preview.ts
storySort: {
  order: ['Foundations', 'Components', 'Pages', 'Flows', 'Labs', 'Galleries'],
}
```

Pro: galleries cluster in one place, easy to find.
Con: takes top-level sidebar real estate.

### Pattern (b) — Nested under existing sections

Place each gallery near the audit target:

```
Components/Empty States/Gallery   (TagGallery tag="empty-state")
Pages/Platform/Audit              (TagGallery tags=['platform']]
```

Pro: gallery sits adjacent to the work it audits.
Con: less discoverable, scattered across sidebar.

**Recommended:** Pattern (a) for first project use; Pattern (b) when you've built ≥5 galleries and want them near the audit target. Set in wizard during install, document in `.storybook/README.md`.

## Connecting to Labs

Galleries and Labs are complementary:

- **Galleries** are *backward* — audit existing stories for drift.
- **Labs** are *forward* — prototype new versions before they ship.

A typical flow:

```
Extract → Components/* (snapshot existing app)
   ↓
Galleries → see drift across stories (e.g., 17 different empty states)
   ↓
Labs/Visual/* → iterate on a clean empty-state design
   ↓
Designer approves
   ↓
Graduation gate met → Labs/Visual/EmptyState becomes Components/Display/EmptyState
   ↓
Existing stories swap their inline empty-state JSX for <EmptyState> component
   ↓
Re-run gallery → 17 variants collapsed to 1
```

The gallery is the metric: "did the cleanup actually consolidate?"

## What Storybook docs and general model knowledge typically miss

This is the value-add of this reference (the rest is in textbooks):

1. **Tags as workflow scenarios, not taxonomy** — docs treat tags as a flat label system; this reframes them as a query layer.
2. **The 4-layer tag taxonomy** (autodocs / audience / state / track) — composed orthogonally, not in textbooks.
3. **The `TagGallery` wrapper itself** — pattern not in Storybook docs; ~50 LOC, project-portable.
4. **Multi-tag intersection + ordered flow gallery** — extensions that turn one wrapper into a query language.
5. **The agent workflow** — "show me X" / "build a flow of Y" → tag + gallery scaffold, unattended.
6. **The Galleries-Labs loop** — backward audit + forward experiment, with metric closure.
7. **Concrete proof** — the production app's 17-variant empty-state drift as the canonical example.

## Anti-patterns

1. **Duplicating story content into the gallery file** — galleries must use `import.meta.glob` projection, never inline. Otherwise the gallery drifts the moment a story changes.
2. **Mixing tag layers without convention** — `tags: ['empty', 'EmptyState', 'is-empty']` defeats the purpose. Pick one convention (kebab-case state names is the default).
3. **Galleries without `'!autodocs'`** — they pollute the docs page. Galleries are tools, not docs.
4. **`flowOrder` in `args` instead of `parameters`** — args are controllable from the toolbar; parameters are story metadata. Order belongs in metadata.
5. **One gallery file per tag manually maintained** — if the team grows past ~10 galleries, build a `GalleriesIndex.stories.tsx` that surveys all tags and links each. Don't hand-maintain a list.
6. **Project-specific globs in the wrapper** — when porting, ALWAYS adjust `import.meta.glob` paths to match the target project's `stories` directory structure. The wrapper isn't truly portable until this is verified.

## Verification record

This reference captures:
- Anton's TagGallery wrapper (2026-05-25 Slack thread, Rememba project) — verbatim
- Three production-ready variants (intersection / ordered / grid) added by this skill
- 4-layer tag taxonomy synthesizing Anton's state-tag work + the production app's audience-tag pattern
- The agent-callable workflow framing (added per user direction 2026-05-27)
- Concrete proof-by-data using a production app's 191 stories survey

Storybook does not ship this natively. Closest patterns (`@storybook/blocks` Canvas, autodocs aggregation, MCP `preview-stories`) all aggregate per-component or return URLs — none of them project a tag-filtered set into a single canvas.
