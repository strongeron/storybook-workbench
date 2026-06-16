#!/usr/bin/env bash
# prune-to-ledger.sh — move a chosen/archived Explore story from code (L2) to
# the markdown ledger (L3).
#
# Reads parameters.decision metadata from the story file, appends a row to
# .storybook/audit/decisions.md (creating it from template if missing), and
# prepares the git rm command (use --execute to actually delete).
#
# Idempotent — if the file's decision id is already in the ledger, refuses
# to add a duplicate row.
#
# Usage:
#   prune-to-ledger.sh <story-path>                       # dry-run by default
#   prune-to-ledger.sh <story-path> --execute             # also git rm the file
#   prune-to-ledger.sh <story-path> --ledger <path>       # custom ledger path
#   prune-to-ledger.sh <story-path> --pr <number>         # attach PR number
#
# Exit codes:
#   0  pruning prepared (and executed if --execute)
#   1  refused — duplicate or missing metadata
#   2  bad invocation

set -uo pipefail

STORY_PATH=""
LEDGER_PATH=".storybook/audit/decisions.md"
EXECUTE=false
PR_NUMBER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)   EXECUTE=true; shift ;;
    --ledger)    LEDGER_PATH="$2"; shift 2 ;;
    --pr)        PR_NUMBER="$2"; shift 2 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           STORY_PATH="$1"; shift ;;
  esac
done

if [[ -z "$STORY_PATH" ]] || [[ ! -f "$STORY_PATH" ]]; then
  echo "ERROR: pass a story file path. Got: $STORY_PATH" >&2
  exit 2
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; CYAN=""; DIM=""; BOLD=""; RESET=""; fi

# ---- extract decision metadata from the story file ----

# Scope to the meta block — between `const meta` and `export default meta`
META_BLOCK=$(awk '/^const meta/,/^export default meta/' "$STORY_PATH")

extract() {
  local key="$1"
  echo "$META_BLOCK" | grep -oE "${key}:[[:space:]]*['\"][^'\"]+['\"]" | head -1 \
    | sed -E "s/^${key}:[[:space:]]*['\"]//; s/['\"]\$//"
}

# Look inside parameters.decision = { ... } block
DECISION_BLOCK=$(echo "$META_BLOCK" | awk '/decision:[[:space:]]*\{/,/}/' | head -30)

extract_decision() {
  local key="$1"
  echo "$DECISION_BLOCK" | grep -oE "${key}:[[:space:]]*['\"][^'\"]+['\"]" | head -1 \
    | sed -E "s/^${key}:[[:space:]]*['\"]//; s/['\"]\$//"
}

DECISION_ID=$(extract_decision "id")
DECISION_WINNER=$(extract_decision "winner")
DECISION_DATE=$(extract_decision "date")
DECISION_RATIONALE=$(extract_decision "rationale")
DECISION_SHIPPED=$(extract_decision "shippedTo")
STORY_TITLE=$(extract "title")

# Fallback: if id is missing, derive from title
if [[ -z "$DECISION_ID" ]] && [[ -n "$STORY_TITLE" ]]; then
  DECISION_ID=$(echo "$STORY_TITLE" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed -E 's/-+/-/g; s/^-//; s/-\$//')
fi

# Fallback: date from git log if not in metadata
if [[ -z "$DECISION_DATE" ]] && command -v git >/dev/null 2>&1; then
  DECISION_DATE=$(git log -1 --format="%cs" -- "$STORY_PATH" 2>/dev/null || echo "")
fi

# Git ref for the last commit touching the file (will be the prune commit's parent)
GIT_REF=""
if command -v git >/dev/null 2>&1; then
  GIT_REF=$(git log -1 --format="%h" -- "$STORY_PATH" 2>/dev/null || echo "")
fi

# ---- validate ----
if [[ -z "$DECISION_ID" ]]; then
  echo "${RED}ERROR:${RESET} could not extract decision id or title from $STORY_PATH" >&2
  echo "${DIM}Add parameters.decision = { id: '...', ... } to the story before pruning.${RESET}" >&2
  exit 1
fi

if [[ -z "$DECISION_DATE" ]]; then
  DECISION_DATE="(unknown)"
fi
[[ -z "$DECISION_WINNER" ]] && DECISION_WINNER="—"
[[ -z "$DECISION_RATIONALE" ]] && DECISION_RATIONALE="(no rationale recorded)"
[[ -z "$DECISION_SHIPPED" ]] && DECISION_SHIPPED="—"
[[ -z "$PR_NUMBER" ]] && PR_DISPLAY="—" || PR_DISPLAY="#${PR_NUMBER}"
[[ -z "$GIT_REF" ]] && GIT_REF="—"

