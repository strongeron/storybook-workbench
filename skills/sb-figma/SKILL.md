---
name: sb-figma
description: "The Figma↔Storybook bridge, both directions, via the native Figma MCP. design→code: map foundation tokens (color/spacing/type) from Figma variables with design↔code parity + drift, and deliver approved Figma components (extract → build → embed), authoring stories via sb-stories' rules. code→design: build Code Connect mappings from components + stories + token parity + usage so Figma Dev Mode shows the real code. Use for 'sync my Figma tokens', 'map Figma variables to my design system', 'deliver this approved Figma design', 'check design↔code token parity', 'connect my components to Figma / code connect'. NOT for prototyping/iterating an undecided design (that's sb-explore)."
compatibility: "Requires bash, python3 and Node.js (the .mjs scripts), plus the Figma MCP server (remote https://mcp.figma.com/mcp preferred). Job 1 reads every variable mode with use_figma (edit access) or falls back to get_variable_defs; Code Connect needs an Organization/Enterprise plan; writes need a Full seat. Without MCP the scripts reuse the cached .storybook/figma-variables.json. Reads project-inventory.json (sb-inventory) when present."
allowed-tools: Bash Read Glob Grep Write Edit
license: MIT
metadata:
  author: strongeron
  version: '2.4.0'
  bundle: storybook-workbench
  vendor:
    scripts: [capture-figma.mjs, pull-figma-variables.mjs, css-tokens.mjs, build-token-parity.mjs, build-figma-variables.mjs, build-code-connect.mjs, workbench-settings.mjs, record-figma-delivery.py]
    wrappers: [TokenMatrix, TokensCanvas, FigmaInventory]
    references: [figma-token-sync.md, read-figma-variables.js, write-figma-variables.js, workbench.schema.json]
    templates: [figma-inventory.stories.tsx]
---

# sb-figma — the Figma ↔ Storybook bridge

`sb-figma` moves an **approved** design into production Storybook (Jobs 1–2) and pushes the code's truth
back to Figma (Job 3, and opt-in writes). It uses the Figma MCP, but it is **not** the exploration skill.

## Preconditions — check before the first call

| Job | Needs | Tools |
|---|---|---|
| Read tokens (Job 1, preferred) | edit access to the file; the **remote** server | `use_figma` (read-only script) |
| Read tokens (fallback) | any seat | `get_variable_defs` |
| Deliver a component (Job 2) | any seat | `get_design_context`, `get_metadata`, `download_assets` |
| Code Connect (Job 3) | **Organization or Enterprise** plan, published library components | `get_code_connect_suggestions`, `get_context_for_code_connect`, `send_code_connect_mappings` |
| Write to Figma (opt-in) | **Full** seat for an existing file (any seat can write to drafts); remote server; beta | `use_figma`, `generate_figma_design` |

- Prefer the **remote** server (`https://mcp.figma.com/mcp`). The desktop server has no write, no
  code-to-canvas and no skills.
- Rate limits are per plan and seat (Starter View/Collab seats get a handful of calls a month; Dev/Full seats
  about 200 a day). `whoami`, `add_code_connect_map` and `create_new_file` don't count.
- A call fails with access, permission or rate-limit errors → call `whoami` (plans + seats) and report what's
  missing instead of retrying.
- Figma's own skills (`figma-use`, `figma-design-to-code`, `figma-code-connect`, `figma-generate-design`) come
  with the Figma plugin; without it, read them from the MCP as `skill://figma/<name>/SKILL.md`. Tools that
  require one say so in their description — load it first and pass `skillNames`.

> **The lifecycle line (load this first).** *Undecided / trying options* → **`sb-explore`** (Lab sandbox,
> iterate against a Figma node) → **`sb-ship`** (graduate the Lab experiment). *Already approved in Figma* →
> **`sb-figma`** (deliver direct to prod). Both touch Figma MCP; the difference is **exploration vs delivery**.
> If the user is still deciding, hand off to `sb-explore`. See `references/figma-token-sync.md`.

## Learn from each run — gaps and project rules

Every run starts here and ends here:

