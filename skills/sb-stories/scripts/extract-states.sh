#!/usr/bin/env bash
# extract-states.sh — Per-component state-branch discovery.
#
# For each real component (from .storybook/project-inventory.json or the scan
# fallback), greps for the conditional branches that determine WHAT STATES
# need separate stories. Replaces "agent guesses minimum coverage" with
# "agent reads the JSON and writes one story per real branch."
#
# Detects (regex — light AST):
#   loading branch    — isLoading, loading, pending, isPending, isFetching
#   error branch      — error, err, isError, failed
#   empty branch      — !data, data.length === 0, data?.length === 0,
#                       items.length === 0, isEmpty
#   disabled prop     — disabled, aria-disabled, isDisabled
#   open/closed state — open, isOpen (for overlays)
#   success branch    — success, isSuccess, submitted, isSubmitted
#   skeleton          — Skeleton, <Loader/>, shimmer
#
# Output: writes .storybook/component-states.json keyed by file path with
# detected branches + recommendedMinimumStories.
#
# Usage:
#   extract-states.sh                # uses project-inventory.json if present
#   extract-states.sh path/to/src    # explicit scan path (no inventory needed)
#   extract-states.sh --out file     # custom output path
#   extract-states.sh --inventory f  # custom inventory path
#
# Exit codes:
#   0  states written
#   1  no real components found (run inventory-project.sh first)
#   2  bad invocation

set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found in PATH. Install python3 (Alpine: apk add python3; Debian: apt install python3)." >&2; exit 2; }

OUT_PATH=".storybook/component-states.json"
INVENTORY_PATH=".storybook/project-inventory.json"
EXPLICIT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_PATH="$2"; shift 2 ;;
    --inventory) INVENTORY_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) EXPLICIT_PATH="$1"; shift ;;
  esac
done

# ─── Gather candidate component files ────────────────────────────────────────
TMP_FILES=$(mktemp)
trap 'rm -f $TMP_FILES' EXIT

if [[ -n "$EXPLICIT_PATH" ]]; then
  find "$EXPLICIT_PATH" -type f \( -name "*.tsx" -o -name "*.jsx" \) \
    -not -name "*.test.*" -not -name "*.spec.*" -not -name "*.stories.*" \
    -not -name "*.d.ts" 2>/dev/null > "$TMP_FILES" || true
elif [[ -f "$INVENTORY_PATH" ]]; then
  # Read real components from inventory JSON
  python3 -c "
import json
with open('$INVENTORY_PATH') as f:
    inv = json.load(f)
for c in inv.get('components', {}).get('real', []):
    print(c['file'])
" > "$TMP_FILES"
else
  # Fallback: single-app + monorepo layouts
  SCAN_FALLBACKS=()
  for p in src app/frontend; do
    [[ -d "$p" ]] && SCAN_FALLBACKS+=("$p")
  done
  for parent in packages apps; do
    if [[ -d "$parent" ]]; then
      while IFS= read -r d; do
        SCAN_FALLBACKS+=("$d")
      done < <(find "$parent" -maxdepth 3 -type d \( -name src -o -name app \) 2>/dev/null | head -20)
    fi
  done
  for p in "${SCAN_FALLBACKS[@]}"; do
    find "$p" -type f \( -name "*.tsx" -o -name "*.jsx" \) \
      -not -name "*.test.*" -not -name "*.spec.*" -not -name "*.stories.*" \
      -not -name "*.d.ts" 2>/dev/null >> "$TMP_FILES" || true
  done
fi

FILE_COUNT=$(wc -l < "$TMP_FILES" | tr -d ' ')
if [[ $FILE_COUNT -eq 0 ]]; then
  echo "ERROR: no component files. Run inventory-project.sh first, or pass a scan path." >&2
  exit 1
fi

# ─── Detect state branches per file ──────────────────────────────────────────
TMP_RESULTS=$(mktemp)
trap 'rm -f $TMP_FILES $TMP_RESULTS' EXIT

