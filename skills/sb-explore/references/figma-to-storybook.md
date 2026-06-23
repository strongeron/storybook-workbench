# Figma → Storybook → Production — the roundtrip

The narrow problem this reference owns: **a designer hands over a Figma frame, and the agent needs a single path from "Figma node URL" to "shipped component callable from app code, with the old version archived."** Labs covers the "playground" half; this reference covers the workflow seams Labs doesn't make explicit.

## When to load this reference

- "implement this Figma frame" / "land this Figma design"
- "iterate on this design without touching app code yet"
- "we have a redesign coming — how do we stage it"
- "the V2 of `<X>` from Figma — where does it go"
- The user pastes a Figma URL (file or node)

## The roundtrip in one diagram

```
Figma frame                                                                Old component
    │                                                                          ▲
    │ 1. extract node URL + light/dark frames + viewport                       │
    ▼                                                                          │ 7. archive (tag deprecated)
Labs/<topic>/<frame-name>.stories.tsx     ← starts here                        │
parameters.design = { type: 'figma', url }                                     │
    │                                                                          │
    │ 2. iterate (Controls + pseudo-states + measure)                          │
    ▼                                                                          │
Visual + interactive prototype, designer-reviewable URL                        │
    │                                                                          │
    │ 3. graduation gate (Labs → Components)                                   │
    ▼                                                                          │
Components/<Domain>/<Name>.stories.tsx                                         │
    │                                                                          │
    │ 4. propagation (codemod sketch updates callsites)                        │
    ▼                                                                          │
App callsites consume new component  ───────────────────────────────────────┘
    │
    │ 5. lifecycle tag the old version
    ▼
Old component story keeps `tags: ['deprecated']` + amber banner until removed
```

The four seams Labs doesn't make explicit are step 1 (extraction), step 4 (propagation), step 5 (deprecation), step 7 (archive). Steps 2 and 3 are already covered in `references/labs-workflow.md`.

## Step 1 — Land the Figma node as a Labs story

Ask the user (or infer from the pasted URL):

| Question | Why it matters |
|---|---|
| Which Figma node? | The frame URL must include `?node-id=`; without it `parameters.design` will only deep-link to the file, not the specific frame |
| Light + dark, or just one? | Light frame → one story; dual-theme → use `@storybook/addon-themes` to swap; per-theme frame URLs → two stories with different `parameters.design.url` |
| Viewport? | Maps to `parameters.viewport.defaultViewport`. Defaults: `mobile1`, `tablet`, `responsive` |
| Static or interactive? | Static → `render` returns markup; interactive → `useArgs`/`useState` and (optionally) `play` |
| New component or redesign of existing? | New → `Labs/<topic>/<name>` and create the component from scratch in the story file. Redesign → import existing component, override props/markup inline; once stable, the old component file gets replaced |

Scaffold the file (template at `templates/figma-frame-labs.tsx` — or use this skeleton directly):

```tsx
// src/stories/labs/<topic>/<frame-name>.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

// Import the existing component for a redesign, or build inline for a new one
// import { OldHero } from '@/components/old-hero';

function HeroV2Mockup() {
  // Build the frame as a component. Use design tokens, not hex.
  // Replace tokens once verified against Figma color variables.
  return (
    <section className="bg-surface-50 text-foreground p-12">
      {/* ... */}
    </section>
  );
}

const meta = {
  title: 'Labs/Hero/V2',
  component: HeroV2Mockup,
  parameters: {
    layout: 'fullscreen',
    design: {
      type: 'figma',
      url: 'https://www.figma.com/file/<file>/Project?node-id=<node>',
    },
    docs: {
      description: {
        component: `
## Hero V2 — Figma sync

Source: <Figma node link in parameters.design above>.

### Why this exists
Replacing the current Hero. Targeting <reason>.

