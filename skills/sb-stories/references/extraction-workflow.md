# Extraction Workflow — Vibe-Coded App to Storybook

Layer 2 of the skill. Load this reference when the user wants to **capture an existing app's components, screens, and flows in Storybook** rather than write stories from scratch.

**When to load:**
- User says "extract Storybook from this app", "build a Storybook out of this", "capture the state of this app", "make stories for what we already have"
- User has a working React app (vibe-coded with Lovable/Bolt/v0/Cursor/Claude, or existing production code) and wants to systematize it
- SKILL.md Layer 2 hand-off

**Prerequisites:**
- Storybook installed (Layer 1 — install-wizard.md must have run first, OR Storybook already present)
- Project decorators wired (theme/router/queryclient available in preview.tsx)

## Phase 0 — Ground-truth inventory (v1.8.1+, MANDATORY)

Before manually scanning, run the **four-script discovery chain** to capture every value an authoring decision will depend on. Each script writes a structured JSON the agent reads instead of grepping ad-hoc. Replaces trusting `CLAUDE.md` / `AGENTS.md` — those drift, lie, or don't exist in vibe-coded repos.

```bash
# 1. Stack + design system + real vs dead components
~/agent-skills/plugins/storybook-workbench/skills/sb-inventory/scripts/inventory-project.sh

# 2. Routes + flows + overlays (Phase 3 ground truth)
~/agent-skills/plugins/storybook-workbench/skills/sb-flows/scripts/extract-flows.sh

# 3. State branches per component (Phase 1 minimum-story driver)
~/agent-skills/plugins/storybook-workbench/skills/sb-stories/scripts/extract-states.sh

# 4. Shared prop-shape clusters (Phase 2 factory threshold)
~/agent-skills/plugins/storybook-workbench/skills/sb-stories/scripts/extract-prop-shapes.sh
```

Four files land under `.storybook/`. Read them in order; each later phase reads the earlier JSONs.

| Script | Output | What it answers |
|---|---|---|
| `inventory-project.sh` | `project-inventory.json` | Stack, dominant design system, real vs dead components, tokens, orphan stories |
| `extract-flows.sh` | `flows.json` | Routes (5 flavors), ad-hoc page switchers, wizards/step machines, modal/dialog overlays, per-screen state recommendations |
| `extract-states.sh` | `component-states.json` | Per-component state branches detected (loading/error/empty/disabled/open/success/skeleton/variants), minimum story count, tier inference (primitive/composite/container) |
| `extract-prop-shapes.sh` | `prop-shapes.json` | Type definitions clustered by usage count, factory candidates (≥3 component files), single-use shapes (inline mocks) |

`inventory-project.sh` ground-truth output:

The script writes `.storybook/project-inventory.json` with:

| Section | What's in it | Why it matters |
|---|---|---|
| `libraries.*` | React/Vite/Tailwind v4/v3/shadcn/Radix/Base UI/R3F booleans | Tells you the stack without asking |
| `designSystem.dominant` | Exactly one of `tailwind-v4`, `shadcn`, `dtcg`, `css-vars`, `none` | The opinion. Use this everywhere. Mixed sources flagged separately. |
| `designSystem.mixed` | `true` if multiple sources have >5 tokens each | Signal of transition / inconsistency — investigate before authoring |
| `components.real[]` | Files imported FROM OUTSIDE their own file (sorted by importer count) | **Priority for stories** — these are the production surface |
| `components.dead[]` | Files defined but never imported elsewhere | **Likely AI slop** — don't write stories for these; flag for deletion |
| `tokens.orphan[]` | Declared `--foo` never referenced (`var()` or as scale prefix) | Soft signal — Tailwind v4 internal vars are noisy here |
| `orphanStories.items[]` | Stories importing files that don't exist | Hard signal — refactors left these behind; safe to delete |

**Use it like this in extraction:**

```bash
# 1. Discover
$ ~/agent-skills/plugins/storybook-workbench/skills/sb-inventory/scripts/inventory-project.sh
✓ Wrote .storybook/project-inventory.json

━━ Project inventory summary ━━
  Stack:       React=✓  Vite=✓  Tailwind v4=✓  shadcn=✗
  Design sys:  dominant=tailwind-v4   (TW4:349 shadcn:0 DTCG:0 CSS-vars:0)
  Components:  196 real / 40 dead (slop) / 248 total
  Tokens:      62 used / 345 orphan / 407 declared
  Stories:     63 orphan stories (import missing components)

# 2. Open Foundations/Inventory in Storybook (after scaffolding ProjectInventory wrapper)
# 3. Author stories ONLY for components in components.real[]
# 4. Optionally delete orphan stories + dead components in a separate cleanup PR
```

