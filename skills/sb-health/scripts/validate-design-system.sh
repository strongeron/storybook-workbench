#!/usr/bin/env bash
# validate-design-system.sh — comprehensive design-system health check.
#
# Pairs with the DesignSystemHealth wrapper. Writes findings to
# .storybook/design-system-health.json. The wrapper reads + renders it.
#
# Checks (deterministic by default; stylelint + LLM sub-agent are optional):
#   1. raw-color       — hex/rgba/hsl literals in component source (should use tokens)
#   2. undefined-token — components reference var(--foo) where --foo isn't declared
#   3. scale-gap       — spacing scale has unexpected jumps (sorts numeric values, flags >2x gaps)
#   4. unused-token    — declared in :root or @theme but never referenced
#   5. design-md       — DESIGN.md colors cross-checked against code tokens (the brief can drift/lie)
#   6. property-token  — (opt-in) valid token used on the WRONG property family, per a designer-owned
#                        design-system/lint/colors.json — e.g. a container token used as text color
#   7. stylelint       — runs stylelint if config + binary present
#   8. semantic        — emits a sub-agent prompt for LLM to check naming drift / inconsistency
#
# Usage:
#   validate-design-system.sh                  # all checks, write JSON
#   validate-design-system.sh --no-stylelint   # skip stylelint
#   validate-design-system.sh --quick          # only checks 1-4 (no stylelint, no sub-agent prompt)
#   validate-design-system.sh --emit-prompt    # ALSO print the sub-agent prompt for the agent to dispatch
#
# Exit codes:
#   0   findings written; severity-mixed
#   1   one or more `error` findings present (useful for CI gating)
#   2   bad invocation

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

QUICK=false
NO_STYLELINT=false
EMIT_PROMPT=false
OUT_PATH=".storybook/design-system-health.json"
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)         QUICK=true; shift ;;
    --no-stylelint)  NO_STYLELINT=true; shift ;;
    --emit-prompt)   EMIT_PROMPT=true; shift ;;
    --out)           OUT_PATH="$2"; shift 2 ;;
    -h|--help)       sed -n '2,25p' "$0"; exit 0 ;;
    *)               SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  for cand in src app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; CYAN=""; DIM=""; BOLD=""; RESET=""; fi

# ─── findings accumulator (newline-separated JSON-friendly fields) ───────────────
TMP_FINDINGS=$(mktemp)
trap 'rm -f "$TMP_FINDINGS"' EXIT

# Emit a finding: kind | severity | file | line | message | fix
emit() {
  local kind="$1" sev="$2" file="$3" line="$4" message="$5" fix="${6:-}"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$kind" "$sev" "$file" "$line" "$message" "$fix" >> "$TMP_FINDINGS"
}

