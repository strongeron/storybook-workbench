# Without-MCP Workflow — Manual CSF3 for Storybook 9 / 10

When Storybook MCP is unavailable (Webpack project, non-React framework, Storybook < 10.3, or just not installed), the skill must teach the syntax MCP would otherwise inject. This file documents 13 patterns observed missing in one Without-MCP sub-agent verification run on 2026-05-26 (full report: Fox Brains vault `2026-05-26-without-mcp-switch-verification.md`).

**Honest scope note:** n=1 verification. Expect ~60–70% of these to be durable AI knowledge gaps across models and training cutoffs (the SB10-specific facts in §1-4 are highest-confidence). The rest are agent-and-cutoff specific — re-run the same exercise with a different model or six months later and the gap list will shift. The critical 4 are the most-bulletproof; the completeness 9 are valuable but expect drift.

## The 4 critical patterns (always teach these)

### 1. Imports — the SB10 quartet

```ts
// Story types: from the framework-specific entry
import type { Meta, StoryObj } from '@storybook/react-vite';
// (NOT @storybook/react — that's deprecated in v10)
// For Webpack5: @storybook/react-webpack5

// Test utilities: from the storybook package itself
import { userEvent, within, waitFor, expect, fn, spyOn } from 'storybook/test';
// (NOT @storybook/test — that prefix was retired in v8+)

// Controlled-component sync: from preview-api
import { useArgs } from 'storybook/preview-api';

// Preview types (only in .storybook/preview.tsx):
import type { Preview } from '@storybook/react-vite';
```

The agent will guess `@storybook/react` and `@storybook/test`. Both are wrong in v10. Surface these imports early and verbatim.

### 2. The `fn()` spy pattern — `args` over `argTypes.action`

```ts
// ✓ Modern (preferred): fn() auto-logs to Actions AND is assertable in play
const meta = {
  component: Button,
  args: {
    onClick: fn(),         // ← spy created here, used everywhere
  },
} satisfies Meta<typeof Button>;

export const Clicked: StoryObj<typeof meta> = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
```

```ts
// ✗ Legacy (avoid in new stories): argTypes.action
const meta = {
  component: Button,
  argTypes: {
    onClick: { action: 'clicked' },  // ← only logs to Actions, not assertable
  },
};
```

Don't use both — pick `args: { onClick: fn() }`.

### 3. `satisfies Meta<typeof X>` (NOT annotation) for typed `args` in play

```ts
// ✓ Use satisfies: StoryObj<typeof meta> infers args correctly inside play
const meta = {
  component: Switch,
  args: { checked: false, onChange: fn() },
} satisfies Meta<typeof Switch>;
//  ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ this enables typed args in play

export default meta;
type Story = StoryObj<typeof meta>;

export const Checked: Story = {
  args: { checked: true },
  play: async ({ args }) => {
    //         ↑↑↑↑↑↑ args is fully typed as Partial<SwitchProps>
  },
};
```

```ts
// ✗ Type annotation widens the type and breaks args inference in play
const meta: Meta<typeof Switch> = {
  component: Switch,
};
```

### 4. The `play` function recipe

```ts
import { within, userEvent, expect } from 'storybook/test';

export const FilledForm: StoryObj<typeof meta> = {
  play: async ({ canvas, userEvent, args }) => {
    // canvas, userEvent, canvasElement come from play args
    // do NOT re-import userEvent or write const canvas = within(canvasElement)

    await userEvent.type(canvas.getByLabelText('email'), 'a@b.com', { delay: 50 });
    await userEvent.click(canvas.getByRole('button', { name: /submit/i }));

    // Prefer findBy* (retries) over getBy* (throws immediately) for async assertions
    await expect(await canvas.findByText(/welcome/i)).toBeVisible();

    // For portals (modals, tooltips), query via canvasElement.ownerDocument.body:
    // await within(canvasElement.ownerDocument.body).findByRole('dialog');
  },
};
```

**Rule:** `canvas`, `userEvent`, `canvasElement` are play arguments — destructure them, don't import. The only thing you sometimes import is `within` for portal queries, and `expect` for assertions.

**ARIA roles for queries:** custom toggles render as `<input role="switch">`, not `role="checkbox"`. Use `canvas.getByRole('switch')` for toggle components. Modals use `role="dialog"` (or `'alertdialog'` for destructive confirmations). Tabs use `role="tab"` + `role="tabpanel"`. Default to role-based queries (accessibility-first); fall back to `getByLabelText` only when role doesn't apply.

## The 9 completeness patterns

### 5. Controlled components — `useArgs` for two-way sync

When a component is controlled (e.g., `<Switch checked={x} onChange={setX} />`), Storybook's Controls panel won't reflect user interaction unless you bridge it:

