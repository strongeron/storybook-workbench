# Flow capture — model the connections, not just the screens

Load this reference for the **Flow** build mode: when the task is "audit the whole app's UI
surface", "map the user journeys", "show how the screens connect", "build a flow/site map", or
"capture the navigation". Component mode stories a single component's states; Flow mode captures
**routes (nodes) + navigation (edges) + the chrome that links from everywhere**.

> **The lesson this reference encodes (field-verified).** A route inventory is only *half* an
> audit. An honest "capture all connections" must enumerate every **source of navigation**, not
> just page bodies — otherwise the always-present sidebar/header/footer slips through. On one
> real audit the split was ~30% tool gap (no inertia/edge/nav support) and ~70% method gap (the
> sweep was scoped to page bodies, with no checklist for the chrome). Both halves are fixed here:
> `extract-flows.sh` now emits edges + nav sources, and the checklist below makes coverage provable.

## Step 0 — run the extractor, read the new fields

```bash
~/agent-skills/plugins/storybook-workbench/skills/sb-flows/scripts/extract-flows.sh   # writes .storybook/flows.json
```

`flows.json` now carries three things beyond route nodes. **Read them — do not re-grep by hand:**

| Field | What it is | How to use |
|---|---|---|
| `routes.*` + `routeCount` | Route nodes across 6 flavors (react-router / nextjs-pages / nextjs-app / tanstack / **inertia** / **nanostores**) | One page story per route; `perScreenRecommendations` gives the state list per screen |
| `edges[]` + `edgeCount` | Navigation **connections** — `{kind: link\|visit\|anchor\|openPage\|routerOpen, to, file, line}` | Build the flow graph from these; each `to` is a destination path. `openPage`/`routerOpen` are nanostores imperative edges that navigate by route NAME (kept as `toName`, resolved to a path). Group by `kind` |
| `navSources[]` + `navSourceCount` | Persistent **chrome** — `{kind: sidebar\|header\|footer\|layout\|nav, file, signal}` | Story each one **and** sweep it for links before declaring the graph complete |
| `accessSummary` + per-route `access` | WHO reaches each screen — `{public, user, admin, …}` counts; each route carries `access` (path heuristic) | Feeds `AppFlowGraph` role lanes (`node.role = route.access`). A **draft** — verify against `roleSignals[]` |
| `roleSignals[]` | Real access **guards** — `{signal: guard\|decl\|check, file, line, snippet}` (e.g. `<RequireAuth>`, `allowedRoles`, `user.role===`) | Ground truth for the lane mapping. Read them to correct `access`, then audit per persona (see "Step — explore roles") |

`dominantRouter: "inertia"` means the app declares routes imperatively (`router.get/post/visit("/x")`
in a TS adapter — Inertia-static on Rails/Laravel, wouter, custom routers). The 4 file-based
flavors miss these; the inertia/generic pass catches them.

## When extraction under-reports — read the unmatched call sites and adapt

**The extractor knows a fixed menu of navigation idioms; your app may use one it doesn't.** That is
not a corner case — it is the default failure mode of any pattern-matching extractor, and it is
*silent*: a route list still prints, the run still exits 0. The signal that it happened is the
extractor's own alarm:

```
⚠ LIKELY UNDER-EXTRACTION: 27 route(s) but only 2 edge(s), with 44 navigation-shaped
  call site(s) the known passes did NOT capture.
```

(It fires when routes exist but edges are thin relative to them, or there are more uncaptured
navigation-shaped calls than captured edges — and it prints the first several `file:line` offenders.)

**`flows.json` is a draft, not ground truth. When the alarm fires, do NOT trust `edgeCount`** — the
graph is missing connections. Work the loop:

1. **Read the unmatched call sites** the alarm printed. They are real navigation the passes can't
   parse — e.g. a project helper `appNavigate("profile")`, a store action `goToStep(3)`, a wrapped
   `useGoto()`. Open each, confirm it navigates, and learn the idiom (what's the target — a path? a
   route NAME resolved through a map? a step index?).
2. **Resolve the real edges with provenance.** Prefer a small **repo-local, source-aware resolver**
   over more brittle line-regex — read the routing module and each call site, emit
   `{from, to|toName, file, line}` for every edge, and record genuinely *dynamic* targets
   (`navigate(computedPath)`) as `dynamicCallSites` rather than guessing. (Worked example: a
   `@nanostores/router` app where `openPage($router, NAME)` produced 0 href-edges — a ~40-line
   `.mjs` that read the route map and call sites recovered all of them, each with `file:line`.)
   Drop it at `.storybook/scripts/extract-app-graph.mjs`, regenerable and local.
