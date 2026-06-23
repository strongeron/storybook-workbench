#!/usr/bin/env python3
"""build-component-pages.py — the component↔page import graph the ComponentUsage worklist renders.

COMPOSES (does not re-scan) from the three discovery JSONs the other extractors already wrote:
  .storybook/component-usage.json   (extract-component-usage.sh)  → callSites, props, declaredButUnused,
                                                                     per-component `files`, and a page→components rollup
  .storybook/project-inventory.json (inventory-project.sh)        → each real component's `file` + `kind`
  .storybook/flows.json             (extract-flows.sh)            → routes: path + access(role) per page

Writes .storybook/component-pages.json:
  { generatedAt, components: { <Name>: {
      callSites, props, declaredButUnused,
      parents[]  — components whose file renders <Name> (one level up),
      children[] — components <Name>'s own file renders (one level down),
      pages[]    — routed surfaces that render <Name>, directly OR transitively via the render graph,
                   each { path, title, role, storyId }
      tokens[]   — the design tokens this component's file consumes (reverse of tokens[*].components).
      isPage     — true ONLY when <Name>'s own def file IS a routed page surface (its file keys
                   usage_pages). A page is mounted by the router as a config value ({ component: X }),
                   never as JSX — so callSites/props are 0 by construction (accurate, not missing).
      route      — the path that page serves (e.g. "/scheduler"); present iff isPage. NOT folded into
                   pages[] (a page appearing on itself reads circular) — it's the route it *serves*.
  } },
    tokens:    { <--token>: { category, count, components[], pages[] } }  — forward "where is this token used".
    fileIndex: { <src file>: { component, kind, pages[] } }  — path-keyed projection of the same graph,
                   so a token/size's raw usage paths resolve to component + page NAMES (and a story to jump to).
  }
  Together: one file answers "where is X used" for a token, component, or page — in either direction.

This is a DRAFT like every other extractor (static import/JSX analysis) — barrel re-exports, dynamic
imports, and aliased imports may under-link. Verify against the source for anything load-bearing.

  build-component-pages.py [ROOT]          # ROOT defaults to "."; reads/writes ROOT/.storybook/
"""
import json, os, re, sys, tempfile
from datetime import datetime, timezone

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
SB = os.path.join(ROOT, ".storybook")
OUT = os.path.join(SB, "component-pages.json")