1. **Read the open gaps first:** `node scripts/workbench-settings.mjs gaps`. Each one says what a previous run
   couldn't do and how to fix it. Show them to the user before starting new work.
2. **The scripts record gaps as they go** in `.storybook/figma/gaps.json`: `collision` (several Figma variables
   on one token), `weak-match` (named on the last word only), `unmapped-name` (Figma variables with no code
   token), `unsupported-value` (a colour syntax the parity can't read), `unmapped-variant-value` (a Figma
   variant value with no code value). A gap a later run no longer finds is marked resolved.
3. **Record what only you see:** a value with no token you had to ask about (`missing-token`), a tool Figma
   refused (`tool-refused`):
   `node scripts/workbench-settings.mjs add --kind missing-token --detail "icon #116932 has no token" --suggestion "…"`.
4. **Fix a gap with a project rule, not a skill edit.** Rules live in `.storybook/workbench.json` (scaffold:
   `node scripts/workbench-settings.mjs --init`; schema `references/workbench.schema.json`); the project owns
   the file, so skill updates never overwrite it, and command-line flags still win:
   - `css` — where the token CSS lives · `darkSelectors` — what marks the dark theme
   - `nameMap` — `"fg/error": "--color-error-text"`: beats name guessing, settles collisions
   - `ignore` — Figma variables to leave out (`"Size/*"`) · `variantValues` — `"status - success": "success"`
   - `codeConnectLabel` — default Code Connect label
5. **Something the rules can't fix** (an unsupported colour syntax, a wrong result) → `report-issue.sh --gaps`
   drafts a sanitized issue with the open gaps as counts per kind — no names or values.

## Job 0 — capture the MCP output (always, before anything else)

> **Force the NATIVE structured tools — never work from a screenshot.** A screenshot is pixels; it cannot
> give you variables, styles, or component props. The full picture comes ONLY from the native MCP tools, and
> you must pull all three categories before building or connecting:
> - **Variables** → `get_variable_defs` (the token values: color/spacing/type/effect, resolved).
> - **Components + styles** → `get_design_context` (the reference code, applied styles, props/variants).
> - **Structure** → `get_metadata` (the node tree; on truncation, drill to child node-ids — never give up at
>   the parent).
> `get_screenshot` is **visual reference only** — for an eyeball diff after you've built from the structured
> data. NEVER read tokens, props, or layout off a screenshot. If a tool returns "nothing selected" on a page
> id, drill to a concrete component node (a page is not a layer).

Scripts can't call the Figma MCP, and an MCP result lives only in the agent's context — ephemeral, gone
on the next session, absent headless. So **every Figma MCP call you make, persist it** through the universal
store before using it. This is what makes the pipeline reproducible and iterable.

```bash
# pipe each tool's output straight in (JSON, code text and XML are all stored as returned):
<get_variable_defs output>  | node scripts/capture-figma.mjs --tool get_variable_defs   --file <FILE> --node <NODE> --from-mcp -
<get_design_context output> | node scripts/capture-figma.mjs --tool get_design_context  --file <FILE> --node <NODE> --from-mcp -
<get_metadata output>       | node scripts/capture-figma.mjs --tool get_metadata        --file <FILE> --node <NODE> --from-mcp -
<get_code_connect_map out>  | node scripts/capture-figma.mjs --tool get_code_connect_map --file <FILE> --node <NODE> --from-mcp -
# get_screenshot returns an image — save it, then register the file:
node scripts/capture-figma.mjs --tool get_screenshot --file <FILE> --node <NODE> --image /tmp/frame.png
# see the whole inventory (degrade / iterate):
node scripts/capture-figma.mjs --list
```

Store layout: `.storybook/figma/manifest.json` + `.storybook/figma/<tool>/<node>.json` (images keep their
ext). Re-capturing a (tool,node) overwrites — diff against git to see what moved in Figma. **Downstream steps
read the store, never re-call MCP.**

## MCP realities (field-verified 2026-06-22; tool schemas re-checked 2026-10-01)

