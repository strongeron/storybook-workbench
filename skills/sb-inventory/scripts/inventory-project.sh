#!/usr/bin/env bash
# inventory-project.sh — Setup-phase ground-truth discovery.
#
# The first script the agent runs when meeting a new project. Replaces trusting
# CLAUDE.md / AGENTS.md (those drift, lie, or don't exist). Writes a structured
# JSON the agent reads instead.
#
# What it discovers:
#   1. Design system source — which of 4 is dominant (tailwind-v4 / shadcn /
#      dtcg / css-vars). Returns single recommendation + flags mixed setups.
#   2. Real components — exports under src/components/ imported FROM OUTSIDE
#      src/components/ and src/stories/ (i.e., actually used in app code).
#   3. Dead components — defined but never imported outside their own dir or
#      stories. Likely AI slop.
#   4. Token usage map — which declared --foo tokens are referenced in
#      production code vs orphaned.
#   5. Orphan stories — stories importing components that no longer exist or
#      have been deleted from src/components/.
#   6. Library detection — framework (React + Vite), CSS framework (Tailwind v3
#      vs v4 vs none), UI lib (shadcn / Radix / Base UI / none), router,
#      query client.
#
# Output: writes .storybook/project-inventory.json + prints human summary.
#
# Usage:
#   inventory-project.sh                     # scan ./src and ./app/frontend
#   inventory-project.sh path/to/src         # custom scan path
#   inventory-project.sh --quick             # skip dead-code analysis (faster)
#   inventory-project.sh --chain             # also run validate-design-system.sh + audit-drift.sh
#   inventory-project.sh --out custom.json   # custom output path
#
# Exit codes:
#   0   inventory written
#   1   significant slop detected (>10 dead components OR mixed DS sources)
#   2   bad invocation

set -uo pipefail

QUICK=false
CHAIN=false
OUT_PATH=".storybook/project-inventory.json"
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=true; shift ;;
    --chain) CHAIN=true; shift ;;
    --out)   OUT_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *)       SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  for cand in src app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
fi
if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  echo "ERROR: no scan path found. Run from project root." >&2
  exit 2
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; CYAN=""; DIM=""; BOLD=""; RESET=""; fi

echo "${BOLD}━━ Project inventory ━━${RESET}"
echo "${DIM}Scanning: ${SCAN_PATHS[*]}${RESET}"
echo

# ─── 1. Library detection ─────────────────────────────────────────────────────
echo "${DIM}[1/6] Detecting libraries…${RESET}"
HAS_TAILWIND_V4=false
HAS_TAILWIND_V3=false
HAS_SHADCN=false
HAS_RADIX=false
HAS_BASEUI=false
HAS_REACT=false
HAS_VITE=false
HAS_R3F=false

if [[ -f package.json ]]; then
  grep -qE '"react":' package.json && HAS_REACT=true
  grep -qE '"vite":' package.json && HAS_VITE=true
  grep -qE '"tailwindcss":[[:space:]]*"\^?4' package.json && HAS_TAILWIND_V4=true
  grep -qE '"tailwindcss":[[:space:]]*"\^?3' package.json && HAS_TAILWIND_V3=true
  grep -qE '"@radix-ui/' package.json && HAS_RADIX=true
  grep -qE '"@base-ui-components/' package.json && HAS_BASEUI=true
  grep -qE '"@react-three/fiber"' package.json && HAS_R3F=true
fi
[[ -f components.json ]] && HAS_SHADCN=true

# ─── 2. Design system source detection ────────────────────────────────────────
echo "${DIM}[2/6] Detecting design system source…${RESET}"
SOURCE_TW4_COUNT=0
SOURCE_SHADCN_COUNT=0
SOURCE_DTCG_COUNT=0
SOURCE_CSSVARS_COUNT=0

