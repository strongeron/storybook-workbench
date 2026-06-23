# Figma → Storybook delivery — the runbook

Load this when delivering an **approved** Figma design. For *iterating an undecided* design, stop — that's
`sb-explore` (Lab). The lifecycle: `sb-explore` (explore) → `sb-ship` (graduate Lab) ‖ `sb-figma` (deliver
approved Figma → prod). Both are Figma-aware; the line is **exploration vs delivery**.

## Job 0 — capture EVERY MCP output first (the store)

Scripts can't call MCP and an MCP result is ephemeral (gone next session, absent headless). Persist each call
through the universal store so downstream steps + future iterations read disk, never re-hit MCP:

```bash
<tool output JSON> | node scripts/capture-figma.mjs --tool <get_variable_defs|get_design_context|get_metadata|get_code_connect_map> --file <FILE> --node <NODE> --from-mcp -
node scripts/capture-figma.mjs --tool get_screenshot --file <FILE> --node <NODE> --image /tmp/frame.png   # images
node scripts/capture-figma.mjs --list                                                                     # inventory
```
Store: `.storybook/figma/manifest.json` + `.storybook/figma/<tool>/<node>.json`. Re-capture overwrites → `git diff` shows what moved in Figma.

## Job 1 — foundation tokens (reads the captured variables)

1. **Resolve inputs** — Figma **file id**, the **variables node id** (the variables/styles spec frame), and the
   project's **token CSS path(s)**. Ask if not provided.
2. **Capture + normalize:** capture `get_variable_defs` (Job 0), then normalize the stored file:
   ```bash
   node scripts/pull-figma-variables.mjs \
       --from-mcp .storybook/figma/get_variable_defs/<NODE>.json --out .storybook/figma-variables.json
   ```
   Headless / no capture yet: run with no `--from-mcp` and it reuses the last `--out` cache (degrade path).
3. **Build parity:**
   ```bash
   node scripts/build-token-parity.mjs --variables .storybook/figma-variables.json \
       --css "src/styles/**/*.css" --out .storybook/figma-token-parity.json
   ```
4. **Wire the foundation stories** — `Colors.stories.tsx` (and the `Tokens`/`Type` groups) import the parity
   JSON and spread `figmaVar`/`figmaHex` onto the matching `TokenMatrix`/`TokensCanvas` rows. Pattern:
   ```ts
   import parity from '../../.storybook/figma-token-parity.json'
   const fig = (token: string) => parity.color[`--${token}`] ?? {}
   // row: { token: 'primary', role: 'Primary', ...fig('primary') }  // → figmaVar + figmaHex appear
   ```
   Keep the fields optional — a project with no `figma-token-parity.json` renders exactly as today.
5. **Report drift** — surface `build-token-parity`'s `drift` rows and `figmaOnly` list. `appOnly` tokens
   (`--ring`, `--popover`, …) are **expected**, not failures — say so.

### OKLCH → hex notes (why the resolver exists)

The dialect stores colours as **bare channel triplets** (`--primary: 0.56 0.072 234`) or `var()` aliases to
one. A bare triplet is not a valid CSS colour unwrapped — the resolver wraps it as `oklch(L C H)` and converts
through OKLab → linear sRGB → gamma sRGB, gamut-clamped to `#rrggbb`. Figma publishes hex; we compare the
resolved code hex against it within rounding tolerance. `oklch(...)` literals, `#hex`, and `var()` chains are
all handled; HSL channel triplets are out of v1 scope (flag if encountered).

## Job 2 — approved component delivery

Mirrors the test project's `design-system-guardrails.md` §8, but **delegates authoring to `sb-stories`**:

1. `get_design_context` for the node (truncated → `get_metadata`, then fetch the sub-node) + `get_screenshot`.
2. **Audit before adding** — grep existing components for the same concept; extend rather than duplicate.
3. **Build** with approved tokens/primitives only — tokens, not magic numbers. A Figma value with **no token**
   → stop and ask (route to Job 1 or the user); never smuggle a raw value in.
4. **Author the story following `sb-stories`** — materially-different states only, factory if 3+ share a shape.
   Do not reinvent CSF3 rules; load `sb-stories`.
5. **Stamp + embed** — node-id top-of-file comment; `parameters.design = { type:'figma', url:'…?node-id=…' }`
   (`@storybook/addon-designs`) + a docs-description link.
6. **Validate** — light / dark / mobile, screenshot-vs-implementation parity.

## Guardrails

- **Tokens are mirror images of Figma variables** — code `--token` ↔ Figma `semantic/*` 1:1. If a Figma value
  doesn't map, stop and propose adding the token (don't invent).
- **Stamp the node-id** on every delivered component + foundation story so the catalog traces back to Figma.
- **Don't fragment** — sb-figma writes only the foundation/token stories itself; component stories go through
  `sb-stories`, Lab graduation through `sb-ship`.
