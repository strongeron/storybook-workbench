#!/usr/bin/env python3
"""page-patterns.py — detect page composition for the real-page-capture story mode.

Deterministic, regex-based static analysis. Scans page/route/view files and reports, per page:
  - importable : has a default-export component (→ Mode A: import the real page as-is)
  - layout     : the <*Layout> wrapper it renders (imported)
  - dataHook   : the data provider it reads (usePage / useLoaderData / useParams / store / query)
  - dataType   : the hook's generic type — THE signal for which factory/mock to seed
  - sections   : domain section components it renders, in JSX appearance order (excludes ui/ primitives)
  - gridHint   : best-effort column/layout hint from the top container (flagged approximate)
Plus sharedSections[] — a section component rendered by >=2 pages (the reusable pieces).

We only REPORT what the code actually expresses; we never invent layout rules. Inline JSX blocks
are not components, so they never appear as sections (they'd need extracting first).

Usage:
  page-patterns.py [ROOT] [--out FILE]      # ROOT defaults to "."; prints JSON if no --out
"""
import json, os, re, sys

PAGE_SEGMENTS = ("/pages/", "/app/", "/routes/", "/views/")
SRC_ROOTS = ("src", "app/frontend")
SKIP_SUFFIX = (".stories.tsx", ".stories.jsx", ".test.tsx", ".spec.tsx", ".d.ts")

IMPORT_RE = re.compile(r'import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+["\']([^"\']+)["\']')
DEFAULT_EXPORT_RE = re.compile(r'export\s+default\s+(?:function|class|\w+)')
DATA_HOOK_RE = re.compile(r'\b(usePage|useLoaderData|useRouteLoaderData|useParams|useSelector|useAppSelector|useStore|useQuery)\b\s*(?:<([^>{}]+)>)?')
LAYOUT_TAG_RE = re.compile(r'<(\w*Layout)\b')
GRID_RE = re.compile(r'(grid-cols-\[[^\]]+\]|(?:lg:|md:|sm:)?grid-cols-\d+)')


def find_page_files(root):
    out = []
    for base in SRC_ROOTS:
        d = os.path.join(root, base)
        if not os.path.isdir(d):
            continue
        for dirpath, _, files in os.walk(d):
            rel_dir = "/" + os.path.relpath(dirpath, root).replace(os.sep, "/") + "/"
            if "/node_modules/" in rel_dir or not any(seg in rel_dir for seg in PAGE_SEGMENTS):
                continue
            for fn in files:
                if fn.endswith((".tsx", ".jsx")) and not fn.endswith(SKIP_SUFFIX):
                    out.append(os.path.relpath(os.path.join(dirpath, fn), root))
    return sorted(out)


def is_section(name, mod):
    if not name[:1].isupper():
        return False
    if "/ui/" in mod or mod.endswith("/ui"):
        return False
    return mod.startswith("@/components") or "/components" in mod


def analyze(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8", errors="ignore") as f:
        src = f.read()

    imported = {}  # local name -> module path
    for m in IMPORT_RE.finditer(src):
        default, named, mod = m.group(1), m.group(2), m.group(3)
        if default:
            imported[default] = mod
        if named:
            for n in named.split(","):
                n = n.strip()
                if n.startswith("type "):
                    n = n[5:].strip()
                n = n.split(" as ")[-1].strip()
                if n:
                    imported[n] = mod

    importable = bool(DEFAULT_EXPORT_RE.search(src))
    # Default-export component name (what a story would import). None = anonymous default.
    component = None
    m = re.search(r'export\s+default\s+(?:function|class)\s+(\w+)', src)
    if m:
        component = m.group(1)
    else:
        m = re.search(r'export\s+default\s+(\w+)', src)
        if m and m.group(1) not in ("function", "class", "async"):
            component = m.group(1)

    layout = next((m.group(1) for m in LAYOUT_TAG_RE.finditer(src) if m.group(1) in imported), None)

    # Prefer a TYPED data-hook occurrence (usePage<Foo>) over a bare one — the generic is the
    # mock signal, and pages often call usePage() bare elsewhere (e.g. just for `url`).
    dataHook = dataType = None
    first = typed = None
    for m in DATA_HOOK_RE.finditer(src):
        if first is None:
            first = m
        if m.group(2):
            typed = m
            break
    chosen = typed or first
    if chosen:
        dataHook = chosen.group(1)
        dataType = chosen.group(2).strip() if chosen.group(2) else None

    section_imports = {n for n, mod in imported.items() if is_section(n, mod) and n != layout}
    seen, sections = set(), []
    for m in re.finditer(r'<([A-Z]\w+)\b', src):
        n = m.group(1)
        if n in section_imports and n not in seen:
            seen.add(n)
            sections.append(n)

    g = GRID_RE.search(src)
    return {
        "file": rel,
        "importable": importable,
        "component": component,
        "layout": layout,
        "dataHook": dataHook,
        "dataType": dataType,
        "sections": sections,
        "gridHint": g.group(1) if g else None,
    }


def main():
    args = [a for a in sys.argv[1:]]
    out_path = None
    if "--out" in args:
        i = args.index("--out")
        out_path = args[i + 1]
        del args[i:i + 2]
    root = args[0] if args else "."

    pages = [analyze(root, p) for p in find_page_files(root)]
    by_section = {}
    for pg in pages:
        for s in pg["sections"]:
            by_section.setdefault(s, []).append(pg["file"])
    shared = [{"section": s, "pages": f} for s, f in sorted(by_section.items()) if len(f) >= 2]

    result = {
        "pagePatterns": pages,
        "sharedSections": shared,
        "summary": {
            "pages": len(pages),
            "importable": sum(1 for p in pages if p["importable"]),
            "sharedSections": len(shared),
        },
    }
    txt = json.dumps(result, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(txt + "\n")
        print(f"page-patterns: {len(pages)} pages, {len(shared)} shared sections -> {out_path}")
    else:
        print(txt)


if __name__ == "__main__":
    main()
