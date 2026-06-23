#!/usr/bin/env bash
# scaffold-wrapper.sh — copy Storybook-only wrappers into a project.
#
# Wrappers live in this skill's source tree at $SKILL/wrappers/. This script
# copies the selected wrappers into a target project's .storybook/wrappers/
# directory (creating it if missing) along with the barrel index.
#
# Wrappers are Storybook-only — they live under .storybook/ so Vite excludes
# them from production bundles automatically.
#
# Usage:
#   scaffold-wrapper.sh                              # interactive — prompts for tier
#   scaffold-wrapper.sh --tier 1                     # CORE only (3 wrappers)
#   scaffold-wrapper.sh --tier 2                     # CORE + EXTENDED (7 wrappers)
#   scaffold-wrapper.sh --tier 3                     # CORE + EXTENDED + ADVANCED/3D (opt-in; needs peer deps)
#   scaffold-wrapper.sh --tier 4                     # CORE + EXTENDED + DESIGN-SYSTEM (no 3D tier — the common case)
#   scaffold-wrapper.sh --flow                       # FLOW mode (AppFlowGraph + JourneyGraph)
#   scaffold-wrapper.sh AppFlowGraph                 # specific wrappers only
#   scaffold-wrapper.sh --all                        # everything incl. flow + design-system
#   scaffold-wrapper.sh --list                       # list available wrappers
#
# Exit codes:
#   0  wrappers copied
#   1  refused — target file already exists (use --force to overwrite)
#   2  bad invocation

set -uo pipefail

# Resolve skill source dir (this script lives at $SKILL/scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPERS_SRC="$SKILL_DIR/wrappers"

TIER_1=(ABCanvas StateGrid StateMatrix)
TIER_2=(StorySet StoryStrip TrackedDecision DecisionsDashboard)
TIER_3=(ShaderCanvas R3FCanvas MotionStage)
TIER_4=(TokensCanvas TokenMatrix DesignSystemHealth ProjectInventory ComponentUsage UsageExplorer IconMatrix)
FLOW=(AppFlowGraph JourneyGraph)

# Wrappers with OPTIONAL peer deps. They are copied when explicitly requested, but are
# NEVER added to the barrel's `export *` — a single re-export of one of these poisons the
# whole barrel's module graph for every consumer (e.g. rolldown-vite does NOT honor the
# `@vite-ignore` guard inside R3FCanvas, so a flow story that imports the barrel hard-fails
# at import-analysis even though the dep is only dynamically imported). Import them directly.
OPTIONAL_DEP=(R3FCanvas)
is_optional_dep() { local x; for x in ${OPTIONAL_DEP[@]+"${OPTIONAL_DEP[@]}"}; do [[ "$x" == "$1" ]] && return 0; done; return 1; }

# ---- args ----
TIER=""
SELECTED=()
FORCE=false
LIST=false
WANT_FLOW=false
WANT_3D=false
TARGET_DIR=".storybook/wrappers"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)   TIER="$2"; shift 2 ;;
    --all)    TIER="4"; WANT_FLOW=true; WANT_3D=true; shift ;;
    --flow)   WANT_FLOW=true; shift ;;
    --force)  FORCE=true; shift ;;
    --list)   LIST=true; shift ;;
    --target) TARGET_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *)        SELECTED+=("$1"); shift ;;
  esac
done

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; RESET=$'\033[0m'
if [[ ! -t 1 ]]; then GREEN=""; YELLOW=""; RED=""; CYAN=""; DIM=""; RESET=""; fi

# ---- list mode ----
if $LIST; then
  echo "${GREEN}Tier 1 — CORE${RESET}"
  for w in "${TIER_1[@]}"; do echo "  ${w}"; done
  echo "${GREEN}Tier 2 — EXTENDED${RESET}"
  for w in "${TIER_2[@]}"; do echo "  ${w}"; done
  echo "${GREEN}Tier 3 — ADVANCED${RESET}"
  for w in "${TIER_3[@]}"; do echo "  ${w}"; done
  echo "${GREEN}Tier 4 — DESIGN-SYSTEM${RESET}"
  for w in "${TIER_4[@]}"; do echo "  ${w}"; done
  echo "${GREEN}Flow — FLOW mode${RESET}"
  for w in "${FLOW[@]}"; do echo "  ${w}"; done
  exit 0
fi

