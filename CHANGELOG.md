# Changelog — storybook-workbench

Moved out of the SKILL.md frontmatter (where it had grown to ~3,000 words and scared people
off installing). This is the full version history; skills no longer carry it inline.

## 2.2.0 — 2026-06-16 — authoritative coverage, layout frame, cross-agent tracking & feedback layer

- **Story coverage is authoritative, not a guess.** When Storybook is installed, `inventory-project.sh`
  now runs `storybook index` and reconciles `index.json` (the stories Storybook *actually registers*)
  into `project-inventory.json.storyCoverage` (`source: "storybook-index"`, `withRegisteredStory`,
  `needsStory`). The old basename-glob heuristic (which sb-hub flagged as a "loose upper bound") is the
  fallback when Storybook isn't installed. Cross-agent — plain `storybook index` CLI, no dev server / no
  MCP. MCP stays the *authoring* accelerator; `index.json` is the *tracking* source.
- **Cross-agent progress frame for sb-hub.** Mode 2 (`what's next`) now surfaces coverage straight from
  the JSON (`coverage: N/M [source] · K need one` + the `needsStory` iterate list) via a compact field
  extract — the full object, never a truncated dump — and a `find -newer` drift probe lists which
  source/story files changed since the last discovery (no git, no Claude hook). It routes to
  sb-inventory/sb-audit to refresh, shrinking `needsStory[]` — iterate until empty.
- **Layout-aware preview frame.** New `withLayoutFrame` decorator (scaffolded into `.storybook/decorators/`)
  makes the global frame follow each story's `layout` instead of forcing `100vh` on everything (which buried
  primitives in viewport-tall whitespace). Report wrappers gained `fillViewport?` (default true) so they
  embed without forcing the viewport. Documented in wrapper-library "Layout & previews", install-wizard
  item 10, and a CssCheck Done-when gate.
- **Treatment-vs-control A/B eval harness.** `run.sh --control` runs each case skill-on vs a genuinely
  bare model (neutral-cwd isolation + a fail-closed leak gate) and reports the chain's value — measured at
  **+73–75pp** on a 12-case cohort. A judge-unavailable outcome is distinguished from a content failure so
  an auth/transport outage can't masquerade as a skill regression.
- **Every skill installs self-contained — and points onward.** `build.sh` vendors `decorators/` with the
  wrappers and rewrites `shared/` paths in *all* doc bodies AND the Codex surface (`agents/openai.yaml`),
  so a standalone `npx skills add <repo> -s <skill>` ships its own scripts/refs/wrappers/decorator with no
  dev-tree path. Each ships `CONTEXT.md` (the pipeline map) and names its sibling skills for onward
  install. README documents per-skill install + the renderer→producer data dependency.
- **Feedback / self-improve layer.** A sanitized, agent-native bug reporter — `shared/scripts/report-issue.sh`
  + `sb-hub` Mode 3 (Report) — captures shapes/counts/versions only (never source, token values, or secrets),
  PRINTS a `gh issue create` command + a blank-issue URL, and makes **no network call** (the user submits).
  README "Found a bug?" section, a `.github/ISSUE_TEMPLATE`, and `CONTRIBUTING.md` document the loop
  (report → reproduce → eval case → fix → field-learnings). No telemetry, no runtime self-modification —
  the self-improvement is eval-case-per-bug, enforced by `test-report-issue.sh` (a seeded secret must never
  appear in a draft).
- **Usage-explorer + per-component "Where it's used" docs, first-class in the guidance.** `sb-stories` now
  states the per-component usage band is composed ONCE (`UsageSection` → `preview.ts` `docs.page`) and
  auto-appears on every component's autodocs from the usage graph — don't hand-author it per component;
  keep `refresh-usage` current. Points at the `UsageExplorer` wrapper for whole-graph exploration. New eval
  cases 44 (authoritative coverage), 45 (sanitized report), 46 (per-component usage docs); 43 already covers
  the bidirectional token↔component graph. Full deterministic suite: **26/26**.

### token-usage single source (same cycle)

