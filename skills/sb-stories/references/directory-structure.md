# Directory Structure — Designing YOUR Title Convention

Storybook's `title` field builds the sidebar hierarchy: `title: "Group/Sub/Component"` creates `Group ▶ Sub ▶ Component` in the sidebar. The convention is *project-level* — pick once, document it in `.storybook/preview.ts`, and enforce consistency.

This file is NOT a map of any specific project. It's a guide to *designing* the convention that fits yours, with three worked example taxonomies.

## Step 1 — Read what's already there

Before designing a convention, read `.storybook/preview.ts` for the existing one:

```ts
// .storybook/preview.ts
const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        order: ['Foundations', 'Components', 'Pages', 'Flows', 'Labs'],
      },
    },
  },
};
```

If `storySort` is set, match it. If not, you're designing fresh.

## Step 2 — Pick a taxonomy shape

Three convergent shapes — pick the one that fits the project type.

### Taxonomy A — Design system / component library

For projects shipping a reusable component library:

```
Foundations/
├── Colors           (MDX page — <ColorPalette>)
├── Typography       (MDX page — <Typeset>)
├── Spacing          (MDX page)
└── Icons            (MDX page — <IconGallery>)

Components/
├── Form/
│   ├── Button
│   ├── Input
│   ├── Select
│   └── Checkbox
├── Display/
│   ├── Card
│   ├── Badge
│   └── Avatar
├── Feedback/
│   ├── Toast
│   ├── Modal
│   └── Spinner
└── Navigation/
    ├── Tabs
    └── Breadcrumb

Pages/               (full-screen previews + composed page layouts)
├── Public/
└── App/

Flows/               (the journey layer — App Map + user journeys, from sb-flows)
├── App Map          (AppFlowGraph: routes · edges · navSources)
└── <Journey>        (JourneyGraph: numbered states · desktop + mobile)

Labs/                (work-in-progress, hidden from autodocs)
└── ExperimentalThing
```

> Reusable compositions (FormGroup = Label+Input+Error, CardWithActions) are
> component-level — they live under `Components/<Domain>/<Name>`, not a separate
> root. The layer model is **Foundations → Components → Pages → Flows → Labs**:
> one screens layer (Pages) and one journey layer (Flows).

**When to pick this:** publishing to npm, multiple downstream consumers, atomic-design vocabulary fits.

### Taxonomy B — SaaS app

For projects building application UI (not a library):

```
UI/                  (primitives — buttons, inputs, icons)
├── Buttons
├── Inputs
└── Icons

Features/            (composed by domain)
├── Auth/
│   ├── LoginForm
│   └── SignupForm
├── Billing/
│   ├── PaymentMethod
│   └── InvoiceList
└── Settings/
    ├── ProfileForm
    └── NotificationPreferences

Pages/               (whole-screen previews)
├── Public/
│   ├── Landing
│   ├── Pricing
│   └── About
└── App/
    ├── Dashboard
    ├── ProjectList
    └── ProjectDetail

Labs/                (sandbox)
```

**When to pick this:** internal app, single consumer, features mapped to product surface.

### Taxonomy C — Marketing site

For projects building landing pages / promotional content:

```
Foundations/
├── Colors
├── Typography
└── Spacing

Sections/            (one per type of page section)
├── Hero
├── Features
├── Pricing
├── Testimonials
├── FAQ
└── CTA

Blocks/              (reusable across sections)
├── PrimaryButton
├── Card
└── Logo

Pages/               (assembled — composed of sections)
├── Landing
├── Pricing
├── Solutions
└── About
```

**When to pick this:** primarily marketing, section-based composition, fewer atomic primitives.