for path in "${SCAN_PATHS[@]}"; do
  # Tailwind v4: @theme blocks
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    count=$(grep -cE -- '--[a-z0-9-]+[[:space:]]*:' "$f" 2>/dev/null)
    SOURCE_TW4_COUNT=$((SOURCE_TW4_COUNT + count))
  done < <(grep -rlE '@theme([[:space:]]|\{)' "$path" --include="*.css" 2>/dev/null || true)

  # shadcn: :root + hsl-channel pattern
  if $HAS_SHADCN; then
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      count=$(awk '/:root[[:space:]]*\{/,/\}/' "$f" 2>/dev/null \
        | grep -cE -- '--[a-z0-9-]+[[:space:]]*:[[:space:]]*[0-9.]+[[:space:]]+[0-9.]+%[[:space:]]+[0-9.]+%')
      SOURCE_SHADCN_COUNT=$((SOURCE_SHADCN_COUNT + count))
    done < <(find "$path" -name "*.css" 2>/dev/null)
  fi

  # Plain CSS :root vars
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    count=$(awk '/:root[[:space:]]*\{/,/\}/' "$f" 2>/dev/null \
      | grep -cE -- '--[a-z0-9-]+[[:space:]]*:')
    SOURCE_CSSVARS_COUNT=$((SOURCE_CSSVARS_COUNT + count))
  done < <(find "$path" -name "*.css" 2>/dev/null)
done

# DTCG: count tokens.json files
for path in "${SCAN_PATHS[@]}"; do
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    count=$(grep -cE -- '"\$value":' "$f" 2>/dev/null)
    SOURCE_DTCG_COUNT=$((SOURCE_DTCG_COUNT + count))
  done < <(find "$path" .storybook docs -name "tokens.json" -o -name "*.tokens.json" 2>/dev/null)
done

# Pick dominant
DOMINANT="none"
MAX_COUNT=0
for name in tailwind-v4 shadcn dtcg css-vars; do
  case "$name" in
    tailwind-v4) c=$SOURCE_TW4_COUNT ;;
    shadcn)      c=$SOURCE_SHADCN_COUNT ;;
    dtcg)        c=$SOURCE_DTCG_COUNT ;;
    css-vars)    c=$SOURCE_CSSVARS_COUNT ;;
  esac
  if [[ $c -gt $MAX_COUNT ]]; then
    MAX_COUNT=$c
    DOMINANT=$name
  fi
done

# Detect mixed (>1 source with significant count)
MIXED=false
MIXED_REASON=""
SIGNIFICANT_COUNT=5
significant_sources=0
[[ $SOURCE_TW4_COUNT     -gt $SIGNIFICANT_COUNT ]] && significant_sources=$((significant_sources + 1))
[[ $SOURCE_SHADCN_COUNT  -gt $SIGNIFICANT_COUNT ]] && significant_sources=$((significant_sources + 1))
[[ $SOURCE_DTCG_COUNT    -gt $SIGNIFICANT_COUNT ]] && significant_sources=$((significant_sources + 1))
# Note: don't double-count css-vars if shadcn detected (they overlap)
if ! $HAS_SHADCN && [[ $SOURCE_CSSVARS_COUNT -gt $SIGNIFICANT_COUNT ]]; then
  significant_sources=$((significant_sources + 1))
fi
if [[ $significant_sources -gt 1 ]]; then
  MIXED=true
  MIXED_REASON="$significant_sources sources have >$SIGNIFICANT_COUNT tokens each"
fi

# ─── 3. Component usage map (real vs dead) ────────────────────────────────────
echo "${DIM}[3/6] Mapping component usage…${RESET}"
TMP_COMPONENTS=$(mktemp)
TMP_USAGE=$(mktemp)
trap 'rm -f "$TMP_COMPONENTS" "$TMP_USAGE"' EXIT

