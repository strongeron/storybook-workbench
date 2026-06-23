# End-to-End Flow — the moat playbook

**The differentiator.** Most "CSF3 story" skills cover one layer: write a story. This skill chains the full pipeline from "vibe-coded app handed to me" to "shipped, reviewed component, old version deprecated" — with a **runnable command at every step**.

The marketplace position: Storybook as Figma-replacement + audit surface + propagation pipeline, not just a per-component sandbox.

## The shape — Setup → Build → Ship + 2 gates + 3 modes

```
SETUP (one-time per project)                    ◄─── decision graduates ─┐
   ├─ Install                                                             │
   └─ Inventory (only if existing app)                                    │
       │                                                                  │
       ▼                                                                  │
BUILD (recurring — pick a mode) ───────────────► GATES (after every cycle)│
   ├─ Component ⭐ (production story)            ├─ Lint  ✅ (per cycle) │
   ├─ Explore   🧪 (iteration, sandboxed)         └─ Audit 🔍 (periodic)  │
   └─ Compare   🧱 (stakeholder review + wrappers)   │                    │
       (Factory side-step — 3+ stories share shape)  ▼                    │
                                                  back to BUILD ──────────┘
                                                     │
                                                     ▼
                                                  SHIP (event)
                                                     propagate + deprecate

This reference is the **playbook**. SKILL.md has the trigger logic; this file has the commands and the worked example. The flow lines up runnable commands at every step so the agent doesn't reinvent verbs per project.

## When to load this reference

- User describes a full pipeline ("we have a Figma redesign, no Storybook yet, ~30 components")
- User asks for the "Storybook workflow" / "end-to-end story flow" / "how do I move from messy to clean"
- User needs to see how the layers connect (skill-judge or skill-router review)
- New project onboarding — orient before picking a starting layer

## The 3+2+3 model — one command per state

### SETUP (one-time)

| Step | Command | What it produces |
|---|---|---|
| Pre-flight | `test -d .storybook && grep -q '"storybook"' package.json` | `STORYBOOK_PRESENT` or `NO_STORYBOOK` |
| Install | `npx storybook@latest init --yes` (then wizard Phase 2 from `install-wizard.md`) | `.storybook/` with bundled addons + decorators |
| Inventory (conditional — existing apps only) | `~/agent-skills/plugins/storybook-workbench/skills/sb-inventory/scripts/inventory-project.sh` (then `extract-flows.sh`, `validate-design-system.sh`) | Real-vs-slop component map + dominant design system → `project-inventory.json` / `flows.json` / `design-system-health.json`. Owned by **sb-inventory** / sb-flows / sb-health. Greenfield projects skip this. (`audit-drift.sh` is the periodic **Audit** gate, not inventory — see below.) |

### BUILD (recurring — pick one mode per cycle)

| Mode | Command | What it produces |
|---|---|---|
| Factory side-step (when 3+ stories share shape) | `~/agent-skills/plugins/storybook-workbench/skills/sb-stories/scripts/scaffold-factory.sh <TypeName> <type-import-path>` | `.storybook/factories.ts` with a `createMock<X>` stub the agent fills in |
| Mode: **Component** ⭐ (production story) | write stories — MCP `get-storybook-story-instructions` if wired, else `references/without-mcp.md`. **File location = the recorded `storiesLocation`** (CONTEXT.md): the worked example below co-locates because it's a project-you-own run; an **audit defaults to isolated `.storybook/stories/`** | Production stories tagged `['autodocs']` in the chosen location |
| Mode: **Explore** 🧪 (iteration, sandboxed) | scaffold under `src/explore/` (or `src/stories/labs/` on existing projects); `references/labs-workflow.md` + `references/figma-to-storybook.md` | Stories tagged `['explore', '!autodocs', '!test']` — disk-isolated, doesn't pollute app code |
| Mode: **Compare** 🧱 (stakeholder review) | `${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh --tier 2` (one-time; tier 1 = the 3 structural views, tier 2 adds the decision pair), then `<ABCanvas>` / `<StateGrid>` / `<TrackedDecision>` from `.storybook/wrappers/`. See `references/wrapper-library.md`. | Composition stories — A/B / role / state grid / page / motion / decision-tracked |

### GATES (after every BUILD cycle)

| Gate | Command | What it produces |
|---|---|---|
| **Lint** ✅ (per cycle) | `${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh <path>` (`--strict` adds tsc+eslint) | PASS/FAIL per check, exit non-zero on FAIL |
| **Audit** 🔍 (periodic) | `~/agent-skills/plugins/storybook-workbench/skills/sb-audit/scripts/audit-drift.sh` + `find-stories-by-tag.sh <tag>` → scaffold `<TagGallery>` or `<DecisionsDashboard>` | Drift surface, gallery view, decision board |

### SHIP (event — Explore iteration graduates) — **preserve the experiment**

The Explore story stays in place (design history). Pick Path A or Path B based on what the Explore introduced. See `references/propagate-workflow.md` for the full decision tree + sub-paths (B1 evolve in place / B2 keep V1 alongside).

| Step | Command | What it produces |
|---|---|---|
| Path A — NEW component | `cp src/explore/<name>/<file>.tsx src/components/<name>/<File>.tsx` + write fresh `<File>.stories.tsx` for production | New shipping component + production stories (autodocs); Explore stays |
| Path B — UPDATE existing | agent edits `src/components/<name>/<File>.tsx` with V2 changes + updates `<File>.stories.tsx` with new states | Existing component evolved; Explore stays |
| Propagate callsites | `ast-grep --pattern '<old import>' --rewrite '<new import>' --update-all` (only if import path changed) | Every callsite updated |
| Close decision loop | Update Explore story tags `decision:pending` → `decision:chosen` + `archived`; set `parameters.decision = { status, winner, date, shippedTo }`; add chosen banner to docs | Explore preserved + visibly marked; `<DecisionsDashboard>` sees the win |
| Deprecate V1 (Path B2 only) | edit V1 stories file: `tags: ['deprecated']` + removal date | Old version visibly marked, kept one release window |
| Confirm | `${CLAUDE_PLUGIN_ROOT}/scripts/find-stories-by-tag.sh decision:chosen` + `find-stories-by-tag.sh deprecated` | Lists chosen + deprecated stories — drives the next cleanup pass |

### Maintenance cadence (where "Iterate" lives)

Re-run `audit-drift.sh` + `find-stories-by-tag.sh deprecated` every sprint or every 20 PRs. The point of the audit is the *re-run* — if you check drift once and never again, you never see whether it dropped. This replaces what was "Iterate as a phase" in earlier drafts.

## The Build → Gates → (maybe) Ship loop

This is the loop most Storybook tutorials never get to. It's what makes the skill compound across projects:

```
                ┌─────────────────────────────────────────┐
                │                                         │
                ▼                                         │
   BUILD ────► Lint ────► (graduation event?) ── yes ────► SHIP
   (Component/        (validate-stories.sh)                  │
    Explore/                                                 │
    Compare)                                                 │
       ▲                                                     │
       │                                                     │
   Audit (periodic) ◄─────────────────────────────────────────┘
   (audit-drift.sh + find-stories-by-tag.sh)
```

Each Build cycle:
1. **Build** — write or iterate a story in Component / Explore / Compare mode
2. **Lint** — `validate-stories.sh` confirms conformance (every cycle)
3. **Maybe Ship** — only if an Explore iteration graduated; ast-grep callsites, tag old version deprecated
4. **Maybe Audit** — periodically `find-stories-by-tag.sh` re-runs the gallery / decision board; drift becomes visible
5. **Back to Build** — if Audit surfaces drift (17 names for "empty state"), consolidate via Component mode

The loop is *runnable*, not aspirational. Each step has a command.

## Worked example — production-shaped run

This is how the chain plays out on a new project the size of a small production app (~30 components, designer redesigning the Hero):

```bash
# ─────────────── SETUP ───────────────
$ test -d .storybook && grep -q '"storybook"' package.json && echo OK
NO_STORYBOOK
$ npx storybook@latest init --yes                   # ~3 min; configures preview.tsx via wizard
$ scripts/inventory-project.sh                       # inventory existing app (real vs slop)
11 real / 4 dead · dominant=tailwind-v4 (the AGENTS.md claimed shadcn — inventory caught the lie)
$ scripts/audit-drift.sh src/                        # naming-drift survey (the periodic Audit gate)
17 stories with "empty" in export name across 5 files — gallery candidate later

# ─────────── BUILD — Factory side-step ───────────
$ scripts/scaffold-factory.sh Course '@/types/course'
✓ Wrote .storybook/factories.ts with createMockCourse stub — fill in deterministic defaults

# ─────────── BUILD — Mode: Component (per component, 5–8 per session) ───────────
# (agent writes src/components/hero/Hero.stories.tsx using createMockCourse)
$ scripts/validate-stories.sh src/components/hero/Hero.stories.tsx   # Lint gate
all checks passed

# ─────────── BUILD — Mode: Explore (designer hands over Figma V2) ───────────
# (agent scaffolds src/explore/hero/v2.stories.tsx with parameters.design, tags ['explore', '!autodocs', '!test'])
$ scripts/validate-stories.sh src/explore/hero/v2.stories.tsx        # Lint gate

# ─────────── BUILD — Mode: Compare (stakeholder review) ───────────
$ scripts/scaffold-wrapper.sh --tier 2                                # one-time, scaffolds 7 (CORE + EXTENDED, incl. the decision pair)
# (agent writes src/explore/compare/hero-v1-vs-v2.stories.tsx using <TrackedDecision> + <ABCanvas>)
# (tags: ['compare', 'decision:pending', '!autodocs', '!test'])
$ scripts/validate-stories.sh --strict 'src/**/*.stories.tsx'        # Lint gate (--strict for tsc+eslint)

# ─────────── GATES — Audit (after several Build cycles) ───────────
$ scripts/find-stories-by-tag.sh empty-state                          # the drift we found in Inventory
# Tag relevant stories with 'empty-state' + scaffold src/stories/galleries/EmptyStateGallery.stories.tsx
$ scripts/find-stories-by-tag.sh decision:pending                     # see pending decisions
# Open Decisions/Dashboard in Storybook UI

# ─────────── SHIP (V2 wins) — preserve the experiment ───────────
# Decision tree → Path B1 (evolve existing src/components/hero in place; V2 doesn't need V1 alongside)

# 1. Apply V2 changes to the production component (agent reads src/explore/hero/v2.tsx, applies diff)
#    Result: src/components/hero/Hero.tsx now has V2 contents

# 2. Update production stories file with new states V2 introduced
#    Result: src/components/hero/Hero.stories.tsx evolved

$ scripts/validate-stories.sh src/components/hero/Hero.stories.tsx    # Lint gate
all checks passed

# 3. (Optional) ast-grep callsites only if the import path changed (Path B1 typically doesn't change it)
# $ ast-grep --pattern '...' --rewrite '...' --update-all

# 4. Update the EXPLORE story tags + chosen metadata IN PLACE — do NOT git mv it
#    Edit src/explore/hero/v2.stories.tsx:
#      tags: ['explore', 'decision:pending', ...] → ['explore', 'decision:chosen', 'archived', '!autodocs', '!test', 'figma-sync']
#      parameters.decision = { status: 'chosen', winner: 'V2', date: '2026-05-29', shippedTo: 'Components/Marketing/Hero' }
#      parameters.docs.description.component = '## Chosen 2026-05-29 — shipped to Components/Marketing/Hero'

# 5. Update the COMPARE story to flip the decision banner
#    Edit src/explore/compare/hero-v1-vs-v2.stories.tsx:
#      tags: ['compare', 'decision:pending', ...] → ['compare', 'decision:chosen', 'archived', ...]
#      <TrackedDecision> status='chosen' winner='V2' date='2026-05-29'

$ scripts/find-stories-by-tag.sh decision:chosen                       # confirm dashboard updated
src/explore/hero/v2.stories.tsx:25
src/explore/compare/hero-v1-vs-v2.stories.tsx:32

# Experiment preserved at src/explore/hero/v2.{tsx,stories.tsx} (historical record, decision:chosen).
# Shipping component at src/components/hero/Hero.{tsx,stories.tsx} (V2 contents, autodocs).

# ─────────── Maintenance (next sprint) ───────────
$ scripts/audit-drift.sh src/                         # any new naming inconsistencies?
$ scripts/find-stories-by-tag.sh deprecated           # removal-window cleanup ready?
```

The chain is the moat. Each `scripts/<x>.sh` call is a **named, scoped command** — the agent doesn't have to invent the verb. Modes (Component / Explore / Compare) are the agent's primary decision per Build cycle; everything else is gates running automatically.

## When the chain breaks — the actual hard parts

The textbook layers connect cleanly. Real projects break in two places, and the skill addresses both:

- **Drift across Galleries** — one production app had 17 "empty state" naming variants. Without `find-stories-by-tag.sh` + `TagGallery`, the drift is invisible. With them, one canvas exposes it and one renaming pass fixes it.
- **Propagation lag** — graduation happens, but old callsites linger for months. Without `ast-grep` + `find-stories-by-tag.sh deprecated`, the cleanup never closes. With them, the deprecation has an end date and the next sprint runs `find-stories-by-tag.sh deprecated`, sees zero, deletes the old component.

These are the loops the skill is actually built to support. Everything else is table stakes.

## The scripts (named verbs the chain calls)

| Script | Step | Used by |
|---|---|---|
| `scripts/inventory-project.sh` | Setup · Inventory (real-vs-slop, design system) | Agent during initial discovery (**sb-inventory**); paired with `extract-flows.sh` (sb-flows) + `validate-design-system.sh` (sb-health) |
| `scripts/validate-stories.sh` | Lint gate | Agent before declaring done; CI on every PR |
| `scripts/audit-drift.sh` | Audit gate (periodic naming-drift survey) | Agent during periodic cleanup (**sb-audit**) — *not* inventory |
| `scripts/find-stories-by-tag.sh` | Audit gate (galleries + deprecation + decisions) | Agent to enumerate stories matching a tag |
| `scripts/scaffold-factory.sh` | Build · Factory side-step | Agent when 3+ stories share a shape |
| `scripts/scaffold-wrapper.sh` (v1.7) | Build · Compose mode | Agent when project needs Storybook-only wrappers (one-time per project, tier-selectable) |

(Future candidates not yet built: `propagate-component.sh` wrapping ast-grep; `audit-figma-sync.sh` listing stories with `parameters.design`. These currently live as prose recipes in `figma-to-storybook.md`.)

## Anti-patterns specific to running the chain

1. **Skipping Lint gate before Ship.** Graduating an unvalidated story to production carries its anti-patterns into the design system. Validator must PASS before `git mv`.
2. **Running Audit once and forgetting.** The point of audits is the *re-run*. If you never re-open `EmptyStateGallery` or `DecisionsDashboard` after a cleanup pass, you never see whether drift dropped.
3. **Propagating without deprecating.** Leaves the old component reachable with no warning. Designers don't know which is canonical. They are one event, not two.
4. **Iterating without re-running Audit.** The drift report from Inventory is a snapshot, not a forever-truth. Re-run periodically.
5. **Authoring without a factory when 3+ stories share a shape.** Inline mocks pile up; later refactors fan out. Factory side-step before authoring when the shape is shared.

## Verification record

- 3+2+3 shape derived from v1.6.1 reframe (Setup / Build / Ship + 2 gates + 3 modes). Compacted from earlier 12-phase model.
- Worked example shape drawn from a real production app's structure: `.storybook/factories.ts` (527 lines, framework-agnostic), 191 stories across 25 directories, 17 "empty" naming variants in Audit drift.
- Scripts: `validate-stories.sh`, `audit-drift.sh`, `find-stories-by-tag.sh`, `scaffold-factory.sh` shipped in v1.6. `scaffold-wrapper.sh` shipped in v1.7 alongside the wrapper library (now 16 wrappers).
- Backward compat: Author/Labs/Compose mode names still accepted (Labs/* title prefix in validator); new projects encouraged to use Component/Explore/Compare.
