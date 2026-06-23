# Labs Workflow — Storybook as a Design Playground (not Figma)

> **Terminology:** this reference predates the rename and says **Labs** / `src/stories/labs/` / `['labs']`.
> The canonical term in `SKILL.md` is **Explore** (`.storybook/explore/`, `['explore']`). They are the
> same track — read every "Labs" here as "Explore," and author with the `Explore` names.

The recurring goal: **prototype interactions and visual ideas inside the project, against real types and real components, without polluting the app codebase.** When this works, Storybook replaces a meaningful slice of what Figma is used for — interaction prototyping, motion exploration, state exploration — because the playground IS the production system, one tag-flip away from shipping.

This reference is for the **playground / Labs** flow that runs alongside the production Author flow in SKILL.md. Use it when the user says:

- "let's prototype this animation in Storybook"
- "play with this component in a sandbox before building it"
- "we want to replace Figma for interaction prototyping"
- "where should this experimental component live"
- "set up a design playground"

## The two-track model

Production stories and experiments live side by side in the same Storybook, separated by **disk path**, **title prefix**, and **tags** — not by a separate project.

| Track | Title prefix (suggested) | Disk path | Tags | Visibility |
|---|---|---|---|---|
| **Production** | `Components/*`, `Pages/*`, `Flows/*` | `src/components/<Name>/<Name>.stories.tsx` OR `src/stories/<Name>.stories.tsx` | `['autodocs']` | Sidebar + autodocs + visual regression + designer reviews |
| **Labs** | `Labs/*` (or `Sandbox/*` / `Playground/*` / `Experiments/*` — your call, set in wizard) | `src/stories/labs/<topic>/<experiment>.stories.tsx` | `['labs', '!autodocs', '!test']` | Sidebar visible to you, hidden from autodocs + CI + designer reviews |
| **Animation experiments** | `Labs/Motion/*` (sub-tree of Labs) | `src/stories/labs/motion/<lib>/<experiment>.stories.tsx` | `['labs', 'motion', '!autodocs', '!test']` | Same as Labs; the `motion` tag enables a sidebar filter |

**Critical disk rule:** everything under `src/stories/labs/**` must be excluded from the production bundle (same rule as factories — see `factory-patterns.md`). Vite default ignores `*.stories.*` from production builds; if your config emits the full `src/`, add an explicit exclude.

## Wizard question — name your Labs section

Ask once during install, then enforce project-wide. Use `AskUserQuestion`.

> Where will you put experiments, prototypes, and motion exploration?
> - **`Labs/`** (recommended — neutral, widely understood)
> - **`Sandbox/`** (more playful — common in design-tool teams)
> - **`Playground/`** (most explicit about purpose)
> - **`Experiments/`** (most formal — common in research-driven teams)
> - **Skip** — you don't want a playground section
> - **Custom** — type your own (e.g., `WIP`, `Drafts`, `Spike`)

After selection, write the choice into `.storybook/preview.ts` `storySort` and document it in `.storybook/README.md` so the team uses the same prefix.

## Tag conventions (the filter mechanic)

Storybook supports tag-based filtering in the sidebar (`storybook:filter:<tag>`), tag-based exclusion from autodocs (`'!autodocs'`), and tag-based exclusion from the test runner (`'!test'`).

**The three tag layers:**

