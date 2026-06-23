# Composition Patterns — beyond one-story-per-state

The unique value here: **five composition patterns observed in 191 production stories that AI agents reliably reinvent each time.** They aren't anti-patterns — they're the patterns that make Storybook a stakeholder-reviewable surface for design exploration, not just a per-component catalog.

**v1.7 update:** these patterns now have backing wrappers in `.storybook/wrappers/` (see `references/wrapper-library.md`). The pattern descriptions below are still the conceptual reference; the wrappers are the runnable implementation. Scaffold via `${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 1` to get `<ABCanvas>`, `<StateGrid>`, `<StateMatrix>`, etc.

| Pattern | Wrapper to use (v1.7) |
|---|---|
| A/B Comparison | `<ABCanvas>` |
| Role Comparison | `<StateGrid>` with `role` as the varied prop — only after an audit shows role-gated UI |
| Status Grid | `<StateGrid>` |
| Page Composition | `<StorySet ids={[...]} layout="strip">` or hand-rolled |
| Configurable Scrubbable | `<ShaderCanvas>` for visual experiments (opt-in 3D tier) |

The patterns:

1. **A/B Comparison** — two design directions side-by-side
2. **Role Comparison** — same component rendered for each user role (Teacher · Student · Admin)
3. **Status Grid** — every state of a component on one canvas
4. **Page Composition** — assemble a full page from real components inside a single story
5. **Configurable Scrubbable Prototype** — typed-args extension exposing stakeholder-tunable Controls

Each pattern below: when-to-use → naming convention → minimal snippet → anti-pattern that breaks it.

## When to load this reference

- The user says "let's compare two designs" / "side-by-side"
- The user says "show me this from every role" / "all permissions"
- The user wants every state of a component on one screen ("all variants", "status grid")
- The user wants to build/preview a full page assembled from existing components
- The user wants stakeholder-tunable prototypes ("let the PM change the trigger threshold and watch it scroll")
- Reviewing existing stories — these patterns commonly show up and aren't anti-patterns despite looking like mega-stories

## Pattern 1 — A/B Comparison

The story renders two complete design directions side-by-side with labeled headers. Used during design exploration (not after a direction is chosen).

**When to use**
- Stakeholder review of two candidate flows / heroes / forms
- Iteration loop between designer and PM before committing
- Visual diff that shipping side-by-side makes obvious

**Naming convention**
- Story name: `Comparison_<Topic>` or `<Topic>: A vs B`
- Story tag: `'comparison'` (Galleries can aggregate all comparisons)
- Title typically lives under `Public Pages/<Section>/` or `Labs/Comparisons/`

**Skeleton**
```tsx
export const Comparison_HeroVariants: Story = {
  name: 'Comparison: Current vs Iteration',
  parameters: { layout: 'fullscreen' },
  tags: ['comparison'],
  render: () => (
    <div className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-2">
      <div>
        <h2 className="bg-surface-100 mb-4 px-4 py-2 text-lg font-bold">Current (Button-driven)</h2>
        <CurrentHero />
      </div>
      <div>
        <h2 className="bg-surface-100 mb-4 px-4 py-2 text-lg font-bold">Iteration (Inline input)</h2>
        <IterationHero />
      </div>
    </div>
  ),
};
```

**What this is NOT**
- Not a way to ship both designs to production — pick one, deprecate the other
- Not a mega-story (the components are real, just rendered twice)

## Pattern 2 — Role Comparison

Same component rendered for each user role on one canvas, so designers can see how the UI changes by audience.

**When to use**
- Permission-sensitive UI (Teacher dashboard vs Student dashboard)
- Multi-tenant or multi-role components (Live Session card seen by Teacher vs Student)
- Catching role-specific drift (Teacher action missing for Admin)

**Naming convention**
- Story name: `RoleComparison_<Topic>` or `<Topic>: Teacher vs Student`
- Story tag: `'role-comparison'`
- Often paired with the audience tag layer (`'platform'`, `'public'`)

