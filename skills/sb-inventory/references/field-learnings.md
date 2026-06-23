# Field learnings — what the discovery scripts get right and wrong

Distilled from four cross-agent validation runs (Codex driving the skill on
messy-app, marketplace-app, codex-test-01, codex-test-02). The point of this file
is compounding: each run feeds back into the scripts so the next agent doesn't
re-discover the same correction. See `docs/specs/2026-05-3*/2026-06-*-codex-validation-*.md`.

## Worked as intended (keep)

- **Real-vs-slop over docs.** Every run, the audit reported the *actual* design
  system (tailwind-v4) over a lying `AGENTS.md`/README (shadcn/Radix/Redux), and
  flagged dead components the docs claimed didn't exist. This is the skill's core
  value and it holds cross-agent.
- **Flows by shape, not name.** Wizards detected even when the step var is `i`/`setI`
  or `n`/`setN` (not `step`/`setStep`); overlays detected as `<div role="dialog">`
  gated by `open`, not just named `<Dialog>` tags. (Both were bugs, now fixed — see
  the v1.10 fix batch.)
- **Factory candidate detection** (shapes used ≥3×) and **entry-point exclusion**
  (`main.tsx` never listed dead) both held.
- **Story conformance** the scripts gate on: react-vite meta, `storybook/test`,
  `fn()` callbacks, one named story per state (no mega-story), `parameters.layout`,
  overlay `open` as an arg (not pseudo), wizard one-story-per-step with `play()`.

## Corrections agents had to make repeatedly (now addressed)

These recurred across runs — the script output was misleading enough that the agent
re-computed it by hand every time. Each is now fixed in the scripts:

1. **Token usage false-orphan (both Codex runs).** `inventory-project.sh` reported
   `0 used / N orphan` for Tailwind `@theme` tokens, because it only counted
   `var(--token)` references. Tailwind v4 consumes tokens through *generated
   utilities* (`--color-brand` → `bg-brand`/`text-brand`; `--spacing-gutter` →
   `p-gutter`), so every token read as orphaned. → Now detects utility consumption
   for known `@theme` namespaces; the metric reflects real use.

2. **Component vs app/page conflation (both Codex runs).** `realCount/deadCount`
   mixed `src/components/*` with `src/App.tsx` and `src/pages/*`, so the agent kept
   re-separating "15 real / 3 dead, but only 11 are components." → Inventory now
   emits a `byKind` breakdown (component / page / app) alongside the flat totals.

3. **Factory count includes dead usages (both Codex runs).** A shape used in 6 files
   where one is a dead component was reported as 6 usages; the agent corrected to "5
   live." → `extract-prop-shapes.sh` now annotates each candidate with `liveUsages`
   (excluding files the inventory marked dead).

4. **Orphan-story false positive (codex-test-01 + codex-test-02).** `inventory-project.sh`
   flagged stories whose imports actually resolve. Root cause: BSD sed treats `\s` as
   a literal `s`, so `s/from\s+'//` never stripped the `from '` prefix → paths like
   `from '../X` resolved to nothing → every story flagged. → POSIX `[[:space:]]`.

5. **SB-scaffold + test/factory files counted as app components (codex-test-01 +
   codex-test-02).** `src/stories/Button.tsx` (the SB init tutorial) and
   `src/test/factories/job.ts` were counted in real/dead, so the agent kept saying
   "ignore the starter files." → `kind_of` now classifies `/stories/` as `scaffold`
   and `/test/`,`/factories/`,`*.factory.*` etc. as `support`; both are excluded from
   the real/dead headline and the dead list, and reported in their own `byKind` buckets
   + `supportCount`.

6. **byKind adoption (codex-test-02 re-audit).** After fix #2 landed, the agent had
   the correct `byKind` data but still recomputed the split by hand. → The
   orchestration `audit` prompt now tells the agent to *cite* `components.byKind` and
   `liveUsages` rather than recompute. (Lesson: a correct JSON field isn't adopted
   until it's surfaced in the prompt/summary.)

## Validation (re-audit after the fixes, same project)

A fresh Codex `audit` on codex-test-02 with the fixed scripts confirmed the loop
closed: token false-orphan gone, `Job` reported as "6 files total, 5 live usages"
(citing `liveUsages`), 0 orphan stories. #5 above was surfaced *by that re-audit* and
fixed in the same round — the flywheel.

A second re-audit after #5/#6 confirmed adoption: the agent now *pastes the
`components.byKind` JSON* and cites `liveUsages: 5` verbatim instead of recomputing,
and lists "Excluded from the headline: SB scaffold: 3, test/factory support: 1." The
agent's tone shifted from "the detector is wrong, here's my correction" to "the
detectors still *miss* some useful detail" — the signal that correctness is resolved
and only enrichment remains.

## Open / lower-signal (watch, not yet changed)

- **Story placement convention.** Runs split between colocated
  (`src/components/X.stories.tsx`) and `src/stories/`. Both pass; the skill doesn't
  mandate one. Leave to project convention unless a run shows it matters.
- **component-states.json includes scaffold + App.tsx.** Same scaffold-noise class as
  #5, but in the states output. Low signal so far — fix if a run leans on it.
- **Flows don't enumerate wizard step names or cross-component transitions
  (enrichment, not correctness).** `flows.json` flags `ProfileWizard` as a wizard but
  doesn't list `role`/`profile`/`review`; it detects `ApplyModal` but not the
  `JobDetail → /onboard` submit-success transition; `component-states.json` gives
  generic wizard states (`default`/`disabled`/`variants`) not the concrete steps. The
  agent reads the steps from code fine — this is "could be richer," not "is wrong."
  Candidate enhancement, not a recurring bug.

## Orchestration learnings (driver, not skill)

Captured in `evals/CODEX-ORCHESTRATION.md`: sequential-only, `resume --last` keeps
session memory, audit/setup/stories/drift need `workspace-write` (discovery writes
the `.storybook/` ledger; `audit-drift.sh` uses `mktemp`); `setup` also needs
network + a writable npm cache (`NPM_CONFIG_CACHE=/private/tmp`) and `--no-dev`.

## v1.13 — live Codex validation of the flow pipeline (2026-06-01)

Drove `sb-cross-agent-run audit` (Codex 0.134.0) on a real **inertia-static** app
(marketplace-courses). The new `extract-flows.sh` passes worked end-to-end through Codex:
`dominantRouter=inertia` (99 routes — **0 before**, the extractor used to bail), `edgeCount=101`
(97 router-visit + 4 link), `navSourceCount=32`. Codex honored the nav-sweep reminder and named
the real `StudentSidebar`/`TeacherSidebar`/`TeacherLayout` chrome — the #1 audit miss, now caught.

Two watchouts Codex surfaced (worked-vs-not):
- **Nav-source false positive (FIXED):** filename match counted overlay primitives like
  `ModalFooter.tsx`/`DialogHeader.tsx` as persistent nav. Added a
  `grep -viE "(modal|dialog|sheet|popover|toast|tooltip)"` exclusion to pass 9(a). The detector
  stays intentionally broad (a sweep *reminder*, not a final nav map — `flow-capture.md` frames it
  so), but overlay chrome is page-body-covered and shouldn't inflate `navSources[]`.
- **Inertia page-liveness (OPEN, inventory not flows):** `inventory-project.sh` marks all `pages/`
  dead because it doesn't join `inertia("page/name")` string targets back to page files. Cross-check
  page deadness against `flows.json` routes, not `components.dead` alone. Candidate fix:
  inventory should resolve `inertia("…")` string args as page references. Tracked, not yet closed.
