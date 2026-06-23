# Validate Workflow — runnable check before a story ships

The recurring question this reference answers: **"is this story actually conformant, or did the agent just declare done?"** Anti-patterns are prose; this is the runbook that turns them into a deterministic pass/fail plus a sub-agent prompt for the judgment-needed checks.

Two paths, used together:

- **Bash validator (`scripts/validate-stories.sh`)** — deterministic checks for CI and for the agent to call before declaring a story done. Returns `PASS`/`FAIL` per check, exits non-zero if anything failed.
- **Sub-agent review prompt** — for judgment-needed checks the validator can't make (weak coverage, missing JTBD prose, mega-story smell, designer-grade concerns). Dispatched as a single Agent call returning a fixed-shape report.

## When to load this reference

- The user said "validate my story" / "review my story" / "is this story good"
- The agent has just written a story file and is about to declare done
- CI is being wired (the bash script is the entrypoint)
- A skill-internal pre-merge gate (the validator runs over the diff)

## What the validator actually checks

The 13 checks below (plus a project-level CssCheck tally) are the ones that catch the highest-leverage anti-patterns + the SB10 import gaps verified in earlier runs. Each is binary (PASS/FAIL/WARN); judgment is reserved for the sub-agent path.

### Group A — SB10 imports + API (4 checks, deterministic)

| # | Check | Pattern |
|---|---|---|
| 1 | Imports `@storybook/react-vite`, not `@storybook/react` | `grep -E "^import .* from ['\"]@storybook/react['\"]"` → must be empty |
| 2 | Imports `storybook/test`, not `@storybook/test` | `grep -E "from ['\"]@storybook/test['\"]"` → must be empty |
| 3 | Uses `satisfies Meta<typeof X>`, not `const meta: Meta<typeof X> =` (type annotation) | `grep -E "^const meta(:|\s*=).*Meta<.*>\s*=\s*\{" \| grep -v "satisfies"` → must be empty (the annotation form widens type and breaks `args` inference in `play`) |
| 4 | `useArgs` is from `storybook/preview-api`, not from `react` | If file uses `useArgs`, must `grep "from ['\"]storybook/preview-api['\"]"` |

### Group B — Anti-pattern grep (4 checks, deterministic)

| # | Check | Pattern |
|---|---|---|
| 5 | No CSF2 (`storiesOf(`, `.story` properties) | `grep -E "storiesOf\(\|\.story\s*=\s*\{"` → must be empty |
| 6 | No dead SB10 imports (`@storybook/addon-essentials`, `@storybook/blocks`) | `grep -E "from ['\"](@storybook/addon-essentials\|@storybook/blocks)['\"]"` → must be empty |
| 7 | No inline hex in story `render` body | `grep -E "render:.*\{[^}]*#[0-9a-fA-F]{3,8}"` → must be empty (multi-line check via `pcregrep -M` if available; see script) |
| 8 | No `disabled: true` inside `parameters.pseudo` | `grep -E "pseudo:\s*\{[^}]*disabled"` → must be empty (`disabled` is structural, see anti-pattern 19) |

### Group C — Coverage signal (2 checks, deterministic)

| # | Check | Pattern |
|---|---|---|
| 9 | `parameters.layout` is set on meta | `grep -E "layout:\s*['\"](centered\|fullscreen\|padded)['\"]"` → must match at least once |
| 10 | If any callback prop is in props (onClick / onChange / onSubmit), at least one story uses `fn()` in `args` | If component uses callback props (heuristic: file matches `on[A-Z]`), then `grep "fn()"` must match somewhere in the file |

### Group D — Project conventions (2 checks, optional, only if `.storybook/preview.ts` declares a `storySort.order`)

| # | Check | Pattern |
|---|---|---|
| 11 | Title prefix matches one of the declared sort order roots | Parse `storySort.order` from `.storybook/preview.ts`; `grep -oE "title:\s*['\"][^'\"/]+"` must produce a value present in the order list |
| 12 | Labs stories include `'!autodocs'` and `'!test'` tags | If title starts with one of the declared Labs section names (`Labs/`, `Sandbox/`, etc.), `grep "!autodocs"` and `grep "!test"` must both match |

### Group E — Story-as-proof (1 check + project tally, from `storybook ai setup`)

| # | Check | Pattern |
|---|---|---|
| 13 | `play` earns its place — WARN (not FAIL) on a no-op play whose only assertion is `toBeVisible`/`toBeInTheDocument` with no interaction/async/portal/computed-style signal | If file has `play:`, `grep` for `userEvent\|fireEvent\|findBy\|waitFor\|aria-pressed\|getComputedStyle\|ownerDocument\|toHaveBeenCalled` — absent + only `toBeVisible`/`toBeInTheDocument` → WARN (anti-pattern 34) |
| ★ | **Project tally (multi-file scans only):** exactly ONE story across the project asserts `getComputedStyle` (the `CssCheck` proof, anti-pattern 33) | Count files matching `getComputedStyle`; WARN on 0 (no CSS-loaded proof) or >1 (redundant probes) |

### What the validator does NOT check (judgment — use the sub-agent path)