| Tag | What it does | Where to set |
|---|---|---|
| `'autodocs'` | Includes story in autodocs page | Meta level — production stories only |
| `'labs'` | Project convention — sidebar filter `Tag: labs`, surfaces "what's in the playground" view | Meta level — every Labs story |
| `'motion'` | Project convention — sub-filter for animation experiments | Meta level — Labs/Motion stories only |
| `'!autodocs'` | Excludes from autodocs page | Meta level — every Labs story (don't pollute docs with WIP) |
| `'!test'` | Skips in test runner / CI | Meta level — every Labs story (don't fail CI on WIP) |
| `'wip'` | Project convention — "I know this is broken, leave me alone" | Story level — for individual stories actively being iterated |
| `'ai-generated'` | Project convention — flag for human review | Story level — when an agent wrote the story |
| `'needs-work'` | Project convention — pairs with `ai-generated` until reviewed | Story level — removed after human pass |

**Story-level tags merge with meta-level**, and `!` prefix subtracts a meta-level tag. So:

```ts
const meta = {
  title: 'Labs/Motion/Card-Reveal',
  tags: ['labs', 'motion', '!autodocs', '!test'],
} satisfies Meta<typeof Card>;

export const FastReveal: StoryObj<typeof meta> = {
  tags: ['wip'],   // merged with meta tags → ['labs','motion','!autodocs','!test','wip']
};

// To graduate a single story into autodocs while keeping the rest as labs:
export const ShippableReveal: StoryObj<typeof meta> = {
  tags: ['autodocs'],   // adds autodocs back; meta's '!autodocs' is overridden at story level
};
```

## Disk layout — keep experiments out of app code

The whole point of the Labs flow is that experiments live in Storybook-only paths the production bundle skips. Two patterns:

```
src/stories/labs/
├── motion/
│   ├── framer-motion/
│   │   ├── card-reveal.stories.tsx
│   │   ├── list-stagger.stories.tsx
│   │   └── README.md             ← optional, explain the experiment's goal
│   ├── motion-one/
│   │   └── modal-transition.stories.tsx
│   └── react-spring/
│       └── drag-to-dismiss.stories.tsx
├── interactions/                  ← Figma-replacement interaction prototypes
│   ├── login-flow.stories.tsx
│   └── checkout-flow.stories.tsx
└── visual/                        ← static visual exploration
    ├── color-density.stories.tsx
    └── card-elevation.stories.tsx
```

Each experiment is a `.stories.tsx` file. Some experiments may import from `src/components/` (using real production components to prototype variants); they may also define **inline experimental components** that never escape `src/stories/labs/**` — that's the whole point of keeping the path isolated.

## Animation library decorator patterns

For animation experiments, expose the library's controls as story args so you can scrub. The pattern is the same regardless of library; concrete examples below.

### Framer Motion / `motion` (the React API)

```tsx
import { motion, AnimatePresence } from 'motion/react';
// or: import { motion, AnimatePresence } from 'framer-motion';

const meta = {
  title: 'Labs/Motion/Card-Reveal',
  tags: ['labs', 'motion', '!autodocs', '!test'],
  argTypes: {
    duration: { control: { type: 'range', min: 0.1, max: 2, step: 0.1 } },
    easing: { control: 'inline-radio', options: ['easeIn', 'easeOut', 'easeInOut', 'circIn', 'circOut'] },
    distance: { control: { type: 'range', min: 0, max: 200, step: 10 } },
  },
  args: { duration: 0.4, easing: 'easeOut', distance: 40 },
  render: function Render({ duration, easing, distance }) {
    const [show, setShow] = useArgs() && false; // pattern only; use AnimatePresence or `key` to retrigger
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: distance }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration, ease: easing }}
        >
          <Card />
        </motion.div>
      </AnimatePresence>
    );
  },
} satisfies Meta;
```

Storybook's range/radio controls turn motion parameters into a designer-grade scrubber.

### Motion One / GSAP / React Spring

Same shape — expose the library's primary tweaking parameters (duration, easing, stiffness/damping for spring physics) as story args. Use `useEffect` + `key` to retrigger on arg change.

### Replay button pattern

For animations that play once and end, add a "replay" play function:

```tsx
export const Default: Story = {
  args: { duration: 0.4 },
  play: async ({ canvasElement }) => {
    // Force remount the animated subtree by bumping a key — pattern is component-specific
  },
};
```

Or wire a remount on every `args` change by deriving a `key` from the args inside `render`.

## Figma-replacement recipe — interaction prototyping

The pattern Figma can't do: **a `play` function that drives the real component through the full interaction** while you watch.

```tsx
// src/stories/labs/interactions/login-flow.stories.tsx
import { LoginForm } from '@/components/forms/LoginForm';
import { userEvent, within, waitFor, expect, fn } from 'storybook/test';

const meta = {
  title: 'Labs/Interactions/Login-Flow',
  component: LoginForm,
  tags: ['labs', '!autodocs', '!test'],
  args: { onSubmit: fn(), onForgotPassword: fn() },
  parameters: {
    layout: 'centered',
    msw: {
      handlers: [
        // Mock the auth API with a deliberate delay so the loading state is visible
        http.post('/auth/login', async () => {
          await delay(800);
          return HttpResponse.json({ user: makeUser() });
        }),
      ],
    },
  },
} satisfies Meta<typeof LoginForm>;

export const HappyPath: StoryObj<typeof meta> = {
  play: async ({ canvas, userEvent, args }) => {
    // The whole interaction Figma can't show you:
    await userEvent.type(canvas.getByLabelText(/email/i), 'me@example.com', { delay: 60 });
    await userEvent.type(canvas.getByLabelText(/password/i), 'correct-horse', { delay: 60 });
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));

    // Loading state is now visible — 800ms of skeleton/spinner
    await expect(await canvas.findByText(/signing in/i)).toBeVisible();

    // Then success
    await waitFor(() => expect(args.onSubmit).toHaveBeenCalledOnce());
  },
};

export const WrongPassword: StoryObj<typeof meta> = {
  parameters: {
    msw: { handlers: [http.post('/auth/login', () => HttpResponse.json({ error: 'bad_credentials' }, { status: 401 }))] },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(/email/i), 'me@example.com', { delay: 60 });
    await userEvent.type(canvas.getByLabelText(/password/i), 'wrong', { delay: 60 });
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));
    await expect(await canvas.findByText(/incorrect/i)).toBeVisible();
  },
};
```

What Figma can't replicate but this gives you:

- **Real timing.** 800ms loading state, 60ms typing cadence, the actual transition durations.
- **Real components.** No "design version drift" — you prototype against `LoginForm` as it ships.
- **Real data shapes.** Mocks come from factories matching the production types (see `factory-patterns.md`).
- **Multi-state coverage.** Happy path + wrong-password + network-error are three stories, all reviewable side by side in the sidebar.
- **Stakeholder demoable.** Send the Storybook URL — clicking the story runs the interaction.

## Two entry styles into Labs — component-first vs story-first (PRD prototype)

Labs experiments arrive two ways. Naming the difference up front decides what graduates and how.

| | **Component-first** | **Story-first (PRD prototype)** |
|---|---|---|
| Starting point | A real component already exists; you're iterating its visuals/states | No component yet — the *screen or feature* is being designed |
| What lives in the `.stories.tsx` | `import` of the real component + new states | A local preview component, local `interface`s for proposed props, local mock builders, and several named "scenario" stories |
| The story is… | a view of the component | **the spec** — each named scenario doubles as an acceptance criterion |
| Graduation produces | refined states on the existing component | a *new* component **and** a real type: the local `interface` becomes the serializer/API contract; the preview component moves to `src/components/` |
| Decision rule | use when the component exists | use when there's no backing type/endpoint yet — "design the screen, wire the backend second" |

Story-first is legitimate and powerful — the prototype is real production code one tag-flip from shipping. Two rules keep it from rotting:

- **Import what already exists.** If the prototype needs a sub-component the app already ships, import the real one; only inline a local stand-in when the real one doesn't exist yet, marked `// TODO: replace with <RealComponent> once it exists` (anti-patterns #27).
- **Extract after sign-off, then collapse to component-first.** Once a scenario is signed off, promote the local preview component to `src/components/` and the local `interface` to the real type/serializer; the story drops to a plain `import` (now component-first). Don't leave the story-first prototype *and* the extracted component both live — that's two sources of truth (anti-patterns #27).

## Graduation gate — when does Labs/X become Components/X

Move from `Labs/` to `Components/` only when **all four** are true:

1. **Stable API.** Props don't change weekly. If you're still renaming `variant` → `kind` → `intent`, stay in Labs.
2. **≥3 callsites planned** in real app code. If only one screen needs it, inline it there; don't promote to design-system.
3. **Designer-reviewed.** A human has looked at the production-grade states (Default · Hover · Focus · Disabled · Loading · Error) in Storybook and signed off.
4. **Tokens, not magic numbers.** Color, spacing, radius all reference design tokens — no inline `#ababab` or `marginTop: 13`.

When all four are met, **graduate via the preserve-don't-destroy model** — do NOT `git mv` the experiment away. The Ship flow in `references/propagate-workflow.md` is the source of truth: **copy** the component into production (Path A new / Path B update), write a fresh production stories file, and update the Labs story *in place* with `decision:chosen` + `archived` tags so the design history survives. (`git mv` here is the destructive bug the layered-preservation model exists to prevent.)

If a Labs experiment **fails to graduate** (idea didn't work out), flip it to `decision:rejected` (or delete if truly noise) — git keeps the history; the sidebar stays clean.

## The clean-extract-iterate loop

The big-picture flow this skill is built to support:

```
Messy app
   │
   ▼
extraction-workflow.md   →  snapshot existing components as Components/* stories
   │                                with [`ai-generated`, `needs-work`] tags
   ▼
Designer review        →  identifies inconsistencies, missing states, drift
   │
   ▼
Labs/Visual/*          →  iterate on cleaned-up versions WITHOUT touching app code
   │                                (new tokens, refined motion, new states)
   ▼
Graduation gate met?  ─ no ──→  flip decision:rejected (or delete), try another direction
   │ yes
   ▼
Components/*           →  COPY into production (Path A/B), fresh production stories,
                              archive the Labs original in place, update app callsites
                              (preserve-don't-mv — see propagate-workflow.md)
```

The "without touching app code" promise is what makes this safe. Until the graduation gate, the app keeps using the old (messy) component; Labs/ is your private workshop.

## What goes in Labs vs what doesn't

**Yes, put in Labs:**
- Animation explorations (the same component with 8 different motion treatments)
- Interaction prototypes (the full login flow as a `play`-driven story)
- Visual variants (Card with 12 elevation/shadow/border combinations)
- New component spikes before you decide on the API
- Cleaned-up versions of existing components, iterating side-by-side with the messy production version
- Density/scale experiments

**No, don't put in Labs:**
- Real component documentation (that's Components/*)
- Token-doc-block MDX (that's Foundations/*)
- One-off scripts or non-UI code
- Anything you'd ship next week (promote to Components/* with proper coverage)

## Anti-patterns

1. **Labs experiments importing from each other.** Each experiment should be standalone — depend on `src/components/**` (real components) or define inline experimental components. If one Labs experiment imports another, you've created a hidden hierarchy that breaks when one gets deleted.
2. **Production components depending on Labs.** Never. `src/components/` must not import from `src/stories/labs/`. If you need a piece of Labs in production, graduate it first.
3. **Skipping `'!autodocs'` on Labs stories.** Pollutes the docs page with WIP. Always include `'!autodocs'` at meta level.
4. **Skipping `'!test'` on Labs stories.** Breaks CI when a Labs story has incomplete `play` interaction or unstable visuals.
5. **Letting Labs grow without pruning.** Set a periodic ritual (every sprint or every PR review) to delete failed experiments. Git keeps the history; the sidebar should not.
6. **Skipping the graduation gate.** A Labs experiment promoted to Components/ before its API is stable forces app code to track API churn. Promote only when all four gate criteria are met.

## Verification record

This file documents a pattern not previously captured in `storybook-workbench` — the Labs/playground track running alongside production. The tag conventions are SB10-native (`!autodocs`, `!test`, story-level tag merging). The graduation gate is a synthesis of Storybook's official agentic-setup advice + the Backend.AI case study + the Camila/Kowalski "ship the experiment" pattern.