# Find all component definition files
for path in "${SCAN_PATHS[@]}"; do
  find "$path" -type f \( -name "*.tsx" -o -name "*.ts" \) \
    -not -name "*.stories.*" -not -name "*.test.*" -not -name "*.spec.*" 2>/dev/null \
    | xargs grep -lE '^export[[:space:]]+(default[[:space:]]+)?(function|const|class)' 2>/dev/null \
    | sort -u >> "$TMP_COMPONENTS"
done
sort -u "$TMP_COMPONENTS" -o "$TMP_COMPONENTS"
TOTAL_COMPONENT_FILES=$(wc -l < "$TMP_COMPONENTS" | tr -d ' ')

# For each component file, count how many OTHER files import it
DEAD_COUNT=0
REAL_COUNT=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  # Component name from basename (without extension)
  name=$(basename "$file" | sed -E 's/\.tsx?$//')
  # Skip entry points + config: they're mounted (by index.html / the bundler),
  # never imported by other modules, so they'd always read as "dead" though they
  # aren't components. index = re-export/entry; main = Vite/CRA entry; vite-env /
  # setupTests = config. (Caught by both Codex validation runs flagging main.tsx.)
  case "$name" in index|main|vite-env|setupTests|setup|entry-server|entry-client) continue ;; esac

  # Search for files that import this component name.
  # Exclude: the file itself + stories/tests/specs.
  # Sibling files within the same directory DO count as usage (typical for
  # composite components: course-builder/<file> imported by course-builder/<other>).
  importers=$(grep -rlE "from[[:space:]]+['\"][^'\"]*${name}(\.tsx?)?['\"]" \
    "${SCAN_PATHS[@]}" --include="*.ts" --include="*.tsx" 2>/dev/null \
    | grep -vF "$file" \
    | grep -v "\.stories\.\|\.test\.\|\.spec\." \
    | wc -l | tr -d ' ')

  if [[ "$importers" -eq 0 ]]; then
    printf '%s\tdead\t0\n' "$file" >> "$TMP_USAGE"
    DEAD_COUNT=$((DEAD_COUNT + 1))
  else
    printf '%s\treal\t%s\n' "$file" "$importers" >> "$TMP_USAGE"
    REAL_COUNT=$((REAL_COUNT + 1))
  fi
done < "$TMP_COMPONENTS"

# ─── 4. Token usage map (single source: token-usage.py) ───────────────────────
# Token usage is computed by ONE scanner — token-usage.py — so sb-inventory, sb-health,
# and the demo's token views can't drift apart. It classifies every DECLARED custom
# property as used/orphan with an accurate reference count and the files where it's used,
# recognising all three Tailwind-v4 consumption signals: var(), generated color/scale
# utilities, and custom @utility classes. (The old inline grep used a loose `-<suffix>`
# substring match that conflated namespaces and matched data strings → wrong orphan counts.)
echo "${DIM}[4/6] Mapping token usage…${RESET}"
TMP_TOKENS_JSON=$(mktemp)
trap 'rm -f "$TMP_COMPONENTS" "$TMP_USAGE" "$TMP_TOKENS_JSON"' EXIT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if python3 "$SCRIPT_DIR/token-usage.py" "${SCAN_PATHS[@]}" > "$TMP_TOKENS_JSON" 2>/dev/null \
   && [[ -s "$TMP_TOKENS_JSON" ]]; then
  read -r TOTAL_TOKENS USED_TOKENS ORPHAN_TOKENS < <(python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))["summary"]
print(s["totalDeclared"], s["usedCount"], s["orphanCount"])' "$TMP_TOKENS_JSON")
else
  printf '{"tokens":[],"summary":{"totalDeclared":0,"usedCount":0,"orphanCount":0}}' > "$TMP_TOKENS_JSON"
  TOTAL_TOKENS=0; USED_TOKENS=0; ORPHAN_TOKENS=0
fi