# ---- resolve which wrappers to copy ----
TO_COPY=()
if [[ ${#SELECTED[@]} -gt 0 ]]; then
  TO_COPY=("${SELECTED[@]}")
elif [[ "$TIER" == "1" ]]; then
  TO_COPY=("${TIER_1[@]}")
elif [[ "$TIER" == "2" ]]; then
  TO_COPY=("${TIER_1[@]}" "${TIER_2[@]}")
elif [[ "$TIER" == "3" ]]; then
  TO_COPY=("${TIER_1[@]}" "${TIER_2[@]}" "${TIER_3[@]}")
elif [[ "$TIER" == "4" ]]; then
  # DESIGN-SYSTEM tier = CORE + EXTENDED + DESIGN-SYSTEM. The ADVANCED/3D tier (tier 3) is
  # intentionally EXCLUDED — those wrappers carry optional peer deps and must not be scaffolded
  # onto a non-3D app (the common case). Use --tier 3 or --all to opt into the 3D wrappers.
  TO_COPY=("${TIER_1[@]}" "${TIER_2[@]}" "${TIER_4[@]}")
elif ! $WANT_FLOW; then
  echo "${YELLOW}No tier or wrapper names specified.${RESET}"
  echo "Run with --tier 1|2|3|4, --flow, --all, --list, or specific wrapper names."
  exit 2
fi
# --all re-adds the ADVANCED/3D tier (tier 4 excludes it by default)
if $WANT_3D; then
  for w in "${TIER_3[@]}"; do
    case " ${TO_COPY[*]:-} " in *" $w "*) ;; *) TO_COPY+=("$w") ;; esac
  done
fi
# --flow adds the two flow wrappers to whatever was selected (or stands alone)
if $WANT_FLOW; then
  for w in "${FLOW[@]}"; do
    case " ${TO_COPY[*]:-} " in *" $w "*) ;; *) TO_COPY+=("$w") ;; esac
  done
fi

# ---- validate wrappers exist in source ----
for w in "${TO_COPY[@]}"; do
  if [[ ! -f "$WRAPPERS_SRC/${w}.tsx" ]]; then
    echo "${RED}ERROR:${RESET} wrapper '${w}' not found in $WRAPPERS_SRC"
    echo "Run with --list to see available wrappers."
    exit 2
  fi
done

# ---- ensure target dir exists ----
mkdir -p "$TARGET_DIR"

# ---- copy files ----
COPIED=()
SKIPPED=()
for w in "${TO_COPY[@]}"; do
  src="$WRAPPERS_SRC/${w}.tsx"
  dst="$TARGET_DIR/${w}.tsx"
  if [[ -f "$dst" ]] && ! $FORCE; then
    SKIPPED+=("$w")
    continue
  fi
  cp "$src" "$dst"
  COPIED+=("$w")
done

# ---- always copy the shared support files ----
# icons.tsx is the ONE wrapper icon language; ReportIntro.tsx is the shared "what is this /
# where from" orientation banner (OFF by default — reachable on demand via setProvenance() /
# __SB_WB_PROVENANCE__) imported by the report wrappers (ProjectInventory, AppFlowGraph,
# DesignSystemHealth, ComponentUsage, TokenMatrix, DecisionsDashboard) and the experiment banner
# imported by ABCanvas. usage-index.tsx is the where-is-this-used resolver imported by TokenMatrix +
# UsageExplorer. usage-stamp.tsx is the shared header/lane/chip/legend primitives + the component-pages
# data loader, imported by UsageExplorer, ComponentContext AND IconMatrix. ComponentContext.tsx is the per-component
# "Where it's used" map that UsageSection renders on every component's Docs page. Force-copied so a copied
# wrapper never loses a dependency. (Color comes from the app's CSS vars — var(--color-*) — not a JS palette.)
# resolve-paint.ts is the shared bare-channel-OKLCH paint helper imported by every swatch surface
# (swatches, TokensCanvas, usage-stamp, TokenMatrix) — force-copied so a vendored swatch wrapper
# never ships importing a missing './resolve-paint'.
for shared_file in icons.tsx swatches.tsx usage-badge.tsx ReportIntro.tsx usage-index.tsx usage-stamp.tsx ComponentContext.tsx resolve-paint.ts; do
  if [[ -f "$WRAPPERS_SRC/$shared_file" ]]; then
    if [[ ! -f "$TARGET_DIR/$shared_file" ]] || $FORCE; then
      cp "$WRAPPERS_SRC/$shared_file" "$TARGET_DIR/$shared_file"
    fi
  fi
done