def load(name):
    try:
        with open(os.path.join(SB, name)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


usage_doc = load("component-usage.json")
inv_doc = load("project-inventory.json")
flows_doc = load("flows.json")

usage = usage_doc.get("components", {})                 # Name -> {callSites, files[], props{}, declaredButUnused[]}
usage_pages = usage_doc.get("pages", {})                # page_file -> [Names rendered directly]

# Real components from the inventory, keyed by name, with their defining file + kind.
real = (inv_doc.get("components", {}) or {}).get("real", []) or []
name2file, file2name, kind_of = {}, {}, {}
for e in real:
    f = e.get("file")
    if not f:
        continue
    nm = os.path.splitext(os.path.basename(f))[0]
    # Normalize to the PascalCase export the usage scan keys on (button.tsx -> Button; course-card -> CourseCard).
    pascal = "".join(p[:1].upper() + p[1:] for p in re.split(r"[-_.]", nm) if p)
    name2file[pascal] = f
    file2name[f] = pascal
    kind_of[pascal] = e.get("kind", "component")

# Some components are only known via the usage scan (rendered but inventory bucketed elsewhere) — keep them.
for nm in usage:
    name2file.setdefault(nm, None)
    kind_of.setdefault(nm, "component")

# basename → PascalCase export (button.tsx → Button; course-card.tsx → CourseCard). Defined here because
# both the render-graph backfill below and the fileIndex projection later resolve files the same way.
def derive_name(path):
    base = os.path.splitext(os.path.basename(path))[0]
    return "".join(p[:1].upper() + p[1:] for p in re.split(r"[-_.]", base) if p)

# Backfill def files for components the inventory's `real` list missed (it buckets most under `usage`).
# Every render-site path in usage[*].files IS the def file of the component that file declares (one
# component per file), so derive that name and fill name2file when it's still unknown. Without this the
# render graph below only resolves the handful of components in inventory.real → parents/children stay
# empty for the long tail even though usage[*].files carries the edges. Mirrors fileIndex's resolution.
for u in usage.values():
    for f in (u.get("files", []) or []):
        nm = file2name.get(f) or derive_name(f)
        if name2file.get(nm) is None:
            name2file[nm] = f

# ── Render graph (one level), composed from usage[*].files ──
# B is a CHILD of A  ⟺  A's own file appears among the files where <B> is rendered.
children, parents = {}, {}
for a in name2file:
    af = name2file.get(a)
    children[a] = sorted({b for b in usage if af and af in usage[b].get("files", [])}) if af else []
for a in name2file:
    af = name2file.get(a)
    parents[a] = sorted({b for b in name2file if name2file.get(b) and name2file[b] in usage.get(a, {}).get("files", [])})

# ── Page metadata: map a page FILE → {path, title, role, storyId} via flows.json ──
routes = flows_doc.get("perScreenRecommendations", []) or []
def page_meta(page_file):
    base = os.path.splitext(os.path.basename(page_file))[0]
    role, path = None, None
    for r in routes:
        rf, rp = r.get("file"), r.get("path")
        if rf and os.path.normpath(rf) == os.path.normpath(page_file):      # file-based router: exact file match
            path, role = rp, r.get("access"); break
        if rp and base and base.lower() in rp.lower().replace("-", "").replace("_", ""):  # name appears in the path
            path, role = path or rp, role or r.get("access")
    if not path:                                                            # infer from the file path
        path = "/" + re.sub(r"^(\./)?(src/)?(pages|app|routes|views)/", "", page_file)
        path = re.sub(r"/(index)?\.(tsx|jsx|ts|js)$", "", path) or "/"
    # Distinctive title: a bare "index"/"page"/"layout" filename is the same word on every route, so
    # fall back to the nearest meaningful path segment (…/member/messages/index.tsx → "messages").
    label = base
    if base.lower() in ("index", "page", "route", "layout", "default"):
        segs = [s for s in path.strip("/").split("/") if s]
        label = segs[-1] if segs else base
    return {"path": path, "title": f"Pages/{label}", "role": role, "storyId": None}

# ── Transitive page membership: BFS down the render graph from each page's direct components ──
comp_pages = {nm: [] for nm in name2file}
for page_file, direct in usage_pages.items():
    seen, stack = set(), list(direct)
    while stack:
        c = stack.pop()
        if c in seen:
            continue
        seen.add(c)
        stack.extend(children.get(c, []))
    meta = page_meta(page_file)
    for c in seen:
        if c in comp_pages:
            comp_pages[c].append(meta)

# ── Persistent layout-shell chrome: pages that flow in via {children}/<Outlet>, not JSX nesting ──
# A page mounted as <AppLayout>{page}</AppLayout> or through a router <Outlet/> arrives as a PROP/slot,
# invisible to the static JSX render graph above — so the app shell and its nav chrome (Header, Sidebar,
# NavMain, …) resolve to ZERO pages even though they wrap every routed surface. Detect such shells and
# propagate the pages they gate down their render subtree. Conservative by construction: a shell must
# (1) currently map to no page, (2) have a render subtree (the chrome), (3) live ABOVE the page layer
# (never rendered inside a page file), and (4) actually host a page slot in its own source.
SLOT_RE = re.compile(r"<Outlet[\s/>]|\{\s*children\s*\}")
def _read_source(nm):
    f = name2file.get(nm)
    p = os.path.join(ROOT, f) if f else None
    if not p or not os.path.isfile(p):
        return ""
    try:
        with open(p, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""
# A shell mounted by a route guard wraps exactly the non-public routes. page_meta's role often can't
# resolve for a page FILE (route access is keyed by path/name in the router table, not the page file),
# so derive access by normalized-basename match against each route's name AND path, and drop only the
# pages that resolve to an explicit "public" access (the auth shell, not the app shell, wraps those).
def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())
_route_access = [(_norm(r.get("name")), _norm(r.get("path")), r.get("access")) for r in routes]
def page_access(page_file):
    base = re.sub(r"page$", "", _norm(os.path.splitext(os.path.basename(page_file))[0]))
    if base:
        for rn, rp, acc in _route_access:
            if (rn and base in rn) or (rp and base in rp):
                return acc
    return None
shell_pages = [page_meta(pf) for pf in usage_pages if (page_access(pf) or "").lower() != "public"]
_rendered_in_page = set()
for direct in usage_pages.values():
    _rendered_in_page.update(direct)
shells = [
    nm for nm in name2file
    if not comp_pages.get(nm)                # (1) maps to no page today
    and children.get(nm)                     # (2) has a render subtree (chrome)
    and nm not in _rendered_in_page          # (3) lives above the page layer
    and SLOT_RE.search(_read_source(nm))     # (4) hosts a page slot ({children}/<Outlet>)
]
for s in shells:
    seen, stack = set(), [s]
    while stack:
        c = stack.pop()
        if c in seen:
            continue
        seen.add(c)
        stack.extend(children.get(c, []))
    for c in seen:
        if c in comp_pages:
            comp_pages[c].extend(shell_pages)

# Dedup pages per component by path, keep a role if any page supplied one.
def dedup_pages(refs):
    by_path = {}
    for r in refs:
        cur = by_path.get(r["path"])
        if cur is None:
            by_path[r["path"]] = dict(r)
        elif not cur.get("role") and r.get("role"):
            cur["role"] = r["role"]
    return sorted(by_path.values(), key=lambda r: r["path"])

# A component IS a page when its own def file is a routed page surface (a key in usage_pages). Such a
# component is mounted by the router as a config VALUE ({ component: X }), never as JSX — so it has 0
# call sites / 0 props by construction (correct, not missing). Record that it's a page and the route it
# serves so the per-component "Where it's used" block can show "serves /scheduler" instead of a
# misleading "0 call sites · no routed page". Self-route is a distinct field, NOT folded into pages[]
# (a page listed among "pages it appears on" reads circular). Normpath both sides — usage_pages keys
# and name2file values may differ by a leading "./".
page_file_by_norm = {os.path.normpath(pf): pf for pf in usage_pages}
def page_route_for(nm):
    f = name2file.get(nm)
    pf = page_file_by_norm.get(os.path.normpath(f)) if f else None
    return page_meta(pf)["path"] if pf else None

# ── Assemble — real UI components only (drop scaffold/support; keep page hosts so the graph connects) ──
components = {}
for nm in sorted(name2file):
    if kind_of.get(nm) in ("scaffold", "support"):
        continue
    u = usage.get(nm, {})
    components[nm] = {
        "callSites": u.get("callSites", 0),
        "props": len(u.get("props", {})),
        "declaredButUnused": len(u.get("declaredButUnused", [])),
        "parents": parents.get(nm, []),
        "children": children.get(nm, []),
        "pages": dedup_pages(comp_pages.get(nm, [])),
    }
    route = page_route_for(nm)
    if route:
        components[nm]["isPage"] = True
        components[nm]["route"] = route

# ── File → {component, pages} index ──
# Lets any usage view (a color/size token's `files`, a prop scan) resolve a raw `src/...` path to the
# COMPONENT it defines and the PAGES that component lands on — so "used in" reads as names you recognize
# and can click, not paths. Same graph as above; this is just the path-keyed projection of it.
#
# Coverage: a token is referenced from arbitrary component files (badge.tsx, day-of-week-filter.tsx),
# most of which the inventory bucketed under `usage` (by name) rather than `real` (by file). So we resolve
# each candidate file to a component the SAME way the inventory does — basename → PascalCase export — and
# keep it when that name is a known component. This reaches the long tail `file2name` (real only) misses.
# (derive_name is defined above — shared with the render-graph backfill.)
candidate_files = set(file2name)
for u in usage.values():
    candidate_files.update(u.get("files", []) or [])           # render sites
candidate_files.update(usage_pages.keys())                     # page files
token_files = set()                                            # every file a token is read from (incl. ui/ primitives)
for r in ((inv_doc.get("tokens", {}) or {}).get("map", []) or []):
    fs = r.get("files", []) or []
    candidate_files.update(fs)                                 # token usage sites — the ones we most need to resolve
    token_files.update(fs)

file_index = {}
for f in candidate_files:
    nm = file2name.get(f) or derive_name(f)
    if nm in comp_pages and kind_of.get(nm) not in ("scaffold", "support"):
        file_index[f] = {
            "component": nm,
            "kind": kind_of.get(nm, "component"),
            "pages": dedup_pages(comp_pages.get(nm, [])),
        }
    elif f in usage_pages:                                      # a page's own file with no tracked component
        file_index[f] = {"component": None, "kind": "page", "pages": [page_meta(f)]}
    elif f in token_files and nm and f.endswith((".tsx", ".jsx")):
        # A design-system PRIMITIVE (e.g. src/components/ui/card.tsx): not a tracked app component or
        # routed page, but it DOES consume tokens. Without this, every token used ONLY by primitives
        # (card/popover/secondary/sidebar/chart…) drops out of the graph and the explorer silently
        # shows a fraction of the palette. Surface it as the primitive consumer so "where is --color-x
        # used?" resolves to a name, not a dropped edge. No pages (primitives aren't routed).
        file_index[f] = {"component": nm, "kind": "primitive", "pages": []}

# ── Token ⇄ component/page edges — the bidirectional "where is this used" the explorer + agents read ──
# Without these, answering "where is --color-x used?" or "which tokens does Button consume?" means joining
# the token map against fileIndex by hand. We precompute BOTH directions so one file answers either:
#   tokens[<tok>]          = {count, components[], pages[]}   — forward (token → where)
#   components[<name>].tokens = [<tok>, ...]                  — reverse (component → what it uses)
# Derived only (walk each token's usage files through fileIndex) — no new scan, no second graph file.
tokens_map = (inv_doc.get("tokens", {}) or {}).get("map", []) or []
token_index, comp_tokens = {}, {}
for tr in tokens_map:
    tok = tr.get("token")
    if not tok:
        continue
    comps, pages_by_path = set(), {}
    for f in tr.get("files", []) or []:
        e = file_index.get(f)
        if not e:
            continue
        if e.get("component"):
            comps.add(e["component"])
            # Only the reverse edge (component → tokens) needs to be a tracked, browsable component;
            # primitives surface as forward consumers but shouldn't graft tokens onto the worklist.
            if e.get("kind") != "primitive":
                comp_tokens.setdefault(e["component"], set()).add(tok)
        for p in e.get("pages", []):
            pages_by_path.setdefault(p["path"], p)
    # Show every token that is ACTUALLY USED — whether it resolves to an app component, only to a
    # design-system primitive (src/components/ui/*), or to a file we couldn't map (count>0 but no
    # consumer resolved). Real usage is the whole point of the explorer, so under-reporting it — the way
    # the old `if comps or pages_by_path` guard silently dropped every primitive-only token — IS the bug.
    # A PURE ORPHAN (0 references, no files) is the one thing left out: it has no usage to show and lives
    # in the health / orphan-token view, not in "where is this used?".
    if comps or pages_by_path or tr.get("count", 0) or (tr.get("files") or []):
        token_index[tok] = {
            "category": tr.get("category"),
            "count": tr.get("count", 0),
            "components": sorted(comps),
            "pages": sorted(pages_by_path.values(), key=lambda p: p["path"]),
        }
for nm, entry in components.items():                            # attach the reverse edge onto each component
    toks = comp_tokens.get(nm)
    if toks:
        entry["tokens"] = sorted(toks)

report = {
    "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "components": components,
    "tokens": token_index,
    "fileIndex": file_index,
    "meta": {
        "componentCount": len(components),
        "note": "Composed from component-usage.json + project-inventory.json + flows.json. Static graph — "
                "barrel/dynamic/aliased imports may under-link; verify load-bearing edges against source.",
    },
}
os.makedirs(SB, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=SB, suffix=".tmp")
with os.fdopen(fd, "w") as f:
    json.dump(report, f, indent=2)
os.replace(tmp, OUT)

with_pages = sum(1 for c in components.values() if c["pages"])
print(f"✓ Wrote {OUT}  ({len(components)} components, {with_pages} mapped to ≥1 page)")
if not usage and not real:
    print("  ⚠ no component-usage.json / project-inventory.json found — run inventory + usage extractors first", file=sys.stderr)