- **Mega-story smell** — one story with knobs for every prop instead of named stories
- **State coverage** — did Button get all 8 expected states?
- **Missing JTBD prose** — production-grade stories should have `parameters.docs.description.story` with a "Jobs to be Done" or design rationale
- **Weak `play` assertions** — `play` runs interactions but asserts nothing meaningful
- **Hardcoded mock when 3+ stories share a shape** — factory candidate missed
- **Title taxonomy fit** — does this title actually belong where it's placed
- **Lifecycle tag missing** — is this clearly a V2/experimental story that should be tagged

These are the sub-agent review prompt's job.

## How to run the bash validator

```bash
# Single file
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh src/stories/Button.stories.tsx

# Glob (everything under src/stories/)
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh 'src/stories/**/*.stories.tsx'

# Current diff (staged or unstaged)
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh --diff

# Strict mode — also runs tsc + eslint + vitest on the file(s)
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh --strict src/stories/Button.stories.tsx
```

Output shape:

```
src/stories/Button.stories.tsx
  [PASS] 01 imports @storybook/react-vite
  [PASS] 02 imports storybook/test
  [FAIL] 03 satisfies pattern — found annotation form on line 12
  [PASS] 04 useArgs source
  [PASS] 05 no CSF2
  [PASS] 06 no dead SB10 imports
  [PASS] 07 no inline hex
  [PASS] 08 no disabled in pseudo
  [PASS] 09 parameters.layout set
  [PASS] 10 fn() used for callback args
  [SKIP] 11 storySort match (no order declared in preview.ts)
  [SKIP] 12 Labs tag combo (not a Labs story)

11 PASS, 1 FAIL, 2 SKIP — exit 1
```

The agent calls this **after writing a story, before declaring done**. If anything fails, the agent fixes and re-runs. The script is also CI-shaped: non-zero exit on any FAIL.

## The sub-agent review prompt

For the judgment-needed checks, dispatch one Agent call (subagent_type=general-purpose or compound-engineering:ce-code-review) with this prompt template. Keep the prompt self-contained — the sub-agent won't see this conversation.

```
You are reviewing a Storybook CSF3 story file at PATH=<abs path>.

Load the storybook-workbench skill from ~/.claude/skills/storybook-workbench/ for context.
Specifically read references/anti-patterns.md and references/composition-patterns.md.

Report ONLY judgment-needed concerns from this list (deterministic checks are
handled by the bash validator separately):

1. Mega-story smell — one story with every prop as a knob instead of named stories
2. State coverage gap — Button missing Hover/Focus/Disabled/Loading variants;
   Input missing Error/Filled; Modal missing Loading. Use the coverage tables in
   SKILL.md Step 2.
3. Missing JTBD prose — is this a production story that needs
   parameters.docs.description.story explaining what this state means and why?
4. Weak play assertion — play function exists but asserts nothing meaningful
   (e.g., clicks a button but never expects(args.onClick).toHaveBeenCalled())
5. Factory candidate — same data shape mocked 3+ times inline; should be a factory
6. Title taxonomy fit — does this title belong where it's placed; is it consistent
   with sibling files
7. Lifecycle gap — is this clearly an experimental/V2/deprecated story that should
   carry a lifecycle tag (see references/lifecycle-tags.md)

For each concern, output exactly:
- File: <path>:<line>
- Issue: <one sentence>
- Suggest: <one sentence fix>

If no concerns, output exactly: "OK — no judgment concerns."

Do not restate what's already in the file. Do not rewrite the file. Report only.
Max 200 words.
```

The agent reads the sub-agent report, fixes anything actionable, and re-runs the bash validator. Two passes max — if the second pass still flags something, surface it to the user rather than looping.

## Integration with existing skill layers

| Layer | When to invoke validate-workflow |
|---|---|
| Author | After every story write, before declaring done |
| Labs | Same — Labs stories should also pass deterministic checks (the script auto-skips Group D #12 unless title prefix matches) |
| Galleries | After tagging stories for a new gallery — verify tag spelling consistency (`'empty-state'` vs `'emptyState'`) |
| Extract | Run over the full output of an extraction session — quickly surfaces which extracted files need follow-up |
| Iterate + Propagate | Before graduation (Labs → Components) — every check must PASS |

## What this reference deliberately does not cover

- **Visual regression** — that's `ds-test-setup` skill territory (Chromatic / Lost Pixel / Playwright snapshots). The validator's job is conformance, not pixel diffing.
- **Axe rule policies** — `addon-a11y` is configured at install; project-specific axe rule customization is out of scope for this validator. The validator can call `run-story-tests` with `a11y: true` if MCP is wired.
- **TypeScript type narrowing inside `play`** — `tsc --noEmit` (strict mode) catches this in `--strict` runs. The validator doesn't try to encode SB-specific type rules.
- **Performance** — story file size, decorator depth, bundle impact. Out of scope here.

## Verification record

Validator built from:
- Anti-patterns #1–18 in `references/anti-patterns.md` (the deterministic ones)
- The 4 critical SB10 patterns in `references/without-mcp.md`
- Coverage tables in `SKILL.md` Step 2 (used by the sub-agent prompt)
- production survey: 191 stories scanned with prototype version of this script — caught 12 real anti-pattern matches across 8 files (mostly missing `parameters.layout` and dead `@storybook/blocks` imports in older files).