# ---- copy the layout-aware global decorator ----
# withLayoutFrame makes the global frame follow each story's `layout` parameter instead of
# blanket-forcing 100vh (which buries primitives like Badge/Button in viewport-tall whitespace).
# It lives in .storybook/decorators/ and must be registered LAST in preview.tsx's `decorators`
# array. See wrapper-library.md ("Layout & previews") and sb-setup install-wizard item 10.
DECORATORS_SRC="$SKILL_DIR/decorators"
DECORATORS_DIR="$(dirname "$TARGET_DIR")/decorators"
DECORATOR_COPIED=false
if [[ -f "$DECORATORS_SRC/withLayoutFrame.tsx" ]]; then
  mkdir -p "$DECORATORS_DIR"
  if [[ ! -f "$DECORATORS_DIR/withLayoutFrame.tsx" ]] || $FORCE; then
    cp "$DECORATORS_SRC/withLayoutFrame.tsx" "$DECORATORS_DIR/withLayoutFrame.tsx"
    DECORATOR_COPIED=true
  fi
fi

# ---- emit a barrel index.ts that re-exports only the copied wrappers ----
INDEX_FILE="$TARGET_DIR/index.ts"
if [[ -f "$INDEX_FILE" ]] && ! $FORCE; then
  echo "${YELLOW}↳ index.ts exists at $INDEX_FILE — skipping (use --force to regenerate)${RESET}"
else
  {
    echo "// Storybook-only wrapper library — auto-generated by scaffold-wrapper.sh"
    echo "// Re-run the scaffolder to regenerate after adding/removing wrappers."
    echo ""
    for w in "${TO_COPY[@]}"; do
      if is_optional_dep "$w"; then
        echo "// '${w}' is NOT barrel-exported (optional peer deps would break the barrel under eager bundlers)."
        echo "// Import it directly where used:  import { ${w} } from './${w}';"
      else
        echo "export * from './${w}';"
      fi
    done
  } > "$INDEX_FILE"
fi

# ---- summary ----
echo ""
echo "${GREEN}━━ scaffold-wrapper.sh ━━${RESET}"
echo "Source: $WRAPPERS_SRC"
echo "Target: $TARGET_DIR"
echo ""
if [[ ${#COPIED[@]} -gt 0 ]]; then
  echo "${GREEN}Copied (${#COPIED[@]}):${RESET}"
  for w in "${COPIED[@]}"; do echo "  ${GREEN}+${RESET} ${w}.tsx"; done
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo ""
  echo "${YELLOW}Skipped — already exist (${#SKIPPED[@]}):${RESET}"
  for w in "${SKIPPED[@]}"; do echo "  ${YELLOW}=${RESET} ${w}.tsx"; done
  echo "${DIM}↳ pass --force to overwrite${RESET}"
fi
echo ""
echo "${DIM}Use:${RESET}"
echo "  import { ABCanvas, TrackedDecision } from './$TARGET_DIR';"

if $DECORATOR_COPIED; then
  echo ""
  echo "${GREEN}+${RESET} decorators/withLayoutFrame.tsx ${DIM}(layout-aware global frame)${RESET}"
  echo "${YELLOW}↳ Register it LAST in .storybook/preview.tsx so primitives stop sitting in 100vh whitespace:${RESET}"
  echo "${DIM}    import { withLayoutFrame } from './decorators/withLayoutFrame';${RESET}"
  echo "${DIM}    const preview = { decorators: [/* providers… */, withLayoutFrame], ... };${RESET}"
  echo "${DIM}  Then set per-story layout: 'centered' (primitives) / 'fullscreen' (pages+report wrappers).${RESET}"
fi

# ---- dependency reminders ----
for w in "${COPIED[@]}"; do
  case "$w" in
    R3FCanvas)
      echo ""
      echo "${YELLOW}⚠${RESET} R3FCanvas requires @react-three/fiber. Install if not present:"
      echo "${DIM}  npm install --save-dev @react-three/fiber @react-three/drei three${RESET}"
      ;;
    DesignSystemHealth)
      echo ""
      echo "${YELLOW}⚠${RESET} DesignSystemHealth reads .storybook/design-system-health.json."
      echo "${DIM}  Generate it with the sb-health skill (validate-design-system.sh) — install it too if you only have sb-wrappers.${RESET}"
      ;;
    TokensCanvas)
      echo ""
      echo "${CYAN}ⓘ${RESET} TokensCanvas auto-discovers tokens from Tailwind v4 @theme, shadcn cssVars,"
      echo "${DIM}  plain :root CSS vars, and DTCG tokens.json. No additional setup required.${RESET}"
      ;;
    ProjectInventory)
      echo ""
      echo "${YELLOW}⚠${RESET} ProjectInventory reads .storybook/project-inventory.json."
      echo "${DIM}  Generate it with the sb-inventory skill (inventory-project.sh) — install it too if you only have sb-wrappers.${RESET}"
      echo "${DIM}  Run this FIRST when meeting a new project — replaces trusting CLAUDE.md/AGENTS.md.${RESET}"
      ;;
    UsageExplorer)
      echo ""
      echo "${YELLOW}⚠${RESET} UsageExplorer reads .storybook/component-pages.json (the bidirectional usage graph)."
      echo "${DIM}  Generate it with refresh-usage.sh — it runs the inventory (sb-inventory) + usage + flows (sb-flows)${RESET}"
      echo "${DIM}  extractors then build-component-pages.py, which composes the token⇄component⇄page graph.${RESET}"
      echo "${DIM}  The one 'where is this used?' surface: pick a token/component/page → full context, both directions.${RESET}"
      echo "${CYAN}ⓘ${RESET} Ready-made story — drop into your Skill/Audit (or any) story group:"
      cat <<'STORY'
        import type { Meta, StoryObj } from "@storybook/react-vite"
        import { UsageExplorer } from "@sb-wrappers/UsageExplorer"
        const meta = { title: "Skill/Audit", parameters: { layout: "fullscreen" } } satisfies Meta
        export default meta
        // `focus` (+ optional `focusKind`) lets other surfaces deep-link here pre-selected: TokenMatrix's
        // "see all →" passes a token; a component Docs page's ComponentContext passes focusKind=component.
        export const Usage: StoryObj = {
          name: "Usage explorer (where is it used)",
          args: { focus: "", focusKind: "token" },
          render: (a: { focus?: string; focusKind?: "token" | "component" | "page" }) =>
            <UsageExplorer initialKind={a.focusKind || "token"} initialId={a.focus || undefined} />,
        }
