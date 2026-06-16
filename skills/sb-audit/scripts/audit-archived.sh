#!/usr/bin/env bash
# audit-archived.sh — list chosen/archived stories sorted by age + flag when
# the archive is getting heavy.
#
# Implements the L2 → L3 surveillance for the layered preservation model
# (see references/propagate-workflow.md). Catches:
#   - L1 stories with decision:chosen that are >90 days old → suggest adding 'archived' tag
#   - L2 archived stories >12 months old → suggest pruning to L3 ledger
#   - Threshold warning when archived count exceeds --threshold (default 20)
#
# Usage:
#   audit-archived.sh                                # default: --older-than 12m, --threshold 20
#   audit-archived.sh --older-than 6m                # tighter horizon
#   audit-archived.sh --threshold 10                 # warn earlier
#   audit-archived.sh --ledger .storybook/audit/decisions.md  # show ledger count too
#   audit-archived.sh --list-only                    # just list, no recommendations
#
# Exit codes:
#   0  scan completed (may still report heavy)
#   2  bad invocation

set -uo pipefail

OLDER_THAN="12m"          # parsed below
THRESHOLD=20
LEDGER_PATH=".storybook/audit/decisions.md"
LIST_ONLY=false
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --older-than) OLDER_THAN="$2"; shift 2 ;;
    --threshold)  THRESHOLD="$2"; shift 2 ;;
    --ledger)     LEDGER_PATH="$2"; shift 2 ;;
    --list-only)  LIST_ONLY=true; shift ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *)            SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  for cand in src stories app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
  if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
    echo "ERROR: no default scan path found. Pass a path or run from project root." >&2
    exit 2
  fi
fi

# ---- parse --older-than into days ----
case "$OLDER_THAN" in
  *d) HORIZON_DAYS="${OLDER_THAN%d}" ;;
  *w) HORIZON_DAYS=$(( ${OLDER_THAN%w} * 7 )) ;;
  *m) HORIZON_DAYS=$(( ${OLDER_THAN%m} * 30 )) ;;
  *y) HORIZON_DAYS=$(( ${OLDER_THAN%y} * 365 )) ;;
  *)  HORIZON_DAYS=365 ;;
esac

# ---- colors ----
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; CYAN=""; DIM=""; BOLD=""; RESET=""; fi

# ---- helpers ----

# Compute days between two ISO dates. Portable across BSD/macOS (date -j) and
# GNU/Linux (date -d) so the same gate runs in local dev and in Linux CI.
days_since() {
  local iso="$1"
  if [[ -z "$iso" ]]; then echo "?"; return; fi
  local then_epoch=""
  if then_epoch=$(date -j -f "%Y-%m-%d" "$iso" +"%s" 2>/dev/null); then :        # BSD/macOS
  elif then_epoch=$(date -d "$iso" +"%s" 2>/dev/null); then :                     # GNU/Linux
  else echo "?"; return; fi
  local now_epoch; now_epoch=$(date +"%s")
  echo $(( (now_epoch - then_epoch) / 86400 ))
}

# Find stories tagged decision:chosen OR archived, extract date
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

for path in "${SCAN_PATHS[@]}"; do
  [[ ! -d "$path" ]] && continue
  while IFS= read -r file; do
    # Pull decision tag (pending | chosen | rejected)
    decision_tag=""
    grep -qE "tags:\s*\[[^]]*['\"]decision:pending['\"]" "$file" 2>/dev/null && decision_tag="pending"
    grep -qE "tags:\s*\[[^]]*['\"]decision:chosen['\"]" "$file" 2>/dev/null && decision_tag="chosen"
    grep -qE "tags:\s*\[[^]]*['\"]decision:rejected['\"]" "$file" 2>/dev/null && decision_tag="rejected"
    has_archived=false
    grep -qE "tags:\s*\[[^]]*['\"]archived['\"]" "$file" 2>/dev/null && has_archived=true

    # Skip files without any decision tag or archived tag
    if [[ -z "$decision_tag" ]] && ! $has_archived; then continue; fi

    # Extract date from parameters.decision.date (preferred) or from a parsable git log
    date_match=$(grep -oE "date:\s*['\"][0-9]{4}-[0-9]{2}-[0-9]{2}['\"]" "$file" 2>/dev/null | head -1)
    if [[ -n "$date_match" ]]; then
      story_date=$(echo "$date_match" | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}")
    else
      # Fall back to git log if available
      if command -v git >/dev/null 2>&1; then
        story_date=$(git log -1 --format="%cs" -- "$file" 2>/dev/null || echo "")
      else
        story_date=""
      fi
    fi

    age_days=$(days_since "$story_date")
    # Extract decision id if present
    id_match=$(grep -oE "id:\s*['\"][^'\"]+['\"]" "$file" 2>/dev/null | head -1 | sed -E "s/id:[[:space:]]*['\"]//; s/['\"]\$//")

    printf "%s|%s|%s|%s|%s|%s\n" "$age_days" "$file" "$decision_tag" "$has_archived" "$story_date" "$id_match" >> "$TMP"
  done < <(find "$path" -type f \( -name "*.stories.ts" -o -name "*.stories.tsx" \) 2>/dev/null)