### What's intentionally different from production
- <one line per significant difference>
        `,
      },
    },
  },
  tags: ['labs', '!autodocs', '!test', 'figma-sync'],
} satisfies Meta<typeof HeroV2Mockup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

Tags:
- `'labs'` — sidebar segment
- `'!autodocs'` / `'!test'` — Labs convention, don't pollute docs / break CI
- `'figma-sync'` — agent-callable filter: "show me all stories currently mirroring a Figma frame"

## Step 2 — Iterate inside Storybook

The point of the playground: change things and see them. Three addons make this Figma-class:

| Addon | What it gives the iteration loop |
|---|---|
| `storybook-addon-pseudo-states` | Hover/focus/active state toggles in the toolbar — see all interactive states without writing 4 stories. Use the **official** Storybook-team package, NOT the third-party `@hover/` fork (see sb-setup install-wizard) |
| `@storybook/addon-measure` | Hold ⌥ to see box-model overlay — verify spacing against Figma's auto-layout values |
| `@storybook/addon-outline` | Toggle layout-debug outlines — catch flexbox/grid traps the static frame hides |
| `@storybook/addon-themes` | Light/dark switcher — dual-theme Figma frames stay in one story |
| `@storybook/addon-designs` | The Figma frame embedded next to your story for side-by-side compare |

If `addon-designs` is wired, `parameters.design = { type: 'figma', url }` (already in the scaffold) renders the Figma frame in the addon panel. Designer + agent now see both at once.

## Step 3 — Graduation gate

Already documented in `references/labs-workflow.md`. Same four criteria:

1. Stable API
2. ≥3 callsites planned
3. Designer-reviewed
4. Tokens, not magic numbers

Plus one extra for Figma roundtrip:

5. **Figma frame final** — designer marks the Figma frame "ready" / "v1 final" / equivalent. Iterating on the frame after promotion fragments the source of truth.

## Step 4 — Propagation to app callsites — **preserve the experiment**

**Critical rule:** the Explore (Labs) story stays where it is. Don't `git mv` it. Production gets a new file (Path A) or the existing component evolves in place (Path B). The Explore record is design history.

Full decision tree + sub-paths: `references/propagate-workflow.md`. Two-line summary here:

### Path A — NEW component (Explore defined a net-new component)

```bash
cp src/explore/hero/v2.tsx src/components/hero/Hero.tsx              # copy, don't move
touch src/components/hero/Hero.stories.tsx                            # fresh production stories
# (agent writes production states per references/with-mcp.md / without-mcp.md)
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh src/components/hero/Hero.stories.tsx
```

### Path B — UPDATE existing component (V2 evolves V1)

```bash
# Agent edits src/components/hero/Hero.tsx with V2 changes (reads src/explore/hero/v2.tsx as the spec)
# Agent updates src/components/hero/Hero.stories.tsx with new states V2 introduced
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh src/components/hero/Hero.stories.tsx
```

### Codemod callsites (both paths — only if import path changed)

```bash
ast-grep --pattern 'import { Hero } from "@/components/old-hero"' \
         --rewrite  'import { Hero } from "@/components/hero"' \
         --update-all
# Prop rename example:
ast-grep --pattern '<Hero variant=$X />' --rewrite '<Hero kind=$X />' --update-all
```

Run the codemod, commit the diff, delete the codemod. The diff is the artifact.

## Step 5 — Close the decision loop — Explore tags update IN PLACE

Update the Explore story tags (don't move the file):

```tsx
// src/explore/hero/v2.stories.tsx — update IN PLACE
const meta = {
  title: 'Explore/Hero/V2',                       // unchanged
  component: HeroV2,                              // unchanged
  parameters: {
    layout: 'fullscreen',
    design: { type: 'figma', url: '...' },        // unchanged
    decision: {                                   // NEW — feeds DecisionsDashboard
      status: 'chosen',
      winner: 'V2',
      date: '2026-05-29',
      shippedTo: 'Components/Marketing/Hero',
    },
    docs: {
      description: {
        component: '## Chosen 2026-05-29 — shipped to **Components/Marketing/Hero**\n\nKept here as the historical record of what we tested.',
      },
    },
  },
  tags: ['explore', 'decision:chosen', 'archived', '!autodocs', '!test', 'figma-sync'],
  //     ^^^^^^^^   ^^^^^^^^^^^^^^^^^^ NEW   ^^^^^^^^ NEW
} satisfies Meta<typeof HeroV2>;
```

Then (Path B2 only — keeping V1 alongside): mark the old version deprecated:

```tsx
// src/components/_legacy/hero/Hero.stories.tsx — only if you kept V1 alongside
const meta = {
  title: 'Components/_Legacy/Hero',
  tags: ['autodocs', 'deprecated'],
  parameters: {
    docs: { description: { component: '**DEPRECATED 2026-05-29** — replaced by Components/Marketing/Hero. Scheduled for removal in v3.2 (target: 2026-07-01).' } },
  },
};
```

See `references/propagate-workflow.md` for the full decision tree + anti-patterns, and `references/lifecycle-tags.md` for the tag taxonomy.

## Step 6 — Run the validator + designer sign-off

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh \
  src/components/hero/Hero.stories.tsx \
  src/explore/hero/v2.stories.tsx
# Plus src/components/_legacy/hero/Hero.stories.tsx ONLY if Path B2 (kept V1 alongside)
```

