# The native `storybook ai setup` prompt — captured, with examples

This file mirrors the prompt that `npx storybook ai setup` injects, so our align+verify
layer (`install-wizard.md`) stays honest about what the native flow already does. **The native
prompt is the source of truth** — when in doubt, re-run the capture (see "Re-capture" at the
bottom) rather than trusting this file; their onboarding moves faster than we can mirror.

> Captured **2026-06-04** from `storybookjs/storybook@next`
> `code/lib/cli-storybook/src/ai/setup-prompts/`. The default variant that ships to real users
> is **`optimized-tests.ts`** (`index.ts`: `DEFAULT_PROMPT_NAME = 'optimized-tests'`) — NOT the
> experimental `setup.ts` or `pattern-copy-play.ts` variants behind `EVAL_SETUP_PROMPT`.

---

## 0. What the command actually is

`storybook ai setup` does **not** run anything itself — it **generates a project-aware Markdown
prompt** (detected framework / renderer / builder / language / addons baked in) for an agent to
execute.

```bash
npx storybook ai setup                 # prints the prompt to stdout (how agents consume it)
npx storybook ai setup --output sb.md  # writes the prompt to a file (paste into an agent w/o shell)
```

The docs page (`storybook.js.org/docs/ai/setup`) tells a **human** to say to their agent:

> "Set up Storybook for me with `npm create storybook@latest` and follow its instructions precisely"

`npm create storybook@latest` runs `storybook init` (which scaffolds `.storybook/`, a
`preview.tsx`, demo stories) **and then** surfaces this agentic prompt.

**Availability:** React renderer + Vite builder only (as of 10.4). Other stacks install fine but
get no AI-setup prompt — route them to `without-mcp.md`.

---

## 1. Rules of engagement (verbatim intent — these are time budgets, not suggestions)

