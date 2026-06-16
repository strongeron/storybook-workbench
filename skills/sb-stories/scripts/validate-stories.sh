#!/usr/bin/env bash
# validate-stories.sh — per-story conformance check for storybook-workbench
#
# Runs 13 deterministic checks on each story file + a project-level CssCheck
# tally (multi-file scans only). Returns PASS/FAIL per check,
# exits non-zero if any check failed. For judgment-needed checks, see the
# sub-agent prompt in references/validate-workflow.md.
#
# Usage:
#   validate-stories.sh <file>
#   validate-stories.sh 'src/**/*.stories.tsx'    # quote globs
#   validate-stories.sh --diff                    # stage+unstaged changed stories
#   validate-stories.sh --strict <file>           # also runs tsc/eslint/vitest
#
# Exit codes:
#   0  all checks passed
#   1  one or more files had failures
#   2  bad invocation / nothing to check

set -uo pipefail

STRICT=false
USE_DIFF=false
TARGETS=()

# ---- args ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=true; shift ;;
    --diff)   USE_DIFF=true; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done

# ---- resolve targets ----
if $USE_DIFF; then
  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: --diff requires git in PATH" >&2
    exit 2
  fi
  # staged + unstaged changes matching story pattern
  mapfile -t TARGETS < <(
    { git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null; } \
      | sort -u | grep -E '\.stories\.(ts|tsx)$' || true
  )
  if [[ ${#TARGETS[@]} -eq 0 ]]; then
    echo "No changed *.stories.* files found via git diff."
    exit 0
  fi
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "ERROR: no targets. Pass a file, a quoted glob, or --diff." >&2
  exit 2
fi

# expand targets: a directory → all stories under it (find, robust); a glob
# string → bash globstar; a plain file → itself. The directory case is the most
# reliable way to lint "everything under src/stories" — `**` glob behavior varies
# by shell (a Codex run found `src/stories/**/*.stories.tsx` matched only nested
# dirs), so prefer passing a directory or --diff.
EXPANDED=()
for t in "${TARGETS[@]}"; do
  if [[ -d "$t" ]]; then
    while IFS= read -r m; do EXPANDED+=("$m"); done \
      < <(find "$t" -type f \( -name '*.stories.tsx' -o -name '*.stories.jsx' -o -name '*.stories.ts' \) 2>/dev/null)
    continue
  fi
  # shellcheck disable=SC2206  # we *want* word-splitting here for glob expansion
  matches=( $t )
  if [[ ${#matches[@]} -eq 1 && ! -e "${matches[0]}" ]]; then
    # treat as bash glob (globstar so ** spans nested dirs)
    shopt -s globstar nullglob
    matches=( $t )
    shopt -u globstar nullglob
  fi
  for m in "${matches[@]}"; do
    [[ -f "$m" ]] && EXPANDED+=("$m")
  done
done

if [[ ${#EXPANDED[@]} -eq 0 ]]; then
  echo "ERROR: no files matched after glob expansion." >&2
  exit 2
fi

# ---- helpers ----

# Look for project's preview.ts/.tsx to read storySort.order (Group D)
find_preview() {
  for cand in .storybook/preview.tsx .storybook/preview.ts .storybook/preview.js .storybook/preview.jsx; do
    [[ -f "$cand" ]] && { echo "$cand"; return; }
  done
}
PREVIEW_FILE=$(find_preview || true)

# Parse storySort.order roots ("Foundations", "Components", "Pages", ...)
STORY_SORT_ROOTS=""
# v1.7 — accept Explore alongside Labs (and other established WIP prefixes)
# for backward compat with established projects.
LABS_PREFIXES="Labs|Explore|Sandbox|Playground|Experiments"
if [[ -n "${PREVIEW_FILE:-}" ]]; then
  # crude extraction — grabs strings inside `order: [...]`
  if grep -qE 'storySort' "$PREVIEW_FILE" 2>/dev/null; then
    STORY_SORT_ROOTS=$(
      awk '/storySort/,/^[[:space:]]*\}/' "$PREVIEW_FILE" \
        | grep -oE "['\"][A-Za-z][A-Za-z _/0-9-]*['\"]" \
        | tr -d "'\"" \
        | awk -F/ '{print $1}' \
        | sort -u | tr '\n' '|' | sed 's/|$//'
    )
  fi
fi

# Output helpers
GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; RED=""; YELLOW=""; DIM=""; RESET=""; fi

pass() { echo "  ${GREEN}[PASS]${RESET} $1 — $2"; }
fail() { echo "  ${RED}[FAIL]${RESET} $1 — $2"; FAILED=$((FAILED + 1)); }
skip() { echo "  ${YELLOW}[SKIP]${RESET} $1 — $2"; }
# warn() surfaces a preferred-but-not-required issue WITHOUT failing the gate.
# (e.g. check 03: a real-codebase scan found 88% of shipping stories use the
# `Meta<…>` annotation — valid CSF3 — so `satisfies` is a nudge, not a blocker.)
warn() { echo "  ${YELLOW}[WARN]${RESET} $1 — $2"; }

# ---- check functions ----

check_01_import_react_vite() {
  if grep -E "^import .* from ['\"]@storybook/react['\"]" "$1" | grep -v "react-vite" >/dev/null 2>&1; then
    fail "01" "imports '@storybook/react' (must be '@storybook/react-vite')"
  else
    pass "01" "no bare '@storybook/react' import (react-vite or none)"
  fi
}

check_02_storybook_test() {
  if grep -E "from ['\"]@storybook/test['\"]" "$1" >/dev/null 2>&1; then
    fail "02" "imports '@storybook/test' (must be 'storybook/test')"
  else
    pass "02" "no '@storybook/test' import (storybook/test or none)"
  fi
}

check_03_satisfies() {
  if grep -qE "^const meta\s*:\s*Meta<" "$1"; then
    line=$(grep -nE "^const meta\s*:\s*Meta<" "$1" | head -1 | cut -d: -f1)
    # WARN, not FAIL: the annotation form is valid CSF3 (~88% of real shipping
    # stories use it). `satisfies Meta<typeof X>` is preferred for per-story arg
    # inference, but this is a nudge, not a gate-blocking error.
    warn "03" "uses 'const meta: Meta<...> =' annotation — prefer 'satisfies Meta<typeof X>' for arg inference (line $line)"
  else
    pass "03" "satisfies pattern"
  fi
}

check_04_useargs_source() {
  if grep -qE "\buseArgs\b" "$1"; then
    if grep -qE "from ['\"]storybook/preview-api['\"]" "$1"; then
      pass "04" "useArgs source"
    else
      fail "04" "useArgs imported from wrong source (must be 'storybook/preview-api')"
    fi
  else
    skip "04" "no useArgs in file"
  fi
}

check_05_no_csf2() {
  if grep -qE "storiesOf\(|\.story\s*=\s*\{" "$1"; then
    fail "05" "found CSF2 syntax (storiesOf or .story = {})"
  else
    pass "05" "no CSF2"
  fi
}

check_06_no_dead_sb10_imports() {
  if grep -qE "from ['\"](@storybook/addon-essentials|@storybook/blocks)['\"]" "$1"; then
    fail "06" "imports dead SB10 module (addon-essentials or blocks)"
  else
    pass "06" "no dead SB10 imports"
  fi
}

check_07_no_inline_hex_in_render() {
  # crude: any 3/6/8 hex literal anywhere in the file outside of comments
  # (we accept hex in `parameters.design.url` etc., so we narrow to render: blocks)
  # heuristic: hex literal after `render` keyword within 2000 chars
  if awk '/render\s*:/{flag=1} flag && /#[0-9a-fA-F]{3,8}\b/{print; exit 1}' "$1" >/dev/null 2>&1; then
    pass "07" "no inline hex in render blocks"
  else
    fail "07" "inline hex literal in render block — extract to design tokens or args"
  fi
}

check_08_disabled_not_in_pseudo() {
  if grep -qE "pseudo:\s*\{[^}]*disabled" "$1"; then
    fail "08" "'disabled' inside parameters.pseudo (disabled is a prop, not a CSS pseudo-class)"
  else
    pass "08" "disabled not in pseudo"
  fi
}

check_09_layout_set() {
  if grep -qE "layout:\s*['\"](centered|fullscreen|padded)['\"]" "$1"; then
    pass "09" "parameters.layout set"
  else
    fail "09" "parameters.layout missing (centered | fullscreen | padded)"
  fi
}

check_10_fn_for_callbacks() {
  # if file references any on[A-Z] prop, expect fn() somewhere in args
  if grep -qE "\bon[A-Z][A-Za-z]+\b" "$1"; then
    if grep -qE "\bfn\(\)" "$1"; then
      pass "10" "fn() used for callback args"
    else
      fail "10" "callback prop present but no fn() in args (or play asserts)"
    fi
  else
    skip "10" "no callback props in file"
  fi
}

check_11_title_sort_match() {
  if [[ -z "$STORY_SORT_ROOTS" ]]; then
    skip "11" "no storySort.order declared in preview"
    return
  fi
  # Scope to the first `const meta` block so we don't match `title` inside mock data
  title_root=$(awk '/^const meta/,/^export default meta/' "$1" \
    | grep -oE "title:[[:space:]]*['\"][^'\"]+['\"]" | head -1 \
    | sed -E "s/^title:[[:space:]]*['\"]//; s/['\"]$//; s|/.*||")
  if [[ -z "$title_root" ]]; then
    skip "11" "no title in meta (component-only file?)"
    return
  fi
  if echo "$title_root" | grep -qE "^($STORY_SORT_ROOTS)$"; then
    pass "11" "title prefix '$title_root' matches storySort"
  else
    fail "11" "title prefix '$title_root' not in storySort roots ($STORY_SORT_ROOTS)"
  fi
}

check_12_labs_tag_combo() {
  # Scope to the first `const meta` block so we don't match `title` inside mock data
  title_root=$(awk '/^const meta/,/^export default meta/' "$1" \
    | grep -oE "title:[[:space:]]*['\"][^'\"]+['\"]" | head -1 \
    | sed -E "s/^title:[[:space:]]*['\"]//; s/['\"]$//; s|/.*||")
  if echo "$title_root" | grep -qE "^($LABS_PREFIXES)$"; then
    if grep -qE "['\"]!autodocs['\"]" "$1" && grep -qE "['\"]!test['\"]" "$1"; then
      pass "12" "Labs story has !autodocs + !test"
    else
      fail "12" "Labs story missing !autodocs or !test tag"
    fi
  else
    skip "12" "not a Labs story"
  fi
}

# check 13 — `play` must earn its place (ai-setup Step 6). A play whose only
# assertion is toBeVisible/toBeInTheDocument, with no interaction, async query,
# portal, or computed-style probe, proves nothing the render didn't already.
check_13_play_earns_its_place() {
  if grep -qE "\bplay\s*:" "$1"; then
    # Signals that a play asserts something non-trivial:
    if grep -qE "userEvent|fireEvent|\.click\(|\.type\(|\.keyboard\(|findBy|waitFor|toHaveValue|aria-pressed|aria-expanded|getComputedStyle|toContain\(|ownerDocument|toHaveBeenCalled" "$1"; then
      pass "13" "play asserts an interaction / async / portal / CSS state"
    elif grep -qE "toBeVisible\(|toBeInTheDocument\(" "$1"; then
      warn "13" "play looks no-op (only toBeVisible/toBeInTheDocument) — drop it, or make it prove an interaction/async/portal/CSS state (ai-setup Step 6)"
    else
      pass "13" "play present (non-trivial body)"
    fi
  else
    skip "13" "no play function"
  fi
}

# ---- strict mode extras ----
run_strict() {
  local file=$1
  echo "  ${DIM}strict mode:${RESET}"
  if command -v npx >/dev/null 2>&1; then
    if [[ -f tsconfig.json ]]; then
      echo "  ${DIM}  tsc --noEmit (workspace)${RESET}"
      npx --no -- tsc --noEmit 2>&1 | grep "$(basename "$file")" || echo "  ${DIM}    (no tsc errors for this file)${RESET}"
    fi
    if compgen -G '.eslintrc.*' >/dev/null 2>&1 || compgen -G 'eslint.config.*' >/dev/null 2>&1; then
      echo "  ${DIM}  eslint${RESET}"
      npx --no -- eslint "$file" 2>&1 | tail -20 || true
    fi
  fi
}

# ---- main loop ----
TOTAL_FILES=0
FAILED_FILES=0
FAILED=0
GRAND_TOTAL_FAILS=0
CSSCHECK_COUNT=0   # project-level: stories asserting getComputedStyle (ai-setup Step 5)

for file in "${EXPANDED[@]}"; do
  TOTAL_FILES=$((TOTAL_FILES + 1))
  FAILED=0
  echo
  echo "${file}"
  if grep -qE "getComputedStyle" "$file" 2>/dev/null; then
    CSSCHECK_COUNT=$((CSSCHECK_COUNT + 1))
  fi

  check_01_import_react_vite "$file"
  check_02_storybook_test "$file"
  check_03_satisfies "$file"
  check_04_useargs_source "$file"
  check_05_no_csf2 "$file"
  check_06_no_dead_sb10_imports "$file"
  check_07_no_inline_hex_in_render "$file"
  check_08_disabled_not_in_pseudo "$file"
  check_09_layout_set "$file"
  check_10_fn_for_callbacks "$file"
  check_11_title_sort_match "$file"
  check_12_labs_tag_combo "$file"
  check_13_play_earns_its_place "$file"

  if $STRICT; then
    run_strict "$file"
  fi

  if [[ $FAILED -gt 0 ]]; then
    echo "  ${RED}→ $FAILED check(s) failed${RESET}"
    FAILED_FILES=$((FAILED_FILES + 1))
    GRAND_TOTAL_FAILS=$((GRAND_TOTAL_FAILS + FAILED))
  else
    echo "  ${GREEN}→ all checks passed${RESET}"
  fi
done

# ---- project-level CssCheck tally (ai-setup Step 5: exactly ONE getComputedStyle
# proof story per project). Only meaningful over a whole-project / multi-file scan,
# so stay silent on a single-file invocation (it would false-warn on every file). ----
if [[ $TOTAL_FILES -gt 1 ]]; then
  echo
  if [[ $CSSCHECK_COUNT -eq 0 ]]; then
    echo "  ${YELLOW}[WARN]${RESET} project — no getComputedStyle 'CssCheck' story found; add exactly ONE asserting a real computed token value, to prove the shared preview loaded the app CSS (ai-setup Step 5)"
  elif [[ $CSSCHECK_COUNT -gt 1 ]]; then
    echo "  ${YELLOW}[WARN]${RESET} project — ${CSSCHECK_COUNT} getComputedStyle stories; ai-setup wants exactly ONE CssCheck (variant-only stories should rely on the render, not re-probe CSS)"
  else
    echo "  ${GREEN}[PASS]${RESET} project — exactly one CssCheck (getComputedStyle proof) present"
  fi
fi

# ---- summary ----
echo
echo "═══════════════════════════════════════════════════"
if [[ $FAILED_FILES -eq 0 ]]; then
  echo "  ${GREEN}${TOTAL_FILES} file(s) scanned — all PASS${RESET}"
  exit 0
else
  echo "  ${RED}${FAILED_FILES} of ${TOTAL_FILES} file(s) failed (${GRAND_TOTAL_FAILS} total check failures)${RESET}"
  exit 1
fi
