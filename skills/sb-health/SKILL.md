---
name: sb-health
description: "Check design-system health for a React+Vite app — raw hex, undefined/unused tokens, scale gaps, and DESIGN.md drift (claims vs code). Use for 'is my design system healthy', 'find raw colors', 'check tokens', or a mixed design system."
compatibility: "Requires bash and python3; reads sb-inventory's project-inventory.json for unused-token (run sb-inventory first); Node.js + stylelint optional for the stylelint pass."
allowed-tools: Bash Read Glob Grep Write
license: MIT
metadata:
  author: strongeron
  version: '2.2.0'
  bundle: storybook-workbench
  vendor:
    scripts: [validate-design-system.sh, scaffold-wrapper.sh]
    wrappers: [DesignSystemHealth]
    references: []
---

# sb-health — design-system health gate

The browser can't shell out, so the script runs the checks and writes JSON the wrapper renders.
`design-system-health.json` is a **rendered** output (Health Docs + DesignSystemHealth/TokenMatrix), so
`refresh-usage.sh` re-runs this check with the other rendered extractors — see `CONTEXT.md` §STORAGE MAP.

## Run it

```bash
SKILL=${CLAUDE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}
CORE=${CLAUDE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}
"$SKILL/scripts/validate-design-system.sh"       # → .storybook/design-system-health.json
# --emit-prompt  also outputs an LLM sub-agent prompt for semantic checks
#                (naming drift, semantic-vs-presentational, scale clarity)
"$CORE/scripts/scaffold-wrapper.sh" DesignSystemHealth   # → .storybook/wrappers/ (+ icons.tsx)
```

## What it checks

- **raw-color** — hex/rgba/hsl literals in components (should be tokens)
- **undefined-token** — components reference `--foo` that's not declared
- **scale-gap** — spacing/type scale has unexpected jumps
- **unused-token** — declared but never referenced (var, Tailwind utility, or custom `@utility`).
  Read from sb-inventory's single source (`.storybook/project-inventory.json` → `tokens.map`),
  not re-scanned here, so health, inventory, and the token views never disagree. Run `sb-inventory`
  first; if the file is absent this check is skipped.
- **design-md** — a `DESIGN.md` (Google Labs YAML-tokens-plus-markdown, an increasingly common way to
  brief agents on a visual identity) is a **claim, not ground truth** — like `AGENTS.md` it drifts as
  the code changes, or was wrong from the start. The script finds it and cross-checks the colors it
  *claims* against the colors the code's CSS tokens actually *declare*, emitting `design-md-drift` for
  each claimed color the code doesn't define. Treat a present `DESIGN.md` as untrusted until reconciled.
- runs `stylelint` if configured

Report `summary` (errors/warnings/info counts) and the top findings. The `DesignSystemHealth`
wrapper renders severity with the shared icon set (no emoji).

The JSON it writes (shape — read these fields, don't re-derive). Each finding is
`{kind, severity, message, file?, line?, fix?}`; `summary` rolls up the counts:

```jsonc
{
  "findings": [
    { "kind": "raw-color",       "severity": "error",   "file": "Button.tsx", "line": 42, "message": "#3b82f6 literal", "fix": "use --color-primary" },
    { "kind": "undefined-token", "severity": "error",   "file": "Card.tsx",   "line": 11, "message": "--surface-2 not declared" },
    { "kind": "design-md-drift", "severity": "warning", "message": "DESIGN.md claims #1e90ff; no token declares it" },
    { "kind": "unused-token",    "severity": "info",    "message": "--legacy-accent declared, never referenced" },
    { "kind": "scale-gap",       "severity": "info",    "message": "spacing jumps 16px → 48px" }
  ],
  "summary": { "total": 5, "errors": 2, "warnings": 1, "info": 2, "checksRun": ["raw-color", "undefined-token", "..."] }
}
```

**Triage order — severity is the verdict, not the count:** fix `error` first (raw-color → map to an
existing token; undefined-token → declare it or fix the typo), *reconcile* `warning` (design-md-drift
→ hand to `design-md`), and **report `info` as-is** (unused-token / scale-gap are signals to verify,
never auto-fixes — see Never below). A repo with 0 errors and 20 info findings is *healthy*.

## Never (and the non-obvious why)

- **NEVER delete an `unused-token` on sight** — it is `info`, not `error`. A static scan can't see a
  token consumed by a Tailwind utility (`bg-[--brand]`), a runtime `var()` built by string concat, or
  a sibling app in the monorepo. "Unused" means "I didn't find a reference," not "safe to remove."
- **NEVER treat `scale-gap` as a failure to fix** — it's `info`. Real scales have intentional jumps (a
  display size far above body); "smoothing" them invents tokens nobody asked for and breaks the rhythm
  a designer chose.
- **NEVER trust `DESIGN.md` as ground truth** — it's a *claim*, like `AGENTS.md`/`CLAUDE.md`, and drifts.
  Reconcile against `design-md-drift` first; an un-reconciled DESIGN.md will confidently lie about colors
  the code doesn't define.
- **NEVER "fix" a `raw-color` by inventing a new token** — map it to an *existing* token. A fresh token
  per literal just relocates the mess into the token layer (more undefined-token noise next run).
- **NEVER hand-recompute this JSON by re-grepping** — the browser can't shell out, so the script is the
  single source; cite its fields. Re-deriving by eye is how the counts drift from what the wrapper renders.

## When to defer

For **extraction** (turning a messy codebase into tokens + components), this skill only *measures*.
To actually extract, run `/ds-runbook` → `/ds-audit` → `/ds-token-extract` → `/ds-component-extract`,
then come back here to verify health and to `sb-stories` for capture.

For a **`DESIGN.md`** that drifted (or to author/regenerate one *from* the code's real tokens), hand
off to the **`design-md`** skill — it composes, extracts, and deep-audits the Google Labs DESIGN.md
format. `sb-health` only flags the drift; `design-md` reconciles or rewrites the brief.

## Next

If health is poor and the project is in transition, fix tokens (or route to ds-* skills) before
authoring stories. Otherwise append a finding and continue to `sb-stories`.