```ts
import { useArgs } from 'storybook/preview-api';

const meta = {
  component: Switch,
  args: { checked: false, onChange: fn() },
  render: function Render(args) {
    const [{ checked }, updateArgs] = useArgs();
    return (
      <Switch
        {...args}
        checked={checked}
        onChange={(next) => {
          args.onChange?.(next);
          updateArgs({ checked: next });   // ← sync back to Controls
        }}
      />
    );
  },
} satisfies Meta<typeof Switch>;
```

### 6. Tags reference (SB10 recognized values)

| Tag | Effect |
|---|---|
| `'autodocs'` | Generates a Docs page for this story group |
| `'!autodocs'` | Excludes from autodocs (override at story level) |
| `'!dev'` | Hides from the sidebar in dev mode (keeps in test) |
| `'!test'` | Skips in test runner |
| `'ai-generated'` | Project convention — flag for human review |
| `'experimental'`, `'wip'` | Project conventions — use freely |

Story-level tags merge with meta-level. Use the `!` prefix to subtract a meta-level tag at the story level.

### 7. Layout reference

```ts
parameters: { layout: 'centered' }    // for small interactive components (default for UI primitives)
parameters: { layout: 'padded' }      // for components needing breathing room (default if omitted)
parameters: { layout: 'fullscreen' }  // for pages, full-width layouts, top-level shells
```

These are the only three built-ins. Custom layouts require decorators wrapping the story.

### 8. Title-and-grouping conventions

`title: "Group/Sub/Component"` builds the sidebar hierarchy.

Recommended for new design-system projects:
- `Foundations/*` — color, typography, spacing, icons (MDX docs only)
- `Components/{Domain}/{Name}` — atomic + molecular components (incl. composed patterns like FormGroup)
- `Pages/{audience}/{Name}` — full page previews + composed page layouts
- `Flows/{Name}` — the journey layer (App Map + user journeys, from sb-flows)

Alternative for marketing sites:
- `Sections/*` — hero, features, pricing, testimonials
- `Blocks/*` — reusable composed blocks
- `Pages/*` — assembled landing pages

If `.storybook/preview.ts` already has a `parameters.options.storySort`, match its top-level order.

### 9. File placement decision

Two valid patterns — pick one project-wide:

**(a) Flat demo dir** (matches Storybook CLI scaffold):
```
src/stories/
├── Button.tsx
├── Button.stories.tsx
└── button.css
```

**(b) Colocated** (preferred for production design systems):
```
src/components/Button/
├── Button.tsx
├── Button.stories.tsx
├── Button.test.tsx
├── button.css
└── index.ts
```

Tradeoffs: flat is faster to scan as a catalog; colocated is faster to refactor as a library. Don't mix.

### 10. Story registration — when do I edit `main.ts`?

Default `stories` glob in `.storybook/main.ts`:
```ts
stories: [
  "../src/**/*.mdx",
  "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
]
```

You don't need to register individual stories — auto-discovered by glob. Edit `main.ts` only if:
- Your stories live outside `src/` (e.g., in a `packages/<pkg>/src` monorepo layout)
- You're using a different file extension
- You want to limit which stories load (e.g., `**/*.story.tsx` instead of `**/*.stories.tsx`)

### 11. Verification ladder without dev server

Run in this order — each layer catches different errors:

```bash
# 1. Type safety (catches imports, prop mismatches, story shape)
npx tsc --noEmit

# 2. Story-specific lint (catches CSF mistakes, hierarchy-separator issues)
npx eslint --ext .tsx,.ts src/stories/  # requires eslint-plugin-storybook

# 3. Vitest runs play functions headlessly via Playwright (catches runtime, assertions, a11y)
npx vitest --project storybook run path/to/Foo.stories.tsx

# 4. Last resort — start the dev server for visual check
npm run storybook
```

Cap retries on any single file at ~5. If a story keeps failing after 5 attempts, leave `'needs-work'` tag and move on.

### 12. Scaffold quirks to know

The Storybook CLI scaffold uses these patterns — keep them or replace project-wide, but be consistent:

