# Runbook — the `/sb-hub` navigator + surgical phase verbs

The cross-agent engine behind the bundle's skills. **Claude Code** invokes each skill as a `/sb-*` command. **Codex** reaches the identical flow via `/skills` → pick the skill, or `$<skill> <phase>`. **Cursor** matches the skill `description`. Same scripts, same ledger, same navigator — only the trigger syntax differs per agent. This runbook routes to the **v2 bundle skills** (`sb-setup`, `sb-inventory`, `sb-flows`, `sb-health`, `sb-stories`, `sb-explore`, `sb-figma`, `sb-wrappers`, `sb-audit`, `sb-ship`); the hub skill is `sb-hub` (`/sb-hub`).

**Principle: surgical, never monolithic.** Each verb does ONE scoped thing and appends findings to `.storybook/audit/`. `/sb-hub` is the default — it inspects state + the ledger and names the single next action. The user stays in control by editing the ledger.

## The findings ledger — `.storybook/audit/`

Machine JSONs (`project-inventory.json`, `flows.json`, `component-states.json`, `prop-shapes.json`, `design-system-health.json`) live in `.storybook/`, written atomically by the discovery scripts. The human-readable, steerable layer lives in `.storybook/audit/`, first seeded by `/sb-inventory` (and `/sb-audit`):

| File | Written by | Role |
|---|---|---|
| `findings.md` | every verb (append-only, timestamped) | what each step found — full trail across sessions |
| `extraction-plan.md` | seeded from `/sb-inventory`'s `components.real[]` priority list — **user edits to redirect** | ranked component batches |
| `status.md` | `/sb-stories` | per-component: `pending` / `in-progress` / `done` / `skipped` |

**Rules:** append, never overwrite (preserve history); `/sb-hub` reads these and **honors user edits** (a component marked `skipped` is not suggested; reordering `extraction-plan.md` changes order). This is how the user changes direction.

## `/sb-hub` — default navigator

Detect state from artifacts + ledger → recommend **exactly one** next surgical skill (whose prerequisites are met). Never executes a big batch.

### State detection
| Phase | Probe (done when) | Next skill if not done |
|---|---|---|
| Setup | `.storybook/` + `"storybook"` in package.json | `/sb-setup` |
| Inventory | `.storybook/project-inventory.json` exists | `/sb-inventory` |
| Flows | `.storybook/flows.json` exists | `/sb-flows` |
| Health | `design-system-health.json` exists / `designSystem.mixed` resolved | `/sb-health` (or `/ds-runbook` if token/component extraction needed) |
| Stories | every real component has a story OR is `done`/`skipped` in `status.md` | `/sb-stories <next pending component>` |
| Explore | a new/redesigned component needs sandboxed iteration — **undecided** (event) | `/sb-explore` |
| Figma | an **approved** Figma design to deliver — foundation tokens (color/spacing/type) or an approved component, or a design↔code parity/drift check (event) | `/sb-figma` |
| Ship | an Explore story meets the graduation gate (event) | `/sb-ship <path>` |
| Audit | periodic drift / decision-board review | `/sb-audit` |

### Output shape
```
# Storybook CSF3 — where you are
Project: <name> · MCP: <wired|no> · Design system: <dominant>
✅ setup  ✅ inventory  ✅ flows  ⬜ health  ·  Stories: 3/38 real  ·  ledger: .storybook/audit/
→ Next: /sb-stories CourseCard   (top of components.real[] with no story yet)
   Handoff: ⚠ raw-hex debt high → consider /ds-runbook before authoring
```
Rules: one recommendation, prerequisite-satisfied; surface the `ds-runbook` handoff when token/component debt is detected.

## Surgical verbs (each scoped to one target, appends to findings.md)

