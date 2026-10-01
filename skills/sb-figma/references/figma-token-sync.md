# Figma ↔ Storybook — the runbook

Load this when delivering an **approved** Figma design. For *iterating an undecided* design, stop — that's
`sb-explore` (Lab). The lifecycle: `sb-explore` (explore) → `sb-ship` (graduate Lab) ‖ `sb-figma` (deliver
approved Figma → prod). Both are Figma-aware; the line is **exploration vs delivery**.

## Job 0 — capture EVERY MCP output first (the store)

Scripts can't call MCP and an MCP result is ephemeral (gone next session, absent headless). Persist each call
through the universal store so downstream steps + future iterations read disk, never re-hit MCP:

```bash
<tool output> | node scripts/capture-figma.mjs --tool <use_figma|get_variable_defs|get_design_context|get_metadata|get_code_connect_suggestions|get_context_for_code_connect> --file <FILE> --node <NODE> --from-mcp -
node scripts/capture-figma.mjs --tool get_screenshot --file <FILE> --node <NODE> --image /tmp/frame.png   # images
node scripts/capture-figma.mjs --list                                                                     # inventory
```
Store: `.storybook/figma/manifest.json` + `.storybook/figma/<tool>/<node>.json`. Re-capture overwrites → `git diff` shows what moved in Figma.

## Job 1 — foundation tokens (every mode)

1. **Resolve inputs** — the Figma file URL (→ `fileKey`) and the project's **token CSS path(s)**. Ask if not
   provided.
2. **Read + capture** — preferred: load `figma-use`, then `use_figma` with `references/read-figma-variables.js`
   as `code` (`skillNames: "figma-use"`): every collection, every mode, aliases resolved. Fallback without edit
   access: `get_variable_defs` on a node that uses the tokens (that node's variables, one mode).
3. **Normalize** (either shape):
   ```bash
   node scripts/pull-figma-variables.mjs \
       --from-mcp .storybook/figma/<use_figma|get_variable_defs>/<NODE>.json --out .storybook/figma-variables.json
   ```
   Headless / no capture yet: run with no `--from-mcp` and it reuses the last `--out` cache (degrade path).
4. **Build parity** (default mode ↔ `:root`, Dark ↔ `.dark` / `[data-theme=dark]` / dark `@media`):
   ```bash
   node scripts/build-token-parity.mjs --variables .storybook/figma-variables.json \
       --css "src/styles/**/*.css" --out .storybook/figma-token-parity.json
   ```
5. **Wire the foundation stories** — `Colors.stories.tsx` (and the `Tokens`/`Type` groups) import the parity
   JSON and spread `figmaVar`/`figmaHex` onto the matching `TokenMatrix`/`TokensCanvas` rows. Pattern:
   ```ts
   import parity from '../../.storybook/figma-token-parity.json'
   const fig = (token: string) => parity.color[`--${token}`] ?? {}
   // row: { token: 'primary', role: 'Primary', ...fig('primary') }  // → figmaVar + figmaHex appear
   ```
   Keep the fields optional — a project with no `figma-token-parity.json` renders exactly as today.
6. **Report drift** per mode — `drift` rows, `modes.Dark` drift, `figmaOnly`, `unmatchedModes`. `appOnly`
   tokens (`--ring`, `--popover`, …) are **expected**, not failures — say so.

### OKLCH → hex notes (why the resolver exists)

The dialect stores colours as **bare channel triplets** (`--primary: 0.56 0.072 234`) or `var()` aliases to
one. A bare triplet is not a valid CSS colour unwrapped — the resolver wraps it as `oklch(L C H)` and converts
through OKLab → linear sRGB → gamma sRGB, gamut-clamped to `#rrggbb`. Figma publishes hex; we compare the
resolved code hex against it within rounding tolerance. `oklch(...)` literals, `#hex`, and `var()` chains are
all handled; HSL channel triplets are out of v1 scope (flag if encountered).

## Job 2 — approved component delivery

Mirrors the test project's `design-system-guardrails.md` §8, but **delegates authoring to `sb-stories`**:

1. **Chunk** a big board by artboard/section; deliver and record one part at a time.
2. **Load `figma-design-to-code`**, then `get_design_context` for the node (`skillNames`, `clientFrameworks`):
   code + asset URLs + screenshot in one call. Metadata-only response → fetch the child nodes it lists.
3. **Reuse** — Code Connect-mapped components come back as the real import; otherwise grep for the same
   concept and extend it (`search_design_system` for library components).
4. **Assets** — `download_assets` into the project; no placeholders, no temporary Figma URLs in code.
5. **Build** with approved tokens/primitives only — a Figma value with **no token** → stop and ask.
6. **Author the story following `sb-stories`**, stamp the node-id + `parameters.design`, validate
   light / dark / mobile against the captured screenshot, then record it in the Figma Inventory.

## Job 3 — Code Connect (code → design)

`whoami` (Organization/Enterprise plan) → `get_code_connect_suggestions` (`excludeMappingPrompt: true`) →
`get_context_for_code_connect` per component → `comps.json` → `build-code-connect.mjs --file <FILE_KEY>` →
show the user `send` → `send_code_connect_mappings`. Prop-level snippets: Code Connect 2.x template files
(`Component.figma.ts`) or a `template` in the mapping; `context[].propMappings` is the input.

## Guardrails

- **Tokens are mirror images of Figma variables** — code `--token` ↔ Figma `semantic/*` 1:1. If a Figma value
  doesn't map, stop and propose adding the token (don't invent).
- **Stamp the node-id** on every delivered component + foundation story so the catalog traces back to Figma.
- **Don't fragment** — sb-figma writes only the foundation/token stories itself; component stories go through
  `sb-stories`, Lab graduation through `sb-ship`.
