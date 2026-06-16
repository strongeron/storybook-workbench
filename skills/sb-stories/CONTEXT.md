# CONTEXT — shared vocabulary for the storybook-workbench bundle

Every skill in this bundle assumes the terms below. Read this once; skills reference it
instead of re-explaining. (Pattern borrowed from mattpocock/skills `CONTEXT.md`.)

## The pipeline in one line

**Setup -> Build -> Ship**, with two gates (Lint per-cycle, Audit periodic) and a Navigate verb
(`sb-hub`) that names the next step throughout. Only Setup -> Build -> Ship are sequential;
everything else is on-demand. The default audit order is setup, inventory, health, flows, stories.

| Macro | What | Skill |
|---|---|---|
| **Setup** | install Storybook if missing, discover what's real vs slop, detect the design system, map navigation | `sb-setup`, `sb-inventory`, `sb-health`, `sb-flows` |
| **Build** | author stories / app-maps / comparisons | `sb-stories`, `sb-wrappers` |
| **Ship** | graduate an Explore experiment to production | `sb-ship` |
| **Audit** | drift survey + decision board (periodic gate) | `sb-audit` |
| **Navigate** | inspect state, name the single next step | `sb-hub` (onboarding check + orchestrator + navigator) |

## Core terms

- **real · dead · slop** — a *real* component is exported under `src/components/` AND imported
  from outside its own file (it's used). A *dead* component is defined-but-never-imported — this
  is the per-component term; the inventory labels them "Dead components" and counts them (`29 dead`).
  *Slop* is the aggregate: the share of the app that's dead/unused junk, surfaced as the slop
  **rate** (`dead ÷ total`, e.g. `8% slop`) — the ~30% a vibe-coded app ships. So "real vs slop"
  is the headline framing; **dead** is the precise label for one unused component. Ground truth
  comes from `inventory-project.sh`, never from `CLAUDE.md`/`AGENTS.md` (those drift, lie, or are absent).
- **vendor** — shadcn-style installed primitives under `components/ui/`. They are app code
  but NOT the user's authored components, so they are reported in their own `vendor` bucket
  and excluded from the real/dead *domain-component* headline. (This is the fix for "the
  inventory showed me 40 shadcn components I didn't write.")
- **kind** — every discovered file is bucketed: `component` · `page` · `app` · `vendor`
  (shadcn `ui/`) · `module` (types/helpers/hooks/utils/lib/api/services — real code but not UI
  components) · `scaffold` (SB init tutorial under `src/stories/`) · `support` (test/factory/mock).
  Only `component`+`page`+`app` count toward the real/dead headline and the "most imported"
  list — so `vendor`, `module`, `scaffold`, `support` never pollute the view of *your components
  used in prod* (a `types.ts` is imported everywhere and would otherwise top the list).
- **Build outputs** (not four equal "modes") — `sb-stories` writes a **Component** story ⓢ, the
  production output, one per materially-different state. `sb-wrappers` scaffolds Storybook-only
  **views**: A/B Compare (`ABCanvas`), state grids (`StateGrid`/`StateMatrix`), role canvas,
  token/health/inventory canvases, the decisions board, and the maps. `sb-flows` produces the
  **Flow** view — the whole-app map (`AppFlowGraph`) plus per-flow journey maps (`JourneyGraph`):
  connections, not just screens. Separately, **Explore** is a sandboxed iteration track
  (`sb-explore`) that lives OUTSIDE `src/components/`; `sb-ship` graduates an Explore experiment
  into a Component.
- **ledger** — `.storybook/audit/{findings,extraction-plan,status}.md`. Append-only memory
  you steer by editing; the hub navigator honors your edits. Commit it or a `git clean`
  loses it.

## STORAGE MAP — where everything lands (answers "where is it stored?")

**One place. `.storybook/` is the single home** for everything the bundle writes, so a client /
vibe-coded repo stays clean and one `rm -rf .storybook` removes the entire audit. **Never scatter
outputs across the repo.** The *only* thing whose location is a real choice is **where the stories
go** — decided once in `sb-setup` (see STORIES LOCATION below), recorded in `status.md`, honored by
every skill.

| What | Path | Commit? |
|---|---|---|
| Discovery ground truth | `.storybook/project-inventory.json`, `flows.json`, `component-states.json`, `prop-shapes.json`, `component-usage.json` (real prop/value usage at call sites) | yes |
| Design-system health | `.storybook/design-system-health.json` | yes |
| Findings ledger | `.storybook/audit/{findings,extraction-plan,status}.md` | yes |
| Decision ledger (pruned) | `.storybook/audit/decisions.md` | yes |
| Scaffolded wrappers | `.storybook/wrappers/*.tsx` (+ `icons.tsx`, `index.ts`) | yes |
| Factories | `.storybook/factories.ts` | yes |
| **Stories** (the one choice) | **isolated:** `.storybook/stories/**/*.stories.tsx`  ·  **co-located:** `src/**/<Name>.stories.tsx` | yes |
| **Agent run artifacts** | `.context/storybook-workbench/<skill>/<run_id>/*.json` | **no** (gitignored — ephemeral) |

Nothing the bundle produces lands anywhere else. If you can't find an output, it is under `.storybook/`.

**Who refreshes what (keep rendered data fresh).** Some JSONs are **rendered** in Storybook (an autodocs
embed or a wrapper reads them) — those must refresh together; others are **authoring inputs** the agent
reads once to write code, regenerated on demand.

| JSON | Producer script | Rendered by | Refreshed by |
|---|---|---|---|
| `project-inventory.json` (incl. `tokens.map`) | `inventory-project.sh` | ProjectInventory · UsageSection (Colors/Typography/Scales/Semantic) · TokenUsageGrid | **`refresh-usage.sh`** |
| `component-usage.json` | `extract-component-usage.sh` | StateGrid/StateMatrix `usage=` · UsageSection (component Docs) | **`refresh-usage.sh`** |
| `flows.json` | `extract-flows.sh` | AppFlowGraph · JourneyGraph | **`refresh-usage.sh`** |
| `design-system-health.json` | `validate-design-system.sh` (sb-health) | UsageSection (Health) · DesignSystemHealth · TokenMatrix | **`refresh-usage.sh`** |
| `component-states.json` · `prop-shapes.json` · `runtime.json` | extract-states · extract-prop-shapes · discover-runtime | — (authoring inputs) | regenerated on demand by sb-stories / sb-setup |
| `index.json` (Storybook's OWN report) | `storybook index` (CLI, no server/build) | — (reconciled into `project-inventory.json.storyCoverage`) | run by `inventory-project.sh` / `refresh-usage.sh` |

**Story coverage is authoritative, not a guess.** When Storybook is installed, `inventory-project.sh`
runs `storybook index` and reconciles `index.json` (the stories Storybook actually registers) into
`storyCoverage` (`source: "storybook-index"`, `withRegisteredStory`, `needsStory`) — far better than the
basename-glob heuristic (`source: "heuristic"`, the fallback when Storybook isn't installed). Cross-agent:
plain CLI, no dev server, no MCP. MCP is the *authoring* accelerator; `index.json` is the *tracking* source.

`refresh-usage.sh` (+ `--docs`) is the one command that re-runs all four **rendered** extractors; `sb-audit`
runs it each pass, and it belongs in CI before `storybook build`. The autodocs import the JSON, so a rebuild
reflects reality with no hand-editing.

### STORIES LOCATION — ask once, recommend, record (the "don't scatter stories" rule)

A demo finding: writing `Foo.stories.tsx` next to every component scatters new files through a
client's `src/` — a mess in a repo you don't own. So **`sb-setup` must ASK the user where stories
live** (via `AskUserQuestion`, or numbered list where no blocking tool exists) and **recommend** based
on intent:

- **Isolated — THE DEFAULT** (this is an audit tool; assume a repo you don't own) — stories live under
  `.storybook/stories/`, mirroring the component tree (`.storybook/stories/components/CourseCard.stories.tsx`).
  `src/` is never touched; the whole audit is one removable folder. `sb-setup` sets `main.ts`
  `stories: ['./stories/**/*.stories.@(tsx|ts)']` (relative to `.storybook/`). Stories import
  components via the project's `@/` alias, not deep relative paths.
- **Co-located — opt in only** (Storybook's general convention, for a **project you own long-term** and
  want stories to move with components on refactor) — `src/components/<X>/<X>.stories.tsx`.

- **A custom folder** — the user can name any single folder; it's globbed into `main.ts` and treated
  as the one place. Still one location, never a mix.

Always **ask** (isolated is the recommended/first option and the fallback). Record the choice in
`.storybook/audit/status.md` as `storiesLocation: isolated|colocated|<path>` so `sb-stories` and the
hub honor it without re-asking. **The ask is enforced at two points** so it can't be skipped: `sb-setup`
asks during install, and if Storybook already existed (so `sb-setup` was skipped), the **first
`sb-stories` refuses to write until it asks** and records the choice. Never co-locate or guess silently.

## What loads when (the load map — answers "is this 200k tokens?")

- **Eager:** only the one skill's `SKILL.md` you triggered (each is ~60–110 lines).
- **Lazy:** a skill's local `references/*.md` plus the few shared references load *only when the
  skill body says to* — never all at once. Discovery scripts write JSON the agent reads instead of
  grepping source.
- **Never auto-loaded:** `CHANGELOG.md`, other skills' bodies, the wrapper `.tsx` source.

You install the bundle; you pay context only for the verb you run.

## Resume protocol (answers "we stopped mid-session with half-baked files")

Discovery scripts write JSON **atomically** (temp file → move), so a partial run leaves no
half-JSON. Story/audit work records progress in `.storybook/audit/status.md`. On re-entry the
hub (`/sb-hub` / `$sb-hub what's next`) reads `status.md` + checks which discovery
JSONs exist, and resumes from the first incomplete step — it never assumes a file half-written
in a prior session is complete. Rule for every skill: **finish the artifact you started or
mark it `incomplete` in `status.md` before stopping.**

## §wrapper-view-design — the ONE visual language for wrappers

Wrappers are Storybook-only React components scaffolded into `.storybook/wrappers/`. They share
one visual language so they don't look like a pile of different widgets:

1. **No emoji. Ever.** Use the icon set in `wrappers/icons.tsx` (`<Icon.palette/>`,
   `<Icon.warning/>`, `<Icon.check/>`, …). Dependency-free inline SVG: 24×24 viewBox,
   `currentColor` stroke, 1.6 width — icons inherit text color and size.
2. **Injectable.** Map-style wrappers (`AppFlowGraph`, `JourneyGraph`) accept an `icons` prop
   so a project can pass its own lucide/Phosphor/custom set and match the app's language.
   `mergeIcons(overrides)` merges over the defaults.
3. **Themed via the app's tokens (CSS vars, not a JS palette).** Wrappers color themselves with the
   host app's CSS custom properties and a fallback — `var(--color-foreground, <fallback>)`,
   `var(--color-surface, …)`, `var(--color-border-subtle, …)`, and the semantic
   `--color-success/warning/error[-surface|-text]` roles. One `.dark` class flip re-skins every
   wrapper light↔dark, and the fallback keeps it rendering standalone. This is the single source of
   color. Keep *data* colors (token swatches, categorical legend hues, shader output) as-is; only
   chrome reads from vars.
4. **`icons.tsx` always travels.** `scaffold-wrapper.sh` force-copies it next to any wrapper, so a
   wrapper copied alone never loses its icons.
5. **Status fields hold a `WrapperIcon` component, not a glyph string** — e.g. severity →
   `{ error: Icon.x, warning: Icon.warning, info: Icon.info }`, rendered via an aliased
   `const SevIcon = style.icon; <SevIcon size={14} />`.
6. **Plain text where a swatch already carries the cue** (e.g. TokensCanvas section headings) —
   no decorative glyph prefix.

To add an icon: add one inline-SVG entry to `Icon` in `icons.tsx` (keep the `// emoji → name`
comment so the mapping stays legible), then reference `<Icon.newName/>`.

## Cross-agent rules (answers "slash commands don't work in Cursor/Codex")

All three agents read the same `SKILL.md` (Agent Skills open standard); each skill also ships an
`agents/openai.yaml` for Codex's richer surface. What differs is *invocation UX*, not availability:
- **Claude Code** (`~/.claude/skills/`): each skill is a slash command — `/sb-inventory`, `/sb-hub`.
- **Codex** (`~/.codex/skills/`): custom slash commands are NOT read. Invoke by name —
  `$sb-hub <phase>` (e.g. `$sb-hub what's next`) or `/skills` → pick the skill.
  The `openai.yaml` `default_prompt` routes the phase.
- **Cursor / cursor-agent** (`~/.cursor/skills/`): reads `SKILL.md` like the others — trigger by
  describing the task so the `description` matches, or by name. Custom `/sb-*` shortcuts do NOT fire
  (Cursor has rules + skills, not Claude-style slash commands), but the skills themselves work.
- Any skill body that says "use the Agent tool" must branch per platform: Claude `Agent`
  (model `sonnet`), Codex `gpt-5.x-mini` equivalent; if no override mechanism, omit the model
  and inherit the default rather than fail the dispatch.

### Tool portability — how the SAME tools hold across agents

There is **no cross-agent tool-name registry**, and `allowed-tools` is *experimental* in the open
standard ("support may vary between agents"). So portability is two parts, not the field:
1. **`allowed-tools` = a Claude-only pre-approval** (lists run without a prompt). We keep it to the
   **6 universal primitives** (`Bash Read Glob Grep Write Edit`) — present natively in every agent, so
   it's safe where read and harmless where ignored (Codex/Cursor apply their *own* permission models:
   Codex sandbox + approval, Cursor settings). `test-tool-portability.sh` fails on any non-universal tool.
2. **`compatibility` = the portable runtime contract** — every skill declares what must exist
   (`bash, python3, node, git`). This is the field any agent reads to know the skill's real needs; the
   gate requires it and `skills-ref validate` (the official validator) confirms each skill against the
   standard. There is no install-time *translation* — primitives are universal; install just drops
   `SKILL.md` and each agent applies its model. If a skill ever needs a **non-portable** capability,
   document the per-platform branch in that skill body and add an eval before shipping it.