| Skill | Scope | Runs | Appends to ledger |
|---|---|---|---|
| `/sb-setup` | once | install probe; `install-wizard.md` + `npx storybook ai setup` if `NO_STORYBOOK`; MCP detect | setup state, MCP wired? |
| `/sb-inventory` | repo, once | `inventory-project.sh` | real/dead counts, dominant DS, vendor/module buckets |
| `/sb-flows` | repo | `extract-flows.sh` | routes / nav edges / persistent-nav sources |
| `/sb-health` | story-side | `validate-design-system.sh` (+ scaffold `DesignSystemHealth`); defer extraction to `/ds-runbook` | health findings |
| `/sb-stories <Component>` | one component | `extract-states.sh` / `extract-prop-shapes.sh` if missing → write `.stories.tsx` from its `component-states.json` states (refuse Cartesian; factory if ≥3 usages) → gate `validate-stories.sh` / `check-story-ready.sh` | mark `in-progress`→`done` in `status.md` |
| `/sb-explore` | one component | sandboxed iteration outside `src/components/` (+ Figma node) — **undecided**; `labs-workflow.md` | explore record |
| `/sb-figma` | tokens / component / connect | **both directions** (native MCP, not screenshots). design→code: `capture-figma.mjs` (store every MCP output) → `pull-figma-variables.mjs` + `build-token-parity.mjs` (color/spacing/type parity + drift) → wire Foundations stories; approved components authored via `/sb-stories`. code→design: `build-code-connect.mjs` → MCP `send_code_connect_mappings` (gated). `figma-token-sync.md` | parity/drift, captured nodes, code-connect map |
| `/sb-wrappers <Name>` | one+ wrapper | `scaffold-wrapper.sh <Name\|--tier N\|--flow>` | wrapper scaffolded |
| `/sb-audit` | read-only | `audit-drift.sh` + `audit-archived.sh` + `find-stories-by-tag.sh` | drift clusters, archive/decision board |
| `/sb-ship <explore-path>` | one story | `propagate-workflow.md` Path A/B (preserve, never `git mv`) | graduation record |

(`/sb-list`-style read-outs are folded into `/sb-inventory`'s report; the per-component plan is the user-edited `extraction-plan.md` ledger, not a separate verb.)

## Dependency order
`/sb-setup` (framework present) gates `/sb-stories` · `/sb-inventory` gates flows / health / stories · `/sb-stories` self-gates with `validate-stories.sh` · `/sb-audit` is periodic · `/sb-explore`, `/sb-figma`, and `/sb-ship` are event-triggered. `/sb-explore` (iterate an **undecided** design) and `/sb-figma` (deliver an **approved** Figma design) are both Figma-aware — route by stage, not by "uses Figma". `/sb-hub` only ever suggests a command whose prerequisites are satisfied.

## ds-runbook handoff (never to leaf ds-* skills)
Token/component **extraction** is owned by `ds-runbook`. Bridge to `/ds-runbook` when: `/sb-inventory` flags `designSystem.mixed` / heavy raw-hex / orphan tokens · `/sb-health` hits real token-or-component debt · VRT-in-CI is needed (→ `ds-test-setup` + `ds-ci-gates`). Return here for story capture after.

## Codex note — invoking the same phases (capability parity, not `/`-syntax)
Codex has **no custom `/sb-*` slash commands** (its slash set is built-in; `~/.codex/prompts` is not read — verified 2026-05-29). Codex invokes a skill two ways (per Codex docs):
- **`$<skill> <phase>`** — the `$`-mention is the command-like entry. `$sb-hub what's next` ≈ `/sb-hub`; `$sb-inventory` ≈ `/sb-inventory`; `$sb-stories CourseCard` ≈ `/sb-stories CourseCard`.
- **`/skills`** → pick the skill, then name the phase.

Either way the agent reads this runbook and runs the identical scripts + `.storybook/audit/` ledger. Only the trigger syntax differs per agent; the phases, navigator, and outputs are the same. (Each skill's `agents/openai.yaml` `default_prompt` surfaces its phase so `$<skill> <phase>` routes cleanly.)