Smoke-tested on a real 248-component production codebase: correctly identified Tailwind v4 as dominant (zero false positives), flagged 16% slop rate (40/248), surfaced 63 orphan stories.

## Phase 1 — Scan and classify

Goal: enumerate every real component, classify by tier, derive minimum story count from detected state branches.

**The chain reads `.storybook/component-states.json` (from Phase 0)** — the JSON already lists every state branch the component handles. The tier field is set: `primitive` (≤2 states), `composite` (3-4), `container` (5+).

```bash
# Top priority targets — components needing ≥4 stories (containers/composites)
python3 -c "
import json
d = json.load(open('.storybook/component-states.json'))
for t in d['priorityTargets'][:10]:
    print(f'{t[\"file\"]}: {t[\"minimumStories\"]} stories — {\",\".join(t[\"states\"])}')
"

# Component density per dir — where's the most concentration?
python3 -c "
import json, collections
d = json.load(open('.storybook/project-inventory.json'))
by_dir = collections.Counter('/'.join(c['file'].split('/')[:-1]) for c in d['components']['real'])
for k, v in by_dir.most_common(10): print(f'{v:3d}  {k}')
"

# How many already have stories?
find . -name "*.stories.tsx" -not -path "*/node_modules/*" | wc -l
```

**Authoring rule** — for each component, the `states` array from `component-states.json` is the canonical minimum story list. Default → loading → error → empty → disabled → success → open. **Don't author more states than the JSON suggests** (refuse Cartesian); **don't author fewer** (those are the real branches in the source).

Tier classification (already in JSON) drives extraction order:

| Tier | Heuristic | Extract first | Stories needed |
|---|---|---|---|
| **Tier 1 — Primitive** | Props-only, no `useState`/`useEffect`/`useQuery`/data hooks, JSX output is mostly leaf elements (`<button>`, `<input>`, `<div>`) | Yes — easiest, biggest coverage win | Default + meaningful states (per SKILL.md Step 2 checklists) |
| **Tier 2 — Composite** | Uses `useState`, child components from primitive layer, no data fetching | Second pass | Default + state combinations |
| **Tier 3 — Container / Page** | Data fetching (`useQuery`, `useSWR`, server actions), routing context, multiple stateful children | Last — needs foundation phase | Default + Loading + Error + Empty + state-driven variants |

**Storybook's official agentic-setup workflow caps at 10 components per session.** Backend.AI's real case study converged on **5–8 per session**. Stop when:
- Context utilization hits ~70%
- Next component requires understanding >3 new modules not already read

Save the ranked candidate list to `.storybook/extraction-plan.md` for future sessions to resume.

## Phase 2 — Identify shared data shapes (factory candidates)

**The chain reads `.storybook/prop-shapes.json` (from Phase 0).** It already clusters shapes by usage count.

```bash
# Factory candidates — types used in ≥3 component files. Run scaffold-factory.sh on each.
python3 -c "
import json
d = json.load(open('.storybook/prop-shapes.json'))
for c in d['factoryCandidates']:
    print(f'{c[\"type\"]:24s} {c[\"componentFileUsages\"]} files  {c[\"declaredIn\"][0][\"file\"] if c[\"declaredIn\"] else \"\"}')
"
```

**Decision rule (locked in `extract-prop-shapes.sh` at `--threshold 3`):**

| Shape appears in | Action | Why |
|---|---|---|
| **≥3 component files** | Run `scaffold-factory.sh <Type> <import-path>` — extract to `src/stories/factories/<name>.ts` using `makeFactory<T>` pattern | Diff hygiene + deterministic mock data across stories |
| **1-2 component files** | Inline minimal mock data in story `args` | Pre-factoring single-use shapes is premature abstraction |

See `references/factory-patterns.md` for the `makeFactory<T>` pattern. Don't override the threshold without a reason; `≥3` is the verified line where shared factories pay rent.

## Phase 3 — Map screens and flows

Goal: every distinct screen becomes a Page story; multi-step flows become MDX docs that link the page stories. **All four flow surfaces — routes, ad-hoc switchers, wizards, overlays — are already in `flows.json` from Phase 0.**