STORY
      ;;
    IconMatrix)
      echo ""
      echo "${YELLOW}⚠${RESET} IconMatrix scans your /src live (Vite import.meta.glob) — no JSON, no install of an icon pkg."
      echo "${DIM}  Library-agnostic: it never imports an icon package. YOUR story passes the library metadata and a${RESET}"
      echo "${DIM}  resolve(name)→component fn, so it works for lucide-react, phosphor, heroicons, etc.${RESET}"
      echo "${CYAN}ⓘ${RESET} Ready-made story — drop into Foundations (set your library + resolve):"
      cat <<'STORY'
        import type { Meta, StoryObj } from "@storybook/react-vite"
        import * as Lucide from "lucide-react"
        import { IconMatrix, type IconCmp } from "@sb-wrappers/IconMatrix"
        const resolve = (n: string): IconCmp | undefined => (Lucide as Record<string, unknown>)[n] as IconCmp | undefined
        const meta = { title: "Foundations/Icons", parameters: { layout: "fullscreen" }, tags: ["autodocs"] } satisfies Meta
        export default meta
        export const Coverage: StoryObj = {
          render: () => (
            <IconMatrix
              library={{ name: "lucide-react", version: "0.552.0", site: "https://lucide.dev/icons/", npm: "https://www.npmjs.com/package/lucide-react" }}
              resolve={resolve}
              exclude={["LucideIcon"]}  // a library's icon TYPE export, not a glyph
            />
          ),
        }
STORY
      ;;
    AppFlowGraph)
      echo ""
      echo "${CYAN}ⓘ${RESET} AppFlowGraph renders an AppGraph you derive from .storybook/flows.json"
      echo "${DIM}  (routes + edges + navSources). Dependency-free SVG; no install. See references/flow-capture.md.${RESET}"
      echo "${DIM}  Personalize: pass your project's icons via the icons={{ entry, modal, ... }} prop${RESET}"
      echo "${DIM}  (e.g. lucide-react). Defaults are inline SVG — NO emoji.${RESET}"
      echo "${DIM}  Themes off your app's CSS vars (var(--color-foreground|surface|border-subtle, …));${RESET}"
      echo "${DIM}  a .dark flip re-skins it. Keep the var() chrome — only coverage/edge data colors are literal.${RESET}"
      ;;
    JourneyGraph)
      echo ""
      echo "${CYAN}ⓘ${RESET} JourneyGraph renders ONE flow as a vertical journey map for the Flows/* Docs page."
      echo "${DIM}  Step kinds: screen · action · modal · end — each gets its own icon + badge ring.${RESET}"
      echo "${DIM}  Personalize via icons={{ screen, action, modal, end, link }} (e.g. lucide). NO emoji.${RESET}"
      echo "${DIM}  Long labels/details wrap (no overflow); a step with a storyId becomes a deep-link.${RESET}"
      echo "${DIM}  Keep a curated journey ~3-12 steps (Docs column); the whole map at scale → AppFlowGraph.${RESET}"
      echo "${DIM}  Coverage demo of all kinds + lengths: references/wrapper-library.md → <JourneyGraph>.${RESET}"
      ;;
  esac
done

exit 0
