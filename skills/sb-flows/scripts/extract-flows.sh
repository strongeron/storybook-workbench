#!/usr/bin/env bash
# extract-flows.sh — Phase 3 ground truth: routes + flows + overlays + edges + nav.
#
# Discovers every navigable surface in the app so the agent knows what page
# and flow stories to author — AND how those surfaces connect. Route NODES are
# only half the picture; an audit of "all connections" must also enumerate the
# EDGES between them and every SOURCE of navigation (not just page bodies).
# That second half is what a page-body-only sweep misses (the classic miss:
# the always-present sidebar/header/footer chrome).
#
# Detects (programmatically — no LLM judgment):
#   ROUTE NODES
#   1. React Router routes (<Route path=...>)
#   2. Next.js Pages Router (pages/**, excludes pages/api)
#   3. Next.js App Router (app/**/page.tsx)
#   4. TanStack Router file-based routes (routes/**)
#   4b. Inertia / generic imperative router (router.get/post/visit("/path"))
#       — covers Inertia-static (Rails/Laravel adapters), wouter, and any
#         "router.<verb>('/path')" convention the 4 file-based flavors miss.
#   5. Ad-hoc page switchers (const [page, setPage] = useState plus setPage())
#   6. Wizard / step machines (useState plus step OR setStep with numeric flow)
#   7. Modal/Dialog/Sheet overlays (<Dialog open=...>, <Modal open=...>)
#   EDGES + SOURCES (v1.13 — the connection half)
#   8. Navigation edges (<Link href/to>, router.visit/get/post, internal <a href>)
#   9. Persistent-nav sources (sidebar/header/footer/nav chrome — the layout
#      that links from every screen, so it is NEVER found by a page-body sweep)
#
# Output: writes .storybook/flows.json plus prints human summary.
#
# Usage:
#   extract-flows.sh                # scan ./src, ./app, ./pages
#   extract-flows.sh path/to/src    # custom scan path
#   extract-flows.sh --out file     # custom output path
#
# Exit codes:
#   0  flows written
#   1  no routes AND no ad-hoc switcher found (probably static site / library)
#   2  bad invocation

set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found in PATH. Install python3 (Alpine: apk add python3; Debian: apt install python3)." >&2; exit 2; }

OUT_PATH=".storybook/flows.json"
SCAN_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) SCAN_PATHS+=("$1"); shift ;;
  esac
done

if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  # Single-app layouts
  for cand in src app pages app/frontend; do
    [[ -d "$cand" ]] && SCAN_PATHS+=("$cand")
  done
  # Monorepo layouts (packages/*/src, apps/*/src) — common with pnpm/turbo/nx
  for parent in packages apps; do
    if [[ -d "$parent" ]]; then
      while IFS= read -r d; do
        SCAN_PATHS+=("$d")
      done < <(find "$parent" -maxdepth 3 -type d \( -name src -o -name app \) 2>/dev/null | head -20)
    fi
  done
