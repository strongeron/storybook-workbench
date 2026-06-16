#!/usr/bin/env bash
# extract-prop-shapes.sh — Factory-candidate discovery (Phase 2 ground truth).
#
# Finds TypeScript interfaces and type aliases that appear in component prop
# signatures across the codebase. Clusters by name; surfaces shapes referenced
# in ≥3 component files as factory candidates (matching the SKILL.md threshold
# rule). Locks in the "3+ usage → scaffold-factory.sh, otherwise inline" choice
# instead of leaving it to agent judgment.
#
# Two-pass detection:
#   Pass 1 — collect all `interface FooProps` / `type Foo = {...}` definitions
#            and `interface Foo {}` / `type Foo = {}` data-shape definitions.
#   Pass 2 — for each named type, count how many DIFFERENT component files
#            reference it (as `: TypeName`, `<TypeName>`, prop type).
#
# Output: writes .storybook/prop-shapes.json with:
#   factoryCandidates[]  — types referenced in ≥3 component files
#   propInterfaces[]     — every `XxxProps` interface (one per component)
#   singleUseShapes[]    — types used in 1-2 files (inline mocks, no factory)
#
# Usage:
#   extract-prop-shapes.sh             # scan ./src
#   extract-prop-shapes.sh path/to/src # custom scan path
#   extract-prop-shapes.sh --out file  # custom output path
#   extract-prop-shapes.sh --threshold 3   # factory threshold (default 3)
#
# Exit codes:
#   0  shapes written
#   1  zero shapes found (very small codebase)
#   2  bad invocation

set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found in PATH. Install python3 (Alpine: apk add python3; Debian: apt install python3)." >&2; exit 2; }

OUT_PATH=".storybook/prop-shapes.json"
THRESHOLD=3
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)       OUT_PATH="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *)           SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  for cand in src app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
  # Monorepo layouts (packages/*/src, apps/*/src)
  for parent in packages apps; do
    if [[ -d "$parent" ]]; then
      while IFS= read -r d; do
        SCAN_PATHS+=("$d")
      done < <(find "$parent" -maxdepth 3 -type d \( -name src -o -name app \) 2>/dev/null | head -20)
    fi
  done
fi
if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  echo "ERROR: no scan path found. Tried src/, app/frontend, packages/*/src, apps/*/src. Pass an explicit path." >&2
  exit 2
fi

TMP_DEFS=$(mktemp)
TMP_REFS=$(mktemp)
trap 'rm -f $TMP_DEFS $TMP_REFS' EXIT

# ─── Pass 1: collect type definitions ───────────────────────────────────────
# interface FooProps { ... }
# type Foo = { ... }
# (We keep ALL of them; filtering happens in pass 2 by usage count.)
for p in "${SCAN_PATHS[@]}"; do
  grep -rEn "^\s*(export\s+)?(interface|type)\s+[A-Z]\w+" "$p" \
    --include="*.ts" --include="*.tsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts:)" \
    >> "$TMP_DEFS" || true
done

# ─── Pass 2: count component-file references per type ───────────────────────
# We only care about REFERENCES from .tsx/.jsx (component files), not .ts.
# Build a unique sorted list of type names from defs.

TYPE_NAMES=$(awk -F: '{print $3}' "$TMP_DEFS" \
  | grep -oE "(interface|type)\s+[A-Z]\w+" \
  | awk '{print $2}' | sort -u)

# For each type, find component files referencing it (excluding the def file)
echo "$TYPE_NAMES" | while IFS= read -r tname; do
  [[ -z "$tname" ]] && continue
  # Skip overly common / generic names that pollute counts
  case "$tname" in
    Props|State|Options|Config|Data|Item|Element|Node|Component|Children|Ref) continue ;;
  esac

  # Find files using TypeName in TYPE position only. Excludes JSX `<TypeName>`
  # by requiring an identifier (`\w`) before `<` (so `Array<Course>` / `Omit<Course>`
  # / `Promise<Course>` match, but `<Course>` in JSX does not).
  #
  # Type-position contexts:
  #   : TypeName               — type annotation
  #   extends/implements Type  — inheritance
  #   , TypeName               — additional type in param list
  #   TypeName[]               — array of
  #   Generic<TypeName>        — type arg to a generic (requires preceding \w)
  # Count a file only if it references the type on a NON-import line. The old
  # `grep -l` counted any match, so a comma'd named import (`import { Foo, Course }`)
  # falsely registered as a usage and could flip a single-use shape into a
  # factory candidate (adv-3). Drop `import …/export … from …` lines first, then
  # collect the filenames. `sed` extracts the path colon-safely (greedy up to :line:).
  files=$(for p in "${SCAN_PATHS[@]}"; do
    grep -rEn "(:|extends|implements|,)\s*${tname}(\b|<|\[)|\w<\s*${tname}\b" "$p" \
      --include="*.tsx" --include="*.jsx" 2>/dev/null \
      | grep -vE "^.*:[0-9]+:[[:space:]]*(import|export)[[:space:]].*[[:space:]]from[[:space:]]" \
      | sed -E 's/^(.*):[0-9]+:.*/\1/' || true
  done | sort -u)

  count=$(printf "%s" "$files" | awk 'NF{n++} END{print n+0}')
  files_csv=$(printf "%s" "$files" | paste -sd ',' -)
  echo -e "${tname}\t${count}\t${files_csv}" >> "$TMP_REFS"