- **Component↔page import graph (`build-component-pages.py`) — the ComponentUsage worklist now has data.**
  The worklist wrapper (every real UI component ranked by call-sites, with its `parents`/`children`
  nesting and the pages it renders on) read `.storybook/component-pages.json`, but no script wrote it —
  it rendered empty. New composer builds it from the three discovery JSONs (project-inventory +
  component-usage + flows), no new scan: `children` from `usage[*].files`, `pages` resolved
  transitively through the render graph (a `Rating` nested in a `CourseCard` on `/dashboard` shows
  `/dashboard`), `role` from each route's `access`. Wired into `refresh-usage.sh` (4th extractor) so it
  refreshes with the rest; sb-inventory documents it as the "audit the system by imports" view. Static
  draft (barrel/dynamic imports may under-link). Also fixed: `token-usage.py` was an undeclared orphan
  (not in any vendor) — now declared so it ships.

- **One scanner for token usage (`sb-inventory/scripts/token-usage.py`).** sb-inventory, sb-health,
  and the demo's token views were each computing "used vs orphan" with different, divergent logic —
  producing contradictions like a token shown as **"33 uses · unused"** (used via a Tailwind utility
  or custom `@utility`, which the var()-only scans missed). Now ONE Python scanner classifies every
  declared custom property using all three Tailwind-v4 consumption signals (`var()`, generated
  color/scale utilities, custom `@utility` classes), with an accurate count and the files where each
  token is used. It writes `project-inventory.json` (`tokens.map`).
- **`inventory-project.sh`** calls `token-usage.py` instead of its old loose `-<suffix>` substring grep
  (which conflated namespaces — `--radius-md` and `--shadow-md` got identical counts — and matched
  data strings, under-reporting orphans). Declaration-only token extraction also drops junk tokens
  (`--all`, `--audit`, `--default`).
- **`validate-design-system.sh` (sb-health)** no longer re-scans for unused tokens; it READS the
  orphans from `project-inventory.json`. Run `sb-inventory` before `sb-health` (already the pipeline
  order). This removes the near-duplicate report and guarantees the Health view, the Inventory view,
  and the Semantic token table can never disagree.
- **`tokens.map` now carries `files` + `declaredIn`** so the token-usage views can show **where** each
  token is used and findings keep a source location.

## 2.1.0 — 2026-06-10 — pre-publish hardening

- **`sb-flows` no longer under-extracts nanostores apps (`extract-flows.sh`).** Two gaps fixed,
  found dogfooding a `@nanostores/router` app that reported 24 routes / 2 edges where the truth was
  27 / 35: (1) nanostores route detection (§4c) was single-line only, so Prettier-wrapped
  `key:` / `"/path"` entries were dropped — added a multi-line `awk` pass mirroring the `<Route>`
  one; (2) the edge sweep (§8) only knew href-based navigation (`<Link>`, `router.visit`, `<a>`),
  so nanostores apps — which navigate by route NAME via `openPage($router, "name")` /
  `redirectPage` / `$router.open` — reported ~0 edges. Added single-line + bounded multi-line
  detection for those, emitted as `kind: openPage|routerOpen` with `toName` (route name) resolved
  to a path through the route map. `flow-capture.md` reference updated; `dominantRouter` already
  treated `nanostores` as a flavor.

- **Theme-safe wrappers — render on a stock app, not just a token-rich one.** Dogfooding on a
  bare shadcn/Tailwind-v4 app surfaced rendered wrapper views with transparent panels, missing
  borders, and invisible text: the wrappers assumed design tokens the host theme doesn't ship
  (`--color-surface`, `--color-border-subtle`, semantic `--color-{success,warning,error}-*`,
  `--color-brand-*`) via `var()` with no fallback, and used `--color-muted` (a near-white surface
  token) as a text color. Fixed by a scoped `TOKEN_SHIM` on each wrapper's root that maps the
  expected vocabulary onto stock primitives with fixed fallbacks (no self-references — those void
  the fallback via a CSS cycle), plus `--color-muted` → `--color-muted-foreground` for all text.
  Applied to `ProjectInventory`, `DesignSystemHealth`, `ComponentUsage`, **and `DecisionsDashboard`**
  (the status board — same defect, caught by an all-wrappers audit). `AppFlowGraph` needed none
  (zero risky tokens). Distinct DESIGN-SYSTEM hue per source (`TokensCanvas`); `ComponentUsage`
  worklist gains the parent/child nesting graph (walk the tree both directions into the IDE).