What the live Figma MCP actually returns — the scripts already handle these; know them so you don't fight the output:
- **`get_variable_defs` is a FLAT `{ "name": "value" }` map** (not nested DTCG, not an array). Colors come **already
  resolved to hex** (`"semantic/background":"#fbfcfc"`), incl. 8-digit alpha (`"#e4e5e580"`). Numbers are bare
  strings (`"spacing-2":"8"`, `"wght/semibold":"650"`). **Typography is an opaque `Font(family: …, size: …)`
  string** — `pull-figma-variables` parses it to `{family,size,weight,lineHeight,…}` (a field may itself be a
  var-name ref like `size/text-lg`). Shadows are `Effect(…)` → the `effect` family. `classify()` buckets by VALUE.
- **`get_metadata` returns XML and TRUNCATES on large frames** (a table view blew past the token limit). When it
  truncates: read the child node ids from the partial XML and `get_design_context`/`get_metadata` the **sub-node**,
  not the parent. Capture each sub-node to the store so you never re-fetch.
- **Node-ids: the URL uses `1-6965`, the API examples use `1:6965`; every tool accepts both.** `capture-figma`
  stores captures under the dash form so they're found either way. Every tool also needs the `fileKey` from
  the URL (`figma.com/design/<fileKey>/…`; for a branch URL use the branch key).
- **`get_design_context` returns code text plus a screenshot by default; `get_metadata` returns XML.** Only
  `get_variable_defs` and the `use_figma` read script return JSON.
- **Persistence + screenshot↔node linking are solved by Job 0** — the store keeps every output with its node-id in
  the manifest, so you don't hand-cross-reference screenshots or re-call MCP (both were real friction before).

## The jobs (all read the Job-0 store)

### Job 1 — foundation tokens → `Foundations/Colors|Tokens|Type` (sb-figma writes these directly)

No other skill maps Figma *variables* to code tokens, so sb-figma owns the foundation parity end to end.

1. **Read the variables — every mode.** Preferred: load Figma's `figma-use` skill (or the
   `skill://figma/figma-use/SKILL.md` resource), then call `use_figma` with the contents of
   `references/read-figma-variables.js` as `code` and `skillNames: "figma-use"`. It only reads: every local
   collection, every mode (Light, Dark, …), aliases resolved. Big system (output is capped near 20 kB): set
   `ONLY` to one collection and call once per collection. Capture the result (Job 0).
   Fallback, when you can't run `use_figma` (no edit access to the file): `get_variable_defs` on the node
   that uses the tokens. It returns only the variables that node uses, in one mode — dark is not compared.
   Library variables the file consumes but doesn't own: `get_libraries`, then `search_design_system` with
   `{"entity":"variable", …}`.
2. **Normalize** — `node scripts/pull-figma-variables.mjs --from-mcp .storybook/figma/<tool>/<NODE>.json --out .storybook/figma-variables.json`.
   It accepts either shape; the default mode fills `color`/`spacing`/`type`, other modes land in `modes`.
   With no `--from-mcp` it reuses the last cache (the headless degrade path).
3. **Build parity** — `node scripts/build-token-parity.mjs --variables .storybook/figma-variables.json --css <token-css-glob> --out .storybook/figma-token-parity.json`.
   The CSS is read per theme: `:root` is the default, `.dark` / `[data-theme=dark]` / dark `@media` blocks
   are the dark theme. Figma's default mode is compared with the default theme, a Figma "Dark" mode with the
   dark theme (`modes.Dark` in the output). OKLCH channel triplets resolve to hex; `semantic/*` maps to the
   project's `--token`, following `var()` alias chains.
4. **Wire** the foundation stories — pass `figmaParity` to `TokenMatrix` (it reads `figma-token-parity.json`)
   to show drift in the color table's issue column (`figma Δ`, `code #X vs figma #Y` on hover). The fields are
   optional: a project with no Figma file renders as before.
5. **Report drift** in the sb-health shape: Figma value ≠ code value (OKLCH→hex tolerance for color, exact
   for spacing/type), per mode; app-only roles (`--popover`, `--ring`, …) are expected, not failures.

### Job 2 — approved Figma component → production (sb-figma delivers; sb-stories authors)

1. **Size the delivery first — chunk a big board.** A multi-artboard feature (a whole flow, a screen with
   many sections) blows past the MCP token budget. Split by artboard or section: deliver, validate and
   record one part, then the next. The Figma Inventory (step 8) unions stories across parts.
