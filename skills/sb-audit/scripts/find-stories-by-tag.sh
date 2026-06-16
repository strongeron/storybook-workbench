#!/usr/bin/env bash
# find-stories-by-tag.sh — list stories carrying a given tag.
#
# Two main use cases:
#   1. Gallery prep — find every story tagged 'empty-state' to scaffold a TagGallery
#   2. Deprecation audit — find every story tagged 'deprecated' to plan cleanup
#
# Also: lifecycle audits (`v2-preview`, `experimental`, `ai-generated`,
# `needs-design-review`) and arbitrary user-defined tags.
#
# Usage:
#   find-stories-by-tag.sh empty-state
#   find-stories-by-tag.sh deprecated --count        # just print count
#   find-stories-by-tag.sh ai-generated --files-only # print unique filenames
#
# Exit codes:
#   0  scan completed (zero matches is still PASS)
#   2  bad invocation

set -uo pipefail

TAG=""
COUNT_ONLY=false
FILES_ONLY=false
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT_ONLY=true; shift ;;
    --files-only) FILES_ONLY=true; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *)
      if [[ -z "$TAG" ]]; then TAG="$1"
      else SCAN_PATHS+=("$1")
      fi
      shift
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "ERROR: pass a tag to search for. e.g. find-stories-by-tag.sh empty-state" >&2
  exit 2
fi

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

# Match `tags: [..., '<tag>', ...]` or `"<tag>"` inside a tags array
# Tolerate single + double quotes, optional ! prefix, surrounding whitespace
PATTERN="tags:\s*\[[^]]*['\"]${TAG}['\"]"

matches=()
for path in "${SCAN_PATHS[@]}"; do
  if [[ -d "$path" ]]; then
    while IFS= read -r line; do
      matches+=("$line")
    done < <(grep -rnE "$PATTERN" "$path" --include="*.stories.ts" --include="*.stories.tsx" 2>/dev/null || true)
  fi
done

count=${#matches[@]}

if $COUNT_ONLY; then
  echo "$count"
  exit 0
fi

if [[ $count -eq 0 ]]; then
  echo "${DIM}No stories found with tag '${TAG}' under: ${SCAN_PATHS[*]}${RESET}"
  exit 0
fi

if $FILES_ONLY; then
  # Unique files only
  printf '%s\n' "${matches[@]}" | cut -d: -f1 | sort -u
  exit 0
fi

# Default — pretty list with file:line
echo "${YELLOW}━━━ ${count} stories with tag '${TAG}' ━━━${RESET}"
for m in "${matches[@]}"; do
  file=$(echo "$m" | cut -d: -f1)
  lineno=$(echo "$m" | cut -d: -f2)
  echo "  ${GREEN}${file}${RESET}:${lineno}"
done

# Hint at next step based on tag
case "$TAG" in
  empty-state|loading|error|success|*-state)
    echo
    echo "${DIM}↳ Gallery candidate: scaffold src/stories/galleries/${TAG}Gallery.stories.tsx with <TagGallery tag=\"$TAG\" />${RESET}"
    ;;
  deprecated)
    echo
    echo "${DIM}↳ Cleanup audit: confirm each story has a removal date in parameters.docs.description.component${RESET}"
    ;;
  experimental|v2-preview)
    echo
    echo "${DIM}↳ Lifecycle audit: check if any of these should graduate (Labs gate criteria — see references/labs-workflow.md)${RESET}"
    ;;
  ai-generated)
    echo
    echo "${DIM}↳ Review queue: these stories need human visual sign-off before tag is removed${RESET}"
    ;;
esac

exit 0