All must PASS. Then designer opens:
- `Decisions/Dashboard` to confirm V2 is in the Chosen column with rationale + date
- `Explore/Hero/V2` to see the historical iteration with the chosen banner
- `Components/Marketing/Hero` to see what's shipping
- Gallery view for `tag:deprecated` (Path B2 only) to confirm the old version is reachable but visibly marked

## Anti-patterns specific to the Figma roundtrip

1. **`git mv` the Explore story to `src/components/`.** Destroys the experiment. Use `cp` (Path A) or evolve the existing component (Path B); the Explore story stays in place with updated tags. See `references/propagate-workflow.md`.
2. **Skipping `parameters.design`.** Without the Figma URL in the story, future iterations lose the source-of-truth link. Always wire `addon-designs` for Figma-sourced stories.
3. **Iterating on a `Components/` story instead of Explore.** The whole point of Explore is that app code keeps using the old version while you iterate. Promoting before the gate forces app code to track API churn.
4. **Pasting Figma hex/rem values inline.** Verify against the design system tokens; if the token is missing, that's a separate `/ds-token-extract` task. Don't smuggle raw values into the story.
5. **Forgetting to update Explore tags after Ship.** Leaving `'decision:pending'` on a shipped iteration breaks the dashboard. Flip to `'decision:chosen'` + `'archived'`; set `parameters.decision.shippedTo`.
6. **Deleting the old component without leaving a `tags: ['deprecated']` story** (Path B2 only). Loses design history; loses visual regression coverage of the old design during migration.

## Worked example — a production Hero redesign roundtrip

The shape this should take, sketched from `stories/pages/public/hero/HeroVariants.stories.tsx` + `stories/pages/public/courses/CoursesLandingV2.stories.tsx`:

- Old Hero — `src/components/hero-image.tsx`, used by `app/frontend/pages/home.tsx`
- New design landed as `stories/pages/public/hero/HeroVariants.stories.tsx` with `title: 'Public Pages/Hero/Variants'` — that codebase called this "Variants" instead of `Labs/`, naming convention only
- Graduated: still pending in the production codebase — both versions coexist via title naming, not lifecycle tags. **This is exactly the gap `references/lifecycle-tags.md` closes.**

A clean roundtrip would be:
1. New design lands at `src/stories/labs/hero/variants.stories.tsx`
2. Designer iterates → graduation gate met
3. New `src/components/hero/` ships, `app/frontend/pages/home.tsx` updated
4. Old `src/components/hero-image.tsx` stays one release with `tags: ['deprecated']` story
5. Next release: file removed, gallery `tag:deprecated` empties → confirms cleanup

## Verification record

This reference codifies the seams that already exist implicitly in `labs-workflow.md` (steps 2-3) plus the seams the production app's naming-only convention leaves unresolved (steps 1, 4, 5, 7). The codemod sketch uses `ast-grep` not `jscodeshift` because it's faster to write and SB10's TypeScript-heavy story files are friendlier to ast-grep's pattern syntax.