# ─── 5. Orphan stories ────────────────────────────────────────────────────────
echo "${DIM}[5/6] Detecting orphan stories…${RESET}"
TMP_ORPHAN_STORIES=$(mktemp)
trap 'rm -f "$TMP_COMPONENTS" "$TMP_USAGE" "$TMP_TOKENS_JSON" "$TMP_ORPHAN_STORIES"' EXIT

ORPHAN_STORIES=0
for path in "${SCAN_PATHS[@]}" stories; do
  [[ ! -d "$path" ]] && continue
  while IFS= read -r story; do
    # Get all relative imports in the story. POSIX [[:space:]], not \s — BSD sed
    # (macOS) treats \s as a literal 's', so `s/from\s+.../` silently fails to strip
    # the `from '` prefix, leaving paths like `from '../X` that resolve to nothing →
    # every story falsely flagged orphan (seen in two Codex runs).
    imports=$(grep -oE "from[[:space:]]+['\"]\.[^'\"]+['\"]" "$story" 2>/dev/null \
      | sed -E "s/from[[:space:]]+['\"]//;s/['\"]\$//")
    while IFS= read -r imp; do
      [[ -z "$imp" ]] && continue
      # Resolve relative to story location
      story_dir=$(dirname "$story")
      resolved="$story_dir/${imp}"
      # Try with various extensions
      if [[ ! -f "$resolved" ]] \
        && [[ ! -f "$resolved.tsx" ]] \
        && [[ ! -f "$resolved.ts" ]] \
        && [[ ! -f "$resolved/index.tsx" ]] \
        && [[ ! -f "$resolved/index.ts" ]]; then
        printf '%s\t%s\n' "$story" "$imp" >> "$TMP_ORPHAN_STORIES"
        ORPHAN_STORIES=$((ORPHAN_STORIES + 1))
        break
      fi
    done <<< "$imports"
  done < <(find "$path" -name "*.stories.tsx" -o -name "*.stories.ts" 2>/dev/null)
done

# ─── 6. Chain to sister scripts if --chain ────────────────────────────────────
if $CHAIN && ! $QUICK; then
  echo "${DIM}[6/6] Chaining to sister scripts…${RESET}"
  if [[ -x ~/agent-skills/plugins/storybook-workbench/skills/sb-audit/scripts/audit-drift.sh ]]; then
    ~/agent-skills/plugins/storybook-workbench/skills/sb-audit/scripts/audit-drift.sh "${SCAN_PATHS[@]}" 2>/dev/null | head -20 || true
  fi
fi

# ─── Write JSON output ────────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_PATH")"

# Authoritative stories index — Storybook's OWN report. `storybook index` materializes index.json
# (id/title/importPath/tags) with NO dev server, NO full build, so the coverage reconcile in the
# python step below counts the stories Storybook ACTUALLY registers (respecting .storybook/main.ts
# globs; excluding broken / non-indexed *.stories.* the filesystem glob would wrongly count) instead
# of a basename guess. Best-effort: needs Storybook installed; the python step falls back to the
# source-scan heuristic when index.json is absent. Plain CLI → runs the same on Claude/Codex/Cursor.
if [[ -f package.json ]] && grep -q '"storybook"' package.json 2>/dev/null && [[ -x node_modules/.bin/storybook ]]; then
  node_modules/.bin/storybook index -o .storybook/index.json >/dev/null 2>&1 || true
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
USER_NAME=$(whoami)

python3 - "$OUT_PATH" "$NOW" "$USER_NAME" "$DOMINANT" "$MIXED" "$MIXED_REASON" \
  "$HAS_REACT" "$HAS_VITE" "$HAS_TAILWIND_V4" "$HAS_TAILWIND_V3" "$HAS_SHADCN" \
  "$HAS_RADIX" "$HAS_BASEUI" "$HAS_R3F" \
  "$SOURCE_TW4_COUNT" "$SOURCE_SHADCN_COUNT" "$SOURCE_DTCG_COUNT" "$SOURCE_CSSVARS_COUNT" \
  "$TOTAL_COMPONENT_FILES" "$REAL_COUNT" "$DEAD_COUNT" \
  "$TOTAL_TOKENS" "$USED_TOKENS" "$ORPHAN_TOKENS" "$ORPHAN_STORIES" \
  "$TMP_USAGE" "$TMP_TOKENS_JSON" "$TMP_ORPHAN_STORIES" <<'PYEOF'