```bash
# Routes — every flavor, per-screen state recommendations baked in
python3 -c "
import json
d = json.load(open('.storybook/flows.json'))
print(f'Dominant router: {d[\"dominantRouter\"]}')
for r in d['perScreenRecommendations']:
    print(f'  {r.get(\"path\", \"?\"):24s} → {\",\".join(r[\"recommendedStates\"])}')
"

# Ad-hoc useState page switchers (App.tsx-style)
python3 -c "import json; print('\n'.join(json.load(open('.storybook/flows.json'))['adhocSwitchers']))"

# Wizards / step machines (useState<number> + setStep)
python3 -c "import json; print('\n'.join(json.load(open('.storybook/flows.json'))['wizards']))"

# Modal/Dialog/Sheet overlays — each is a flow with open/closed + inner loading/error
python3 -c "
import json
for o in json.load(open('.storybook/flows.json'))['overlays']:
    # malformed grep lines land as {raw: ...}; skip them
    if 'file' not in o: continue
    print(f'  {o.get(\"component\", \"?\"):12s} {o[\"file\"]}:{o.get(\"line\", \"?\")}')
"
```

The five route flavors detected by `extract-flows.sh`:

| Flavor | Detection pattern | JSON key |
|---|---|---|
| **react-router** | `<Route path=...>` declarations (single-line + Prettier multi-line) | `routes.reactRouter[]` |
| **nextjs-pages** | files under `pages/` (excl. `pages/api/`) | `routes.nextjsPages[]` |
| **nextjs-app** | `app/**/page.tsx` files | `routes.nextjsApp[]` |
| **tanstack** | files under `routes/` (file-based) | `routes.tanstack[]` |
| **adhoc-state** | `const [page, setPage] = useState` in App.tsx | `adhocSwitchers[]` |

**Migration-in-progress signal.** When `routerTies[]` in `flows.json` is non-empty, the project has 2+ router flavors with significant route counts — investigate before wiring a router decorator. Example: `dominantRouter: "react-router"` + `routerTies: ["nextjs-app"]` means a legacy react-router app is being migrated to Next.js App Router. Decide which decorator to wire (MemoryRouter vs Next router mock); don't silently pick the dominant one.

**Per-screen output:** one story per behaviorally-distinct state of the page. `flows.json` already proposes the right state set per path pattern — auth, list, detail, form, dashboard — based on path-keyword matching. Use them as the starting list; override only when source state branches diverge (`component-states.json` is the source of truth for those).

| Page type | Stories to capture |
|---|---|
| **Auth (login, signup, password reset)** | Empty form · Filled · Submitting · Validation error · Server error · Success / redirect (mocked) |
| **List view (users, posts, items)** | Default · Empty · Loading · Error · One-item · Many-items (test pagination/virtualization) · Filtered |
| **Detail view** | Default · Loading · Not found · Permission denied · Long content · Stale (cache miss) |
| **Form (settings, profile)** | Empty · Pre-filled · Dirty · Submitting · Per-field validation error · Submit success |
| **Dashboard / landing** | First-visit · Returning user · Empty (no data yet) · Loading skeleton · Partial data |

**Flow capture (the piece most teams miss):**

A flow is a multi-step user journey across screens — onboarding, checkout, password reset, multi-step form, etc. Document it as:

1. **One story per step** with title `Pages/{Flow}/{NN-StepName}`:
   - `Pages/Onboarding/01-Welcome`
   - `Pages/Onboarding/02-Profile`
   - `Pages/Onboarding/03-Preferences`
   - `Pages/Onboarding/04-Done`
2. **One MDX docs page** linking them: `stories/docs/Flows/Onboarding.mdx` with do/don't blocks, success criteria, drop-off concerns
3. **Optional `play` function** that drives a story through several steps to validate the transitions

Naming convention: `NN-` prefix for ordering, lowercase kebab for clarity in URLs.

**Common gotcha — unexported sub-components.** Vibe-coded multi-step flows often have step components defined as local consts inside the parent file, NOT exported. Example:

```tsx
// src/pages/Onboarding.tsx
function StepWelcome(...) { /* ... */ }   // ← not exported
function StepProfile(...) { /* ... */ }   // ← not exported
export function Onboarding() { /* renders one of them based on state */ }
```