**Skeleton**
```tsx
export const RoleComparisonLive: Story = {
  name: 'Live Session: Teacher vs Student vs Admin',
  parameters: { layout: 'padded' },
  tags: ['role-comparison', 'platform'],
  render: () => (
    <div className="space-y-8">
      {(['teacher', 'student', 'admin'] as const).map(role => (
        <section key={role}>
          <h3 className="text-foreground mb-2 text-sm font-semibold uppercase tracking-wide">{role}</h3>
          <LiveSessionCard role={role} session={mockSession} />
        </section>
      ))}
    </div>
  ),
};
```

**What this is NOT**
- Not a replacement for per-role stories — the role-comparison story complements `LiveSessionCard_Teacher`, `LiveSessionCard_Student` (those are visual-regression anchors)
- Not where you cover role-specific empty/error states — those still need their own stories

## Pattern 3 — Status Grid

Every state of a component on one canvas. Distinct from per-state stories: those are visual-regression anchors; the status grid is the *designer's overview*.

**When to use**
- Status badges (4 statuses → render all 4)
- Empty/Loading/Default/Error/Success on one canvas
- "Show me every state" requests

**Naming convention**
- Story name: `StatusGrid` or `AllStates` or `<Topic>: All States`
- Story tag: `'status-grid'`

**Skeleton**
```tsx
const STATUSES = ['draft', 'pending', 'live', 'past'] as const;

export const StatusGrid: Story = {
  name: 'All Statuses',
  parameters: { layout: 'padded' },
  tags: ['status-grid'],
  render: () => (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {STATUSES.map(status => (
        <div key={status}>
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">{status}</p>
          <CourseCard course={createMockCourse({ state: status })} />
        </div>
      ))}
    </div>
  ),
};
```

**What this is NOT**
- Not a mega-story — only one prop varies, semantically meaningful, deterministic factory inputs
- Not the only state coverage — per-state stories still exist for visual regression

## Pattern 4 — Page Composition

Assemble a full page from real components inside a single story. Goes beyond per-component catalog: stakeholders see the page they'll ship.

**When to use**
- Landing page review (hero + features + CTA in one canvas)
- Multi-step flow review (4 modals in sequence)
- Designer/PM stakeholder approval of a whole page

**Naming convention**
- Story name: `Page_<Name>` or `<Section>: Full Flow`
- Story tag: `'page-composition'`
- Title under `Pages/<audience>/<Name>` or `Public Pages/<Section>/`
- `parameters.layout: 'fullscreen'` (always — partial-width breaks the composition)

**Skeleton**
```tsx
export const Page_LandingFlow: Story = {
  name: 'Landing Flow (Complete)',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story: `
## Landing flow — Jobs to be Done
1. **Hero**: "When I land here, I want to immediately understand what this is."
2. **Course grid**: "When I browse, I want to see what's available."
3. **CTA**: "When I'm interested, I want to sign up without friction."
        `,
      },
    },
  },
  tags: ['page-composition', 'public'],
  render: () => (
    <div>
      <Hero />
      <section className="bg-surface-50 py-16">
        <h2 className="mb-8 text-center text-3xl">Courses</h2>
        <CourseGrid courses={sampleCourses} />
      </section>
      <section className="py-24">
        <EarlyAccessCTA />
      </section>
    </div>
  ),
};
```

**What this is NOT**
- Not a Next.js/Inertia/Rails-rendered page — the story renders the *composition*, the routing layer is mocked or omitted
- Not a substitute for component-level coverage — per-component stories still exist
- Not the place for app-specific data fetching — use factories from `references/factory-patterns.md`

**Key value-add** — the JTBD prose inside `parameters.docs.description.story` (Jobs to be Done framing). production teams use this consistently in composition stories; it's the seam that makes the story stakeholder-readable, not just designer-readable. The skill recommends this as a section header inside any Page Composition story.

## Pattern 5 — Configurable Scrubbable Prototype

A story with a typed args extension that exposes prototype-tunable parameters as Controls. The PM/designer drags a slider and the prototype updates live.