import json, sys, os, re, glob, tempfile

(out_path, now, user, dominant, mixed_str, mixed_reason,
 has_react, has_vite, has_tw4, has_tw3, has_shadcn, has_radix, has_baseui, has_r3f,
 tw4_n, shadcn_n, dtcg_n, cssvars_n,
 total_comp, real_n, dead_n,
 total_tok, used_tok, orphan_tok, orphan_stories,
 usage_path, tokens_json_path, orphan_stories_path) = sys.argv[1:]

def b(s):
    return s == "true"

# Bucket a file by where it lives: a reusable component, a route/page, an app shell
# (App.tsx, src root), Storybook *scaffold* (the init tutorial under src/stories/),
# or test/factory *support*. The flat real/dead totals conflated these, so the Codex
# runs kept re-separating "17 real, but only 11 are components — the rest are the SB
# starter + the factory." scaffold/support are reported separately and excluded from
# the component real/dead headline (they're not app code to write stories for).
def kind_of(path):
    p = "/" + path.lstrip("./")
    if "/stories/" in p:                       # Storybook init tutorial components
        return "scaffold"
    if ("/test/" in p or "/tests/" in p or "/__tests__/" in p or "/__mocks__/" in p
            or "/factories/" in p or "/fixtures/" in p or "/mocks/" in p
            or ".factory." in p or ".fixture." in p or ".mock." in p or ".mocks." in p):
        return "support"
    if "/components/ui/" in p or "/ui/" in p:  # shadcn-style installed primitives — vendored, not authored
        return "vendor"
    if "/components/" in p:
        return "component"
    if "/pages/" in p or "/app/" in p or "/routes/" in p or "/views/" in p:
        return "page"
    # Non-component source modules: types, helpers, hooks, utils, services, api, store, etc.
    # These are real code but NOT UI components — they pollute the "most imported components"
    # view (a types.ts is imported everywhere, so it tops the list). Bucket them as `module`
    # and keep them out of the component headline + the real[] list. (Vadim: "I see types and
    # helpers in most-imported — I want only components used in prod.")
    if ("/lib/" in p or "/utils/" in p or "/util/" in p or "/helpers/" in p or "/hooks/" in p
            or "/services/" in p or "/api/" in p or "/store/" in p or "/stores/" in p
            or "/context/" in p or "/contexts/" in p or "/constants/" in p or "/config/" in p
            or p.endswith("/types.ts") or p.endswith(".types.ts") or p.endswith("/constants.ts")
            or p.endswith("/utils.ts") or p.endswith("/helpers.ts") or p.endswith("/api.ts")):
        return "module"
    return "app"

# scaffold/support = not app code; vendor = installed library primitives (shadcn ui/);
# module = non-component source (types/helpers/hooks/utils/api). All are excluded from the
# real/dead *domain-component* headline + the real[] "most imported" list so that view is the
# user's OWN components used in prod — not shadcn primitives, the SB starter, test helpers,
# or types/helpers. Each is still reported in its own byKind bucket.
SUPPORTY = {"scaffold", "support"}
NON_DOMAIN = {"scaffold", "support", "vendor", "module"}

# Read dead/real component map
dead, real = [], []
try:
    with open(usage_path) as f:
        for line in f:
            parts = line.rstrip().split('\t')
            if len(parts) < 3: continue
            file, status, importers = parts
            entry = {"file": file, "kind": kind_of(file),
                     "importers": int(importers) if importers.isdigit() else 0}
            if status == "dead":
                dead.append(entry)
            else:
                real.append(entry)
