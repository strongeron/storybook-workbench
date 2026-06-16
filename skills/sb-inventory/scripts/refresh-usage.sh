#!/usr/bin/env bash
# refresh-usage.sh — ONE command to refresh all "declared vs. actually-used" data + the docs that read it.
#
# Re-runs the three static extractors (idempotent; read-only on the app — they only WRITE .storybook/*.json)
# and optionally re-stamps the per-component usage MDX. The autodocs import the JSON, so a Storybook rebuild
# after this reflects current reality with ZERO hand-editing.
#
#   .storybook/project-inventory.json   ← inventory-project.sh    (components real/dead + token usage map)
#   .storybook/component-usage.json     ← extract-component-usage.sh (real prop/variant call-site counts)
#   .storybook/flows.json               ← extract-flows.sh        (routes defined + nav edges)
#   <storiesLocation>/<Name>.usage.mdx  ← scaffold-usage-mdx.py   (--docs: per-component "real usage" page)
#
# Three ways to trigger the update, same script:
#   • per-script / manual : refresh-usage.sh [ROOT]            (run anytime; or call one extractor directly)
#   • every audit         : sb-audit runs the usage refresh as part of its drift pass
#   • CI / pre-build      : add `refresh-usage.sh --docs` before `storybook build` so docs ship current
#
# Usage:
#   refresh-usage.sh [ROOT]          # refresh the 3 JSONs for ROOT (default: .)
#   refresh-usage.sh --docs [ROOT]   # ALSO re-stamp per-component usage MDX
#
# This is an ORCHESTRATOR: it needs the whole bundle present (it calls scripts owned by sb-inventory /
# sb-flows / shared). Point SB_BUNDLE or CLAUDE_PLUGIN_ROOT at the bundle if autodetection from $0 fails.
set -uo pipefail
DOCS=false; ROOT="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    --docs) DOCS=true; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) ROOT="$1"; shift ;;
  esac
done

# Locate the bundle: explicit env wins, else walk up from this script (shared/scripts → bundle).
BUNDLE="${SB_BUNDLE:-${CLAUDE_PLUGIN_ROOT:-}}"
if [[ -z "$BUNDLE" || ! -d "$BUNDLE/skills" ]]; then
  here="$(cd "$(dirname "$0")" && pwd)"; BUNDLE="$(cd "$here/../.." && pwd)"
fi

# find a named script anywhere under the bundle (shared or any skill); empty if absent
find_script(){ find "$BUNDLE/shared/scripts" "$BUNDLE"/skills/*/scripts -name "$1" 2>/dev/null | head -1; }

run_one(){ # run_one <label> <script-name> [args...]
  local label="$1" name="$2"; shift 2
  local path; path="$(find_script "$name")"
  if [[ -z "$path" ]]; then echo "  ⚠ skip $label — $name not found under $BUNDLE (need the full bundle)"; return 0; fi
  case "$name" in
    *.py) ( cd "$ROOT" && python3 "$path" "$@" ) ;;
    *)    ( cd "$ROOT" && bash   "$path" "$@" ) ;;
  esac >/dev/null 2>&1 \
    && echo "  ✓ $label" \
    || echo "  ⚠ $label exited non-zero (often a soft finding, JSON still written) — check .storybook/"
}

echo "== refresh-usage: $ROOT =="
# Refresh EVERY rendered file: each autodocs embed / wrapper reads one of these, so they refresh together.
run_one "inventory + token usage → project-inventory.json" inventory-project.sh
run_one "component prop/variant usage → component-usage.json" extract-component-usage.sh
run_one "routes + nav edges → flows.json" extract-flows.sh
# Composes the three JSONs above into the component↔page import graph the ComponentUsage worklist reads.
run_one "component↔page import graph → component-pages.json" build-component-pages.py
run_one "design-system health findings → design-system-health.json" validate-design-system.sh
if $DOCS; then
  run_one "per-component usage MDX (--docs)" scaffold-usage-mdx.py
fi
echo "== done — rebuild Storybook to refresh the autodocs that import these JSONs =="
