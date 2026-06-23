# Headless test wiring — make stories an agent-runnable gate

Load this reference when the task is "make the stories testable by an agent / in CI", "run the
stories headless", "get a machine-readable a11y list", or after authoring flow/interaction
stories that carry a `play`. The Lint gate (`validate-stories.sh`) checks story *shape*; this
wires the *runtime* — interaction + a11y — into two CLI commands an agent can run and parse.

> **Why this earns its keep (field-verified).** Two commands caught real bugs a static check
> never would: `test:storybook` surfaced a headless render crash (`createElement … data:image/svg+xml
> … not a valid name`) and a mislabeled button; `test:storybook:a11y` produced a concrete,
> actionable violation list. The MCP `run-story-tests` tool is great in-session, but the **CLI**
> wiring is what gives an agent a pass/fail it can act on in CI or a fresh shell.

## What this is (and what it is NOT)

- **IS:** Storybook's Vitest browser-mode runner — every story runs as a test (smoke + any `play`),
  with `addon-a11y` able to fail on violations. One config, two npm scripts.
- **IS NOT:** a replacement for Chromatic/visual regression (that's `ds-test-setup`) or for the
  Lint gate. It's the *interaction + a11y* layer between them.

## Bridge first — confirm the current setup against Storybook docs

Vitest/runner versions move fast. **Before writing config, fetch the live setup** rather than
trusting this file's snapshot (MCP `get-documentation` for "test runner" / "vitest addon", or
WebFetch `storybook.js.org/docs/writing-tests`). Storybook's `init` already adds `addon-vitest` on
10.4 — check whether the project is already wired before adding anything:

```bash
grep -q '@storybook/addon-vitest' package.json && echo "VITEST_ADDON_PRESENT" || echo "ADD_IT"
test -f vitest.config.ts -o -f vitest.workspace.ts && echo "VITEST_CONFIG_PRESENT" || echo "NO_VITEST_CONFIG"
```

## The wiring (verify shape against docs before pasting)

`vitest.config.ts` — the `storybookTest` plugin + a Playwright-backed browser provider:

```ts
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

export default defineConfig({
  plugins: [storybookTest({ configDir: '.storybook' })],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',          // `npx playwright install` once
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: ['.storybook/vitest.setup.ts'],
  },
});
```

`.storybook/vitest.setup.ts` — apply project annotations + gate a11y by env (see toggle below):

```ts
import { beforeAll } from 'vitest';
import { setProjectAnnotations } from '@storybook/react-vite';
import * as preview from './preview';

const project = setProjectAnnotations([preview.default]);
beforeAll(project.beforeAll);
```

`package.json` scripts — the two agent-runnable commands:

```jsonc
{
  "scripts": {
    // interaction + smoke: every story renders, every play runs
    "test:storybook": "vitest --project=storybook --run",
    // a11y as failures: flip addon-a11y from 'todo' to 'error' for this run
    "test:storybook:a11y": "STORYBOOK_A11Y=error vitest --project=storybook --run"
  }
}
```

## The verify loop — one batch, then iterate (adopted from `storybook ai setup` Step 7)

When you've just authored a batch of stories, **how** you run them the first time matters. Storybook's own setup prompt encodes a tag-based honesty protocol — adopt it verbatim:

1. **First run is the whole batch, together.** `npx vitest --project storybook run` over *all* new stories at once — **no single-file runs before the batch**. Per-file runs hide cross-story interference (a leaked portal root, an unreset `MockDate`, a shared MSW handler) that only surfaces when stories run in one session. The batch is the real signal.
2. **Tag every freshly-authored file `['ai-generated', 'needs-work']` up front.** `needs-work` is a claim of *unverified*, not *broken*.
3. **Strip `'needs-work'` only from files vitest confirms green** in that batch run. A file that passed earned it; a file that didn't keeps the tag.
4. **Cap retries at ~5 per failing file.** If a story still fails after ~5 focused fix attempts, **leave `'needs-work'` on it** and surface it to the human — don't loop forever or quietly delete the story. The lingering tag is the honest hand-off: it tells the user exactly which stories to look at.

> This is the inverse of tag-as-noise (`anti-patterns.md` #32): `needs-work` is legitimate *because it's transient and targeted* — it names unverified work and gets removed the moment a story goes green. `ai-generated` on 100% of a stable suite is the noise; `needs-work` on the 2 files that still fail is signal.

The `'todo' ↔ 'error'` a11y split below composes with this: run `test:storybook` for the interaction batch, then `test:storybook:a11y` for the accessibility pass.

## The a11y `'todo' ↔ 'error'` toggle

`addon-a11y` has three test modes: `'off'` (skip), `'todo'` (report, don't fail CI), `'error'`
(fail CI on any violation). Default to **`'todo'`** so a backlog doesn't gridlock CI; let the
`test:storybook:a11y` script opt into `'error'`. Read the env in `preview.ts`:

```ts
// .storybook/preview.ts
const a11yMode = process.env.STORYBOOK_A11Y === 'error' ? 'error' : 'todo';
export default {
  parameters: { a11y: { test: a11yMode } },
  // ...
};
```

This is the agent loop: run `test:storybook:a11y`, read the violation list, log each to the ledger
(many are **log-only** — see below), fix the ones in scope, re-run.

## `play` = demo vs test (keep them separate)

`play` is for **assertions**, not for browsing. Conflating them produces a confusing auto-running
demo. Split per flow (full pattern in `references/flow-capture.md`):

- **`Walk-through`** — no `play`. For humans clicking through. Tag `['flow']`.
- **`Flow test`** — the `play` that drives + asserts. Hidden from the sidebar via the lifecycle
  tags so it still runs headless but doesn't clutter browsing: `!dev` (hide in dev sidebar),
  `!test` only if you want it skipped (you don't — for the test story, keep it test-eligible),
  `!autodocs`. The `!manifest` tag drops a story from the static manifest entirely.

This separation came from Storybook's official AI doc — bridge to it (`storybook.js.org/docs/writing-tests`)
rather than hardcoding tag semantics that may shift.

## Log-only findings

Headless runs surface real production issues (unassociated `<label>`s, sub-AA contrast, render
crashes). Most are **not** in scope for a story-authoring pass — the point of storying them is to
**reflect prod as it actually is**. Log each to `.storybook/audit/findings.md` under a `LOG-ONLY`
marker and keep moving; don't fix code mid-authoring unless asked. (See SKILL.md "log-only finding".)

## When to hand off

- Visual regression / Chromatic snapshots → `ds-test-setup` (this reference stops at interaction + a11y).
- Detailed axe rule config beyond addon-a11y defaults → `.storybook/preview.ts` `a11y.config`.