except FileNotFoundError:
    pass

def by_kind(entries):
    out = {"component": 0, "page": 0, "app": 0, "scaffold": 0, "support": 0, "vendor": 0, "module": 0}
    for e in entries:
        out[e["kind"]] = out.get(e["kind"], 0) + 1
    return out
real_by_kind = by_kind(real)
dead_by_kind = by_kind(dead)

# Story coverage — which real OWN components (kind 'component') already have a story vs. need one.
# Covered = a co-located <name>.stories.* exists, OR some *.stories.* imports the component file.
# (Own components only — vendored ui/ primitives + dead/slop are excluded, per the audit's real-vs-slop split.)
_story_files = []
for _rd in ("src", "stories", ".storybook/stories", "app", "components"):
    for _ext in ("tsx", "jsx", "mjs", "js", "ts"):
        _story_files += glob.glob(os.path.join(_rd, "**", "*.stories." + _ext), recursive=True)
_covered_base, _story_text = set(), ""
for _sf in _story_files:
    _covered_base.add(os.path.basename(_sf).split(".stories.")[0].lower())
    try: _story_text += open(_sf, encoding="utf-8", errors="ignore").read() + "\n"
    except Exception: pass
# Two signals, kept separate. Co-located (a <name>.stories.* file exists) is the HARD count.
# Import-mention (the basename appears as a path in some story's text) is a LOOSE upper bound:
# it counts a component as "covered" whenever ANY story imports it — including imports purely to
# mock or compose it (e.g. MemberDialog.stories.tsx importing member-form), which gives the
# component no story of its own. Surface both so a consumer can tell the spread instead of
# trusting an inflated single number.
def _colocated(entry):
    b = os.path.splitext(os.path.basename(entry["file"]))[0]
    return b.lower() in _covered_base
def _has_story(entry):
    b = os.path.splitext(os.path.basename(entry["file"]))[0]
    return _colocated(entry) or bool(re.search(r'/' + re.escape(b) + r'["\']', _story_text))
_own = [e for e in real if e["kind"] == "component"]
_needs = sorted({os.path.splitext(os.path.basename(e["file"]))[0] for e in _own if not _has_story(e)})
story_coverage = {
    "real": len(_own),
    "storyFiles": len(_covered_base),                          # distinct .stories.* files that exist — the reliable signal
    "withColocatedStory": sum(1 for e in _own if _colocated(e)),  # own components with their OWN story (hard count)
    "withStory": len(_own) - len(_needs),                      # loose upper bound: co-located OR mentioned by any story
    "needsCount": len(_needs),
    "needsStory": _needs[:50],
    "source": "heuristic",                                     # upgraded to "storybook-index" below when index.json exists
}

# Reconcile against Storybook's OWN index (.storybook/index.json from `storybook index`) — the
# AUTHORITATIVE set of stories Storybook actually registers. index.json entries' importPath points at
# the STORY file, whose basename (Foo.stories.tsx → foo) maps to a component. When present this is the
# truth (respects main.ts globs, drops broken/un-indexed stories); needsStory recomputes against it.
# Heuristic fields stay for comparison. Absent (Storybook not installed / CLI didn't run) → heuristic.
_idx_path = os.path.join(os.path.dirname(out_path) or ".", "index.json")
try:
    _entries = json.load(open(_idx_path)).get("entries") or {}
    _idx_list = _entries.values() if isinstance(_entries, dict) else _entries
    _indexed_base = {
        os.path.basename(_e.get("importPath", "")).split(".stories.")[0].lower()
        for _e in _idx_list if _e.get("type") == "story" and _e.get("importPath")
    }
    _indexed_base.discard("")
    def _registered(entry):
        return os.path.splitext(os.path.basename(entry["file"]))[0].lower() in _indexed_base
    _reg_needs = sorted({os.path.splitext(os.path.basename(e["file"]))[0] for e in _own if not _registered(e)})
    story_coverage.update({
        "source": "storybook-index",
        "registeredStories": sum(1 for _e in _idx_list if _e.get("type") == "story"),
        "withRegisteredStory": sum(1 for e in _own if _registered(e)),  # AUTHORITATIVE coverage
        "needsCount": len(_reg_needs),
        "needsStory": _reg_needs[:50],
    })