2. **Load Figma's design-to-code guidance.** `get_design_context` now requires it: use the
   `/figma-design-to-code` skill (Figma plugin) or read the `skill://figma/figma-design-to-code/SKILL.md`
   MCP resource, and pass `skillNames: "figma-design-to-code"` (`"resource:figma-design-to-code"` when read
   from the resource) on the call. Set `clientFrameworks`/`clientLanguages` (e.g. `react`, `typescript`).
3. **Extract (into the Job 0 store).** One `get_design_context` call returns reference code, asset download
   URLs and a screenshot; capture it. If it comes back as metadata only (too large), fetch the child nodes
   listed in it instead of the parent. `get_metadata` gives the tree when you need structure alone.
4. **Reuse before building.** Code Connect-mapped components come back in the design context as the real
   import — use them. Otherwise grep for an existing component covering the same concept and extend it
   (guardrails §8 step 3); `search_design_system` finds library components by name.
5. **Assets.** Use an exact match already in the project first (e.g. the same icon from the icon package the
   app uses). Otherwise download each asset the way the `get_design_context` response describes, into the
   project's asset folder. No placeholders, no new icon package, no temporary Figma asset URLs left in code.
6. **Build** with approved tokens and primitives only — tokens, not magic numbers. A Figma value with no
   token → stop and ask (a missing-token task: Job 1 or the user). The reference code is a starting point
   to adapt, not to paste.
7. **Author the story with `sb-stories`' conventions** (materially different states only; a factory when 3+
   stories share a shape), stamp the node-id in a top-of-file comment and `parameters.design` (Shared
   plumbing), then validate light / dark / mobile against the captured screenshot.
8. **Record the delivery in the Figma Inventory** — so the stories this feature created don't scatter
   across the taxonomy. Idempotent; re-run per delivery, stories union by id:
   ```bash
   python3 scripts/record-figma-delivery.py . \
     --figma-url "<board url>" [--feature "<Name>"] --spec-url "<spec node url>" --node-ids 101-9717 \
     --description "<one line>" \
     --story "Hunts/Hunt Packs:hunts-hunt-packs--default:component"   # repeat per story you created
   ```
   Then ensure the root surface exists: scaffold once with `scaffold-wrapper.sh --figma`, drop the
   `figma-inventory.stories.tsx` template (title `Figma Inventory`), add **one export per feature**
   (`export const Hunts = { args: { feature: 'Hunts' } }`), and pin it to the top in `.storybook/preview`
   via `options.storySort.order: ['Figma Inventory', '*']`. The `FigmaInventory` wrapper reads
   `figma-inventory.json` and renders the index + each feature's board link + the stories it brought in.

### Job 3 — Connect: Storybook → Figma (code → design)

Push the code's truth back so Figma Dev Mode shows your real components. Code Connect needs an
**Organization or Enterprise** plan and **published library** components (see Preconditions). Follow
Figma's order; every call goes through the Job-0 store:

1. **Check access** — `whoami`. No Org/Enterprise plan → stop and say so; Dev Mode won't show mappings.
2. **Find the components** — `get_code_connect_suggestions` on the page or frame (`excludeMappingPrompt: true`
   for a lean list of unmapped components).
3. **Read each one** — `get_context_for_code_connect` per component node: its properties, variant options and
   descendants. Match it to the code component (a story with `parameters.design` for that node is the
   strongest signal; else the component name).
4. **Build the payload** — write `comps.json` (`component`, `codeFile`, `figmaNode`, optional `componentName`,
   `label`, `tokens`, `variantProperties`, `modes`), then:
   ```bash
   node scripts/build-code-connect.mjs --components comps.json --file <FILE_KEY> \
        --parity .storybook/figma-token-parity.json --usage .storybook/component-usage.json \
        --out .storybook/code-connect.json
   ```
   `send` is the exact `send_code_connect_mappings` input (`fileKey`, `nodeId`,
   `mappings[{nodeId, componentName, source, label}]`); `context` holds tokens, real props and variant →
   prop mappings for review; `reverseParity` lists components with no Figma node or no source, unsupported
   labels, drifted tokens.