3. **Re-run and re-verify** — the alarm should clear (unmatched candidates fall to ~0, or the
   remainder is genuinely non-navigational / dynamic and you can say so).
4. **If the idiom is general, fold it upstream** into `extract-flows.sh` so the next repo gets it for
   free (this is exactly how the nanostores `openPage`/`redirectPage` passes were added). A
   one-repo convention stays a repo-local resolver; a framework convention becomes a new pass.

This is the difference between a skill that runs a script and a skill that **understands when the
script is wrong** and extends it. Treat the extractor as a fast first pass over known idioms, never
as proof of completeness.

## Deep-edge tracing (the store/service-action and re-export case)

The shallow attribution (page-body, nav-chrome, one-hop component host) misses the navigations that
matter most in a real app: the ones fired from a **store or service action**. A `switchToHotel()`
service that calls `openPage($router, "scheduler")` has **no screen of its own** — its real origin is
*whoever calls `switchToHotel`*. Left shallow, it lands in `unresolvedEdges` ("fired from a
store/service action") and the map silently loses a real transition.

The reference template (`templates/extract-app-graph.mjs`, `moduleOrigins`) resolves these by
reading the source, not guessing:

1. **Find the exported symbol whose body contains the nav line** (`enclosingExport`).
2. **Find its real callers — re-export aware.** This is the part that bites: the action is usually
   re-exported through a barrel/store (`switch-to-hotel.ts` → `export { switchToHotel }` in
   `stores/org.ts` → consumers import from `@/stores/org`, never the service path). `reexportTokens`
   walks the re-export graph to a fixpoint, collecting every import token the symbol is reachable
   through, so `callersOf` finds the consumers that a source-path-only search would miss.
3. **Resolve each caller up to a routed page** — page → its route; nav chrome → entry; component →
   `pagesImporting` (raise the hop depth for deep nests); another store/service → recurse,
   cycle-guarded.
4. **Attribute the edge with the full chain in provenance** (`openPage ⟵ switchToHotel←hotels-table,
   my-organizations-page`), kind `module-trace`. **If nothing resolves, keep it unresolved** — a
   genuinely dynamic dispatch or a route-less catch-all is recorded honestly, never invented.

Field result on one app: this recovered 4 real `module-trace` edges (e.g. `switchToHotel → scheduler`)
and cut `unresolvedEdges` from 7 to 3 — the remaining 3 being honestly unattributable (a 404 with no
`routePattern`, two orphan feature components). Bump `pagesImporting`'s depth if deeply-nested
components still don't resolve, but never trade honesty for coverage.

## Back / return navigation (the round-trip, not just the forward edge)

A forward-only graph is half the picture: a user opens a screen AND comes back. But "back" has a precise
meaning — it is a **return ACTION**, not merely a link whose destination is a parent. A sidebar "Dashboard"
link from a deep screen goes *up* the hierarchy yet it is forward navigation, not a return; marking those is
noise. There are three distinct return cases, modeled differently:

| Case | What it is | Modeled as |
|---|---|---|
| **Page back** | a Back / Cancel / Close CTA, or browser-back | a `back: true` **edge** — violet, drawn with a REVERSED arrow (the arrowhead sits at the source screen and points back, so the line reads as a return) |
| **Modal close** | a modal opens OVER a page and closes back to it | a **node state** (`modals[]`), not a route edge — the card shows "Opens · close ↩ returns here" |
| **Form** | submit → outcome; **cancel** → previous page | submit = a `form` edge; cancel = a `back` edge |

The **label is the copy of the action you click** — "Cancel", "Back", "Close" — not "Back to {parent}"
(the node the arrow touches already names the destination). The extractor reads it automatically
(`ctaLabelAt`): the control's text (`>Cancel</button>`), an `aria-label`/`title`, or a `label=`/`children=`
prop near the nav call. When nothing clean matches it falls back to a plain "Back" (returns) or
`verb · source` (forward) — recorded in **`labelVia`** (`"cta"` vs `"fallback"`) and tallied in
`stats.ctaLabels` / `stats.labelFallbacks`, so a fallback is honest, never a silent guess. Tune the
patterns (ADAPT) to your component library if many edges read `verb · source`.

A page-back edge is flagged from two honest signals (recorded in `backVia`):

| `backVia` | Signal | Example |
|---|---|---|
| `intent` | a return-word label near the call (`\bback\b`, return, **cancel**, **close**, previous, ←) — catches a "Cancel" CTA even to a *sibling* | a "Cancel" button → the list |
| `imperative` | `router.back()` / `navigate(-1)` / `history.back()` / `goBack()` — no destination, so the parent route is inferred (flagged `inferred: true`) | `<BackButton>` calling `router.back()` |

Path hierarchy (`to` is an ancestor of `from`) is **deliberately NOT a trigger on its own** — it over-fires
on sidebar/hub jumps. The intent matcher is tight (`\bback\b` won't fire inside `callback`/`background`) and
the imperative case is marked `inferred`. `AppFlowGraph` renders back edges distinctly (reversed violet
arrow) with a **Back** filter facet; coverage never comes at the cost of a fabricated destination — an
unattributable back call goes to `unresolvedBack`, not a guessed edge.

## Validate the graph (never hallucinate an empty edge)

The contract: **every edge carries file:line provenance; anything unattributable is recorded, not
invented.** Before trusting the map, validate:

- **`unresolvedEdges` is small and each `reason` is honest** — "page not bound to a routePattern",
  "dynamic dispatch", not a silent drop. A large/growing list means the extractor is under-reporting
  (work the under-extraction loop) — it does NOT mean "no edge there."
- **Spot-check `module-trace` edges against source** — open one provenance chain and confirm the
  caller really invokes the action. The trace is heuristic (import-token + call-site); a same-named
  export in two modules is the one false-positive risk worth a glance.
- **No fabricated `from`.** There is never a default/placeholder source node. If you can't attribute
  an origin from real source, it stays unresolved. An empty or guessed edge is a bug, not a fallback.
- **Counts reconcile** — `routeCount`, `edgeCount` (by attribution), `unresolvedEdges`,
  `dynamicCallSites` should add up against the call sites the scan found; log anything dropped.

```bash
node -e 'const g=require("./.storybook/app-graph.json");
  const by={}; for(const e of g.edges) by[e.attribution]=(by[e.attribution]||0)+1;
  console.log("edges by attribution:", by, "| unresolved:", g.unresolvedEdges.length);
  for (const u of g.unresolvedEdges) console.log("  UNRESOLVED", u.provenance, "→", u.to, "—", u.reason);'
```

## Step 1 — Sources-of-navigation checklist (the provable method)

An audit of *all* connections is only complete when every source below is swept. Tick each one
against `flows.json` and the codebase. **The nav-chrome row is the one that gets missed** —
`extract-flows.sh` now surfaces it (`navSources[]`) and prints a sweep reminder, but you still
have to act on it.

| Source | Where it shows up | Covered by |
|---|---|---|
| Page-body links / router calls / forms | inside route components | `edges[]` (link/visit) + your read of each page |
| Server redirects | router adapter / controller (`router.get` → server) | `routes.inertia` + read the adapter |
| In-page modal / dialog triggers | `<Dialog open>` etc. | `overlays[]` |
| **Layout chrome: sidebar / header / footer / nav** | **outside any page — links from every screen** | **`navSources[]` ← the #1 miss** |
| Card / widget deep-links | inside list/dashboard widgets | `edges[]` + manual read of widget components |

If `navSourceCount > 0`, the extractor prints: *"Sweep the N nav source(s) for links BEFORE
declaring the flow graph complete."* Do exactly that — open each nav file, add its links as edges.

## Step — explore roles (the same app is a different app per persona)

A route map without roles is a half-truth: an anonymous visitor, a signed-in user, and an admin
see **different graphs** over the same routes. The extractor gives you a starting point and the raw
guards — your job is to turn them into a verified, per-persona flow.

1. **Read what the extractor gave you.** `accessSummary` (e.g. `{public: 6, user: 8, admin: 15}`)
   and a per-route `access` (`public` / `user` / `admin`) — but that field is a **path heuristic**
   (`/admin/*` → admin, `/login` + marketing → public, else user). It is a draft, not proof.
2. **Verify against `roleSignals[]`** — the real guards, with `file:line` and a `signal` class:
   - `guard` — JSX route guards: `<ProtectedRoute>`, `<RequireAuth>`, `<AdminRoute>`, `<RoleGuard>`.
   - `decl` — declarative: `requiresAuth`, `allowedRoles`, `roles: [...]`, `meta: { auth }`.
   - `check` — imperative: `requireRole('admin')`, `hasRole()`, `user.role === 'admin'`, redirect to `/login`.
   Open each, map it to the routes it wraps, and **correct any `access` the heuristic got wrong**
   (a `/reports` route behind `<AdminRoute>` is admin, not user). If guards exist but a custom idiom
   means they didn't classify, that's the under-extraction loop — read the source and resolve it.
3. **Lay it out in role lanes.** When building the `AppGraph` for `AppFlowGraph`, set
   `node.role = route.access` and pass `lanes: ["public","user","admin", …]`. The graph then reads
   as swimlanes — one row per persona — which is how a reviewer actually reasons about access.
4. **Audit the crossings (the security-shaped part).** For every edge that crosses lanes, ask the
   adversarial question and capture it as a flow state:
   - Can an **anon** reach a `user` route directly (deep link / no guard)? → that's a redirect-to-login
     story, or a bug.
   - Can a plain **user** reach an `admin` route? → an authorization story (403 / not-found / redirect),
     or a privilege-escalation bug worth a `LOG-ONLY:` finding.
   - Does a persona have an **orphan** screen (reachable by role but no nav edge into it)?
   Each persona's reachable subgraph is its own journey — story the distinct ones (a `JourneyGraph`
   per persona where they materially differ), don't collapse them into one anonymous map.

## Step 2 — Audit → Map → Build → Track

1. **Audit** — run the extractor; reconcile `routeCount` / `edgeCount` / `navSourceCount` against
   the checklist. Append the counts to `.storybook/audit/findings.md` (timestamped).
2. **Map** — derive the journey map: nodes = routes, edges = `edges[]` (+ swept nav links),
   grouped into role lanes (e.g. public / user / admin / system) where the app has roles.
3. **Build** — scaffold `AppFlowGraph` (whole-app map) and one `JourneyGraph` per flow (see below).
   Story each route + each nav source.
4. **Track** — the journey map and the sidebar must stay 1:1 (naming convention below). Record the
   flow inventory in the ledger so a later session resumes without re-deriving it.

## Step 3 — Visualize: dependency-free SVG graph (no app-repo dependency)

**Do not push React Flow + a layout engine into the app repo for Storybook-only chrome.** A
4-role app lays out deterministically. Use the bundled wrappers — pure SVG, no install:

- **`<AppFlowGraph>`** — whole-app route map: role swimlanes (default public / user / admin / system),
  typed/colored edges (link vs visit vs redirect), legend, detail panel, pan/zoom, an interactive
  **coverage filter** (toggle flow / story / partial / none to dim or spotlight screens by story
  coverage), and **click-through to each screen's story** (by storyId).
- **`<JourneyGraph>`** — one flow's journey map; doubles as the Docs index for that flow's stories.

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh AppFlowGraph
${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-wrapper.sh JourneyGraph
```

Feed them the graph you derived in Step 2 (nodes with `{id, label, role, storyId}` and edges with
`{from, to, kind}`). Full props in `references/wrapper-library.md`.

> **Field-fixed `AppFlowGraph` invariants — verify by actually driving the map in a browser (click a
> node → focus, Fit all, pan), not by glancing at it.** Four silent bugs recur if the wrapper is
> rewritten: (1) root must be `height: 100dvh`, never `100%` — `100%` collapses in focus mode and the
> canvas goes blank; (2) the graph `<svg>` needs `overflow: visible` or edges clip at the canvas
> edge; (3) pack each lane from the top (per-lane row), not by global route index, or lanes get huge
> vertical gaps; (4) collapse parallel edges to the same neighbour in the ego view (`×N`) or a
> neighbour shows as duplicate cards. Full symptom→cause→fix in `references/wrapper-library.md`
> → "field-fixed layout invariants". And role lanes must come from the app's real access gate (see
> "Step — explore roles" above), not the path heuristic.

> **Connector labels = the ACTION the user triggers, not the destination.** A first cut often labels
> every edge with the *target route's title* — but the arrowhead already names the destination node,
> so the label just repeats it ("Edit department" on four edges pointing at the Edit-department card,
> telling you nothing). Instead derive the label from the navigation **mechanism** (the call-site
> `fn`) + the **source** that fires it: `openPage/router.open → "opens"`, `redirectPage/replace →
> "redirects"`, `<Link>/anchor → "links"`, form → "submits", nav chrome → "nav"; append the source
> component (` · departments-table`). And the URL-**hierarchy** edges (parent→child by path) are NOT
> user actions — give them their own kind (`subroute`, faint dotted, labelled "sub-route"), never
> mix them into the click/nav edges as a generic "link" called "child route".

## Step 4 — Flow naming convention (lock this per flow)

So the journey map and the sidebar are 1:1, and tests never break on renames:

- **Display name** `N · <label>` — `N` = the node's position in the journey map; `<label>` matches
  the map node verbatim. (Storybook's `name` field, e.g. `name: '3 · Confirm enrollment'`.)
- **Export name** stays **semantic** — `Interactive`, `Step3`, `Confirm`. The number lives *only*
  in the display name, never in the export.
- **Always link/test by `storyId`** — the id is derived from the title + export, not the display
  name. Numbered display names are cosmetic and never break `run-story-tests` or `<StorySet ids>`.

```tsx
export const Confirm: Story = {            // semantic export → stable storyId
  name: '3 · Confirm enrollment',          // numbered display → 1:1 with the map
};
// link/test by id: 'flows-student-enrollment--confirm' (NOT by the display name)
```

## Step 5 — `play` is a test, a Walk-through is a demo (don't conflate them)

A flow needs two different things; keep them as **two stories**:

| Purpose | Story | `play`? | Tags |
|---|---|---|---|
| **Browse** the flow by hand (designer/stakeholder) | `Walk-through` | **No** | `['flow']` |
| **Assert** the flow in CI (agent/headless) | `Flow test` | **Yes** | `['flow', '!dev', '!test']`-style hidden |

The `Walk-through` renders the sequence for clicking through; the hidden `Flow test` carries the
`play` that drives + asserts state. Hiding the test story (`!dev` / manifest-excluded) keeps the
sidebar clean while CI still runs it. See `references/test-wiring.md` for the headless runner that
turns these into a machine-readable pass/fail + a11y list.

## Step 6 — Render flows/pages at real width, with a mobile view

Page and flow stories are NOT components — do not let them render in the narrow centered canvas. Field-verified miss: flows shown "so narrow" are unreadable and don't reflect how the app ships.

- **Desktop is the default.** `parameters.layout: 'fullscreen'` + a desktop viewport. A page renders at the width it ships at, not the component canvas.
- **Offer mobile.** Wire the viewport presets (mobile / tablet / desktop — see `install-wizard.md` Phase 4) so reviewers can flip. If the app has responsive styles, capture at least one mobile story per key page.
- For a card-on-a-page reviewed at page width, use the width-constraint decorator (`install-wizard.md` Phase 4c), not `layout: 'centered'`.

## Step 7 — Each documented state is its OWN full-width story (don't cram into Docs)

Another field miss: documenting a flow's states as cramped blocks *inside the Docs column* below the journey map. Don't. The Docs page holds the `JourneyGraph`; each state it references is a **separate, full-width story** the graph links to (by `storyId`).

- **One story per documented state** (`empty` / `filled` / `submitting` / `modal-open` / `confirmation` / `error`). Full width, real component, real imports.
- The **interactive** story (`Walk-through` or the `Flow test`) must actually **drive through every documented state** — open the modal, fill it, advance to confirmation. A flow story that stops at `loading` and never reaches `confirmation` is **incomplete** (see anti-pattern). If you document a confirmation state, the interactive `play` must reach it.
- `JourneyGraph` step `storyId`s point at those per-state stories, so clicking the map opens the exact state.

## Bridge to Storybook's own docs

Flow/journey conventions and the change-aware sidebar evolve upstream. Where this reference touches
a native capability, prefer the live doc over baked-in claims (MCP `get-documentation`, or WebFetch):

- Git **New/Modified/related** sidebar filters (SB 10.4 "change review") — use them to see *what
  changed* instead of inventing a `changed` tag. → `storybook.js.org/docs`
- Sharing/publishing a flow walkthrough for stakeholder review → `storybook.js.org/docs/sharing/publish-storybook`