except Exception:
    pass  # no/invalid index.json → keep the source-scan heuristic above

# Domain components only — drop SB scaffold + test/factory support + vendor (shadcn ui/)
# from the headline real/dead counts and from the dead listing, so neither job.ts /
# src/stories/Page.tsx NOR src/components/ui/button.tsx read as the user's "real" or
# "dead app code". Recompute here rather than trust the raw bash tallies.
real_app  = [e for e in real if e["kind"] not in NON_DOMAIN]
dead_app  = [e for e in dead if e["kind"] not in NON_DOMAIN]
real_n    = str(len(real_app))
dead_n    = str(len(dead_app))
total_comp = str(len(real_app) + len(dead_app))
support_count = sum(real_by_kind[k] + dead_by_kind[k] for k in ("scaffold", "support"))
vendor_count  = real_by_kind["vendor"] + dead_by_kind["vendor"]
module_count  = real_by_kind["module"] + dead_by_kind["module"]

# Token usage map from the single-source scanner (token-usage.py): every DECLARED token, its
# category, used/orphan status, reference count, and the files where it's consumed. Powers the
# Foundation "real usage" tables (Colors / Typography / Scales) AND sb-health's unused-token findings.
orphan_token_list = []
token_map = []
try:
    tdata = json.load(open(tokens_json_path))
    for r in tdata.get("tokens", []):
        token_map.append({"token": r["token"], "category": r["category"],
                          "status": r["status"], "count": r["count"], "files": r.get("files", []),
                          "declaredIn": r.get("declaredIn")})
        if r["status"] == "orphan":
            orphan_token_list.append(r["token"])
except (FileNotFoundError, ValueError):
    pass
token_map.sort(key=lambda r: (r["category"], r["status"] == "used", r["token"]))

# Read orphan stories
orphan_story_list = []
try:
    with open(orphan_stories_path) as f:
        for line in f:
            parts = line.rstrip().split('\t')
            if len(parts) < 2: continue
            orphan_story_list.append({"story": parts[0], "missing_import": parts[1]})
except FileNotFoundError:
    pass

inventory = {
    "generatedAt":  now,
    "ranBy":        user,
    "libraries": {
        "react":      b(has_react),
        "vite":       b(has_vite),
        "tailwindV4": b(has_tw4),
        "tailwindV3": b(has_tw3),
        "shadcn":     b(has_shadcn),
        "radix":      b(has_radix),
        "baseui":     b(has_baseui),
        "r3f":        b(has_r3f),
    },
    "designSystem": {
        "dominant": dominant,
        "mixed":    b(mixed_str),
        "mixedReason": mixed_reason if mixed_str == "true" else None,
        "tokenCounts": {
            "tailwind-v4": int(tw4_n),
            "shadcn":      int(shadcn_n),
            "dtcg":        int(dtcg_n),
            "css-vars":    int(cssvars_n),
        },
    },
    "components": {
        "totalFiles": int(total_comp),
        "realCount":  int(real_n),
        "deadCount":  int(dead_n),
        "supportCount": support_count,
        "vendorCount":  vendor_count,
        "moduleCount":  module_count,
        "byKind": {
            "components": {"real": real_by_kind["component"], "dead": dead_by_kind["component"]},
            "pages":      {"real": real_by_kind["page"],      "dead": dead_by_kind["page"]},
            "app":        {"real": real_by_kind["app"],       "dead": dead_by_kind["app"]},
            "scaffold":   {"real": real_by_kind["scaffold"],  "dead": dead_by_kind["scaffold"]},
            "support":    {"real": real_by_kind["support"],   "dead": dead_by_kind["support"]},
            "vendor":     {"real": real_by_kind["vendor"],    "dead": dead_by_kind["vendor"]},
            "module":     {"real": real_by_kind["module"],    "dead": dead_by_kind["module"]},
        },
        "real":       sorted(real_app, key=lambda e: -e["importers"])[:30],
        "dead":       dead_app[:30],
        "storyCoverage": story_coverage,
    },
    "tokens": {
        "totalDeclared": int(total_tok),
        "usedCount":     int(used_tok),
        "orphanCount":   int(orphan_tok),
        "orphan":        orphan_token_list[:30],
        "map":           token_map,
    },
    "orphanStories": {
        "count": int(orphan_stories),
        "items": orphan_story_list[:30],
    },
}