# ---- ensure ledger exists ----
LEDGER_DIR=$(dirname "$LEDGER_PATH")
mkdir -p "$LEDGER_DIR"
if [[ ! -f "$LEDGER_PATH" ]]; then
  cat > "$LEDGER_PATH" <<'EOF'
# Design decisions ledger

History of pruned Storybook experiments. For active experiments, open
Storybook's `Decisions/Dashboard` story.

## How to read this

| Column     | What it tells you                                                                       |
|------------|-----------------------------------------------------------------------------------------|
| Date       | When the decision was made (YYYY-MM-DD)                                                 |
| Decision   | One-line description matching `parameters.decision.id`                                   |
| Winner     | The winning variant label (or `—` if rejected)                                          |
| Rationale  | One-line "why" from `parameters.decision.rationale`                                      |
| Shipped to | Storybook title of the production version (or `—` if rejected)                          |
| PR         | GitHub PR number for the Ship (link prefix in this file's header)                        |
| Git ref    | Commit SHA where the experiment story still exists in history                            |

## To recover a pruned experiment

```bash
git show <git-ref>:src/explore/<topic>/<file>.stories.tsx
```

## Decisions (newest first)

| Date | Decision | Winner | Rationale | Shipped to | PR | Git ref |
|------|----------|--------|-----------|------------|----|---------|
EOF
  echo "${GREEN}✓ Created${RESET} ${LEDGER_PATH}"
fi

# ---- duplicate check ----
if grep -qE "^\|[^|]*\|[[:space:]]*${DECISION_ID}[[:space:]]*\|" "$LEDGER_PATH"; then
  echo "${YELLOW}↳ Skipping:${RESET} decision id '${DECISION_ID}' already present in ${LEDGER_PATH}"
  exit 1
fi

# ---- build the ledger row ----
ROW="| ${DECISION_DATE} | ${DECISION_ID} | ${DECISION_WINNER} | ${DECISION_RATIONALE} | ${DECISION_SHIPPED} | ${PR_DISPLAY} | ${GIT_REF} |"

# ---- print preview ----
echo "${BOLD}━━ prune-to-ledger ━━${RESET}"
echo
echo "Story:       ${CYAN}${STORY_PATH}${RESET}"
echo "Title:       ${STORY_TITLE:-(none)}"
echo "Decision id: ${DECISION_ID}"
echo "Date:        ${DECISION_DATE}"
echo "Winner:      ${DECISION_WINNER}"
echo "Rationale:   ${DECISION_RATIONALE}"
echo "Shipped to:  ${DECISION_SHIPPED}"
echo "PR:          ${PR_DISPLAY}"
echo "Git ref:     ${GIT_REF}"
echo
echo "${BOLD}Will add to${RESET} ${LEDGER_PATH}${BOLD}:${RESET}"
echo "  ${GREEN}${ROW}${RESET}"
echo

if ! $EXECUTE; then
  echo "${YELLOW}DRY-RUN.${RESET} Pass ${BOLD}--execute${RESET} to:"
  echo "  1. Append the row above to ${LEDGER_PATH}"
  echo "  2. ${RED}git rm ${STORY_PATH}${RESET}"
  echo
  echo "${DIM}Or do it manually:${RESET}"
  echo "  echo '${ROW}' >> ${LEDGER_PATH}"
  echo "  git rm ${STORY_PATH}"
  echo "  git add ${LEDGER_PATH}"
  echo "  git commit -m 'design: prune ${DECISION_ID} to ledger'"
  exit 0
fi

# ---- execute ----
echo "${ROW}" >> "$LEDGER_PATH"
echo "${GREEN}✓ Appended row to${RESET} ${LEDGER_PATH}"

if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  git rm "$STORY_PATH"
  echo "${GREEN}✓ git rm${RESET} ${STORY_PATH}"
  echo
  echo "${DIM}Next: review and commit:${RESET}"
  echo "  git add ${LEDGER_PATH}"
  echo "  git commit -m 'design: prune ${DECISION_ID} to ledger'"
else
  rm -f "$STORY_PATH"
  echo "${GREEN}✓ Removed${RESET} ${STORY_PATH}  ${DIM}(no git — used rm directly)${RESET}"
fi

exit 0
