#!/usr/bin/env bash
# check-story-ready.sh — "give me confidence" gate for a Storybook story.
#
# Two phases in one command:
#   1. Setup readiness (advisory) — is the project ready to author stories well?
#        • Storybook installed (.storybook/ present)
#        • discovery chain run (project-inventory / flows / component-states /
#          prop-shapes JSON under .storybook/) — so states + factories aren't guessed
#        • dominant design system known (from project-inventory.json)
#   2. Story conformance (the gate) — delegates to the sibling validate-stories.sh
#        (13 deterministic checks: SB10 imports, satisfies, no CSF2, layout,
#         fn() callbacks, title/sort organization, Explore/Labs tag combo,
#         play-earns-its-place, + a project-level CssCheck tally, …).
#
# Readiness is ADVISORY (warns, never fails) unless --require-extraction is set.
# The conformance phase is the gate: its exit code is this script's exit code.
#
# Usage:
#   check-story-ready.sh <file.stories.tsx>            # readiness + conformance
#   check-story-ready.sh --strict <file>               # also tsc/eslint/vitest
#   check-story-ready.sh --require-extraction <file>   # FAIL if discovery JSONs missing
#   check-story-ready.sh --diff                        # changed stories (git)
#
# Exit codes: 0 ready+conformant · 1 conformance failed (or missing extraction
#             under --require-extraction) · 2 bad invocation

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE="$HERE/validate-stories.sh"
if [[ ! -f "$VALIDATE" ]]; then
  SHARED_VALIDATE="$(cd "$HERE/../../.." && pwd)/shared/scripts/validate-stories.sh"
  [[ -f "$SHARED_VALIDATE" ]] && VALIDATE="$SHARED_VALIDATE"
fi
[[ -f "$VALIDATE" ]] || { echo "ERROR: validate-stories.sh not found next to this script ($VALIDATE)" >&2; exit 2; }

REQUIRE_EXTRACTION=false
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --require-extraction) REQUIRE_EXTRACTION=true ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done
[[ ${#PASSTHROUGH[@]} -eq 0 ]] && { echo "ERROR: pass a story file, a quoted glob, or --diff." >&2; exit 2; }

# ── Phase 1: Setup readiness (advisory) ─────────────────────────────────────
# Two independent axes, tracked separately:
#   discovery_warn — is the ground truth the agent authors AGAINST present? (.storybook/ + JSONs)
#                    This is what CONFIDENT means and is what this gate uniquely asserts.
#   install_warn   — has `npm install` finished so dev/build will run? An ENVIRONMENT concern,
#                    orthogonal to story correctness. Surfaced as a warning, but it does NOT gate
#                    CONFIDENT — discovery + conformance are legitimately ready before install
#                    completes (clean checkout / CI / eval, where node_modules is absent).
echo "━━ Setup readiness ━━"
SB_DIR=".storybook"
discovery_warn=0
install_warn=0

if [[ -d "$SB_DIR" ]]; then
  echo "  [ok]   .storybook/ present"
else
  echo "  [warn] no .storybook/ — run install-wizard (NO_STORYBOOK)"; discovery_warn=$((discovery_warn+1))
fi

# .storybook/main.ts existing ≠ Storybook installed: `storybook init` can edit package.json
# while the package-manager install never completes — stories then "validate" but the dev
# server and `build-storybook` both fail. Verify the binary actually resolves.
if [[ -x node_modules/.bin/storybook ]] || node -e "require.resolve('storybook')" >/dev/null 2>&1; then
  echo "  [ok]   storybook installed (resolvable in node_modules)"
else
  echo "  [warn] storybook NOT installed in node_modules — main.ts may exist but dev/build will FAIL. Run your package-manager install (npm/pnpm/yarn) before authoring."
  install_warn=$((install_warn+1))
fi

missing_json=()
for j in project-inventory flows component-states prop-shapes; do
  if [[ -f "$SB_DIR/$j.json" ]]; then
    echo "  [ok]   $SB_DIR/$j.json"
  else
    echo "  [warn] $SB_DIR/$j.json missing — discovery chain not run for this signal"
    missing_json+=("$j"); discovery_warn=$((discovery_warn+1))
  fi
done

if [[ -f "$SB_DIR/project-inventory.json" ]] && command -v jq >/dev/null 2>&1; then
  ds=$(jq -r '.designSystem.dominant // "unknown"' "$SB_DIR/project-inventory.json" 2>/dev/null)
  mixed=$(jq -r '.designSystem.mixed // false' "$SB_DIR/project-inventory.json" 2>/dev/null)
  echo "  [info] dominant design system: $ds$( [[ "$mixed" == "true" ]] && echo '  ⚠ MIXED (project in transition)')"
fi

if [[ ${#missing_json[@]} -gt 0 ]]; then
  echo ""
  echo "  → States/factories may be guessed rather than read from ground truth."
  echo "    Run the discovery chain first: inventory-project.sh → extract-flows.sh → extract-states.sh → extract-prop-shapes.sh"
  if $REQUIRE_EXTRACTION; then
    echo "  ✗ --require-extraction set and ${#missing_json[@]} discovery JSON(s) missing." >&2
    exit 1
  fi
fi

# ── Phase 2: Story conformance (the gate) ───────────────────────────────────
echo ""
echo "━━ Story conformance ━━"
bash "$VALIDATE" "${PASSTHROUGH[@]}"
conformance_rc=$?

# ── Verdict ─────────────────────────────────────────────────────────────────
echo ""
if [[ $conformance_rc -eq 0 ]]; then
  if [[ $discovery_warn -eq 0 ]]; then
    # Discovery ground truth present + story conformant = CONFIDENT. A pending install is
    # noted (dev/build won't run yet) but does NOT downgrade the verdict — story correctness
    # is established independent of node_modules.
    if [[ $install_warn -gt 0 ]]; then
      echo "✓ CONFIDENT — discovery ground truth present + story conformant (note: storybook not yet installed — run your package-manager install before dev/build)."
    else
      echo "✓ CONFIDENT — setup ready + story conformant."
    fi
  else
    echo "✓ Story conformant (with $discovery_warn discovery readiness warning(s) above)."
  fi
else
  echo "✗ Story conformance FAILED — fix the checks above before shipping."
fi
exit $conformance_rc
