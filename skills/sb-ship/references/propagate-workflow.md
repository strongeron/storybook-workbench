# Propagate Workflow — preserve the experiment, ship the winner

**The discipline this reference owns:** when an Explore iteration is chosen, propagate it to production **without destroying the experiment**. Past skill drafts said `git mv src/explore/... src/components/...` — that's wrong. The Explore story is design history; it should stay where it is, visibly marked as the winning version, so the next designer/agent can read the record.

## The layered preservation model (v1.7.1)

History lives in three layers, all in the repo. Nothing external. Designer / team / AI all read from the same place.

| Layer | Where | Visibility | When |
|---|---|---|---|
| **L1 Active** | `src/components/` + `src/explore/` | Shown in Storybook sidebar by default | Recent — current production + last ~3 months |
| **L2 Archive** | Same files, with `'archived'` tag added | Hidden from sidebar by default; toggle to show | 3–12 months old; `decision:chosen` or `decision:rejected` |
| **L3 Ledger** | `.storybook/audit/decisions.md` (markdown table) | Always present in repo | 12+ months old; story file pruned but recoverable from git |

**Lifecycle of a single decision:**

```
Day 0       decision:pending      → L1  (in Explore + Compare; dashboard shows pending)
Day 14      decision:chosen       → L1  (Ship event; V2 lives in Components; Explore tags flip)
Day 90      add 'archived' tag    → L2  (still in code, hidden from default sidebar)
Day 365     prune to ledger       → L3  (file git rm'd; one-line markdown row remains)
```