5. **Confirm, then send** — show the user the mappings; on approval call `send_code_connect_mappings` with
   `send` as-is. One mapping only: `add_code_connect_map` works too. Both write to Figma.
6. **Prop-level snippets (optional)** — a plain mapping shows the import and component. To map props (the
   variant picker → code props), write a Code Connect **template**: `Component.figma.ts` for the
   `@figma/code-connect` CLI 2.x (template files are the only maintained format since 2.0; `.figma.tsx` +
   `figma.connect()` are migrate-only), or pass `template` in the mapping. Figma's `/figma-code-connect`
   skill covers templates; `context[].propMappings` is the input.

**Components with no Figma node** (`componentsWithoutNode`) have nothing to connect to; creating them is a
write (below).

The loop closes: the `parameters.design` node-id added when delivering (Jobs 1–2) is what Job 3 reads to
connect back.

## Writing to Figma (opt-in, off by default)

Only on the user's explicit request, and confirm before each write — it changes their file. Needs a Full
seat for an existing file (see Preconditions).

- **Default: `use_figma`** (load `figma-use` first, `skillNames: "figma-use"`). Build from the file's own
  components and variables (`search_design_system`), return every created node id, and record them.
- **Tokens → Figma variables** (create a collection or update one, Light + Dark):
  ```bash
  node scripts/build-figma-variables.mjs --css "src/**/*.css" --prefix "--color-bg,--color-text-" \
       --collection "Code tokens" --out .storybook/figma-variables-push.json
  ```
  Paste one entry as `PAYLOAD` into `references/write-figma-variables.js` and run it with `use_figma` —
  **`DRY = true` first**: it returns what it would create and update. Show that to the user, then run with
  `DRY = false`. It reuses a collection or variable with the same name and overwrites values; it deletes
  nothing. Check with Job 1: reading the collection back and running parity should show zero drift.
- **`generate_figma_design` only to capture a rendered page the first time** — e.g. a story rendered in
  isolation: `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`. It makes a pixel copy; refine
  it with `use_figma` against the library components. Updating a page already captured → `use_figma`.
- After a write, the new node id goes back into the story's `parameters.design`, so Jobs 2–3 see it.

## Shared plumbing — the Figma design embed (Docs)

Every story sb-figma touches gets the design source preserved on its catalog page:

```ts
parameters: { design: { type: 'figma', url: 'https://figma.com/file/<FILE_ID>?node-id=<NODE_ID>' } }
```

This is `@storybook/addon-designs` (the "Design" tab — the same mechanism `sb-explore` uses for frames). Plus
a node-id stamp + link in `parameters.docs.description`. `sb-explore` and `sb-stories` can reuse this snippet
whenever the node-id is known.

## Boundaries — never duplicate a sibling's verb

- **Exploration / "try a v2" / undecided** → `sb-explore` (Lab). sb-figma is for *approved* designs only.
- **Graduating a Lab experiment** → `sb-ship` (preserve `cp`, rewrite callsites). sb-figma delivers from
  *Figma*, not from a `/explore/` experiment.
- **Documenting an existing code component (no Figma)** → `sb-stories`. sb-figma *calls* sb-stories' rules to
  author; it never reimplements them.
- **Code-internal token health / orphans** → `sb-health` / `sb-inventory` (Figma-free). sb-figma adds the
  *design↔code* parity those can't see.

## Inputs the agent must resolve first

- **Figma file URL** → the `fileKey` every tool needs; a **node URL** for Jobs 2–3 (and for the
  `get_variable_defs` fallback: a frame that uses the tokens). Ask if not pasted.
- **Token CSS path(s)** — where `--token: <value>` declarations live (e.g. `src/styles/**/*.css`).
- **Is the design approved?** If the user is still iterating → stop, route to `sb-explore`.
- **Plan and seat** for Job 3 and writes — see Preconditions (`whoami`).

## Next

Run Job 1 (tokens) first so components built in Job 2 consume real, parity-checked tokens. Append progress to
`.storybook/audit/status.md` for clean resume. Full call sequence + the OKLCH→hex notes:
`references/figma-token-sync.md`.