**When to use**
- Motion experiments (tune duration/delay/easing live)
- Threshold/trigger tuning (scroll trigger %, debounce delay)
- A/B threshold candidates the PM wants to feel before picking

**Naming convention**
- Story name: `Configurable_<Behavior>` or `<Topic>: Tunable`
- Story tag: `'scrubbable'`
- Always Labs-scoped — these are exploration, not production

**Skeleton**
```tsx
interface TunableScrollArgs {
  triggerOffset: number;
  durationMs: number;
  easing: 'linear' | 'ease-out' | 'ease-in-out';
}

export const Configurable_ScrollTrigger: StoryObj<TunableScrollArgs> = {
  name: 'Scroll Trigger (Tunable)',
  argTypes: {
    triggerOffset: { control: { type: 'range', min: 0, max: 100, step: 5 }, description: 'When (% scrolled) to trigger' },
    durationMs: { control: { type: 'range', min: 100, max: 2000, step: 50 }, description: 'Animation duration in ms' },
    easing: { control: { type: 'select' }, options: ['linear', 'ease-out', 'ease-in-out'] },
  },
  args: { triggerOffset: 40, durationMs: 600, easing: 'ease-out' },
  tags: ['scrubbable', 'labs', '!autodocs', '!test'],
  render: (args) => <ScrollPrototype {...args} />,
};
```

The typed `StoryObj<TunableScrollArgs>` is the key — it's *not* `StoryObj<typeof meta>` here, because the args shape extends beyond the component's own props. SB10 supports this and it gives the Controls panel exactly the levers the PM needs.

**What this is NOT**
- Not a way to ship a configurable component — Controls are an exploration UI, not a runtime API
- Not where you assert behavior — `play` functions still belong on the per-state stories

## Choosing between patterns

| User says | Pattern |
|---|---|
| "compare two designs" / "side-by-side" | A/B Comparison |
| "show me from every role" / "all permissions" | Role Comparison |
| "show all states" / "every variant" | Status Grid |
| "full page" / "whole flow" / "everything together" | Page Composition |
| "let me tune" / "scrubbable" / "play with the timing" | Configurable Scrubbable Prototype |

When patterns overlap (full-flow Page Composition that's also an A/B), prefer Page Composition with `tags: ['page-composition', 'comparison']`. Tag composition is the point.

## Anti-patterns specific to composition

1. **Composition as the only coverage.** A `Page_LandingFlow` story doesn't replace per-component coverage — Hero, CourseGrid, CTA each need their own state coverage.
2. **Composition with fake components.** If `Page_LandingFlow` reaches for a `<MockHero />` instead of the real `<Hero />`, you've built a Figma replica, not a Storybook composition. Use real components.
3. **Cartesian explosion inside a Status Grid.** A 4-status × 5-size × 3-theme grid is 60 cells of noise. Pick one axis per grid; if two matter, split into two grids.
4. **No JTBD prose on Page Composition.** Without the framing, stakeholders don't know what they're reviewing. Always include `parameters.docs.description.story`.
5. **`Configurable_*` without `tags: ['labs']`.** Scrubbable prototypes belong in Labs — they pollute production docs otherwise.

## Verification record

Patterns derived from production survey (191 stories):
- A/B Comparison: 8 instances (e.g., `CurrentFlow_Complete` vs `IterationFlow_Complete` in `ConversionFlows.stories.tsx`, `Comparison: Teacher vs Student` in `DashboardSidebar.stories.tsx`)
- Role Comparison: 4 instances (`RoleComparisonLive`, `RoleComparisonNext` in `LiveSessionCard.stories.tsx`)
- Status Grid: 12 instances (`StatusComparison`, `AllStatesView`, `Sizes`, `StatusBadgeVariants`)
- Page Composition: 6 instances (`Page` stories in `pages/public/courses/`, `ConversionFlows`)
- Configurable Scrubbable Prototype: 3 instances (`Configurable_Scroll_Trigger` in `FloatingWidget.stories.tsx`, motion experiments in `CourseCardAnimations.stories.tsx`)