- **One place, and ask where stories go (demo fix: stories scattered in `src/`).** Everything the
  bundle writes now lives under `.storybook/` — the pruned decision ledger moved `docs/design-decisions.md`
  → `.storybook/audit/decisions.md` (prune-to-ledger + audit-archived defaults, propagate-workflow, README,
  test-flow all repointed). The one placement choice is **where stories live**: `sb-setup` now **asks the
  user** (AskUserQuestion) and recommends — **isolated `.storybook/stories/`** for an audit / client / messy
  repo (keeps `src/` untouched, one removable folder) vs **co-located `src/**`** for a project you own —
  configures `main.ts` `stories`, and records `storiesLocation` in `.storybook/audit/status.md`. `sb-stories`
  honors it (never drops a `.stories.tsx` next to a component when isolated); `sb-hub` Mode 0 flags an
  undecided location and Mode 1 gates `sb-setup` on recording it. CONTEXT.md STORAGE MAP rewritten around
  the single root + the STORIES LOCATION rule.

- **`DESIGN.md` drift check in `sb-health`.** A Google Labs `DESIGN.md` (YAML tokens + markdown
  briefing an agent on the visual identity) is an increasingly common way to guide AI on a repo —
  and, like `AGENTS.md`/`CLAUDE.md`, it drifts or lies. `validate-design-system.sh` now finds a
  `DESIGN.md` and cross-checks the colors it *claims* against the colors the code's CSS tokens
  actually *declare*, emitting `design-md` (present → untrusted) and `design-md-drift` (claimed color
  not in code) findings. `sb-inventory` notes `DESIGN.md` alongside `AGENTS.md` as untrusted; deep
  audit / regeneration of a drifted `DESIGN.md` hands off to the `design-md` skill. Covered by a new
  both-directions eval (discovery-quality §F) + the atomic-write eval; the health write is now atomic
  (temp→os.replace) to match the other discovery scripts.
- **README "Working with a client / messy AI-generated repo"** reworked to the full looks-at → does →
  output picture per stage (scripts folded into "does"), including the `DESIGN.md` drift row.

- **Hub renamed `storybook-workbench` → `sb-hub`** (matches the `sb-*` sibling convention; makes the
  documented-but-unwired `/sb-next` real as `/sb-hub`). The hub is now **three read-only modes**:
  Mode 0 onboarding check (fresh-repo readiness diagnose — stack/Storybook/node/lockfile/MCP/discovery),
  Mode 1 orchestrate (run sb-setup→inventory→flows→health→stories→wrappers→audit in order with hard
  gates, lfg-style), Mode 2 navigate (the prior single-next-step router). All `/sb-next` and
  `$storybook-workbench` references swept to `/sb-hub` / `$sb-hub`; `gen-manifests.py` no longer
  double-counts the hub in the marketplace skill list.
- **Bug fixes (release-1 audit flow):** `extract-flows.sh` NAV_COUNT double-zero (`grep -c . || echo 0`
  emitting `'0\n0'` → broke the nav-sweep guard); `check-story-ready.sh` CONFIDENT verdict decoupled
  from the node_modules install check (discovery readiness, not install, gates CONFIDENT); 7 vendor
  over-declarations turned into real citations; `messy-app/GROUND-TRUTH.md` authored; runbook.md /
  end-to-end-flow.md / HANDOFF.md command vocabulary aligned to the v2 `sb-*` skills.