## Step 3 — Document the choice in `preview.ts`

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        order: [
          'Foundations',
          ['Colors', 'Typography', 'Spacing', 'Icons'],   // explicit sub-order
          'Components',
          ['Form', 'Display', 'Feedback', 'Navigation'],
          'Flows',
          'Pages',
          ['Public', 'App'],
          'Labs',
        ],
        method: 'alphabetical',     // within each group
      },
    },
  },
};
```

The bracketed sub-arrays control sub-ordering. Without them, sub-groups are alphabetical by default.

### Overview / spec / hub stories sort to the TOP — never nested below their content

An **Overview**, **Spec**, or feature-**hub** story is an *entry point* — the thing a reviewer opens first
to get oriented and reach the rest. It must sit at the **top of its root**, not buried as one alphabetical
leaf among the components it summarizes. Two cases:

- **A root-level hub** (e.g. `Figma Inventory`, a per-delivery overview) → list its root **first** in
  `order`, before `Foundations`/`Components`/`Pages`:
  ```ts
  order: ['Figma Inventory', 'Foundations', 'Components', 'Pages', 'Flows', 'Labs']
  ```
- **A per-feature overview** inside a group (`Detections/Overview`, `Hunts/Spec`) → put `Overview`/`Spec`
  **first** in that group's sub-order so it precedes the feature's components:
  ```ts
  order: ['Detections', ['Overview', 'Spec', '*'], 'Components', …]   // '*' = everything else, alphabetical
  ```

Why this is a rule and not a preference: a feature delivered from Figma (sb-figma) or a multi-screen flow
scatters into many stories; if the overview sorts alphabetically it lands in the *middle* of its own
children and reads as just another leaf — the reviewer can't find "start here". Pin it to the top. The
`'*'` sentinel lets you order only the entry points and leave the rest alphabetical.

## Step 4 — Apply consistently

Every new `.stories.tsx` file should:

```ts
const meta = {
  title: 'Components/Form/Button',  // ← match the convention exactly
  component: Button,
} satisfies Meta<typeof Button>;
```

Don't mix `'Form/Button'` (missing top-level) with `'Components/Form/Button'`. Don't mix `'components/form/Button'` (lowercase) with `'Components/Form/Button'`. Stick to one casing pattern.

## File-location options (independent of title)

The title convention is independent of where the `.stories.tsx` file lives on disk. **But the on-disk
location is NOT free choice — it's the `storiesLocation` decision** (CONTEXT.md § STORIES LOCATION),
asked once in `sb-setup` / first `sb-stories` and recorded in `.storybook/audit/status.md`. For an audit
the default is **isolated `.storybook/stories/`** (keeps `src/` clean); the patterns below apply only
when the user opted into **co-located** placement for a project they own. Don't pick a pattern here that
contradicts the recorded decision.

### Pattern (a) — Flat demo dir

```
src/stories/
├── Button.tsx
├── Button.stories.tsx
├── button.css
├── Input.tsx
├── Input.stories.tsx
└── input.css
```

Matches the Storybook CLI scaffold. Easy to browse as a catalog. Components and stories evolve together.

### Pattern (b) — Colocated with components

```
src/components/Button/
├── Button.tsx
├── Button.stories.tsx
├── Button.test.tsx
├── button.css
└── index.ts

src/components/Input/
├── Input.tsx
├── Input.stories.tsx
├── input.css
└── index.ts
```

Production design systems prefer this — refactoring a component touches one folder.

### Picking between them

| Want | Pick |
|---|---|
| Quickly scan all stories | (a) Flat — directory listing IS the catalog |
| Refactor a single component cleanly | (b) Colocated — one folder per component |
| Strict separation between source and demos | (a) Flat — demos in `src/stories/`, real code in `src/components/` |
| Publishable component library | (b) Colocated with `*.stories.*` excluded from the package build |

**Don't mix both.** Pick project-wide, document in the project's CONTRIBUTING.md or `.storybook/README.md`.

## Naming conventions inside the title

- **PascalCase for components:** `Button`, not `button` or `BUTTON`
- **Plural sub-groups for collections:** `Buttons`, `Inputs`, `Icons` (not `Button`, `Input` — those clash with component names)
- **Domain-led subgroups** instead of pattern-led when possible: `Components/Auth/LoginForm` beats `Components/Forms/Login` (auth context > form pattern)
- **`Labs/*` or `WIP/*`** for work-in-progress that shouldn't appear in autodocs. Pair with `tags: ['!autodocs']`

## When to skip the taxonomy entirely

For very small projects (< 20 components total), a flat structure is fine:

```ts
title: 'Button';
title: 'Input';
title: 'Modal';
```

Once you cross 20 components, group. Once you cross 50, sub-group.

## Anti-patterns

1. **Mixing conventions mid-project** — e.g., some stories use `Components/X`, others use `UI/X` for the same kind of thing
2. **Project-specific names without translation guidance** — e.g., a previous project's `Public Pages/...` taxonomy carried into a new project without renaming
3. **Title taxonomy that doesn't match `storySort`** — sidebar sorts alphabetically when `storySort` is missing, producing chaos
4. **Deep nesting (5+ levels)** — `Components/Form/Inputs/Text/Default/Sized/Small` is too much. Cap at 3.