# Atomic write: temp file in the same dir → os.replace, so an interrupted run never leaves
# a half-written JSON (the resume protocol depends on "a file that exists is complete").
_d = os.path.dirname(out_path) or '.'
_fd, _tmp = tempfile.mkstemp(dir=_d, suffix='.tmp')
with os.fdopen(_fd, 'w') as o:
    json.dump(inventory, o, indent=2)
os.replace(_tmp, out_path)

print()
print(f"✓ Wrote {out_path}")
print()
print(f"━━ Project inventory summary ━━")
print(f"  Stack:       React={'✓' if b(has_react) else '✗'}  Vite={'✓' if b(has_vite) else '✗'}  Tailwind v4={'✓' if b(has_tw4) else '✗'}  shadcn={'✓' if b(has_shadcn) else '✗'}  Radix={'✓' if b(has_radix) else '✗'}  R3F={'✓' if b(has_r3f) else '✗'}")
print(f"  Design sys:  dominant={dominant}   (TW4:{tw4_n} shadcn:{shadcn_n} DTCG:{dtcg_n} CSS-vars:{cssvars_n})")
if b(mixed_str):
    print(f"               ⚠ MIXED: {mixed_reason}")
print(f"  Components:  {real_n} real / {dead_n} dead (slop) / {total_comp} app code")
print(f"               └─ components/: {real_by_kind['component']} real, {dead_by_kind['component']} dead"
      f"   ·  pages/: {real_by_kind['page']} real"
      f"   ·  app: {real_by_kind['app']} real")
if support_count:
    print(f"               └─ excluded (not app code): {real_by_kind['scaffold']+dead_by_kind['scaffold']} SB-scaffold"
          f"   ·  {real_by_kind['support']+dead_by_kind['support']} test/factory support")
print(f"  Tokens:      {used_tok} used / {orphan_tok} orphan / {total_tok} declared")
print(f"  Stories:     {orphan_stories} orphan stories (import missing components)")
if story_coverage.get("source") == "storybook-index":
    print(f"  Coverage:    {story_coverage['withRegisteredStory']}/{story_coverage['real']} own components have a story"
          f" Storybook registers ({story_coverage['registeredStories']} stories in index.json) · {story_coverage['needsCount']} need one"
          f"   [authoritative — reconciled against storybook index]")
else:
    print(f"  Coverage:    {story_coverage['withColocatedStory']}/{story_coverage['real']} own components have their own story"
          f" ({story_coverage['storyFiles']} story files) · ≤{story_coverage['withStory']} incl. import-mentions · {story_coverage['needsCount']} need one"
          f"   [heuristic — Storybook not indexed]")
PYEOF

# Exit codes
DEAD_HEAVY=false
[[ "$DEAD_COUNT" -gt 10 ]] && DEAD_HEAVY=true
if $MIXED || $DEAD_HEAVY; then
  echo
  echo "${YELLOW}⚠ Significant slop detected. Review .storybook/project-inventory.json before authoring stories.${RESET}"
  exit 1
fi
exit 0
