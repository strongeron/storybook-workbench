#!/usr/bin/env bash
# audit-drift.sh — find naming drift across stories.
#
# Surfaces the "17 different empty-state names" problem: when multiple stories
# represent the same concept under inconsistent names, the catalog fragments.
# This script clusters story export names by lowercased keyword and reports
# clusters with 3+ variants — those are gallery candidates AND consolidation
# candidates.
#
# Usage:
#   audit-drift.sh                                # scan ./src and ./stories
#   audit-drift.sh path/to/stories                # scan a specific path
#   audit-drift.sh --threshold 5                  # only report clusters with 5+ variants
#   audit-drift.sh --keyword empty                # focus on one keyword
#
# Output:
#   For each drift cluster (3+ stories matching a keyword), one block:
#     keyword "empty" — 17 stories, 12 distinct names
#       Empty (5x)        src/...
#       EmptyState (4x)   src/...
#       ...
#
# Exit codes:
#   0  scan completed (may still report drift)
#   2  bad invocation

set -uo pipefail

THRESHOLD=3
KEYWORD=""
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --keyword) KEYWORD="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  for cand in src stories app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
  if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
    echo "ERROR: no default scan path found (looked for src/, stories/, app/frontend/). Pass a path." >&2
    exit 2
  fi
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; DIM=""; RESET=""; fi

# Collect all `export const <Name>: Story = ...` (or `: StoryObj =`) declarations
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

for path in "${SCAN_PATHS[@]}"; do
  if [[ -d "$path" ]]; then
    find "$path" -type f \( -name "*.stories.ts" -o -name "*.stories.tsx" \) -print0 \
      | xargs -0 grep -nE "^export const [A-Za-z_][A-Za-z0-9_]*\s*:\s*Story(Obj)?" 2>/dev/null
  fi
done | awk -F'[: ]' '{print}' > "$TMP"

# Each line: <path>:<linenum>:export const <Name>: Story...
# Extract Name + path/line
TOTAL=$(wc -l < "$TMP" | tr -d ' ')
echo "${DIM}Scanned $TOTAL story exports across: ${SCAN_PATHS[*]}${RESET}"
echo

# Common drift keywords — extend as patterns emerge
KEYWORDS=(empty loading error success default disabled hover focus selected open closed list grid card detail tablet mobile desktop)
[[ -n "$KEYWORD" ]] && KEYWORDS=("$KEYWORD")

REPORTED=0

for kw in "${KEYWORDS[@]}"; do
  # Case-insensitive match on export name
  matches=$(grep -iE "export const [A-Za-z_]*${kw}[A-Za-z_]*\s*:\s*Story" "$TMP" || true)
  count=$(echo -n "$matches" | grep -c . || true)
  [[ $count -lt $THRESHOLD ]] && continue

  # Pull just the name part for each match (BSD sed compatible — no \s)
  names=$(echo "$matches" | sed -E "s/^.*export const ([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*:[[:space:]]*Story.*/\1/")
  unique_count=$(echo "$names" | sort -u | wc -l | tr -d ' ')

  echo "${YELLOW}━━━ keyword \"$kw\" — $count stories, $unique_count distinct names${RESET}"
  # Capture the sorted-unique list to a file to avoid subshell scope issues
  echo "$names" | sort | uniq -c | sort -rn | head -10 > /tmp/audit-drift-cluster.$$
  while read -r n name; do
    [[ -z "$name" ]] && continue
    rep=$(echo "$matches" | grep -E "export const ${name}[[:space:]]*:[[:space:]]*Story" | head -1 | cut -d: -f1)
    printf "  ${GREEN}%-30s${RESET} ${DIM}%sx, e.g. %s${RESET}\n" "$name" "$n" "$rep"
  done < /tmp/audit-drift-cluster.$$
  rm -f /tmp/audit-drift-cluster.$$
  # macOS bash 3.2 lacks ${var^} — use tr for capitalization
  kw_cap=$(echo "$kw" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  echo "  ${DIM}↳ Gallery candidate: tag these with 'tags: [\"${kw}-state\"]' + scaffold src/stories/galleries/${kw_cap}StateGallery.stories.tsx${RESET}"
  echo
  REPORTED=$((REPORTED + 1))
done

if [[ $REPORTED -eq 0 ]]; then
  echo "${GREEN}No drift clusters at threshold $THRESHOLD across keywords (${KEYWORDS[*]}).${RESET}"
else
  echo "${DIM}$REPORTED drift cluster(s) reported. Threshold: $THRESHOLD. Use --threshold to adjust, --keyword to focus.${RESET}"
fi

echo "${DIM}done.${RESET}"
exit 0