- **Adopted `npx storybook ai setup`'s authoring + verify doctrine** (from auditing the live
  `Prompts/` catalog the command emits). Five rules folded into the shared layer where each phase
  needs them, not the hub: (1) the **`CssCheck`** rule — exactly one `getComputedStyle` proof story
  per project, the only evidence the shared preview loaded the app CSS (`toBeVisible` passes
  unstyled) → `anti-patterns.md` #33 + `validate-stories.sh` project tally; (2) **`play` earns its
  place** — WARN on no-op `toBeVisible`-only plays → #34 + `validate-stories.sh` check 13 (now 13
  per-file checks); (3) **determinism the *component* reads** — pin via a global `beforeEach`
  (`MockDate` + only-the-keys-it-reads `localStorage`) → `install-wizard.md` item 7 + #26 cross-ref;
  (4) **`Edit` not overwrite** the init `preview.tsx` + emit the one `CssCheck` → `install-wizard.md`
  item 8; (5) **one-batch verify loop** — first vitest run is the whole batch, cap ~5 retries, strip
  `needs-work` only from confirmed-green files → `test-wiring.md`. The prompt's "Glob/Grep not shell"
  rule is reconciled (our discovery scripts *are* the cached discovery) and noted in `sb-setup`.
- **No monolith references.** The shared layer (`shared/references/*.md`, `shared/scripts/`,
  `shared/wrappers/*.tsx`, `evals/`, `hooks/`) had ~40 hardcoded paths pointing at the old
  monolith (`~/agent-skills/skills/storybook-workbench/scripts/…`). All rewritten to the bundle's
  own `shared/scripts/` / `shared/references/`. `grep -rn 'agent-skills/skills/storybook-workbench'`
  now returns 0 (the only `~/.claude/skills/storybook-workbench/` left is the new hub's install path).
- **`SECURITY.md`** — security/privacy posture: zero deps, no network, no secrets, writes
  confined to `.storybook/` + `src/{stories,explore}/` (app code only via `sb-ship` `cp`).
- **`docs/pre-publish-audit.md`** — pre-flight checklist mirroring the skills.sh audits
  (Gen Agent Trust Hub / Socket / Snyk) with the exact local commands. Verified live: real
  `socket manifest auto` → "no manifest to scan" (zero supply-chain surface); Trust-Hub-equivalent
  greps (network/secrets/destructive/write-boundary) all clean.

## 2.0.0 — 2026-06-01 — Compound-engineering bundle restructure

Restructured the single `storybook-workbench` skill (v1.13) into a **bundle of focused skills over
a shared agent pool**, modeled on compound-engineering + Intercom `base` + mattpocock `CONTEXT.md`.

- **3 manifests** — `.claude-plugin` / `.codex-plugin` / `.cursor-plugin` for cross-agent install.
- **Hub + 7 standalone skills** — `storybook-workbench` (navigator), `sb-inventory`, `sb-flows`,
  `sb-health`, `sb-stories`, `sb-wrappers`, `sb-audit`, `sb-ship`. One verb each.
- **Shared foundation** — `shared/` (scripts + wrappers + references + templates). No sub-agent pool:
  skills do their own work and gate with `validate-stories.sh` (an early draft had 4 agents that just
  duplicated the skills/validator — removed before release, matching mattpocock/skills).
- **`CONTEXT.md`** — shared DSL + storage map + load map + resume protocol + wrapper-view-design.
- **`CHANGELOG.md`** — this file; frontmatter descriptions trimmed to 2 sentences.
- **Inventory fix** — shadcn `components/ui/` primitives now classified `kind: vendor`, excluded
  from the real/dead domain-component headline (`vendorCount` + `byKind.vendor` report them
  separately). Fixes "the inventory showed me 40 shadcn components I never wrote."
- **Wrapper de-emoji** — new `shared/wrappers/icons.tsx` icon language; `ProjectInventory`,
  `DesignSystemHealth`, `TokensCanvas`, `DecisionsDashboard` retrofitted off emoji onto the
  injectable icon set; `scaffold-wrapper.sh` force-copies `icons.tsx`.

The monolith at `skills/storybook-workbench/` is retained as the reference during migration.

### Verb / mode consolidation map (nothing dropped silently)

The monolith's 13 `/sb-*` commands and 4 Build modes map to bundle skills as follows:

| Monolith verb / mode | Bundle home |
|---|---|
| `/sb-next` (navigator) | **hub** `storybook-workbench` |
| `/sb-setup` | `sb-setup` |
| `/sb-audit`, `/sb-audit-drift` | `sb-audit` (audit-drift.sh inside) |
| `/sb-stories`, `/sb-validate` | `sb-stories` (validate-stories.sh is its gate) |
| `/sb-analyse` (flows\|states\|props) | `sb-flows` (flows) + `sb-stories` (runs extract-states/prop-shapes when missing) |
| `/sb-list` | `sb-inventory` (lists real components) |
| `/sb-wrapper` | `sb-wrappers` |
| `/sb-ship` | `sb-ship` |
| `/sb-design-system` | split: `sb-health` (validate-design-system) + `sb-wrappers` tier 4 (Tokens/Health/Inventory) |
| Build mode **Component** | `sb-stories` |
| Build mode **Explore** | `sb-explore` (Figma + labs-workflow + graduation gate) |
| Build mode **Compare** | `sb-wrappers` |
| Build mode **Flow** | `sb-flows` |

**Deferred (intentionally not yet ported):** `/sb-plan` (extraction batch ranking → today the hub's
journey order + the ledger's `extraction-plan.md` cover the need) and `/sb-cross-agent-run` (Codex
multi-turn orchestration → CONTEXT.md § cross-agent rules covers invoking skills on Codex). Port
these later if demand warrants; they are noted here so they're not mistaken for lost capability.

---

## 1.13.0 — 2026-06-01 — Flow capture + native-first + cross-agent harness

Field compound from the thicket-ai / marketplace-courses runs + session observability + the
Storybook 10.4 changelog.

- **FLOW mode** — `extract-flows.sh` adds a 6th router flavor (inertia / generic
  `router.get/post/visit`), a navigation-EDGE pass (`<Link>` / `router.visit` / internal `<a>`),
  and a persistent-NAV-source pass (sidebar/header/footer). `flows.json` now carries `edges[]` +
  `navSources[]` and prints a sweep reminder — fixes the #1 audit miss (page-body-only sweeps
  that skip layout chrome). New `references/flow-capture.md`. New wrappers `AppFlowGraph` +
  `JourneyGraph` (dependency-free SVG route/journey maps; icon slot, no emoji). test-flow.sh
  +6 checks, 48/48 green.