done

# ---- categorize ----
total=$(wc -l < "$TMP" | tr -d ' ')

# Stories in L1 (decision:chosen but NOT archived) older than 90 days — should be tagged archived
should_archive=$(awk -F'|' -v cutoff=90 '$1 != "?" && $1+0 >= cutoff && $4 == "false" && $3 == "chosen" {print}' "$TMP")

# Stories in L2 (archived) older than $HORIZON_DAYS — candidates for L3 ledger
should_prune=$(awk -F'|' -v cutoff="$HORIZON_DAYS" '$1 != "?" && $1+0 >= cutoff && $4 == "true" {print}' "$TMP")

# Stories in L1 (decision:* without archived tag) — count for active layer
active_count=$(awk -F'|' '$4 == "false" && $3 != "" {n++} END {print n+0}' "$TMP")

# Stories in L2 (archived) — count for threshold warning
archived_count=$(awk -F'|' '$4 == "true" {n++} END {print n+0}' "$TMP")

# Ledger count
ledger_count=0
if [[ -f "$LEDGER_PATH" ]]; then
  # Count data rows (skip header + separator)
  ledger_count=$(grep -cE "^\| [0-9]{4}-[0-9]{2}-[0-9]{2}" "$LEDGER_PATH" 2>/dev/null)
fi

# ---- output ----
echo "${BOLD}━━ Archived stories audit ━━${RESET}"
echo "${DIM}Scan paths: ${SCAN_PATHS[*]}${RESET}"
echo "${DIM}Horizon: --older-than $OLDER_THAN (${HORIZON_DAYS} days) · --threshold $THRESHOLD${RESET}"
echo "${DIM}Ledger: $LEDGER_PATH${RESET}"
echo

echo "${BOLD}L1 (Active — recent chosen/pending):${RESET} stories tagged decision:* without 'archived'  ${CYAN}${active_count}${RESET}"
echo "${BOLD}L2 (Archive — in code, hidden):${RESET}     stories tagged 'archived'                       ${CYAN}${archived_count}${RESET}"
echo "${BOLD}L3 (Ledger — pruned to markdown):${RESET}    .storybook/audit/decisions.md                       ${CYAN}${ledger_count}${RESET}"
echo

# Show all chosen/archived sorted by age
if [[ $total -gt 0 ]]; then
  echo "${BOLD}All chosen/archived stories (oldest first):${RESET}"
  sort -t'|' -k1 -n -r "$TMP" | awk -F'|' -v G="$GREEN" -v Y="$YELLOW" -v R="$RED" -v D="$DIM" -v RESET="$RESET" '
    {
      age = $1; file = $2; tag = $3; archived = $4; date = $5; id = $6
      layer = (archived == "true") ? "L2" : "L1"
      color = G
      if (age != "?" && age+0 >= 365) color = R
      else if (age != "?" && age+0 >= 90) color = Y
      printf "  %s%-3s%s  %-50s  %s  %s%4s d%s  %s(%s)%s\n", color, layer, RESET, file, date, color, age, RESET, D, (id == "" ? tag : id), RESET
    }
  '
  echo
fi

if $LIST_ONLY; then exit 0; fi

# ---- recommendations ----
have_recs=false

if [[ -n "$should_archive" ]]; then
  have_recs=true
  echo "${YELLOW}⚠ Suggested L1 → L2 transitions (chosen >90 days old, missing 'archived' tag):${RESET}"
  echo "$should_archive" | awk -F'|' -v Y="$YELLOW" -v D="$DIM" -v RESET="$RESET" '
    { printf "  %s+%s tag %sarchived%s on %s%s%s  (%s%s days old%s)\n", Y, RESET, Y, RESET, $2, "", "", D, $1, RESET }
  '
  echo "${DIM}    Edit each file: tags: [...] → add 'archived'.${RESET}"
  echo
fi

if [[ -n "$should_prune" ]]; then
  have_recs=true
  echo "${RED}⚠ Suggested L2 → L3 prunes (archived >${OLDER_THAN} old):${RESET}"
  echo "$should_prune" | awk -F'|' -v R="$RED" -v D="$DIM" -v RESET="$RESET" '
    { printf "  %sprune%s  %-50s  (%s%s days old%s)\n", R, RESET, $2, D, $1, RESET }
  '
  echo "${DIM}    For each: scripts/prune-to-ledger.sh <file>${RESET}"
  echo
fi

# Heavy threshold warning
if [[ $archived_count -gt $THRESHOLD ]]; then
  have_recs=true
  echo "${RED}🚨 HEAVY:${RESET} ${BOLD}${archived_count}${RESET} L2 archived stories in code (threshold: ${THRESHOLD})."
  echo "${DIM}    Storybook sidebar is getting cluttered. Consider:${RESET}"
  echo "${DIM}    1. Prune the oldest entries to .storybook/audit/decisions.md (L3)${RESET}"
  echo "${DIM}    2. Or relax the threshold: --threshold $((archived_count + 10))${RESET}"
  echo
fi

if ! $have_recs; then
  echo "${GREEN}✓ Archive is healthy.${RESET} No L1→L2 or L2→L3 transitions suggested at current thresholds."
fi

exit 0