- Title prefix `Example/*` (replace with your project's prefix; `Example` is placeholder)
- Demo files live in `src/stories/` (production projects often move to `src/components/`)
- Three demo components (Button, Header, Page) — delete after writing real stories
- `tsconfig.app.json` excludes `node_modules` only — you may want to also exclude `dist`, `coverage`

### 13. `argTypes` — wire a real Controls panel (not optional)

A component story's **Controls panel is a deliverable**, not a bonus: it's how a reviewer explores
props without editing code, and it powers the autodocs ArgTypes table. The trap: **the Storybook
react-vite default is `react-docgen` (fast), which does NOT infer TypeScript union types into select
controls.** A `variant?: 'primary' | 'secondary'` prop shows up as a bare text box, and props you
never pass in `args` may not appear at all. So for any component with enum/union props, declare
`argTypes` explicitly:

```ts
const meta = {
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Get started', variant: 'primary' },
  argTypes: {
    // Unions → pickers (react-docgen won't do this for you). Keep options in sync with the prop type.
    variant: { control: 'select', options: VARIANTS, table: { category: 'Appearance' } },
    size:    { control: 'inline-radio', options: ['sm', 'md', 'lg'], table: { category: 'Appearance' } },
    // Flags → toggles · copy → text · bounded numbers → number with min/max.
    isLoading: { control: 'boolean', table: { category: 'State' } },
    children:  { control: 'text', table: { category: 'Content' } },
    // Hide what a panel can't set: styling escape hatches, refs, component/function props, data objects.
    className: { table: { disable: true } },
    icon:      { control: false, table: { category: 'Content' } },
    onChange:  { control: false, table: { category: 'Events' } },
  },
} satisfies Meta<typeof Button>;
```

Rules:

- **Every union/enum prop gets `control: 'select'`** (or `'inline-radio'` for ≤4 options) **+ `options`.**
  Don't rely on inference under the react-vite default — it won't happen.
- **Group with `table.category`** (Content / Appearance / State / Validation / Events) so the panel and
  the ArgTypes table stay legible once a component has >5 props.
- **Hide props a panel can't drive:** `className` and other styling escape hatches, refs,
  `LucideIcon`/component props, callbacks, and `{...}`/`[...]` data (`options`, `characterCount`) →
  `control: false` or `table: { disable: true }`. Exercise those from dedicated stories instead.
- **Render-only showcase stories ignore args** — the `Variants`/`States` grids that hardcode their own
  props via `render`. Their Controls panel is inert and misleading, so disable it:
  `parameters: { controls: { disable: true } }`.

(Heavier alternative: set `typescript.reactDocgen: 'react-docgen-typescript'` in `main.ts` to
auto-infer unions + JSDoc — but it's slower and, for props extending DOM attributes, floods the table
with inherited HTML attrs unless you add a `propFilter`. Explicit `argTypes` is the predictable,
per-component choice this skill defaults to.)

### 14. Three more story shapes the basic args-story doesn't cover

Common in real codebases, easy to miss if you only know the args + render forms:

- **Stateful preview wrapper** — when you want the component *playable* in the canvas but don't need Controls-panel sync (so `useArgs` is overkill), wrap it in a tiny local component that holds the state:
  ```tsx
  function Interactive() {
    const [open, setOpen] = useState(false);
    return <><Button onClick={() => setOpen(true)}>Open</Button><Modal open={open} onClose={() => setOpen(false)} /></>;
  }
  export const Playable: StoryObj = { render: () => <Interactive /> };
  ```
  Use this over `useArgs` (#5) when the interaction is multi-step and you don't care about reflecting it in Controls. (`useArgs` is for two-way Controls sync; this is for a self-driving demo.)

- **Component-less meta** — showcase / overview stories that compose *several* components have no single subject. Omit `component:` entirely:
  ```tsx
  const meta = { title: 'Overview/Notifications', tags: ['autodocs'] } satisfies Meta;  // no `component`
  ```
  `component:` is not mandatory. Forcing a dummy one just to satisfy a template is wrong.

- **Per-story decorator override** — a single story can supply its own `decorators: [...]` that wrap *in addition to* (innermost) the meta-level decorators. Use when one story needs a narrower frame (mobile shell, different provider) than its siblings — don't fork the whole meta.

## Refused anti-patterns (refuse these even Without MCP)

1. CSF2 (`storiesOf`, function-with-`.story` properties) — convert via `npx storybook@latest migrate csf-2-to-3`
2. Imports from `@storybook/addon-essentials` or `@storybook/blocks` — both dead in Storybook 10
3. `getBy*` inside `play` for async assertions — use `findBy*` + `waitFor` instead
4. Inline mock data in 3+ stories when they share a shape — extract to factory (see `factory-patterns.md`)
5. Mega-stories with every-prop knobs — write named stories per state instead

## Verification ladder summary

```
WITHOUT MCP, when you finish writing a story:
  tsc --noEmit              ← imports + types
  eslint storybook plugin   ← story shape
  vitest --project storybook run  ← play functions execute
  storybook dev (manual)    ← visual sanity check
```

Stop at the first failure that points to your code. Don't bother starting the dev server until the static checks pass.

## Verification record

Live-verified against Storybook 10.4.1 + Vite 8 + React 19 on 2026-05-26 — see Fox Brains vault `2026-05-26-without-mcp-switch-verification.md` for the 13 gaps this file closes.