done

# ─── Write JSON ──────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_PATH")"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$OUT_PATH" "$NOW" "$THRESHOLD" "$TMP_REFS" "$TMP_DEFS" <<'PYEOF'
import json, sys, re, os, tempfile
out, now, threshold_str, refs_path, defs_path = sys.argv[1:]
threshold = int(threshold_str)

# Load dead-component files from the inventory ledger (same .storybook dir) so a
# shape used only by a dead component isn't over-counted as live reuse. Both Codex
# runs corrected "6 usages, but one is a dead component → 5 live." We annotate
# liveUsages rather than change the candidate threshold (keeps classification stable).
dead_files = set()
inv_path = os.path.join(os.path.dirname(out) or ".", "project-inventory.json")
try:
    with open(inv_path) as f:
        dead_files = {d["file"] for d in json.load(f).get("components", {}).get("dead", [])}
except (FileNotFoundError, ValueError, KeyError):
    pass

factory_candidates = []
prop_interfaces = []
single_use = []

# Build def-location index (where each type was declared)
def_locs = {}
with open(defs_path) as f:
    for line in f:
        m = re.match(r'^([^:]+):(\d+):\s*(?:export\s+)?(?:interface|type)\s+(\w+)', line)
        if m:
            file, lineno, tname = m.group(1), int(m.group(2)), m.group(3)
            def_locs.setdefault(tname, []).append({"file": file, "line": lineno})

with open(refs_path) as f:
    for line in f:
        parts = line.rstrip().split('\t')
        if len(parts) < 3: continue
        tname, count_str, files_csv = parts[0], parts[1], parts[2]
        try:
            count = int(count_str)
        except ValueError:
            continue

        files = [x for x in files_csv.split(',') if x]
        live_files = [x for x in files if x not in dead_files]
        entry = {
            "type": tname,
            "componentFileUsages": count,
            "liveUsages": len(live_files),   # excludes dead-component files
            "files": files[:10],   # cap to keep JSON tight
            "declaredIn": def_locs.get(tname, [])[:3],
        }

        if tname.endswith("Props"):
            prop_interfaces.append(entry)
            continue   # *Props are per-component, not factory candidates

        if count >= threshold:
            factory_candidates.append(entry)
        elif count >= 1:
            single_use.append(entry)

# Sort
factory_candidates.sort(key=lambda e: -e["componentFileUsages"])
prop_interfaces.sort(key=lambda e: -e["componentFileUsages"])

out_obj = {
    "generatedAt": now,
    "factoryThreshold": threshold,
    "factoryCandidates": factory_candidates,
    "factoryCandidateCount": len(factory_candidates),
    "propInterfaces": prop_interfaces[:50],
    "propInterfaceCount": len(prop_interfaces),
    "singleUseShapeCount": len(single_use),
    "recommendation": (
        "Run scaffold-factory.sh for each factoryCandidate; inline mock data for singleUseShapes."
        if factory_candidates else
        "No shared shapes found; inline mock data per story (no factories needed yet)."
    ),
}

# Atomic write (temp → os.replace): an interrupted run never leaves half-written JSON.
_fd, _tmp = tempfile.mkstemp(dir=os.path.dirname(out) or '.', suffix='.tmp')
with os.fdopen(_fd, "w") as f:
    json.dump(out_obj, f, indent=2)
os.replace(_tmp, out)

print(f"✓ Wrote {out}")
print(f"  {len(factory_candidates)} factory candidates (≥{threshold} usages)")
print(f"  {len(prop_interfaces)} *Props interfaces")
print(f"  {len(single_use)} single/dual-use shapes (inline, don't factor)")
PYEOF

# ─── Human summary ───────────────────────────────────────────────────────────
echo ""
echo "━━ Prop-shape inventory ━━"
python3 -c "
import json
with open('$OUT_PATH') as f:
    d = json.load(f)
print('  Factory candidates:')
for c in d['factoryCandidates'][:8]:
    live = c.get('liveUsages', c['componentFileUsages'])
    suffix = f\" ({live} live)\" if live != c['componentFileUsages'] else ''
    print(f\"    {c['type']:24s} {c['componentFileUsages']} files{suffix}\")
if not d['factoryCandidates']:
    print('    (none — inline mocks per story)')
"
echo ""
exit 0
