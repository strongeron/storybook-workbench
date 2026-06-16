#!/usr/bin/env python3
"""discover-runtime.py — deterministic runtime/preview discovery (native 'storybook ai setup' Step 1).

Detect what the Storybook shared preview must SUPPLY to render a page, as precomputed ground truth:
  - entry      : the app entry file
  - providers  : the provider/router tree wrapping <App> (name + import source)
  - rootCss    : how global CSS loads — JS imports and/or index.html <link>
  - portals    : createPortal targets (DOM ids the preview must create) + index.html non-root ids
  - network    : data-fetch libraries/hooks present → whether MSW is needed

Writes .storybook/runtime.json. Reports reality, invents nothing. The native >=12-read Glob/Grep
agent pass is reserved only for judgment a static scan can't make.

Usage:
  discover-runtime.py [ROOT] [--out FILE]
"""
import json, os, re, sys

SRC_ROOTS = ("src", "app/frontend")
ENTRY_NAMES = ("main.tsx", "main.jsx", "index.tsx", "index.jsx", "main.ts", "index.ts")
CODE_EXT = (".tsx", ".jsx", ".ts", ".js")
SKIP = (".stories.tsx", ".stories.jsx", ".test.tsx", ".spec.tsx", ".d.ts")

IMPORT_RE = re.compile(r'import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+["\']([^"\']+)["\']')
PROVIDER_TAG_RE = re.compile(r'<([A-Z]\w*(?:Provider|Router))\b|<(Provider)\b')
CSS_IMPORT_RE = re.compile(r'''import\s+["']([^"']+\.css)["']''')
HTML_LINK_RE = re.compile(r'<link[^>]+href=["\']([^"\']+\.css)["\']', re.I)
HTML_SCRIPT_RE = re.compile(r'<script[^>]+src=["\']([^"\']+\.[jt]sx?)["\']', re.I)
HTML_ID_RE = re.compile(r'\bid=["\']([^"\']+)["\']')
PORTAL_RE = re.compile(r'createPortal\s*\([^,]+,\s*document\.getElementById\(\s*["\']([^"\']+)["\']')
NET_LIBS = {"@tanstack/react-query": "react-query", "react-query": "react-query",
            "swr": "swr", "axios": "axios", "@apollo/client": "apollo"}
NET_HOOK_RE = re.compile(r'\b(useQuery|useMutation|useInfiniteQuery|useSWR|useApolloClient|useLazyQuery)\b')


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="ignore") as f:
            return f.read()
    except (OSError, IsADirectoryError):
        return ""


def find_entry(root):
    html = read(root, "index.html")
    m = HTML_SCRIPT_RE.search(html)
    if m:
        return m.group(1).lstrip("/")
    for base in SRC_ROOTS:
        for name in ENTRY_NAMES:
            if os.path.isfile(os.path.join(root, base, name)):
                return f"{base}/{name}"
    return None


def imports_of(src):
    out = {}
    for m in IMPORT_RE.finditer(src):
        default, named, mod = m.group(1), m.group(2), m.group(3)
        if default:
            out[default] = mod
        if named:
            for n in named.split(","):
                n = n.strip()
                if n.startswith("type "):
                    n = n[5:].strip()
                n = n.split(" as ")[-1].strip()
                if n:
                    out[n] = mod
    return out


def walk_code(root):
    for base in SRC_ROOTS:
        d = os.path.join(root, base)
        if not os.path.isdir(d):
            continue
        for dp, dn, fns in os.walk(d):
            dn[:] = [x for x in dn if x != "node_modules"]
            for fn in fns:
                if fn.endswith(CODE_EXT) and not fn.endswith(SKIP):
                    yield os.path.relpath(os.path.join(dp, fn), root)


def main():
    args = sys.argv[1:]
    out_path = None
    if "--out" in args:
        i = args.index("--out"); out_path = args[i + 1]; del args[i:i + 2]
    root = args[0] if args else "."

    entry = find_entry(root)
    html = read(root, "index.html")

    # providers — the tree often lives in a <Providers> component the entry renders, not the entry
    # itself, so scan entry + App + any *providers* wrapper, each cross-referenced to ITS OWN imports.
    pfiles, app_src = [], ""
    if entry:
        pfiles.append(entry)
    for cand in ("src/App.tsx", "src/app.tsx", "app/frontend/App.tsx"):
        if os.path.isfile(os.path.join(root, cand)):
            pfiles.append(cand)
            app_src = read(root, cand)
    for rel in walk_code(root):
        base = os.path.splitext(os.path.basename(rel))[0].lower().replace("-", "").replace("_", "")
        if base in ("providers", "appproviders", "rootproviders", "appshell"):
            pfiles.append(rel)

    providers, seen, seen_files = [], set(), set()
    for pf in pfiles:
        if pf in seen_files:
            continue
        seen_files.add(pf)
        psrc = read(root, pf)
        pimps = imports_of(psrc)
        for m in PROVIDER_TAG_RE.finditer(psrc):
            name = m.group(1) or m.group(2)
            if name in seen or name in ("ReactStrictMode", "StrictMode"):
                continue
            seen.add(name)
            providers.append({"name": name, "from": pimps.get(name)})

    # root CSS
    entry_src = read(root, entry) if entry else ""
    js_css = sorted({c.lstrip("./") for c in CSS_IMPORT_RE.findall(entry_src) + CSS_IMPORT_RE.findall(app_src)})
    html_css = sorted(set(HTML_LINK_RE.findall(html)))

    # one walk for portals + network signals (fetch libs/hooks + MSW presence)
    pkg = read(root, "package.json")
    libs = {label for dep, label in NET_LIBS.items() if f'"{dep}"' in pkg}
    portals, ptargets, hooks = [], set(), set()
    has_fetch = msw = False
    for rel in walk_code(root):
        s = read(root, rel)
        for tid in PORTAL_RE.findall(s):
            if tid not in ptargets:
                ptargets.add(tid)
                portals.append({"target": tid, "file": rel})
        hooks.update(NET_HOOK_RE.findall(s))
        if re.search(r'\bfetch\s*\(', s):
            has_fetch = True
        if re.search(r'''setupWorker|setupServer|/mocks/(browser|server)|["']msw["']''', s):
            msw = True
    for hid in HTML_ID_RE.findall(html):
        if hid != "root" and hid not in ptargets:
            ptargets.add(hid)
            portals.append({"target": hid, "file": "index.html"})
    if msw:
        libs.add("msw")
    network = {"libraries": sorted(libs), "hooks": sorted(hooks),
               "needsMsw": bool(libs or hooks or has_fetch or msw)}

    result = {
        "entry": entry,
        "providers": providers,
        "rootCss": {"jsImports": js_css, "htmlLinks": html_css},
        "portals": portals,
        "network": network,
        "summary": {"providers": len(providers), "portals": len(portals), "needsMsw": network["needsMsw"]},
    }
    txt = json.dumps(result, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(txt + "\n")
        print(f"runtime: {len(providers)} providers, {len(portals)} portals, msw={network['needsMsw']} -> {out_path}")
    else:
        print(txt)


if __name__ == "__main__":
    main()