- **Native-first install** — `install-wizard.md` defers bootstrap to `npx storybook ai setup`
  (10.4 agentic onboarding), keeping only the under-documented align+verify layer. Pseudo-states
  package corrected to the official `storybook-addon-pseudo-states`, marked OPTIONAL.
- New `references/test-wiring.md` — headless vitest browser-mode runner (`test:storybook` +
  `:a11y`), a11y todo↔error toggle, play=demo-vs-test split.
- Anti-patterns +4 (29 page-body-only audit / 30 narrow flow render / 31 incomplete interactive
  flow / 32 tag-as-noise); item 18 rewritten (propose-don't-impose).
- StateGrid: `cols===1` left-aligns row labels for scannability.

## 1.12.1 — 2026-06-01 — Compound round 2

Validated by re-auditing codex-test-02 with the round-1 fixes (token false-orphan gone,
liveUsages cited, 0 orphan stories).

- `inventory-project.sh` classifies `src/stories/*` as `kind:scaffold` and
  `/test/`,`/factories/`,`*.factory.*` as `kind:support`, excluding both from the real/dead
  headline and reporting them in their own `byKind` buckets + `supportCount`.
- The orchestration `audit` prompt now tells the agent to cite `components.byKind`/`liveUsages`
  instead of recomputing by hand. `test-discovery-quality.sh` → 11 checks.

## 1.12.0 — 2026-06-01 — Compound feedback from 4 cross-agent Codex validation runs

(messy-app, marketplace, codex-test-01, codex-test-02 from-scratch.) Core value held every run
(saw through lying AGENTS.md, wizard/overlay by shape, conformant stories). Four recurring
discovery-output corrections fed back into the scripts:

- (B) Tailwind `@theme` tokens no longer false-orphan — inventory counts utility consumption
  (`bg-brand` from `--color-brand`), not just `var()`.
- (C) inventory `components.byKind` splits real/dead across components/ vs pages/ vs app.
- (A) `extract-prop-shapes.sh` annotates factory candidates with `liveUsages`.
- (D) orphan-story detector fixed — BSD-sed `\s` left a `from ''` prefix; now POSIX `[[:space:]]`.

New `evals/scripts/test-discovery-quality.sh` (7 checks); `references/field-learnings.md`.
Reusable Codex orchestration: `evals/scripts/codex-orchestrate.sh` + `evals/CODEX-ORCHESTRATION.md`.

## 1.11.0 — 2026-05-29 — Surgical slash commands + navigator + findings ledger

- 12 argument-scoped Claude commands (`commands/sb-*.md`): `/sb-next` navigator +
  `/sb-audit /sb-setup /sb-analyse /sb-list /sb-plan /sb-design-system /sb-wrapper /sb-stories
  /sb-validate /sb-audit-drift /sb-ship`.
- `references/runbook.md` — cross-agent navigator (state detection → one next step). Codex reaches
  the same phases via `$storybook-workbench <phase>` / `/skills`.
- New `.storybook/audit/` findings ledger (findings.md append-only · extraction-plan.md ·
  status.md) — user-steerable; `/sb-next` honors edits.

## 1.10.0 — 2026-05-28 — Ground-truth correctness + story gate

- New `evals/fixtures/sample-app` + `golden.json` + `test-extraction-fixture.sh` run the 4
  discovery scripts against hand-verified answers (15 checks) — caught + fixed 3 real heuristic
  bugs (pages/-in-react-router misclassified, comma-import inflating factory candidates, multi-line
  `<Dialog` dropping open-state).
- New `check-story-ready.sh` (Setup-readiness preflight + 12 conformance checks) + opt-in
  PostToolUse hook. Runner gained `regex_present` / `order_before`, case-insensitive regex,
  `runs`/`pass_threshold`. check 03 (`satisfies`) demoted FAIL→WARN after a 191-story scan.
- 3 new anti-patterns (#26 determinism, #27 don't-hand-roll-what-exists, #28 slug-from-title);
  fixed a destructive `git mv` graduation drift.

## 1.9.0 — Four-script Setup discovery chain

`inventory-project` + `extract-flows` + `extract-states` + `extract-prop-shapes` close the
extraction-flow eval gap. flows.json surfaces 5 route flavors + wizards + overlays with per-screen
state recommendations. component-states.json makes minimum story count programmatic.
prop-shapes.json locks the factory threshold at 3 usages. 7 new eval cases (#23–#29).

## 1.8.x — Inventory + design-system wrappers

- 1.8.1 — `inventory-project.sh` ground-truth discovery.
- 1.8 — Tier 4 DESIGN-SYSTEM wrappers (`TokensCanvas`, `DesignSystemHealth`, `ProjectInventory`)
  + `validate-design-system.sh`.

## 1.7.x — Wrapper library + layered preservation

- 1.7.1 — layered preservation model (`audit-archived.sh`, `prune-to-ledger.sh`).
- 1.7 — wrapper library (13 components, 4 categories, 3 tiers) + decision tag taxonomy +
  DecisionsDashboard. SKILL.md compacted from 11 visible steps to 3 (Setup/Build/Ship + 2 gates +
  3 modes). Backward compat: Author/Labs/Compose names still accepted.

## Verification record

- 2026-05-26 — With-MCP run → `docs/publishing/storybook-mcp-verification.md`; Without-MCP run →
  13 gaps that informed `without-mcp.md`.
- 2026-05-27 — extraction pilot (6 gaps patched); v1.5 galleries+tags; v1.6 validate/figma/
  composition/lifecycle/end-to-end + 3 scripts; v1.7 wrapper library smoke-tested.
- 2026-05-28 — ground-truth extraction eval (42 + 15 + 6 checks green).