while IFS= read -r file; do
  [[ -f "$file" ]] || continue

  states=""

  # Loading
  if grep -qE "\b(isLoading|loading|isPending|pending|isFetching)\b" "$file" 2>/dev/null; then
    states="${states}loading,"
  fi

  # Error — require error reference on a non-comment line. The previous
  # implementation file-wide suppressed `error` whenever ANY comment in the file
  # mentioned the word; `if (error) return <ErrorState/>` silently went undetected.
  if grep -E "\b(isError|hasError|error|failed)\b" "$file" 2>/dev/null \
     | grep -vE "^\s*(//|/\*|\*)" \
     | grep -q .; then
    states="${states}error,"
  fi

  # Empty — generic: any `.length === 0`, `?.length === 0`, isEmpty, <Empty…>, noResults/noData/noItems
  if grep -qE "(\.length\s*===?\s*0|\?\.length\s*===?\s*0|isEmpty|noResults|noData|noItems|<Empty)" "$file" 2>/dev/null; then
    states="${states}empty,"
  fi

  # Disabled
  if grep -qE "\b(disabled|isDisabled|aria-disabled)\b" "$file" 2>/dev/null; then
    states="${states}disabled,"
  fi

  # Open/closed (overlay) — require BOTH an open-state reference AND an actual
  # overlay JSX render (`<Dialog ...>` etc.) in this file, not just an import.
  # The narrower check excludes overlay-importer files that don't render.
  if grep -qE "\b(isOpen|open[[:space:]]*[:=])" "$file" 2>/dev/null \
     && grep -qE "<(Dialog|Modal|Sheet|Drawer|Popover|AlertDialog)([[:space:]]|>|$)" "$file" 2>/dev/null; then
    states="${states}open,"
  fi

  # Success — grep -E lacks negative lookahead, so we exclude false-positive identifiers
  # (successUrl, successMessage etc.) by requiring success at word boundary not followed by alpha.
  if grep -qE "\b(isSuccess|submitted|isSubmitted)\b" "$file" 2>/dev/null \
     || grep -qE "\bsuccess[^a-zA-Z_]" "$file" 2>/dev/null; then
    states="${states}success,"
  fi

  # Skeleton / loader child component
  if grep -qE "<(Skeleton|Loader|Spinner|Shimmer)\b" "$file" 2>/dev/null; then
    states="${states}skeleton,"
  fi

  # Variant (size/color/intent)
  if grep -qE "\b(variant|intent|size|color)\s*[:=]" "$file" 2>/dev/null; then
    states="${states}variants,"
  fi

  # Strip trailing comma
  states="${states%,}"

  # Always at least "default"
  if [[ -z "$states" ]]; then
    states="default"
  else
    states="default,$states"
  fi

  echo -e "${file}\t${states}" >> "$TMP_RESULTS"
done < "$TMP_FILES"

# ─── Write JSON ──────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_PATH")"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$OUT_PATH" "$NOW" "$TMP_RESULTS" <<'PYEOF'
import json, sys, os, tempfile
out, now, results = sys.argv[1:]

components = {}
total_states = 0
multistate_count = 0
state_freq = {}

with open(results) as f:
    for line in f:
        line = line.rstrip()
        if not line or '\t' not in line: continue
        file, states_str = line.split('\t', 1)
        states = states_str.split(',') if states_str else ['default']
        components[file] = {
            "states": states,
            "minimumStories": len(states),
            # Tier hint: only "default" → probably leaf/primitive (1 story).
            # 2-3 states → standard interactive primitive.
            # 4+ states → page or container, needs full coverage.
            "tier": (
                "primitive" if len(states) <= 2
                else "composite" if len(states) <= 4
                else "container"
            ),
        }
        total_states += len(states)
        if len(states) >= 3:
            multistate_count += 1
        for s in states:
            state_freq[s] = state_freq.get(s, 0) + 1

# Components most likely to need rich coverage (container + many states)
priority_targets = sorted(
    [(f, d) for f, d in components.items() if d["minimumStories"] >= 4],
    key=lambda x: -x[1]["minimumStories"]
)[:20]

out_obj = {
    "generatedAt": now,
    "componentCount": len(components),
    "totalRecommendedStories": total_states,
    "multistateComponentCount": multistate_count,
    "stateFrequency": dict(sorted(state_freq.items(), key=lambda x: -x[1])),
    "priorityTargets": [
        {"file": f, "states": d["states"], "minimumStories": d["minimumStories"]}
        for f, d in priority_targets
    ],
    "components": components,
}

# Atomic write (temp → os.replace): an interrupted run never leaves half-written JSON.
_fd, _tmp = tempfile.mkstemp(dir=os.path.dirname(out) or '.', suffix='.tmp')
with os.fdopen(_fd, "w") as f:
    json.dump(out_obj, f, indent=2)
os.replace(_tmp, out)

print(f"✓ Wrote {out}")
print(f"  {len(components)} components scanned")
print(f"  {total_states} total recommended stories ({total_states / max(len(components), 1):.1f} per component avg)")
print(f"  {multistate_count} components with ≥3 distinct states (priority targets)")
PYEOF

# ─── Human summary ───────────────────────────────────────────────────────────
echo ""
echo "━━ Component state inventory ━━"
echo "  Top state branches across the codebase:"
python3 -c "
import json
with open('$OUT_PATH') as f:
    d = json.load(f)
for k, v in list(d['stateFrequency'].items())[:8]:
    print(f'    {k:14s} {v}')
"
echo ""
exit 0