Automation: the agent runs `scripts/audit-archived.sh` periodically (manually or in CI) to surface L1→L2 and L2→L3 transitions. `scripts/prune-to-ledger.sh` handles the L2→L3 move (writes the markdown row + git rm's the file). Both scripts have dry-run defaults.

The DecisionsDashboard wrapper shows L1 by default + a collapsible "Past decisions" section for L2 + a footer pointer to L3.

## When to load this reference

- An Explore (or Labs) iteration graduated — Ship event triggered
- The user says "ship V2", "propagate this", "promote to production"
- The Compare story flipped from `decision:pending` to `decision:chosen`
- Reviewing a recent Ship and noticing the Explore story disappeared

## The core rule — preserve by default

Before v1.7, Ship was destructive: `git mv src/explore/hero/v2.stories.tsx src/components/hero/Hero.stories.tsx`. The Explore record vanished from Storybook (only survived in git history). That breaks four things:

1. **Design history** — six months from now, when someone asks "why did we ship V2?", the proof is gone.
2. **Visual regression archive** — VRT had snapshots of V2 from Explore; those snapshots no longer match any visible story.
3. **A/B record** — the Compare story still references V1 vs V2, but V2 now lives somewhere else.
4. **Decision dashboard integrity** — `<DecisionsDashboard>` queries `decision:chosen` stories; if the chosen story was moved + retagged, the dashboard loses context.

**Preserve by default: the Explore story stays where it is.** Its tags get updated (`decision:pending` → `decision:chosen`, add `archived`), a banner is added, but it doesn't move.

## The two paths

When an Explore story is chosen, you propagate via one of two paths. The decision is: does the Explore have its own component, or is it iterating on an existing one?

### Path A — NEW component (Explore defined a new component)

**Use when:** The Explore story has its own component file (e.g., `src/explore/hero/v2.tsx` defines `HeroV2`). There is no shipping equivalent — this is a net-new addition to the design system.

**Sequence:**

```bash
# 1. Copy (NOT move) the component from explore to components
cp src/explore/hero/v2.tsx src/components/hero/Hero.tsx

# 2. Create a new production stories file (do NOT cp the Explore stories — production stories
#    have different concerns: full state coverage, autodocs, no decision metadata)
touch src/components/hero/Hero.stories.tsx
# (agent writes production stories from scratch — see references/with-mcp.md or without-mcp.md)

# 3. Validate the new production story
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh src/components/hero/Hero.stories.tsx

# 4. Propagate to app callsites (if the new component replaces something or is consumed somewhere)
ast-grep --pattern 'import { Hero } from "@/components/old-hero"' \
         --rewrite 'import { Hero } from "@/components/hero"' --update-all

# 5. Update the Explore story tags + add a chosen banner (see "Updating the Explore story" below)
```

**Result:**
- New: `src/components/hero/Hero.tsx` + `src/components/hero/Hero.stories.tsx` (production)
- Preserved: `src/explore/hero/v2.tsx` + `src/explore/hero/v2.stories.tsx` (archive, tagged chosen)

### Path B — UPDATE existing component (V2 replaces V1)

**Use when:** A shipping `src/components/<name>/<Name>.tsx` already exists; the Explore iteration is V2 of it. You're updating in place, not adding a new component.

**Sub-paths inside Path B** — what to do with the existing stories file:

- **B1 — Evolve in place (single shipping version):** edit `src/components/hero/Hero.tsx` with V2 contents; update `src/components/hero/Hero.stories.tsx` with new states. No `_legacy/` directory. V1 history lives in git.
- **B2 — Keep V1 alongside (parallel for one release):** move existing `src/components/hero/` into `src/components/_legacy/hero/`, drop new V2 into `src/components/hero/`; old stories tagged `deprecated` with removal date. Use when V1 still has callsites and the migration is staged.

**Sequence (B1 — evolve in place):**

```bash
# 1. Edit src/components/hero/Hero.tsx to V2 contents
#    (agent reads src/explore/hero/v2.tsx, applies the changes to src/components/hero/Hero.tsx)

# 2. Update src/components/hero/Hero.stories.tsx — add new states V2 introduced
#    (e.g., if V2 added a 'video' variant, add a Story for it)

# 3. Validate
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh src/components/hero/Hero.stories.tsx

# 4. Update Explore story tags + banner (see below)
```

No ast-grep needed — the import path didn't change.

**Sequence (B2 — keep V1 in _legacy):**

```bash
# 1. Move existing component aside
git mv src/components/hero src/components/_legacy/hero

# 2. Create the new V2 component at the original path
mkdir -p src/components/hero
# (agent copies + adapts src/explore/hero/v2.tsx → src/components/hero/Hero.tsx)
# (agent writes src/components/hero/Hero.stories.tsx fresh)

# 3. Tag the _legacy story as deprecated with removal date (see "Deprecating the old version")

# 4. Validate both
${CLAUDE_PLUGIN_ROOT}/scripts/validate-stories.sh \
  src/components/hero/Hero.stories.tsx \
  src/components/_legacy/hero/Hero.stories.tsx

# 5. ast-grep callsites if the import path changed (it didn't if you used the same name)
# This step is only needed if you renamed the component as part of the V2.

# 6. Update Explore story tags + banner (see below)
```

## Updating the Explore story (both paths)

After Ship, the Explore story doesn't move. Update it in place:

```tsx
// src/explore/hero/v2.stories.tsx — BEFORE Ship
const meta = {
  title: 'Explore/Hero/V2',
  component: HeroV2,
  parameters: {
    layout: 'fullscreen',
    design: { type: 'figma', url: '...' },
  },
  tags: ['explore', 'decision:pending', '!autodocs', '!test', 'figma-sync', 'v2-preview'],
} satisfies Meta<typeof HeroV2>;

// AFTER Ship — update tags + add chosen metadata
const meta = {
  title: 'Explore/Hero/V2',
  component: HeroV2,
  parameters: {
    layout: 'fullscreen',
    design: { type: 'figma', url: '...' },
    decision: {
      id: 'hero-v2-2026-05-27',
      status: 'chosen',
      winner: 'V2',
      date: '2026-05-29',
      shippedTo: 'Components/Marketing/Hero',
      rationale: 'Inline CTA cut signup steps from 3 to 1 in user testing',
    },
    docs: {
      description: {
        component: '## Chosen on 2026-05-29 — shipped to **Components/Marketing/Hero**\n\nThis Explore iteration was selected over V1 in PM review. Kept here as the historical record of what we tested. The production version lives in [Components/Marketing/Hero](?path=/story/components-marketing-hero--default).',
      },
    },
  },
  tags: ['explore', 'decision:chosen', 'archived', '!autodocs', '!test', 'figma-sync'],
} satisfies Meta<typeof HeroV2>;
```

The key tag changes:
- `'decision:pending'` → `'decision:chosen'`
- Add `'archived'` to signal "no longer being iterated on, kept for history"
- Keep `'explore'` and `'!autodocs'` / `'!test'` (the story stays in the Explore sidebar, not in autodocs)
- Drop `'v2-preview'` (it's no longer a preview — it shipped)

The `parameters.decision` block feeds `<DecisionsDashboard>` (see `references/wrapper-library.md`) and the `docs.description.component` makes the chosen status visible to anyone opening the story.

## Deprecating the old version (Path B2 only — when keeping V1 alongside)

```tsx
// src/components/_legacy/hero/Hero.stories.tsx
const meta = {
  title: 'Components/_Legacy/Hero',
  component: Hero,
  tags: ['autodocs', 'deprecated'],
  parameters: {
    docs: {
      description: {
        component: '**DEPRECATED 2026-05-29** — replaced by [Components/Marketing/Hero](?path=/story/components-marketing-hero--default). Scheduled for removal in v3.2 (target: 2026-07-01). Kept this release window for migration safety.',
      },
    },
  },
} satisfies Meta<typeof Hero>;
```

Confirm cleanup is visible:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/find-stories-by-tag.sh deprecated
```

## Updating the Compare story (if one exists)

If the Ship came from a Compare A/B story (typical), the Compare story also needs its tags updated:

```tsx
// src/explore/compare/hero-v1-vs-v2.stories.tsx — BEFORE Ship
tags: ['compare', 'decision:pending', '!autodocs', '!test'],

// AFTER Ship — flip to chosen
tags: ['compare', 'decision:chosen', 'archived', '!autodocs', '!test'],
```

And update the `<TrackedDecision>` wrapper inside:

```tsx
// BEFORE
<TrackedDecision id="hero-v2-2026-05-27" status="pending" rationale="..." target="2026-06-03">

// AFTER
<TrackedDecision id="hero-v2-2026-05-27" status="chosen" winner="V2" date="2026-05-29" rationale="...">
```

## Decision tree — which path?

```
Did the Explore story define a NEW component?
   │
   ├─ YES → does an existing component cover the same concept?
   │         │
   │         ├─ NO  → Path A (NEW component — net addition to design system)
   │         │
   │         └─ YES → Path B (UPDATE existing — V2 replaces or evolves it)
   │                    │
   │                    ├─ Single shipping version? → B1 (evolve in place)
   │                    └─ Need V1 alongside for migration? → B2 (move V1 to _legacy)
   │
   └─ NO (Explore iterated on an existing component)
         → Path B (UPDATE existing)
         → typically B1 (evolve in place), unless migration safety needs B2
```

## Anti-patterns

1. **`git mv` instead of preserving the Explore story.** Destroys design history. The Explore story should stay; only its tags + parameters update.
2. **Copying the Explore stories file to `src/components/`** (instead of writing fresh production stories). Explore stories carry decision metadata, fullscreen layout, and `!autodocs` — none of which belong in production stories. Production stories serve a different purpose (state coverage + autodocs).
3. **Forgetting to update the Explore tags.** Leaving `'decision:pending'` on a shipped iteration breaks the dashboard. Always flip to `'decision:chosen'` + add `'archived'`.
4. **Skipping the `shippedTo` metadata.** Without it, the Explore story is just "an experiment that happened" — with it, future readers can jump straight to the production version.
5. **Path B2 without a removal date** on the `_legacy/` story. Deprecation without an end date becomes permanent. Always include a target date in `parameters.docs.description.component`.
6. **Running ast-grep when the import path didn't change** (Path B1). Wastes a CI run. Only ast-grep when the path actually changes.
7. **Mixing the Compare story flip with the Explore story flip.** Both need to update, but they're separate edits — the Compare is the decision artifact, the Explore is the implementation artifact. Don't conflate.

## Worked example — production Hero V2 ship

```bash
# State before Ship:
#   src/components/hero/Hero.tsx              (V1, shipping)
#   src/components/hero/Hero.stories.tsx      (Components/Marketing/Hero, autodocs)
#   src/explore/hero/v2.tsx                   (V2, isolated)
#   src/explore/hero/v2.stories.tsx           (Explore/Hero/V2, decision:pending)
#   src/explore/compare/hero-v1-vs-v2.stories.tsx (Compare/Hero/V1-vs-V2, decision:pending)

# Decision tree → Path B1 (evolve in place, single shipping version):

# 1. Apply V2 changes to the production component
#    (agent reads src/explore/hero/v2.tsx, applies diff to src/components/hero/Hero.tsx)

# 2. Update production stories — add any new states V2 introduced
#    (agent edits src/components/hero/Hero.stories.tsx to add e.g. VideoVariant story)

# 3. Validate
$ scripts/validate-stories.sh src/components/hero/Hero.stories.tsx
all checks passed

# 4. Update Explore story tags + chosen banner (in place — no file move)
#    Edit src/explore/hero/v2.stories.tsx:
#      tags: ['explore', 'decision:pending', ...] → ['explore', 'decision:chosen', 'archived', ...]
#      Add parameters.decision = { status: 'chosen', winner: 'V2', date: '2026-05-29', shippedTo: 'Components/Marketing/Hero' }
#      Add docs.description.component with the chosen banner

# 5. Update Compare story
#    Edit src/explore/compare/hero-v1-vs-v2.stories.tsx:
#      tags: ['compare', 'decision:pending', ...] → ['compare', 'decision:chosen', 'archived', ...]
#      Update <TrackedDecision> status='chosen', winner='V2', date='2026-05-29'

# 6. (Optional) ast-grep if any callsites changed import path — here they didn't, so skip.

# 7. Confirm dashboard updated
$ scripts/find-stories-by-tag.sh decision:chosen
src/explore/hero/v2.stories.tsx:25
src/explore/compare/hero-v1-vs-v2.stories.tsx:32

# State after Ship:
#   src/components/hero/Hero.tsx              (V2, shipping)
#   src/components/hero/Hero.stories.tsx      (Components/Marketing/Hero, autodocs, V2 states)
#   src/explore/hero/v2.tsx                   (UNCHANGED — historical record)
#   src/explore/hero/v2.stories.tsx           (Explore/Hero/V2, decision:chosen, archived)
#   src/explore/compare/hero-v1-vs-v2.stories.tsx (Compare/Hero/V1-vs-V2, decision:chosen)
```

The experiment is preserved. The shipping version is updated. The decision is documented. Future readers can:
- Open `Explore/Hero/V2` to see the original Figma-driven iteration
- Open `Compare/Hero/V1-vs-V2` to see how V1 and V2 looked side-by-side at decision time
- Open `Components/Marketing/Hero` to see what's currently shipping
- Open `Decisions/Dashboard` to see this decision in the Chosen column with rationale + date

## Quarterly pruning ritual (L2 → L3)

Run quarterly (or when `audit-archived.sh` flags HEAVY). Three commands total.

```bash
# 1. Survey the archive — what's old enough to prune?
${CLAUDE_PLUGIN_ROOT}/scripts/audit-archived.sh
#   Output: lists L1 chosen >90d (suggest add 'archived'), L2 archived >12m (suggest prune),
#           and a HEAVY warning if archived count > 20.

# 2. For each prune candidate, run prune-to-ledger.sh (dry-run by default)
${CLAUDE_PLUGIN_ROOT}/scripts/prune-to-ledger.sh src/explore/hero/v1.stories.tsx
#   Output: shows the markdown row that would be added to .storybook/audit/decisions.md
#           plus the suggested git rm commands.

# 3. Once happy, --execute appends the row + git rm's the file
${CLAUDE_PLUGIN_ROOT}/scripts/prune-to-ledger.sh src/explore/hero/v1.stories.tsx --execute
#   Then: git commit -m 'design: prune <decision-id> to ledger'
```

### When NOT to prune

Keep in L2 (don't move to L3) if any of:
- Still referenced by an active Compare story (`<ABCanvas>` or similar pulls it via `<StorySet>`)
- Has unique visual regression baseline value (catches a regression class no other story does)
- Designer flags as "canonical reference" (add a `'canonical-reference'` tag and prune-to-ledger will skip it)

For everything else: prune. The git history preserves the file; the ledger preserves the rationale.

## How "system tells you when it's big"

`audit-archived.sh` emits a `🚨 HEAVY` warning when the L2 count exceeds `--threshold` (default 20). At that point, Storybook's sidebar starts to feel cluttered and pruning becomes worthwhile. The agent should surface this warning to the user whenever it runs the audit — usually after a Build cycle when the sidebar feels heavy.

Default thresholds:
- **90 days** — auto-suggest adding `'archived'` tag to chosen stories (L1 → L2)
- **12 months** — auto-suggest pruning archived stories (L2 → L3)
- **20 archived stories** — emit HEAVY warning + suggest aggressive pruning

All thresholds are configurable per project via CLI flags (`--older-than`, `--threshold`).

## Verification record

- Preserve-by-default decision derived from the user's design-history concern: "preserve experiment and create new one or update current components - with new version."
- Path A vs Path B decision tree derived from a real production app's structure (some components have V2 candidates with their own files, others are just being iterated on).
- B1 vs B2 split derived from real-world migration patterns: B1 for clean cuts, B2 for staged migrations where V1 still has live callsites.
- The `parameters.decision` block format is consumed by `<DecisionsDashboard>` (see `references/wrapper-library.md`).
- This replaces the destructive `git mv` recipe in earlier drafts of `figma-to-storybook.md` and `end-to-end-flow.md`.
- Layered model + L1/L2/L3 lifecycle derived from `docs/specs/2026-05-27-preservation-brainstorm.html`. Quarterly ritual implemented via `audit-archived.sh` + `prune-to-ledger.sh`. Template: `templates/design-decisions.md`.