Three ways to handle this — pick based on team appetite:

| Approach | When to use | Tradeoff |
|---|---|---|
| **(a) Refactor to export** each step component, then write per-step stories | When the team is committed to systematic UI documentation and OK touching code | Cleanest, but extraction is supposed to be non-mutating |
| **(b) Parent-only `Flow` story with `play` advancing state** through each step | When you don't want to refactor — write one story whose `play` clicks "next" through every step, capturing screenshots at each transition | Single story, less granular regression coverage |
| **(c) Inline duplicates of step components** in story file | When the team will refactor later but you want full per-step stories now | Temporary; flagged with `'needs-cleanup'` tag |

Default: (b) for first-pass extraction, switch to (a) when the team commits to the design system. (c) is debt.

**Ad-hoc routing — useState page switchers.** Vibe-coded apps often have `const [page, setPage] = useState('dashboard')` in App.tsx instead of a real router. `extract-flows.sh` flags these as a flat list in `adhocSwitchers[]` (count in `adhocSwitcherCount`). Treatment:
- Page detection: read `App.tsx` for the page-switcher state machine; each page value = one page story
- No router decorator needed; pages render directly
- Story title: `Pages/{PageName}` (no router-namespaced path)
- This is correct extraction behavior — document the ad-hoc reality; refactoring to a real router is its own task post-extraction

**Overlay flows — modal/dialog/sheet.** Overlays (`<Dialog open=…>`, `<Modal open=…>`, `<Sheet open=…>`, `<Drawer open=…>`, `<Popover open=…>`, `<AlertDialog open=…>`) are flows too — they have an open/closed state and usually an internal loading/error state when they fetch on open. `extract-flows.sh` flags them as a flat list in `overlays[]` (count in `overlayCount`).

Minimum overlay coverage:

| Story state | What it represents |
|---|---|
| `Closed` | `open: false` baseline (rare — usually skip unless toggle matters) |
| `Open` | `open: true`, default content rendered |
| `OpenLoading` | `open: true`, content fetch in-flight (loading skeleton) |
| `OpenError` | `open: true`, content fetch failed |
| `OpenEmpty` | `open: true`, content fetch succeeded but result was empty |

**`open` is an arg, not `parameters.pseudo`.** This is the most-violated pattern for overlays. `parameters.pseudo` is for `:hover` / `:focus` / `:disabled` CSS pseudo-classes — none of which model "the dialog is open." Use `args.open: true` so the Controls panel can toggle it and `useArgs` can sync internal close handlers (see `templates/controlled-component-story.tsx`).

## Phase 4 — Detect anti-patterns to flag (don't fix during extraction)

Capture the current state honestly. Don't refactor while extracting — that's a separate pass. But DO flag:

```bash
# Hardcoded hex colors — covers both Tailwind arbitrary form AND inline style={{}}.
# Lovable / Bolt / v0 / Claude / Cursor generated apps overwhelmingly use inline style={{}}
# for colors, NOT arbitrary-Tailwind form. Both patterns must be scanned.
grep -rE "(bg-\[#[0-9a-fA-F]{3,8}\]|text-\[#[0-9a-fA-F]{3,8}\])" src/ --include="*.tsx" | head -20   # Tailwind arbitrary form
grep -rE "style=\{\{[^}]*['\"#]?#[0-9a-fA-F]{3,8}" src/ --include="*.tsx" | head -20                  # inline style={{}} form
grep -rE "(backgroundColor|color|borderColor|fill|stroke):\s*['\"]#[0-9a-fA-F]" src/ --include="*.tsx" | head -20  # object-property form

# Magic-number spacing (Tailwind arbitrary + inline pixel literals)
grep -rE "(mt|mb|ml|mr|p|m|gap)-\[[0-9]+px\]" src/ --include="*.tsx" | head -10
grep -rE "(padding|margin|gap):\s*['\"]?[0-9]+px" src/ --include="*.tsx" | head -10

# Inline mock data that should be a factory
grep -rE "\{\s*id:\s*['\"]\w+['\"]," src/ --include="*.tsx" | head -10
```

**Why three grep patterns for color?** AI-generated apps use inline `style={{ backgroundColor: '#xxx' }}` in ~90% of cases. Only sanitized / cleaned-up projects use the Tailwind `bg-[#xxx]` arbitrary form. Skip the inline-style grep and you'll undercount color debt by 10×.