# ─── 1. raw-color literals in component source ───────────────────────────────────
echo "${DIM}[1/7] scanning for raw color literals…${RESET}"
HEX_COUNT=0
for path in "${SCAN_PATHS[@]}"; do
  [[ ! -d "$path" ]] && continue
  # Find hex colors NOT inside CSS files (those are usually intentional in token files)
  while IFS=: read -r file line content; do
    # Skip files that are themselves token declarations
    if [[ "$file" == *.css ]] || [[ "$file" == *tokens* ]]; then continue; fi
    # Skip comments
    if echo "$content" | grep -qE '^\s*(//|\*|/\*)'; then continue; fi
    emit "raw-color" "warning" "$file" "$line" "Raw hex literal — should use design token" "Replace with var(--color-name) or token reference"
    HEX_COUNT=$((HEX_COUNT + 1))
  done < <(grep -rnE "#[0-9a-fA-F]{3,8}\b" "$path" --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" 2>/dev/null | grep -vE '\.stories\.|//.*#[0-9a-fA-F]' || true)
done
echo "${DIM}  found ${HEX_COUNT} raw hex literals${RESET}"

# ─── 2. undefined-token references (var(--foo) where --foo isn't declared) ───────
echo "${DIM}[2/7] scanning for undefined token references…${RESET}"

# Build the set of declared tokens — CSS files ONLY. `grep -r --include="*.css"` is NOT portable:
# under ugrep (common as `grep` on macOS) --include is ignored, so .tsx files get scanned and a
# `var(--undefined)` reference in component code is mis-collected as a "declared" token — silently
# defeating undefined-token detection. Enumerate .css via find (the codebase idiom), then grep each.
DECLARED_TOKENS=""
while IFS= read -r _cssf; do
  [[ -z "$_cssf" ]] && continue
  DECLARED_TOKENS="$DECLARED_TOKENS"$'\n'"$(grep -hoE -- "--[a-z][a-z0-9-]+" "$_cssf" 2>/dev/null || true)"
done < <(find "${SCAN_PATHS[@]}" -name "*.css" -type f 2>/dev/null || true)
DECLARED_TOKENS=$(printf '%s\n' "$DECLARED_TOKENS" | grep -vE '^$' | sort -u || true)

# Find all var(--foo) usages
USED_COUNT=0
UNDEF_COUNT=0
for path in "${SCAN_PATHS[@]}"; do
  [[ ! -d "$path" ]] && continue
  while IFS=: read -r file line content; do
    # Extract --name from the var() call
    used_name=$(echo "$content" | grep -oE -- "var\(\s*(--[a-z][a-z0-9-]+)" | head -1 | grep -oE -- "--[a-z][a-z0-9-]+")
    [[ -z "$used_name" ]] && continue
    USED_COUNT=$((USED_COUNT + 1))
    if [[ -n "$DECLARED_TOKENS" ]] && ! echo "$DECLARED_TOKENS" | grep -qxF -- "$used_name"; then
      emit "undefined-token" "error" "$file" "$line" "References $used_name but it isn't declared in any :root or @theme block" "Declare $used_name in a CSS token file, or fix the typo"
      UNDEF_COUNT=$((UNDEF_COUNT + 1))
    fi
  done < <(grep -rnE -- "var\(\s*--" "$path" --include="*.css" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
done
echo "${DIM}  ${USED_COUNT} token references, ${UNDEF_COUNT} undefined${RESET}"

# ─── 3. scale-gap analysis (spacing tokens) ─────────────────────────────────────
echo "${DIM}[3/7] analyzing spacing scale gaps…${RESET}"
SPACING_VALUES=$(grep -rhoE -- "--space[a-z-]*-[a-z0-9-]+:\s*[0-9.]+(rem|px|em)" --include="*.css" "${SCAN_PATHS[@]}" 2>/dev/null \
  | grep -oE "[0-9.]+(rem|px|em)" | sort -u || true)

if [[ -n "$SPACING_VALUES" ]]; then
  # Convert all to numeric (px equivalent: rem×16, em×16)
  PX_VALUES=$(echo "$SPACING_VALUES" | awk '{
    n=$0; gsub(/[^0-9.]/, "", n)
    if (match($0, /rem|em/)) print n * 16
    else print n
  }' | sort -n | uniq)
  PREV=""
  while read -r v; do
    if [[ -n "$PREV" ]] && [[ "${v%.*}" != "0" ]]; then
      RATIO=$(awk -v p="$PREV" -v v="$v" 'BEGIN{ if (p > 0) printf "%.2f", v/p; else print "0"}')
      if awk -v r="$RATIO" 'BEGIN{ exit !(r > 2.0) }'; then
        emit "scale-gap" "info" "" "" "Spacing scale jumps ${RATIO}x from ${PREV}px to ${v}px — possible missing intermediate step" "Consider adding a scale value between"
      fi
    fi
    PREV="$v"
  done <<< "$PX_VALUES"
fi

# ─── 4. unused tokens — READ from sb-inventory's single source ──────────────────
# Token usage has ONE owner: sb-inventory (scripts/token-usage.py → project-inventory.json).
# Re-scanning here would duplicate that logic and inevitably drift from it (different grep, different
# Tailwind-utility handling → "33 uses · unused" contradictions). So sb-health reads the orphan tokens
# from project-inventory.json and re-presents them as unused-token findings. If sb-inventory hasn't run,
# the check is skipped — it precedes sb-health in the pipeline, so the file is normally present.
echo "${DIM}[4/7] reading unused tokens from project-inventory.json…${RESET}"
UNUSED_COUNT=0
INVENTORY_JSON="${INVENTORY_JSON:-.storybook/project-inventory.json}"
if [[ -f "$INVENTORY_JSON" ]]; then
  while IFS=$'\t' read -r tok df dl; do
    [[ -z "$tok" ]] && continue
    emit "unused-token" "info" "$df" "$dl" "${tok} is declared but never referenced" "Remove if intentional, or audit usage"
    UNUSED_COUNT=$((UNUSED_COUNT + 1))
  done < <(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for r in d.get("tokens", {}).get("map", []):
    if r.get("status") == "orphan":
        f, _, ln = (r.get("declaredIn") or "").partition(":")
        print("%s\t%s\t%s" % (r["token"], f, ln))' "$INVENTORY_JSON")
  echo "${DIM}  ${UNUSED_COUNT} unused tokens (from inventory)${RESET}"
else
  echo "${DIM}  skipped — run sb-inventory first (project-inventory.json not found)${RESET}"
fi

# ─── 5. design.md / DESIGN.md drift (the brief can lie, like AGENTS.md) ──────────
# A DESIGN.md (Google Labs YAML-tokens-plus-markdown) briefs an agent on the visual
# identity. Like CLAUDE.md/AGENTS.md it is a CLAIM, not ground truth — it drifts as
# the code changes, or was wrong from the start. Cross-check the colors it claims
# against the colors the code's CSS tokens actually declare; flag the gaps.
echo "${DIM}[5/7] checking design.md / DESIGN.md against code…${RESET}"
DESIGN_MD=$(find . -maxdepth 3 -iname 'design.md' -not -path '*/node_modules/*' 2>/dev/null | head -1)
if [[ -n "$DESIGN_MD" ]]; then
  emit "design-md" "info" "$DESIGN_MD" "" "DESIGN.md present — a claim about the visual identity, NOT ground truth (it drifts/lies like AGENTS.md). Cross-checked below; deep-audit or regenerate it with the design-md skill." "Audit DESIGN.md against code with the design-md skill"
  # Hex colors the brief claims vs. hex colors the code's CSS tokens actually declare.
  BRIEF_HEX=$(grep -ioE "#[0-9a-fA-F]{6}\b" "$DESIGN_MD" 2>/dev/null | tr 'A-F' 'a-f' | sort -u || true)
  CODE_HEX=$(grep -rhioE "#[0-9a-fA-F]{6}\b" --include="*.css" "${SCAN_PATHS[@]}" 2>/dev/null | tr 'A-F' 'a-f' | sort -u || true)
  DRIFT_COUNT=0
  while IFS= read -r hx; do
    [[ -z "$hx" ]] && continue
    if [[ -n "$CODE_HEX" ]] && ! echo "$CODE_HEX" | grep -qxF -- "$hx"; then
      emit "design-md-drift" "warning" "$DESIGN_MD" "" "DESIGN.md claims color $hx but no CSS token declares it — the brief has drifted from (or never matched) the code" "Reconcile: fix DESIGN.md with the design-md skill, or add the token"
      DRIFT_COUNT=$((DRIFT_COUNT + 1))
    fi
  done <<< "$BRIEF_HEX"
  echo "${DIM}  DESIGN.md found at ${DESIGN_MD}; ${DRIFT_COUNT} claimed color(s) absent from code tokens${RESET}"
else
  echo "${DIM}  no design.md / DESIGN.md${RESET}"
fi

# ─── 6. property → token-family correctness (opt-in; designer-owned rules) ────────
# The semantic error grep can't see: a VALID, declared token used on the WRONG
# property family (color: var(--color-container)). The which-family-on-which-property
# logic is DESIGN intent, so it lives in a designer-owned rules file — not this script.
# No rules file → no-op, so the zero-config default is preserved. Delegates to
# check-property-tokens.py (handles glob property families, prefix tokens, alias remap,
# per-line ignore, and a stale-rule drift guard). Findings are warning/info only, so an
# opt-in never flips a green CI build red.
echo "${DIM}[6/8] checking property→token-family rules (if configured)…${RESET}"
PROP_RULES=""
for cand in design-system/lint/colors.json .storybook/lint/colors.json; do
  [[ -f "$cand" ]] && { PROP_RULES="$cand"; break; }
done
PROP_COUNT=0
if [[ -n "$PROP_RULES" ]] && [[ -f "$SCRIPT_DIR/check-property-tokens.py" ]]; then
  # The detector already prints the exact `kind\tsev\tfile\tline\tmsg\tfix` shape emit() uses,
  # so append straight to the findings file. Do NOT pipe through `read -r … IFS=$'\t'`: a tab IFS
  # collapses consecutive tabs (tab is whitespace), so a finding with empty file+line (e.g. the
  # suppression tally) would shift its columns left and corrupt the JSON.
  PROP_OUT=$(python3 "$SCRIPT_DIR/check-property-tokens.py" --rules "$PROP_RULES" "${SCAN_PATHS[@]}" 2>/dev/null || true)
  if [[ -n "$PROP_OUT" ]]; then
    printf '%s\n' "$PROP_OUT" >> "$TMP_FINDINGS"
    PROP_COUNT=$(printf '%s\n' "$PROP_OUT" | grep -c . || true)
  fi
  echo "${DIM}  rules: ${PROP_RULES}; ${PROP_COUNT} finding(s)${RESET}"
else
  echo "${DIM}  no design-system/lint/colors.json — skipped (zero-config default)${RESET}"
fi

# ─── 7. stylelint (optional) ────────────────────────────────────────────────────
if ! $QUICK && ! $NO_STYLELINT; then
  echo "${DIM}[7/8] running stylelint if configured…${RESET}"
  if [[ -f .stylelintrc ]] || [[ -f .stylelintrc.json ]] || [[ -f .stylelintrc.yml ]] || [[ -f stylelint.config.js ]] || [[ -f stylelint.config.mjs ]]; then
    if command -v npx >/dev/null 2>&1; then
      while IFS= read -r line; do
        # parse stylelint compact output: file:line:col warning rule
        file=$(echo "$line" | cut -d: -f1)
        lineno=$(echo "$line" | cut -d: -f2)
        msg=$(echo "$line" | cut -d: -f4- | sed 's/^ *//')
        [[ -z "$msg" ]] && continue
        emit "stylelint" "warning" "$file" "$lineno" "$msg" ""
      done < <(npx --no -- stylelint "**/*.css" --formatter compact 2>/dev/null | head -50 || true)
    fi
  else
    echo "${DIM}  no stylelint config found, skipping${RESET}"
  fi
fi

# ─── 8. semantic sub-agent prompt (emit only) ───────────────────────────────────
if ! $QUICK && $EMIT_PROMPT; then
  echo "${DIM}[8/8] emitting semantic-check sub-agent prompt…${RESET}"
  echo
  echo "${BOLD}SEMANTIC SUB-AGENT PROMPT${RESET} (dispatch to validate naming drift, scale clarity, token nomenclature):"
  echo "────────────────────────────────────────────────────────────────────"
  cat <<'EOF'
You are reviewing design tokens for a project. Read .storybook/design-system-health.json (the deterministic findings already in there) and then read the project's CSS files declaring tokens (look in src/**/*.css and any @theme blocks).

Check for these semantic issues that deterministic grep misses:

1. NAMING DRIFT — pairs of tokens with similar values but inconsistent names
   (e.g., --color-blue-500 and --primary-blue both equal #2563eb)
2. SEMANTIC vs PRESENTATIONAL — tokens named after the value (color-red-7) instead of the role (color-destructive)
3. SCALE NAMING — inconsistent scale naming (size-1/2/3 mixed with size-sm/md/lg)
4. SHADCN/V4 STYLE CONFLICT — both shadcn HSL channels AND Tailwind v4 @theme in the same project (one should win)

For each issue, output:
- File: <path>:<line>
- Kind: naming-drift | semantic-vs-presentational | scale-naming | style-conflict
- Severity: warning | info
- Message: <one sentence>
- Fix: <one sentence suggested change>

Output as JSON array matching the HealthFinding shape so it can merge into design-system-health.json.
Under 300 words.
EOF
  echo "────────────────────────────────────────────────────────────────────"
  echo
fi

# ─── write JSON output ──────────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_PATH")"

CHECKS_RUN="raw-color, undefined-token, scale-gap, unused-token, design-md"
[[ -n "$PROP_RULES" ]] && CHECKS_RUN="$CHECKS_RUN, property-token-family"
$NO_STYLELINT || $QUICK || CHECKS_RUN="$CHECKS_RUN, stylelint"
$EMIT_PROMPT && CHECKS_RUN="$CHECKS_RUN, semantic-prompt"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
USER_NAME=$(whoami)

python3 - "$TMP_FINDINGS" "$OUT_PATH" "$NOW" "$USER_NAME" "$CHECKS_RUN" <<'PYEOF'
import json, sys
findings_file, out_path, now, user, checks = sys.argv[1:]
findings = []
with open(findings_file) as f:
    for raw in f:
        raw = raw.rstrip('\n')
        if not raw:
            continue
        parts = raw.split('\t')
        while len(parts) < 6:
            parts.append('')
        kind, sev, file, line, message, fix = parts[:6]
        item = {'kind': kind, 'severity': sev, 'message': message}
        if file:    item['file'] = file
        if line:    item['line'] = int(line) if line.isdigit() else line
        if fix:     item['fix'] = fix
        findings.append(item)

errors   = sum(1 for f in findings if f['severity'] == 'error')
warnings = sum(1 for f in findings if f['severity'] == 'warning')
info     = sum(1 for f in findings if f['severity'] == 'info')

report = {
    'generatedAt': now,
    'ranBy':       user,
    'findings':    findings,
    'summary':     {
        'total':     len(findings),
        'errors':    errors,
        'warnings':  warnings,
        'info':      info,
        'checksRun': [c.strip() for c in checks.split(',')],
    },
}

# Atomic write (temp → os.replace) so an interrupted run never leaves a half-JSON —
# matches the resume-protocol guarantee the other discovery scripts make.
import os
_tmp = out_path + ".tmp"
with open(_tmp, 'w') as o:
    json.dump(report, o, indent=2)
os.replace(_tmp, out_path)

print(f"\n✓ Wrote {out_path} — {len(findings)} findings ({errors} errors, {warnings} warnings, {info} info)")
PYEOF

# Exit non-zero if any errors
ERRORS=$(grep -c $'^[^\t]*\terror\t' "$TMP_FINDINGS" 2>/dev/null)
if [[ "${ERRORS:-0}" -gt 0 ]]; then exit 1; fi
exit 0
