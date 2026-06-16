#!/usr/bin/env bash
# audit-controls.sh — Controls-panel coverage audit (part of the sb-audit periodic gate).
#
# Good practice: every COMPONENT story should expose a usable Controls panel — it's the
# reviewer's prop sandbox and powers the autodocs ArgTypes table. The Storybook react-vite
# default (react-docgen) does NOT infer TS unions into selects, so a component story should
# either declare `argTypes` (unions → select/inline-radio, flags → boolean, group via
# table.category, hide non-serializable props) OR disable controls when it's render-only /
# has no scalar props (`parameters: { controls: { disable: true } }`).
#
# This script flags component stories that have `component:` + `args:` but NEITHER argTypes
# nor a controls-disable — the "missing Controls" candidates — and warns if the manager isn't
# configured to show the addons panel by default (so reviewers don't conclude "no Controls"
# after an accidental `A` keypress hides the panel).
#
# Usage:
#   audit-controls.sh [ROOT]      # ROOT defaults to the current dir; scans **/*.stories.tsx
#
# Exit codes:
#   0  no missing-Controls candidates
#   1  one or more component stories are missing Controls wiring (review them)
#   2  bad invocation

set -uo pipefail
ROOT="${1:-.}"

if [[ ! -d "$ROOT" ]]; then
  echo "ERROR: '$ROOT' is not a directory" >&2
  exit 2
fi

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""; fi

flagged=0; ok=0; disabled=0; skipped=0
FLAGS=()

while IFS= read -r f; do
  # Only component stories matter — a meta with no `component:` is a composition/showcase set.
  grep -q "component:" "$f" || { skipped=$((skipped+1)); continue; }
  # A component story with no `args:` anywhere is render-only — Controls don't apply.
  grep -q "args:" "$f"      || { skipped=$((skipped+1)); continue; }

  has_argtypes=0; has_disable=0
  grep -q "argTypes" "$f" && has_argtypes=1
  grep -Eq "controls:\s*\{\s*disable:\s*true" "$f" && has_disable=1

  if [[ $has_argtypes -eq 1 ]]; then
    ok=$((ok+1))
  elif [[ $has_disable -eq 1 ]]; then
    disabled=$((disabled+1))
  else
    flagged=$((flagged+1))
    FLAGS+=("$f")
  fi
done < <(find "$ROOT" -name "*.stories.tsx" -not -path "*/node_modules/*" | sort)

echo "${GREEN}━━ Controls-panel coverage ━━${RESET}"
echo "  ${GREEN}argTypes wired:${RESET} $ok    ${DIM}controls disabled (render-only/no-scalar):${RESET} $disabled    ${DIM}skipped (no component/args):${RESET} $skipped"
echo

if [[ $flagged -gt 0 ]]; then
  echo "${RED}Missing Controls (${flagged}) — component stories with args but no argTypes and no controls-disable:${RESET}"
  for f in "${FLAGS[@]}"; do echo "  ${RED}✗${RESET} $f"; done
  echo "${DIM}↳ Wire argTypes (unions → control:'select'+options, flags → boolean, group via table.category,"
  echo "  hide className/refs/callbacks/data) — or disable controls if it's render-only. See sb-stories"
  echo "  references/without-mcp.md §13.${RESET}"
  echo
fi

# Manager panel-visibility check — the Controls panel is useless if the dock is hidden by default.
MANAGER=""
for cand in "$ROOT/.storybook/manager.ts" "$ROOT/.storybook/manager.tsx" "$ROOT/.storybook/manager.js"; do
  [[ -f "$cand" ]] && MANAGER="$cand" && break
done
if [[ -z "$MANAGER" ]]; then
  echo "${YELLOW}⚠ No .storybook/manager.ts — the addons panel has no enforced default.${RESET}"
  echo "${DIM}  Add one so Controls show by default (sb-setup align step):"
  echo "    import { addons } from 'storybook/manager-api'"
  echo "    addons.setConfig({ showPanel: true, panelPosition: 'bottom' })${RESET}"
elif ! grep -q "showPanel" "$MANAGER"; then
  echo "${YELLOW}⚠ $MANAGER exists but does not set showPanel — Controls may stay hidden if a user toggled the panel off.${RESET}"
else
  echo "${GREEN}✓ manager sets showPanel${RESET} ($MANAGER)"
fi

# manager.ts only sets the DEFAULT — Storybook persists per-browser layout in localStorage, so a
# stored "panel hidden" state (one accidental `A` keypress) overrides it and the panel stays gone
# even with showPanel:true. This is the most common "no Controls" false alarm; surface the fix.
echo "${DIM}  Panel still hidden in a browser despite showPanel? It's a stored UI override, not config:"
echo "  click the sidebar and press 'A', or run on the Storybook origin —"
echo "  Object.keys(localStorage).filter(k=>k.startsWith('@storybook')).forEach(k=>localStorage.removeItem(k));location.reload()${RESET}"

[[ $flagged -gt 0 ]] && exit 1 || exit 0
