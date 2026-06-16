#!/usr/bin/env bash
# report-issue.sh — draft a SANITIZED GitHub issue for storybook-workbench. Agent-native feedback:
# the skill gathers the context a good report needs and hands you a ready `gh`/URL to submit.
#
# PRIVACY CONTRACT (enforced by test-report-issue.sh):
#   • Captures SHAPES / COUNTS / VERSIONS only — never source code, token VALUES, or file bodies.
#   • Makes NO network call. It writes a local body file and PRINTS a `gh issue create` command + a
#     blank-issue URL; YOU submit. Nothing leaves your machine until you run gh / open the URL.
#
# Usage:
#   report-issue.sh "Coverage shows 0 needs-story but 8 components have no story"   # the 'what happened'
#   report-issue.sh --title "..." --observed "..." --expected "..." --asked "..."
#   SB_ISSUE_REPO=owner/name report-issue.sh "..."     # override the target repo
#   report-issue.sh --help
#
# Exit: 0 wrote a draft · 2 bad invocation
set -uo pipefail

REPO="${SB_ISSUE_REPO:-strongeron/storybook-workbench}"   # the public skills repo (override via env/flag)
TITLE="" ASKED="" OBSERVED="" EXPECTED="" DESC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)     REPO="$2"; shift 2 ;;
    --title)    TITLE="$2"; shift 2 ;;
    --asked)    ASKED="$2"; shift 2 ;;
    --observed) OBSERVED="$2"; shift 2 ;;
    --expected) EXPECTED="$2"; shift 2 ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *)          DESC="${DESC:+$DESC }$1"; shift ;;
  esac
done
[[ -z "$OBSERVED" && -n "$DESC" ]] && OBSERVED="$DESC"
[[ -z "$TITLE" && -n "$OBSERVED" ]] && TITLE="${OBSERVED:0:72}"
[[ -z "$TITLE" ]] && TITLE="storybook-workbench: <describe the strange behavior>"

# ---- skill version (best-effort; this script may run from dev tree or a vendored skill) ----
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VER="unknown"
for cand in "$HERE/../bundle.json" "$HERE/../../bundle.json" "$HERE/../../../bundle.json"; do
  [[ -f "$cand" ]] && VER="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('version','unknown'))" "$cand" 2>/dev/null)" && break
done

# ---- sanitized discovery snapshot: KEYS + COUNTS only, never values ----
# Each .storybook/*.json is summarized as "<file>: key:count …" — list lengths, the storyCoverage
# source/needsCount (numbers), top-level key names. NO string values are ever emitted, so component
# names, file paths, token values, and secrets cannot leak.
snapshot() {
  [[ -d .storybook ]] || { echo "- (no .storybook/ here — run from your project root)"; return; }
  python3 - <<'PY'
import json, glob, os
def summ(p):
    try: d = json.load(open(p))
    except Exception: return f"- {os.path.basename(p)}: (unreadable)"
    bits = []
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, list): bits.append(f"{k}:{len(v)}")
            elif isinstance(v, dict): bits.append(f"{k}{{{len(v)}}}")
            elif isinstance(v, (int, float, bool)): bits.append(f"{k}={v}")
            # strings are intentionally OMITTED (could carry paths/names/values)
        # surface the coverage shape specifically (all numeric/enum — safe)
        sc = (d.get("components") or {}).get("storyCoverage") if isinstance(d.get("components"), dict) else None
        if isinstance(sc, dict):
            keep = {k: sc[k] for k in ("source", "real", "withRegisteredStory", "withColocatedStory", "needsCount") if k in sc and not isinstance(sc[k], (list, dict))}
            if keep: bits.append("storyCoverage(" + " ".join(f"{k}:{v}" for k, v in keep.items()) + ")")
    elif isinstance(d, list):
        bits.append(f"[]:{len(d)}")
    return f"- {os.path.basename(p)}: " + (" ".join(bits) if bits else "(empty)")
files = sorted(glob.glob(".storybook/*.json"))
print("\n".join(summ(f) for f in files) if files else "- (no .storybook/*.json yet — run sb-inventory first)")
PY
}

OS="$(uname -srm 2>/dev/null || echo unknown)"
NODE="$(node -v 2>/dev/null || echo 'not found')"
SB="$( { [[ -x node_modules/.bin/storybook ]] && node_modules/.bin/storybook --version 2>/dev/null; } || echo 'not found')"

BODY="$(mktemp -d)/storybook-workbench-issue.md"   # mktemp -d is portable (BSD+GNU); clean .md name inside
{
  echo "## What happened"
  echo "**Asked:** ${ASKED:-<what you asked the skill to do>}"
  echo "**Observed:** ${OBSERVED:-<the strange behavior>}"
  echo "**Expected:** ${EXPECTED:-<what you expected instead>}"
  echo ""
  echo "## Environment"
  echo "- skill: storybook-workbench v${VER}"
  echo "- os: ${OS}"
  echo "- node: ${NODE}"
  echo "- storybook: ${SB}"
  echo ""
  echo "## Discovery snapshot (shapes/counts only — no source or values)"
  snapshot
  echo ""
  echo "## Repro steps"
  echo "1. <how to reproduce>"
  echo ""
  echo "---"
  echo "_Drafted by \`report-issue.sh\` (sanitized; no telemetry). Maintainer loop: reproduce → add an eval case → fix → field-learnings._"
} > "$BODY"

echo "══ storybook-workbench — issue draft (sanitized: shapes/counts/versions only) ══"
echo ""
echo "Body written → $BODY"
echo ""
echo "Submit it (nothing was sent — this script makes NO network call):"
echo "  gh issue create --repo ${REPO} --title \"${TITLE}\" --body-file \"${BODY}\""
echo "Or open a blank issue and paste the body:"
echo "  https://github.com/${REPO}/issues/new"
echo ""
echo "Review/edit ${BODY} before submitting. Set SB_ISSUE_REPO to change the target repo."