The prompt opens with 8 hard rules. Our `install-wizard.md` only carried the first one ("discover
with Glob/Grep, not shell"). The full set:

1. **Discover with Glob/Grep/Read, not shell.** Never `ls`/`find`/`cat`/`head`/`tail`/shell
   `grep`/`sed`/`node -e` for discovery or bulk edits — slower per call, breaks caching. List →
   `Glob`; search → `Grep`; read → `Read`; bulk-edit → multiple `Edit` (or one `Edit` with
   `replace_all`), never `sed -i`.
2. **Never read or grep inside `node_modules`.** The imports shown in the prompt are correct —
   don't verify them by introspecting installed packages.
3. **Read budget ≈ 12 files for discovery.** `index.html`, entry, App, providers, routing, root
   CSS, 2–3 representative pages/components, 1–2 hooks, 1 test. Need more → summarize and move on.
   (A `relaxed-limits` variant raises this to ~40 for component-heavy repos.)
4. **Edit > Write.** For any file you've Read, use `Edit`. `Write` only for new files. The
   `preview.tsx` from `storybook init` already exists — **Edit** it, never overwrite.
5. **Batch the test loop.** Write **all** stories first, then run vitest **once** across
   everything. No per-file vitest runs until that first batch reveals failures.
6. **Use the detected package manager for every install** (from the lockfile: `pnpm-lock.yaml`→pnpm,
   `yarn.lock`→yarn, `bun.lockb`→bun, else npm).
7. **Prefer fixing the shared `preview.tsx`** over story-local workarounds when multiple stories
   fail the same way.
8. **Stop when success criteria are met** — don't keep polishing.

---

## 2. The 8-step plan (what "analyze codebase / decorators+mocks / write stories / verify" means)

### Step 1 — Discover the runtime (≤12 reads)

Identify, in this order (Glob/Grep first, then targeted Reads):

- `index.html` — `<link rel="stylesheet">`, inline `<style>`, fonts, and any `<div id="...">`
  mount/portal roots **not** created by JS
- entry (`main.tsx`/`index.tsx`) — providers wrapping `<App />`, root CSS imports
- `App.tsx` — top-level layout, router usage, providers consumed
- provider/context files — what they expose
- root CSS — global styles, CSS variables, theme tokens (both JS-imported **and** `index.html`-linked)
- data hooks — `fetch(...)`, `useQuery`, `axios` (capture base URL + endpoints hit at render)
- browser state read at render — `localStorage`/`sessionStorage`/cookie keys
- portal targets — `createPortal(...)` and the DOM ids it mounts to (e.g. `#modal-root`)
- 1–2 real page/feature components (your JSX source-of-truth for stories)

> Stop reading once you can answer: *"What providers, CSS, browser state, and network calls must
> the preview supply for a typical page to render?"*

### Step 2 — Build the shared preview (Edit, don't replace)

Set up Storybook **once** so most stories work with no per-story setup. Merge into the existing
`preview.tsx`. Use the **real** provider tree and **real** root CSS import — don't invent providers.
If CSS is loaded via `<link>` in `index.html` rather than JS, import that same file from preview.
Seed **only** the browser-state keys the app actually reads (don't clear all of storage). Use
`mockdate` only when render depends on the date. **Do not** mock `window`/`document`/`navigator`/
observers/`fetch` directly.

```tsx
// .storybook/preview.tsx
import type { Preview } from '@storybook/react-vite';
import '../src/index.css';
import MockDate from 'mockdate';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { SessionProvider } from '../src/contexts/SessionContext';
import { mswHandlers } from './msw-handlers';

initialize({ onUnhandledRequest: 'bypass' });

const preview: Preview = {
  decorators: [(Story) => (<SessionProvider><Story /></SessionProvider>)],
  loaders: [mswLoader],
  parameters: { msw: { handlers: mswHandlers } },
  async beforeEach() {
    localStorage.setItem('theme', 'dark'); // only the key the app reads
    MockDate.set('2024-04-01T12:00:00Z');  // pin "now" so relative dates are literal
  },
};

export default preview;
```

### Step 3 — Portals in a decorator (not `preview-body.html`)

If discovery found `createPortal(..., document.getElementById('foo'))`, add a decorator that
creates the portal root **before** the story renders. Skip if portals only target `document.body`.

```tsx
// add to the `decorators` array of preview:
(Story) => {
  for (const id of ['modal-root', 'drawer-root', 'toast-root']) {
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
  }
  return <Story />;
}
```

### Step 4 — MSW handlers (only what stories will hit)

Mock side effects at the **preview level**, not per-story. Install + init:

```bash
npm install -D msw msw-storybook-addon mockdate   # use the detected package manager
npx msw init ./public --save
```

Serve `./public` in `main.ts`, and put handlers in `.storybook/msw-handlers.ts` covering **only**
the endpoints your stories exercise — no catch-alls:

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = { staticDirs: ['../public'] };
export default config;
```

```ts
// .storybook/msw-handlers.ts
import { http, HttpResponse } from 'msw';
export const mswHandlers = {
  products: [
    http.get('https://api.example.com/products', () =>
      HttpResponse.json({ items: [{ id: 'p1', name: 'Example', price: 42 }] })
    ),
  ],
};
```

### Step 5 — Write up to 10 story files (one batch) + exactly one `CssCheck`

Two required deliverables:

**(a)** Up to 10 **colocated** `*.stories.tsx` files for meaningful targets (low-level reusable →
page components). Skip subcomponents, hooks, contexts, helpers, and `App` itself when real page
components exist. ~3 exports per file (up to ~10 when real usage warrants). Copy JSX patterns from
real pages/routes/tests. **Tag every new file `['ai-generated', 'needs-work']` from the start** —
`'needs-work'` comes off only after vitest passes. Don't add a custom `title`; don't build large
story-specific harnesses (fix the preview instead); don't create new app components.

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from './Button';

const meta = {
  component: Button,
  tags: ['ai-generated', 'needs-work'], // strip 'needs-work' once vitest passes
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

// Smoke check — one is enough per file
export const Primary: Story = {
  args: { children: 'Order now' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /order now/i })).toBeVisible();
  },
};
// Variant-only stories: no play needed
export const Clear: Story = { args: { children: 'Cancel', clear: true } };
export const Large: Story = { args: { children: 'Checkout', large: true } };
export const WithIcon: Story = { args: { icon: 'cart', 'aria-label': 'food cart' } };
```

**(b) Exactly ONE `CssCheck` story** across the whole project (not one per file). `toBeVisible`
passes on an *unstyled* component — a concrete `getComputedStyle` value is the only proof the
shared preview actually loaded the app's CSS. Read a real styling value from the component's source
and assert the resolved value:

```tsx
export const CssCheck: Story = {
  args: { children: 'Submit' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: /submit/i });
    // PrimaryButton uses bg-blue-600 — fails if Tailwind / global CSS did not load.
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(37, 99, 235)');
  },
};
```

### Step 6 — `play` functions only where they prove something non-trivial

**Do not put a `play` on every story.** One good `play` per file beats five redundant ones. Write a
`play` only when it verifies an **interaction**, **async data arriving from MSW**, a **portal**
mounting in the right root, a **CSS-driven semantic state**, or **accessibility** the component owns.
**Skip `play`** for static variant-only stories — the render itself already fails if the component
throws. A smoke `play` must prove something the render alone doesn't: an aria attribute reflecting
state (`aria-expanded`/`aria-disabled`/`aria-checked`/`aria-current`), a prop rendered as text/attr,
async content arriving (`findBy*`/`waitFor`), or a portal mounting.

**Import discipline (get this exact or vitest fails subtly):** `expect`/`waitFor` come from
`'storybook/test'`. `canvas`, `userEvent`, `canvasElement` come from the **play arguments**:
`async ({ canvas, userEvent, canvasElement }) => {}`. Do **not** `import { userEvent }` and do **not**
write `const canvas = within(canvasElement)` — both are provided. For portal queries only, use
`within(canvasElement.ownerDocument.body)`.

```tsx
export const FilledForm: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText('email'), 'a@b.com', { delay: 50 });
    await userEvent.click(canvas.getByRole('button', { name: /submit/i }));
    await expect(await canvas.findByText(/welcome/i)).toBeVisible();
  },
};
```

### Step 7 — Verify in one batch, then iterate only on failures

First vitest invocation runs **all** new stories together — no single-file runs before the batch:

```bash
npx vitest --project storybook run
```

Then run the project's TypeScript check (the `package.json` script — typically `tsc --noEmit`).
Read the raw output once; don't slice it through repeated `grep`/`head`. For each failure: read the
error → if multiple stories share it, fix the shared preview, not the stories → re-run vitest for
the **affected file(s) only** (`npx vitest --project storybook run path/to/Foo.stories.tsx`) →
repeat, **capped at ~5 retries per file**. When a file passes, strip `'needs-work'` (tags become
`['ai-generated']`). Files you couldn't fix keep `['ai-generated', 'needs-work']` — move on, don't
loop forever. Don't substitute a hard story for an easier one that teaches less about the codebase.

### Step 8 — Clean up

Remove debug code, broad mocks added during diagnosis, unused deps, eval artifacts. Delete the
demo components/CSS/stories/MDX `storybook init` created **only if** you wrote successful real
stories (preserve them if the project still needs onboarding UI).

---

## 3. Done when (the native prompt's 5 success criteria)

- **Exactly one `CssCheck` story exists**, asserting a concrete computed-style value read from the
  component's source.
- Every passing file had `'needs-work'` stripped → `tags: ['ai-generated']`; still-failing files
  keep `['ai-generated', 'needs-work']`.
- `npx vitest --project storybook run` passes for the new files.
- The project's TypeScript check passes for changed files.
- The shared preview is strong enough that stories don't need per-story fetch/provider workarounds.

**Our layer adds one conditional criterion** (only when the project ships a class-based dark theme — `.dark` on `<html>` with CSS-var colors):

- **Dark-mode canvas is themed at the root, not just a decorator.** Fold a second assertion into the one `CssCheck` play so the gate goes red if `preview-head.html` is missing the canvas-root rule (item 9). It's theme-agnostic — it proves `.sb-show-main` inherits the `--color-background` token regardless of which theme is active, so no toggling is needed:

```ts
// inside the CssCheck story's play, after the token assertion:
const main = canvasElement.closest('.sb-show-main') ?? document.querySelector('.sb-show-main');
const probe = document.createElement('div');
probe.style.background = 'var(--color-background)';
main!.appendChild(probe);
const expected = getComputedStyle(probe).backgroundColor;   // resolved page bg
probe.remove();
// .sb-show-main must paint that token (not Storybook's default transparent/white)
expect(getComputedStyle(main as Element).backgroundColor).toBe(expected);
```

If the canvas root isn't themed, `.sb-show-main` is transparent/white and this fails — catching the "dark sliver / white frame" bug before it ships. Skip this assertion entirely for projects with no dark theme.

- **A `centered` primitive is not forced to viewport height.** If a global frame decorator is present (e.g. `withLayoutFrame`, install-wizard item 10), prove it follows the story `layout` instead of blanket-forcing `100vh`. Fold one more assertion into the `CssCheck` play (or give a Badge story `layout: 'centered'` and check it): the rendered story container's height must be **content-sized, well under the viewport** — not `≈100vh`. This keeps primitives from regressing back into a viewport-tall box of whitespace.

```ts
// inside the CssCheck story's play, for a centered/padded story:
const box = canvasElement.firstElementChild as HTMLElement | null;
if (box) {
  // a primitive must shrink-wrap — its frame should be far shorter than the viewport
  await expect(box.getBoundingClientRect().height).toBeLessThan(window.innerHeight * 0.9);
}
```

Skip this for stories that legitimately fill the viewport (`layout: 'fullscreen'` pages / report wrappers).

**Reference links the prompt itself ships (fetch only if stuck):** docs index
`storybook.js.org/llms.txt`; writing-stories, decorators, play-function, vitest-plugin docs
(append `?codeOnly=true` for code-only snippets).

---

## 4. What our align+verify layer adds ON TOP (don't re-do these — the native prompt covers them)

The native prompt above already handles discovery, the shared preview, MSW, portals, story
authoring, play discipline, and verify. `install-wizard.md` should only own the genuinely
**under-documented** bits the native flow leaves open:

- **`viteFinal` plugin-strip** (Rails `vite-plugin-ruby`, React Compiler, Next plugins) — Phase 4b.
- **storySort taxonomy + Labs/Galleries sections** — Phase 2 (only if the user wants production IA).
- **Width-constraint decorator + viewport presets** — Phase 4c.
- **MCP wiring + restart** (`@storybook/addon-mcp`, `.mcp.json`) — Phase 6.
- **Where stories live** (isolated `.storybook/stories/` vs colocated) — the native prompt assumes
  colocated; our skill asks, because a client/messy repo shouldn't be scattered. If colocated is
  chosen, the native prompt's colocation matches us; if isolated, configure `main.ts` `stories` glob.

Items the native prompt and our wizard **agree on** (we kept these in `install-wizard.md` items 7–8):
import global CSS first (#1 silent failure), `beforeEach` determinism (MockDate + only-keys-read),
`Edit` the init preview never overwrite, and exactly one `CssCheck`. Item 9 (canvas-root theming for
class-based dark themes) is our addition, gated by the dark-mode canvas assertion in the Done-when list above.

---

## 5. Re-capture (when the native prompt drifts)

```bash
# the default variant that ships to users:
gh api repos/storybookjs/storybook/contents/code/lib/cli-storybook/src/ai/setup-prompts/optimized-tests.ts \
  --jq '.content' | base64 -d
# its partials (the real reusable knowledge):
for f in steps rules dod examples; do
  gh api repos/storybookjs/storybook/contents/code/lib/cli-storybook/src/ai/setup-prompts/partials/$f.ts \
    --jq '.content' | base64 -d
done
# confirm which variant is default:
gh api repos/storybookjs/storybook/contents/code/lib/cli-storybook/src/ai/setup-prompts/index.ts \
  --jq '.content' | base64 -d | grep DEFAULT_PROMPT_NAME
```

Or simply run `npx storybook ai setup --output /tmp/native.md` in a real React+Vite project and diff
against this file.