fi
if [[ ${#SCAN_PATHS[@]} -eq 0 ]]; then
  echo "ERROR: no scan path found. Tried src/, app/, pages/, packages/*/src, apps/*/src. Pass an explicit path." >&2
  exit 2
fi

# Next.js signal gate. A `pages/` or `src/pages/` directory is NOT proof of
# Next.js — react-router and plain Vite apps use `pages/` for view modules too.
# Only classify pages/ + app/**/page.tsx as Next routes when there's an actual
# Next.js signal (the `next` dependency or a next.config file). Without this gate
# a react-router app with a pages/ folder reports phantom nextjs-pages routes.
IS_NEXT=0
if [[ -f package.json ]] && grep -qE '"next"[[:space:]]*:' package.json 2>/dev/null; then
  IS_NEXT=1
fi
for cfg in next.config.js next.config.mjs next.config.ts next.config.cjs; do
  [[ -f "$cfg" ]] && IS_NEXT=1
done

TMP_REACT_ROUTES=$(mktemp)
TMP_NEXT_PAGES=$(mktemp)
TMP_NEXT_APP=$(mktemp)
TMP_TANSTACK=$(mktemp)
TMP_INERTIA=$(mktemp)
TMP_NANOSTORES=$(mktemp)
TMP_ADHOC=$(mktemp)
TMP_WIZARDS=$(mktemp)
TMP_OVERLAYS=$(mktemp)
TMP_EDGES=$(mktemp)
TMP_NAV=$(mktemp)
TMP_NAVCAND=$(mktemp)
TMP_ROLES=$(mktemp)
trap 'rm -f $TMP_REACT_ROUTES $TMP_NEXT_PAGES $TMP_NEXT_APP $TMP_TANSTACK $TMP_INERTIA $TMP_NANOSTORES $TMP_ADHOC $TMP_WIZARDS $TMP_OVERLAYS $TMP_EDGES $TMP_NAV $TMP_NAVCAND $TMP_ROLES' EXIT

# ─── 1. React Router (<Route ... path=...>) ─────────────────────────────────
# Two-pass: catches both single-line (`<Route path="/x">`) and Prettier multi-line
# (`<Route\n  path="/x"\n>`). Without the second pass, Prettier-formatted apps
# report 0 routes — the dominant production failure mode.
for p in "${SCAN_PATHS[@]}"; do
  # Pass A — single-line declarations
  grep -rEn "<Route\s+[^>]*path\s*=" "$p" --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | head -200 >> "$TMP_REACT_ROUTES" || true

  # Pass B — multi-line declarations. Read each file once, scan for <Route then
  # the first path= within ~10 lines. Uses POSIX bracket classes (not GNU `\s`)
  # so the awk runs portably on macOS BSD awk.
  while IFS= read -r f; do
    awk -v file="$f" '
      /<Route([[:space:]]|$)/ { in_route=1; route_start=NR; next }
      in_route && /path[[:space:]]*=[[:space:]]*["'\''{]/ {
        print file ":" route_start ":" $0
        in_route=0; next
      }
      in_route && NR - route_start > 10 { in_route=0 }
    ' "$f" 2>/dev/null
  done < <(grep -rl "<Route" "$p" --include="*.tsx" --include="*.jsx" 2>/dev/null \
            | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
            | head -200) >> "$TMP_REACT_ROUTES" || true
done

# Dedupe by file:line (single-line + multi-line passes may overlap)
sort -u -t: -k1,2 "$TMP_REACT_ROUTES" -o "$TMP_REACT_ROUTES" 2>/dev/null || true

# ─── 2. Next.js Pages Router (pages/*.tsx, excludes pages/api/) ─────────────
# Gated on IS_NEXT — pages/ without a Next.js signal is not a Next router.
if [[ $IS_NEXT -eq 1 ]]; then
  if [[ -d pages ]]; then
    find pages -type f \( -name "*.tsx" -o -name "*.jsx" \) -not -path "*/api/*" -not -name "_*" \
      2>/dev/null > "$TMP_NEXT_PAGES" || true
  fi
  if [[ -d src/pages ]]; then
    find src/pages -type f \( -name "*.tsx" -o -name "*.jsx" \) -not -path "*/api/*" -not -name "_*" \
      2>/dev/null >> "$TMP_NEXT_PAGES" || true
  fi
fi

# ─── 3. Next.js App Router (app/**/page.tsx) ────────────────────────────────
# Ungated: the `app/**/page.tsx` filename is a Next-App-Router-specific convention
# (unlike generic `pages/`), distinctive enough to classify on its own.
for p in app src/app; do
  [[ -d "$p" ]] && find "$p" -type f -name "page.tsx" 2>/dev/null >> "$TMP_NEXT_APP" || true
done

# ─── 4. TanStack Router file-based (routes/**) ──────────────────────────────
for p in src/routes app/routes; do
  [[ -d "$p" ]] && find "$p" -type f \( -name "*.tsx" -o -name "*.jsx" \) 2>/dev/null \
    | grep -v "__root" >> "$TMP_TANSTACK" || true
done

# ─── 4b. Inertia / generic imperative router (router.get/post/visit("/x")) ──
# The file-based flavors (1-4) miss apps whose routes are declared imperatively
# in a TS/JS adapter: Inertia-static (Rails/Laravel), wouter, custom routers.
# Pattern: a `router.<verb>("/path"` or `Router.<verb>("/path"` string literal.
# Scan .ts AND .tsx/.jsx — adapters are frequently plain .ts with no JSX.
for p in "${SCAN_PATHS[@]}"; do
  grep -rEn "(^|[^A-Za-z])[Rr]outer\.(get|post|put|patch|delete|visit|replace)\s*\(\s*[\"'\`]/" "$p" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
    | head -200 >> "$TMP_INERTIA" || true
done
sort -u -t: -k1,2 "$TMP_INERTIA" -o "$TMP_INERTIA" 2>/dev/null || true

# ─── 4c. nanostores router (@nanostores/router — createRouter({name:'/path'})) ─
# nanostores declares routes as a name→pattern object map (often a `routePatterns`
# const) passed to createRouter(). All file-based + imperative flavors miss it, so
# a nanostores app reports routeCount:0. Gate on the createRouter() CALL SITE (rare —
# the one router-definition file), NOT the @nanostores/router import (which every store
# consumer pulls in; gating on the import + head cap drops the actual definition file).
# Then extract each `name: "/path"` (bare or quoted key, value starting with "/").
for p in "${SCAN_PATHS[@]}"; do
  while IFS= read -r f; do
    # Pass A — single-line `name: "/path"`
    grep -nE "[\"']?[A-Za-z0-9_-]+[\"']?[[:space:]]*:[[:space:]]*[\"']/[^\"']*[\"']" "$f" 2>/dev/null \
      | sed "s|^|$f:|" \
      | head -200
    # Pass B — multi-line: a bare/quoted KEY alone on a line (Prettier wraps long
    # route entries so the "/path" value lands on the NEXT line). Pass A (same-line)
    # misses these — the classic nanostores under-extraction. Synthesize a
    # `key: "/path"` snippet so the Python parser reads name + path identically.
    awk -v file="$f" '
      /^[[:space:]]*"?[A-Za-z0-9_-]+"?[[:space:]]*:[[:space:]]*$/ {
        k=$0; sub(/^[[:space:]]+/,"",k); sub(/[[:space:]]*:[[:space:]]*$/,"",k); gsub(/"/,"",k)
        key=k; keyline=NR; pend=1; next
      }
      pend==1 {
        if (match($0, /"\/[^"]*"/)) { print file ":" keyline ":" key ": " substr($0,RSTART,RLENGTH) }
        pend=0
      }
    ' "$f" 2>/dev/null | head -200
  done < <(grep -rlE "createRouter[[:space:]]*\(" "$p" \
            --include="*.ts" --include="*.tsx" 2>/dev/null \
            | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
            | head -20) >> "$TMP_NANOSTORES" || true
done
sort -u -t: -k1,2 "$TMP_NANOSTORES" -o "$TMP_NANOSTORES" 2>/dev/null || true

# ─── 5. Ad-hoc page switcher (const [page, setPage] = useState) ─────────────
for p in "${SCAN_PATHS[@]}"; do
  grep -rEln "const\s+\[\s*(page|view|screen|tab|currentPage|activePage)\s*,\s*set" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | head -50 >> "$TMP_ADHOC" || true
done

# ─── 6. Wizard / step machine ───────────────────────────────────────────────
for p in "${SCAN_PATHS[@]}"; do
  # (a) by conventional state name: const [step, setStep] = useState<number>
  grep -rEln "const\s+\[\s*(step|currentStep|activeStep|stepIndex)\s*,\s*set(Step|CurrentStep|ActiveStep)" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | head -50 >> "$TMP_WIZARDS" || true
  # (b) by component shape: a *Wizard/Stepper/Onboarding/Checkout/MultiStep
  #     component that uses useState — catches arbitrary step vars (e.g. `i`/`setI`)
  #     that pass (a) misses. POSIX patterns (BSD/GNU grep safe).
  grep -rElE "(function|const)[[:space:]]+[A-Za-z0-9_]*(Wizard|Stepper|Onboarding|Checkout|MultiStep)" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | while IFS= read -r f; do grep -qE "useState" "$f" 2>/dev/null && echo "$f"; done \
    | head -50 >> "$TMP_WIZARDS" || true
done
sort -u "$TMP_WIZARDS" -o "$TMP_WIZARDS" 2>/dev/null || true

# ─── 7. Modal / Dialog / Sheet overlays (<Dialog open={...}>) ───────────────
# Same multi-line treatment as <Route> — Prettier wraps prop-heavy overlay tags.
for p in "${SCAN_PATHS[@]}"; do
  # Pass A — single-line
  grep -rEn "<(Dialog|Modal|Sheet|Drawer|Popover|AlertDialog)\s+[^>]*\bopen\s*=" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | head -100 >> "$TMP_OVERLAYS" || true

  # Pass B — multi-line (POSIX awk, no GNU `\s` / `\b`)
  while IFS= read -r f; do
    awk -v file="$f" '
      /<(Dialog|Modal|Sheet|Drawer|Popover|AlertDialog)([[:space:]]|$)/ { in_tag=1; tag_start=NR; next }
      in_tag && /[[:space:]]open[[:space:]]*=/ {
        print file ":" tag_start ":" $0
        in_tag=0; next
      }
      in_tag && NR - tag_start > 10 { in_tag=0 }
    ' "$f" 2>/dev/null
  done < <(grep -rl -E "<(Dialog|Modal|Sheet|Drawer|Popover|AlertDialog)" "$p" --include="*.tsx" --include="*.jsx" 2>/dev/null \
            | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
            | head -100) >> "$TMP_OVERLAYS" || true

  # Pass C — custom overlays: role="dialog"/"alertdialog" gated by an open prop
  #          (modals built as <div role="dialog"> rather than a named <Dialog> tag).
  #          Only counted when the file ALSO carries an open/isOpen prop, so a
  #          static role=dialog landmark isn't mistaken for a controllable overlay.
  #          Skip files a named-tag pass (A/B) already matched — otherwise a
  #          <Dialog role="dialog"> element double-counts as two overlays.
  while IFS= read -r f; do
    grep -qE "([^A-Za-z]open[[:space:]]*[:=?]|isOpen)" "$f" 2>/dev/null || continue
    cut -d: -f1 "$TMP_OVERLAYS" 2>/dev/null | grep -Fxq "$f" && continue
    grep -nE "role[[:space:]]*=[[:space:]]*[\"'{]*(dialog|alertdialog)" "$f" 2>/dev/null | head -1 | sed "s|^|$f:|"
  done < <(grep -rlE "role[[:space:]]*=[[:space:]]*[\"'{]*(dialog|alertdialog)" "$p" --include="*.tsx" --include="*.jsx" 2>/dev/null \
            | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
            | head -100) >> "$TMP_OVERLAYS" || true
done

sort -u -t: -k1,2 "$TMP_OVERLAYS" -o "$TMP_OVERLAYS" 2>/dev/null || true

# ─── 8. Navigation EDGES (the connections, not just the nodes) ──────────────
# A route inventory lists destinations; an edge inventory lists how you GET
# there. Without edges you cannot prove a flow is fully captured. Sources:
#   <Link href="/x"> / <Link to="/x">   (react-router, Inertia, Next)
#   router.visit/get/post("/x")          (Inertia, imperative)
#   <a href="/x">                        (internal anchors — leading slash only,
#                                         so external https:// links are excluded)
for p in "${SCAN_PATHS[@]}"; do
  # <Link href=/to=> — capture the target literal
  grep -rEn "<Link\s+[^>]*\b(href|to)\s*=\s*[\"'\`]/" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | sed -E 's/^/link:/' | head -300 >> "$TMP_EDGES" || true
  # router.visit/get/post — imperative navigation edges (Inertia & friends)
  grep -rEn "(^|[^A-Za-z])[Rr]outer\.(visit|get|post|replace)\s*\(\s*[\"'\`]/" "$p" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
    | sed -E 's/^/visit:/' | head -300 >> "$TMP_EDGES" || true
  # internal <a href="/x"> anchors (leading slash → in-app, not external)
  grep -rEn "<a\s+[^>]*href\s*=\s*[\"']/" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | sed -E 's/^/anchor:/' | head -200 >> "$TMP_EDGES" || true
  # nanostores imperative edges: openPage/redirectPage/replacePage($router, "routeName").
  # The file-based/anchor edge passes above NEVER see these (nanostores apps navigate
  # by route NAME via @nanostores/router, not href/Link/router.visit) — the classic
  # "nanostores app reports ~0 edges" miss. The target is a route NAME; the Python layer
  # resolves it to a path via the nanostores route map.
  grep -rEn "(openPage|redirectPage|replacePage)\s*\(\s*\\\$?router\s*,\s*[\"'][A-Za-z0-9_-]+[\"']" "$p" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
    | sed -E 's/^/openpage:/' | head -300 >> "$TMP_EDGES" || true
  # nanostores imperative edges: $router.open/replace("routeName")
  grep -rEn "\\\$?router\.(open|replace)\s*\(\s*[\"'][A-Za-z0-9_-]+[\"']" "$p" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
    | sed -E 's/^/routeropen:/' | head -300 >> "$TMP_EDGES" || true
  # Multi-line form: `openPage(` (or redirect/replace) with the route NAME on a following
  # line (Prettier wraps long calls). Synthesize a single-line `openPage($router, "name")`
  # snippet so parse_edge reads it identically. Bounded 4-line lookahead.
  while IFS= read -r f; do
    awk -v file="$f" '
      /(openPage|redirectPage|replacePage)[[:space:]]*\([[:space:]]*$/ { head=NR; pend=1; next }
      pend==1 {
        if (match($0, /["'\''][A-Za-z0-9_-]+["'\'']/)) {
          tok=substr($0,RSTART,RLENGTH); gsub(/["'\'']/,"",tok)
          print file ":" head ":openPage($router, \"" tok "\")"
          pend=0
        } else if (NR-head>4) pend=0
      }
    ' "$f" 2>/dev/null | sed -E 's/^/openpage:/'
  done < <(grep -rlE "(openPage|redirectPage|replacePage)[[:space:]]*\([[:space:]]*$" "$p" \
            --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
            | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" \
            | head -100) >> "$TMP_EDGES" || true
done
# dedupe edge lines (single-line + multi-line passes may overlap on the same head)
sort -u "$TMP_EDGES" -o "$TMP_EDGES" 2>/dev/null || true

# ─── 9. Persistent-nav SOURCES (the chrome a page-body sweep never sees) ────
# Layout chrome links from EVERY screen. Because it lives outside any single
# page component, a sweep scoped to "page bodies + what they render" misses it
# entirely — the #1 audit miss. Enumerate it explicitly as its own source.
# Two signals: (a) filename convention, (b) the navigation landmark / <nav> tag.
for p in "${SCAN_PATHS[@]}"; do
  # (a) by filename — Sidebar/Navbar/Header/Footer/Nav/Menu/Layout/AppShell/TopBar.
  #     Exclude overlay PRIMITIVES whose names contain header/footer but are modal
  #     chrome, not persistent nav (ModalFooter, DialogHeader, SheetHeader, …) —
  #     field-verified false positive: a page-body sweep already covers those.
  find "$p" -type f \( -name "*.tsx" -o -name "*.jsx" \) 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | grep -iE "(sidebar|navbar|header|footer|topbar|nav-?menu|app-?shell|layout|drawer-?nav)" \
    | grep -viE "(modal|dialog|sheet|popover|toast|tooltip)" \
    | sed -E 's/^/file:/' | head -100 >> "$TMP_NAV" || true
  # (b) by landmark — <nav> element or role="navigation"
  grep -rElE "(<nav([[:space:]>])|role[[:space:]]*=[[:space:]]*[\"'{]*navigation)" "$p" \
    --include="*.tsx" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.)" \
    | sed -E 's/^/landmark:/' | head -100 >> "$TMP_NAV" || true
done
sort -u "$TMP_NAV" -o "$TMP_NAV" 2>/dev/null || true

# ─── 10. Role / access gating (WHO can reach each screen) ───────────────────
# A flow graph that ignores roles is a lie: the same route map looks completely
# different to an anonymous visitor, a signed-in user, and an admin. Capture the
# guards that gate access so the flow can be laid out in role lanes (public / user /
# admin / …) and audited per persona ("can an anon reach /billing? can a plain user
# reach /admin?"). Three signal classes, each tagged so the Python layer can classify:
#   guard  — JSX route guards: <ProtectedRoute>, <RequireAuth>, <AdminRoute>, <RoleGuard>…
#   decl   — declarative gating: requiresAuth / allowedRoles / roles:[...] / meta:{auth}
#   check  — imperative gating: requireRole(), hasRole(), user.role===, redirect to /login
# Best-effort + provenance (file:line) — the agent verifies guard→route mapping (the
# central router often declares routes AND guards in one file). See flow-capture.md
# "Step — explore roles".
for p in "${SCAN_PATHS[@]}"; do
  grep -rEn "<(ProtectedRoute|PrivateRoute|RequireAuth|RequireRole|RequireAdmin|AdminRoute|AuthGuard|RoleGuard|Authenticated|RestrictedRoute|AdminOnly|RoleBased)([[:space:]>/])" "$p" \
    --include="*.tsx" --include="*.jsx" --include="*.ts" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" | sed -E 's/^/guard:/' | head -200 >> "$TMP_ROLES" || true
  grep -rEn "(requires?Auth|required?Roles?|allowedRoles|roles?[[:space:]]*:[[:space:]]*\[|meta[[:space:]]*:[[:space:]]*\{[^}]*(auth|role))" "$p" \
    --include="*.tsx" --include="*.jsx" --include="*.ts" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" | sed -E 's/^/decl:/' | head -200 >> "$TMP_ROLES" || true
  grep -rEn "(requireRole[[:space:]]*\(|requireAuth[[:space:]]*\(|useRequire(Auth|Role)|hasRole[[:space:]]*\(|isAdmin[^A-Za-z]|(currentUser|user|session|auth)\.role[[:space:]]*===|redirect[[:space:]]*\([[:space:]]*[\"'\`]/?(login|signin))" "$p" \
    --include="*.tsx" --include="*.jsx" --include="*.ts" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" | sed -E 's/^/check:/' | head -200 >> "$TMP_ROLES" || true
done
sort -u "$TMP_ROLES" -o "$TMP_ROLES" 2>/dev/null || true

# ─── Counts ──────────────────────────────────────────────────────────────────
REACT_ROUTE_COUNT=$(wc -l < "$TMP_REACT_ROUTES" | tr -d ' ')
NEXT_PAGES_COUNT=$(wc -l < "$TMP_NEXT_PAGES" | tr -d ' ')
NEXT_APP_COUNT=$(wc -l < "$TMP_NEXT_APP" | tr -d ' ')
TANSTACK_COUNT=$(wc -l < "$TMP_TANSTACK" | tr -d ' ')
INERTIA_COUNT=$(wc -l < "$TMP_INERTIA" | tr -d ' ')
NANOSTORES_COUNT=$(wc -l < "$TMP_NANOSTORES" | tr -d ' ')
ADHOC_COUNT=$(wc -l < "$TMP_ADHOC" | tr -d ' ')
WIZARD_COUNT=$(wc -l < "$TMP_WIZARDS" | tr -d ' ')
OVERLAY_COUNT=$(wc -l < "$TMP_OVERLAYS" | tr -d ' ')
EDGE_COUNT=$(wc -l < "$TMP_EDGES" | tr -d ' ')
# Unique files, not raw signal lines — a file can match both the filename and
# landmark passes; the JSON dedupes by file, so the summary must too.
# `grep -c . || echo 0` emits '0\n0' on empty input (grep prints 0 AND exits 1, so
# the `|| echo 0` fires too) — that multiline value broke printf %d and the [[ -gt ]]
# nav-sweep guard below. awk 'NF{n++} END{print n+0}' always emits one integer
# (matches the fix already in extract-prop-shapes.sh).
NAV_COUNT=$(cut -d: -f2- "$TMP_NAV" 2>/dev/null | sort -u | awk 'NF{n++} END{print n+0}')

TOTAL_ROUTES=$((REACT_ROUTE_COUNT + NEXT_PAGES_COUNT + NEXT_APP_COUNT + TANSTACK_COUNT + INERTIA_COUNT + NANOSTORES_COUNT))

# ─── L1: under-extraction self-diagnosis ─────────────────────────────────────
# A fixed-idiom extractor silently under-reports the (N+1)th navigation convention —
# the nanostores miss reported 27 routes / 2 edges where the truth was ~46. This makes
# the miss LOUD: sweep for navigation-SHAPED call sites with a deliberately broad net,
# subtract the file:line locations already captured as edges, and surface the remainder.
# Unmatched candidates are the smoking gun for an idiom the passes above don't know yet.
# (Resolution is the agent's job — see references/flow-capture.md "When extraction under-reports".)
for p in "${SCAN_PATHS[@]}"; do
  # No \b — BSD grep -E ignores it (the rest of this script uses (^|[^A-Za-z]) for the same reason).
  grep -rEn "([A-Za-z_]*[Nn]avigate[A-Za-z]*|redirect[A-Za-z]*|openPage|redirectPage|replacePage|go[Tt]o)[[:space:]]*\(|(history|\\\$?router|navigation)\.(push|replace|open|go|visit|get|post|navigate)[[:space:]]*\(" "$p" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
    | grep -vE "(\.test\.|\.spec\.|\.stories\.|\.d\.ts)" >> "$TMP_NAVCAND" || true
done
# Normalize both to file:line, then set-subtract captured edges from candidates.
# Candidate lines are `file:line:content` → fields 1,2.  Edge lines are
# `kind:file:line:content` → fields 2,3.  (App paths carry no ':' so cut is safe.)
UNMATCHED=$(comm -23 \
  <(cut -d: -f1,2 "$TMP_NAVCAND" 2>/dev/null | sed '/^$/d' | sort -u) \
  <(cut -d: -f2,3 "$TMP_EDGES"   2>/dev/null | sed '/^$/d' | sort -u))
UNMATCHED_COUNT=$(printf '%s\n' "$UNMATCHED" | sed '/^$/d' | awk 'NF{n++} END{print n+0}')

# Determine dominant router flavor. File-based flavors win ties over the
# imperative inertia/generic flavor (a file-based convention is a stronger
# signal than scattered router.<verb> calls), so inertia is the last route
# branch before the ad-hoc fallback.
DOMINANT_ROUTER="none"
if   [[ $REACT_ROUTE_COUNT -gt 0 && $REACT_ROUTE_COUNT -ge $NEXT_PAGES_COUNT && $REACT_ROUTE_COUNT -ge $NEXT_APP_COUNT && $REACT_ROUTE_COUNT -ge $TANSTACK_COUNT ]]; then
  DOMINANT_ROUTER="react-router"
elif [[ $NEXT_APP_COUNT -gt 0 && $NEXT_APP_COUNT -ge $NEXT_PAGES_COUNT && $NEXT_APP_COUNT -ge $TANSTACK_COUNT ]]; then
  DOMINANT_ROUTER="nextjs-app"
elif [[ $NEXT_PAGES_COUNT -gt 0 && $NEXT_PAGES_COUNT -ge $TANSTACK_COUNT ]]; then
  DOMINANT_ROUTER="nextjs-pages"
elif [[ $TANSTACK_COUNT -gt 0 ]]; then
  DOMINANT_ROUTER="tanstack"
elif [[ $INERTIA_COUNT -gt 0 ]]; then
  DOMINANT_ROUTER="inertia"
elif [[ $NANOSTORES_COUNT -gt 0 ]]; then
  DOMINANT_ROUTER="nanostores"
elif [[ $ADHOC_COUNT -gt 0 ]]; then
  DOMINANT_ROUTER="adhoc-state"
fi

# ─── Write JSON output ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$OUT_PATH")"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$OUT_PATH" "$NOW" "$DOMINANT_ROUTER" \
  "$REACT_ROUTE_COUNT" "$NEXT_PAGES_COUNT" "$NEXT_APP_COUNT" "$TANSTACK_COUNT" "$INERTIA_COUNT" \
  "$ADHOC_COUNT" "$WIZARD_COUNT" "$OVERLAY_COUNT" "$EDGE_COUNT" "$NAV_COUNT" \
  "$TMP_REACT_ROUTES" "$TMP_NEXT_PAGES" "$TMP_NEXT_APP" "$TMP_TANSTACK" "$TMP_INERTIA" \
  "$TMP_ADHOC" "$TMP_WIZARDS" "$TMP_OVERLAYS" "$TMP_EDGES" "$TMP_NAV" \
  "$NANOSTORES_COUNT" "$TMP_NANOSTORES" "$TMP_ROLES" <<'PYEOF'
import json, re, sys, os, tempfile
(out, now, dominant,
 rr_n, np_n, na_n, ts_n, in_n, ah_n, wz_n, ov_n, ed_n, nv_n,
 rr_f, np_f, na_f, ts_f, in_f, ah_f, wz_f, ov_f, ed_f, nv_f,
 ns_n, ns_f, rl_f) = sys.argv[1:]

def lines(p):
    try:
        with open(p) as f:
            return [ln.rstrip() for ln in f if ln.strip()]
    except FileNotFoundError:
        return []

def parse_grep(ln):
    # "file:line:content" → dict. Uses split with maxsplit=2 so paths containing
    # colons (Windows-style ./foo:bar, or git-mv'd files with colons) still parse.
    parts = ln.split(":", 2)
    if len(parts) >= 3 and parts[1].isdigit():
        return {"file": parts[0], "line": int(parts[1]), "snippet": parts[2].strip()[:160]}
    return {"raw": ln[:200]}

def parse_route_path(snippet):
    m = re.search(r"path\s*=\s*[\"'\{]+([^\"'\}]+)", snippet)
    return m.group(1) if m else None

react_routes = []
for ln in lines(rr_f):
    g = parse_grep(ln)
    g["path"] = parse_route_path(g.get("snippet", ""))
    react_routes.append(g)

def parse_inertia_path(snippet):
    m = re.search(r"[Rr]outer\.(?:get|post|put|patch|delete|visit|replace)\s*\(\s*[\"'`]([^\"'`]+)", snippet)
    return m.group(1) if m else None

inertia_routes = []
for ln in lines(in_f):
    g = parse_grep(ln)
    g["path"] = parse_inertia_path(g.get("snippet", ""))
    inertia_routes.append(g)

def parse_nano_path(snippet):
    # `name: "/path/:id"` (bare or quoted key) → "/path/:id"
    m = re.search(r":\s*[\"'`](/[^\"'`]*)", snippet)
    return m.group(1) if m else None

def parse_nano_name(snippet):
    # leading `name:` (bare or quoted key) → "name" — needed to resolve imperative
    # openPage($router, "name") edges back to their path.
    m = re.match(r"\s*[\"'`]?([A-Za-z0-9_-]+)[\"'`]?\s*:", snippet)
    return m.group(1) if m else None

nanostores_routes = []
nano_name_to_path = {}                      # route NAME → path, for edge resolution
for ln in lines(ns_f):
    g = parse_grep(ln)
    g["path"] = parse_nano_path(g.get("snippet", ""))
    g["name"] = parse_nano_name(g.get("snippet", ""))
    if g.get("path"):                      # keep only real route-map entries
        nanostores_routes.append(g)
        if g.get("name"):
            nano_name_to_path.setdefault(g["name"], g["path"])

def file_to_route(p, kind):
    # pages/foo/bar.tsx → /foo/bar; app/foo/page.tsx → /foo
    rel = p
    rel = re.sub(r'^(\./)?(src/)?', '', rel)
    rel = re.sub(r'^pages/', '/', rel)
    rel = re.sub(r'^app/', '/', rel)
    rel = re.sub(r'/page\.tsx$', '', rel)
    rel = re.sub(r'\.(tsx|jsx)$', '', rel)
    rel = re.sub(r'/index$', '/', rel)
    rel = re.sub(r'\[([^\]]+)\]', r':\1', rel)  # [id] → :id
    return rel or "/"

next_pages = [{"file": f, "path": file_to_route(f, "nextjs-pages")} for f in lines(np_f)]
next_app   = [{"file": f, "path": file_to_route(f, "nextjs-app")} for f in lines(na_f)]
tanstack   = [{"file": f, "path": file_to_route(f, "tanstack")} for f in lines(ts_f)]

# ad-hoc + wizards: file list (deduped)
adhoc_files = sorted(set(lines(ah_f)))
wizard_files = sorted(set(lines(wz_f)))

def parse_overlay(ln):
    g = parse_grep(ln)
    m = re.search(r'<(\w+)', g.get("snippet", ""))
    if m: g["component"] = m.group(1)
    return g

overlays = [parse_overlay(ln) for ln in lines(ov_f)]

# ── Edges: how you navigate between surfaces (link / visit / anchor) ──
def parse_edge(ln):
    # lines are "<kind>:<file>:<line>:<content>" (kind prefixed by sed)
    kind, _, rest = ln.partition(":")
    g = parse_grep(rest)
    g["kind"] = kind  # link | visit | anchor | openpage | routeropen
    snip = g.get("snippet", "")
    # nanostores imperative edges navigate by route NAME, not path — resolve via the map.
    if kind in ("openpage", "routeropen"):
        m = (re.search(r'(?:openPage|redirectPage|replacePage)\s*\(\s*\$?router\s*,\s*[\"\'`]([A-Za-z0-9_-]+)', snip)
             or re.search(r'\$?router\.(?:open|replace)\s*\(\s*[\"\'`]([A-Za-z0-9_-]+)', snip))
        if m:
            name = m.group(1)
            g["toName"] = name
            g["to"] = nano_name_to_path.get(name, name)  # path if known, else the name
        g["kind"] = "openPage" if kind == "openpage" else "routerOpen"
        return g
    m = (re.search(r'(?:href|to)\s*=\s*[\"\'`]([^\"\'`]+)', snip)
         or re.search(r'[Rr]outer\.\w+\s*\(\s*[\"\'`]([^\"\'`]+)', snip)
         or re.search(r'href\s*=\s*[\"\']([^\"\']+)', snip))
    if m:
        g["to"] = m.group(1)
    return g

edges = [parse_edge(ln) for ln in lines(ed_f)]

# ── Nav sources: persistent chrome that links from every screen ──
def parse_nav(ln):
    signal, _, path = ln.partition(":")  # signal = file | landmark
    low = path.lower()
    if "sidebar" in low or "drawer" in low:        kind = "sidebar"
    elif "footer" in low:                          kind = "footer"
    elif "header" in low or "topbar" in low:       kind = "header"
    elif "layout" in low or "shell" in low:        kind = "layout"
    else:                                          kind = "nav"
    return {"file": path, "signal": signal, "kind": kind}

_seen_nav = set(); nav_sources = []
for ln in lines(nv_f):
    n = parse_nav(ln)
    if n["file"] in _seen_nav:
        continue
    _seen_nav.add(n["file"]); nav_sources.append(n)

# Flow-detection: a "flow" is a route surface OR an ad-hoc switcher OR a wizard
flow_count = (
    int(rr_n) + int(np_n) + int(na_n) + int(ts_n) + int(in_n) + len(nanostores_routes)
    + len(adhoc_files) + len(wizard_files)
)

# Per-screen story recommendations: a route should typically have ≥3 stories
# (default, loading, error) and forms/lists need empty + filled
def recommend_states(path):
    p = (path or "").lower()
    if any(k in p for k in ["login", "signin", "signup", "register", "auth"]):
        return ["empty", "filled", "submitting", "validation-error", "server-error", "success"]
    if any(k in p for k in ["list", "feed", "table", "index", "browse"]) or p in ("/",):
        return ["default", "loading", "empty", "error", "filtered", "many-items"]
    if any(k in p for k in ["detail", "show", "view", "[id]", ":id", "single"]):
        return ["default", "loading", "not-found", "error"]
    if any(k in p for k in ["settings", "profile", "edit", "form"]):
        return ["empty", "prefilled", "dirty", "submitting", "validation-error", "success"]
    if any(k in p for k in ["dashboard", "home", "overview"]):
        return ["first-visit", "returning", "empty", "loading", "partial"]
    return ["default", "loading", "error"]

# ── Roles / access: WHO can reach each screen (public / user / admin / …) ──
# Path heuristic for the lane; the role SIGNALS below carry provenance so the agent
# can verify and correct the mapping (the central router usually declares routes AND
# guards in one file, which a path heuristic alone can't resolve).
def parse_role_signal(ln):
    kind, _, rest = ln.partition(":")     # guard | decl | check
    g = parse_grep(rest)
    g["signal"] = kind
    return g
role_signals = [parse_role_signal(ln) for ln in lines(rl_f)]

PUBLIC_KW = ("login", "signin", "sign-in", "signup", "sign-up", "register", "forgot",
             "reset-password", "about", "pricing", "contact", "terms", "privacy",
             "landing", "marketing", "welcome", "faq")
def classify_access(path):
    p = (path or "").lower().strip()
    if re.match(r'^/?admin([/-]|$)', p) or "/admin" in p:
        return "admin"
    if p in ("/", "") or any(k in p for k in PUBLIC_KW):
        return "public"
    return "user"

routes_with_recs = []
for r in react_routes + next_pages + next_app + tanstack + inertia_routes + nanostores_routes:
    routes_with_recs.append({
        **r,
        "access": classify_access(r.get("path")),     # public | user | admin → AppFlowGraph role lane
        "recommendedStates": recommend_states(r.get("path"))
    })

access_summary = {}
for r in routes_with_recs:
    access_summary[r["access"]] = access_summary.get(r["access"], 0) + 1

# Router-ties signal: surface migration-in-progress when 2+ flavors have
# significant counts (>=2 each). Empty list = unambiguous dominantRouter.
router_counts = {
    "react-router": int(rr_n),
    "nextjs-pages": int(np_n),
    "nextjs-app":   int(na_n),
    "tanstack":     int(ts_n),
    "inertia":      int(in_n),
    "nanostores":   len(nanostores_routes),
}
# Report any non-dominant flavor with >=2 routes. The old absolute `dominant - v
# <= 2` gate silently dropped real migrations as the codebase grew (5-vs-2 went
# unreported while 3-vs-2 did) — a router tie is a migration signal at any scale.
router_ties = sorted(
    [k for k, v in router_counts.items() if v >= 2 and k != dominant],
    key=lambda k: -router_counts[k]
)

# Normalized flat envelope. Each category: list under `<name>`, count under
# `<name>Count`. Matches component-states.json + prop-shapes.json shape.
flows = {
    "generatedAt": now,
    "dominantRouter": dominant,
    "routerTies": router_ties,
    "routerCounts": router_counts,
    "routes": {                                # nested by flavor — utility for filtering
        "reactRouter":  react_routes,
        "nextjsPages":  next_pages,
        "nextjsApp":    next_app,
        "tanstack":     tanstack,
        "inertia":      inertia_routes,
        "nanostores":   nanostores_routes,
    },
    "routeCount": int(rr_n) + int(np_n) + int(na_n) + int(ts_n) + int(in_n) + len(nanostores_routes),
    "edges": edges,
    "edgeCount": len(edges),
    "edgeNote": "navigation connections — the EDGES between route nodes. kinds: link/visit/anchor (href-based) plus openPage/routerOpen (nanostores imperative, navigate by route NAME → resolved to a path via `toName`). Build flow stories from these, not just the route list. Group by `kind`.",
    "navSources": nav_sources,
    "navSourceCount": len(nav_sources),
    "navSourceNote": "persistent nav chrome (sidebar/header/footer/layout). Links from EVERY screen, lives outside any page body — a page-body sweep misses it. Author one story per nav source AND fold its links into the flow graph. This is the #1 audit miss.",
    "adhocSwitchers": adhoc_files,
    "adhocSwitcherCount": len(adhoc_files),
    "adhocSwitcherNote": "useState page/view/tab switcher — treat each value as a page story (Pages/<value>)",
    "wizards": wizard_files,
    "wizardCount": len(wizard_files),
    "wizardNote": "step machine — one story per step (Pages/<flow>/NN-<step>) or one flow story with play() advancing state",
    "overlays": overlays,
    "overlayCount": len(overlays),
    "overlayNote": "Modal/Dialog/Sheet — story per open-state (closed/open/loading-inside/error-inside). `open` is an arg, NOT parameters.pseudo.",
    "flowCount": flow_count,
    "perScreenRecommendations": routes_with_recs,
    "accessSummary": access_summary,
    "roleSignals": role_signals,
    "roleNote": "WHO can reach each screen. Each route in perScreenRecommendations carries `access` (public|user|admin) — a PATH heuristic for the AppFlowGraph role lane. `roleSignals[]` are the real access guards found (signal: guard|decl|check, with file:line) — read them to VERIFY and correct the lane mapping, then audit per persona: can an anon reach a `user` route? can a plain `user` reach an `admin` route? The central router often declares routes AND guards together, so the heuristic is a draft — the signals are ground truth.",
}

# Atomic write (temp → os.replace): an interrupted run never leaves half-written JSON.
_fd, _tmp = tempfile.mkstemp(dir=os.path.dirname(out) or '.', suffix='.tmp')
with os.fdopen(_fd, "w") as f:
    json.dump(flows, f, indent=2)
os.replace(_tmp, out)

print(f"✓ Wrote {out}")
if router_ties:
    print(f"  ⚠  Router tie detected: dominantRouter={dominant} but {','.join(router_ties)} also significant — migration in progress?")
PYEOF

# ─── Human summary ───────────────────────────────────────────────────────────
echo ""
echo "━━ Flow inventory summary ━━"
printf "  Router:      dominant=%s\n" "$DOMINANT_ROUTER"
printf "  Routes:      react-router=%d  next-pages=%d  next-app=%d  tanstack=%d  inertia=%d  nanostores=%d\n" \
  "$REACT_ROUTE_COUNT" "$NEXT_PAGES_COUNT" "$NEXT_APP_COUNT" "$TANSTACK_COUNT" "$INERTIA_COUNT" "$NANOSTORES_COUNT"
printf "  Edges:       %d navigation connection(s) (link/visit/anchor)\n" "$EDGE_COUNT"
printf "  Nav sources: %d persistent-chrome file(s) (sidebar/header/footer/layout)\n" "$NAV_COUNT"
printf "  Ad-hoc:      %d page-switcher file(s)\n" "$ADHOC_COUNT"
printf "  Wizards:     %d step-machine file(s)\n" "$WIZARD_COUNT"
printf "  Overlays:    %d Dialog/Modal/Sheet call site(s)\n" "$OVERLAY_COUNT"
ROLE_COUNT=$(awk 'NF{n++} END{print n+0}' "$TMP_ROLES" 2>/dev/null)
printf "  Roles:       %d access-guard signal(s) (guard/decl/check) → see flows.json accessSummary + roleSignals[]\n" "$ROLE_COUNT"
echo ""
if [[ "${ROLE_COUNT:-0}" -gt 0 ]]; then
  echo "  → Per-route 'access' (public/user/admin) is a PATH heuristic — VERIFY it against the $ROLE_COUNT role guard(s) in roleSignals[], then audit per persona: can an anon reach a user route? a user reach an admin route? (flow-capture.md → 'Step — explore roles')."
  echo ""
fi
if [[ $NAV_COUNT -gt 0 ]]; then
  echo "  → Sweep the $NAV_COUNT nav source(s) for links BEFORE declaring the flow graph complete — this chrome is invisible to a page-body-only sweep."
  echo ""
fi

# ─── L1: under-extraction alarm ──────────────────────────────────────────────
# Surface navigation-shaped call sites NOT captured as edges. Escalate to a loud
# warning when routes exist but edges are thin relative to them (edges < routes/4)
# OR there are more unmatched candidates than captured edges — both mean a navigation
# idiom is probably going uncaptured. Stays quiet when nothing is unmatched (an
# edge-sparse static site is not under-extraction).
if [[ $UNMATCHED_COUNT -gt 0 ]]; then
  if [[ $TOTAL_ROUTES -gt 0 && ( $((EDGE_COUNT * 4)) -lt $TOTAL_ROUTES || $UNMATCHED_COUNT -gt $EDGE_COUNT ) ]]; then
    echo "  ⚠ LIKELY UNDER-EXTRACTION: $TOTAL_ROUTES route(s) but only $EDGE_COUNT edge(s), with $UNMATCHED_COUNT navigation-shaped call site(s) the known passes did NOT capture." >&2
    echo "    The app probably navigates via an idiom extract-flows.sh doesn't parse yet (the nanostores-class miss). DO NOT trust the edge count — read these call sites, identify the idiom, and extend extraction (references/flow-capture.md → 'When extraction under-reports'):" >&2
  else
    echo "  ℹ $UNMATCHED_COUNT navigation-shaped call site(s) not captured as edges — verify they're non-navigational before trusting the edge list:" >&2
  fi
  printf '%s\n' "$UNMATCHED" | sed '/^$/d' | head -8 | sed 's/^/      /' >&2
  echo "" >&2
fi

# Exit 1 only if nothing flow-shaped found anywhere (routes, switchers, wizards,
# OR navigation edges). Edges-without-routes still means there's a flow to map
# (e.g. a router convention we don't yet parse, but the <Link>s are real).
if [[ $TOTAL_ROUTES -eq 0 && $ADHOC_COUNT -eq 0 && $WIZARD_COUNT -eq 0 && $EDGE_COUNT -eq 0 ]]; then
  echo "WARN: no routes, ad-hoc switchers, wizards, or navigation edges detected — likely a static site or component library." >&2
  exit 1
fi
exit 0