Tag flagged stories with `['ai-generated', 'needs-cleanup']`. They render correctly but represent debt:
- Hardcoded values → run `/ds-token-extract` or `/ds-audit` after extraction completes
- Inline mocks → factory candidates from Phase 2

The extraction phase **documents reality, doesn't change it**. The cleanup is its own pass — invokes `/ds-audit` + `/ds-token-extract` + `/ds-component-extract` once the snapshot is captured.

## Phase 5 — Write extraction stories

For each candidate from Phase 1, write the story file following SKILL.md Step 5:
- Primitives → follow the import / `fn()` / `satisfies Meta<typeof X>` patterns in `references/without-mcp.md` §1-3; one named story per behaviorally-distinct state (per SKILL.md Step 2 checklists)
- Controlled components → start from `templates/controlled-component-story.tsx` (the only template that survives — the `useArgs` + render sync pattern is non-obvious)
- Pages → set `parameters.layout: 'fullscreen'`, mock data via factories (Phase 2), avoid importing real router/auth/query hooks; create a `<Name>Preview` wrapper component if the real page calls hooks

**Tag every extraction story with `['ai-generated']`** until a human reviews it. Add `'needs-work'` if you weren't sure about something (missing state coverage, ambiguous prop semantics).

Commit per component or per small batch (3-5 components) for clean diff history.

## Phase 6 — Snapshot the current state

After extraction, the Storybook is a **snapshot of what the app looks like today**. Lock it as the baseline:

```bash
# Visual regression baseline via Chromatic
npx chromatic --project-token=<token> --auto-accept-changes

# Or Lost Pixel
npx lostpixel
```

This is the moment that turns "messy vibe-coded app" into "this is where we are." Every future refactor compares against this snapshot. Regressions are caught; intentional changes are reviewed.

## Phase 7 — Hand off

After extraction completes, route to the right next-step skill:

| Goal | Next skill |
|---|---|
| Clean up the design tokens / hardcoded values | `/ds-audit` then `/ds-token-extract` |
| Refactor the components into a design system | `/ds-component-extract` |
| Add visual regression to CI | `/ds-test-setup` + `/ds-ci-gates` |
| Write designer-authored MDX docs per component | (future) `storybook-doc-blocks` — for now, use Storybook's `<Canvas>`/`<Controls>`/`<ColorPalette>` blocks manually |
| Iterate on individual components | This skill, Layer 3 (authoring) |

## Anti-patterns specific to extraction

1. **Refactoring while extracting** — don't. Extraction documents the state; refactoring is a separate concern. Mix them and you lose the "this is where we are" snapshot.
2. **Extracting >10 components in one session** — context will compress, errors batch, attribution becomes ambiguous. Stop at 5-8 done or 10-12 stubbed.
3. **Skipping the flow capture** — a Storybook of 80 components with no flow stories captures the parts but not the product. Even 3 flow MDX pages dramatically improve designer review value.
4. **Not tagging `['ai-generated']`** — extraction stories that merge silently become indistinguishable from human-reviewed stories. Tag aggressively; strip tags only after human review.
5. **Inventing structure** — if `.storybook/preview.ts` already has a `storySort`, match it. If it doesn't and the team has a strong opinion, use the taxonomy interview in `references/directory-structure.md`. Don't impose a different convention mid-extraction.
6. **Over-mocking** — extraction is "what does the app currently look like." Mock data should be representative, not pristine. If the real app has 1500-character article titles, capture that as a story; don't sanitize.

## Sandbox-verifiable scenarios

To validate the extraction workflow end-to-end:
1. Scaffold a fixture vibe-coded app (Vite + React + shadcn with 8-10 inline-styled components and 3-4 pages)
2. Run this workflow against it
3. Verify: extraction-plan.md is generated, 5-8 stories written, 1-2 factories extracted, 1 MDX flow doc created
4. Capture findings → `runs/<date>-extraction-pilot/REPORT.md` → `/kb ingest` → vault

See `docs/publishing/sandbox-pattern.md` for the methodology.

## Verification record

The component-discovery + classification heuristics derive from:
- Storybook's official agentic-setup workflow (9 phases, 10-component ceiling)
- Backend.AI 50-component migration case study (Feb 2026)
- Red Hat behavioral-verification engine pattern (April 2026)

Phase 3 flow capture is **not yet verified live** — it's the next sandbox pilot target.
