#!/usr/bin/env bash
# extract-component-usage.sh — REAL prop-value usage at JSX call sites.
#
# Component-level real-vs-slop (inventory) and type-shape usage (prop-shapes) don't answer
# "which props/variants does the app ACTUALLY use." A shadcn Button may declare 6 variants but
# prod only renders 2. This scans every `<Component …>` call site across src/ and tallies, per
# component, which props are passed with which literal values, how often, and which DECLARED
# props/union-values are never used (prop-level slop). Also a per-page rollup.
#
# Output: .storybook/component-usage.json (atomic). Pairs with the UsageProfile MDX docs.
#
# Usage:
#   extract-component-usage.sh                 # scan ./src, components from inventory real[] (or glob)
#   extract-component-usage.sh path/to/src
#   extract-component-usage.sh --out file
#
# Limits (v1, grep/regex — note in output.meta): {...spread} and dynamic prop values are recorded
# as exprCount, not resolved; value-level "unused" needs a declared string-union (inline or a
# `type X = '…'|'…'` alias in src) — props typed by imported enums aren't value-resolved.

set -uo pipefail
SRC="src"; OUT_PATH=".storybook/component-usage.json"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) SRC="$1"; shift ;;
  esac
done
[[ -d "$SRC" ]] || { echo "ERROR: src dir not found: $SRC" >&2; exit 2; }

DIM=$'\033[2m'; RESET=$'\033[0m'; [[ -t 1 ]] || { DIM=""; RESET=""; }
echo "${DIM}Scanning $SRC for component call-site usage…${RESET}"

python3 - "$SRC" "$OUT_PATH" <<'PYEOF'
import os, re, sys, json, glob, datetime
src, out_path = sys.argv[1], sys.argv[2]

# ── 1. component list ──
# Union inventory real[] with PascalCase component files. The inventory list is capped, so usage
# coverage needs the filesystem scan too.
names = {}  # Name -> declaring file
inv = os.path.join(os.path.dirname(out_path), "project-inventory.json")
if os.path.isfile(inv):
    try:
        d = json.load(open(inv))
        for c in d.get("components", {}).get("real", []):
            f = c.get("file", "")
            if f.endswith((".tsx", ".jsx")):
                names.setdefault(os.path.splitext(os.path.basename(f))[0], f)
    except Exception:
        pass
for ext in ("tsx", "jsx"):
    for f in glob.glob(os.path.join(src, "**", f"*.{ext}"), recursive=True):
        if "/node_modules/" in f or f.endswith((".stories.tsx", ".stories.jsx", ".test.tsx")):
            continue
        base = os.path.splitext(os.path.basename(f))[0]
        if base[:1].isupper():
            names.setdefault(base, f)

# ── all source text (path -> text) ──
# Exclude .stories.*/.test.*/.spec.* here too, not just from registration: these are CATALOG/test
# call sites, not real app usage. Counting a <Btn tone="danger"/> rendered only in Btn.stories.tsx
# would mark `danger` as shipped and suppress its declaredButUnused flag — the exact story-noise leak
# the real-vs-declared signal exists to avoid. App code only.
def _is_catalog(p):
    return p.endswith((".stories.tsx", ".stories.jsx", ".test.tsx", ".test.jsx", ".spec.tsx", ".spec.jsx"))
files = {}
for ext in ("tsx", "jsx"):
    for f in glob.glob(os.path.join(src, "**", f"*.{ext}"), recursive=True):
        if "/node_modules/" in f or _is_catalog(f):
            continue
        try: files[f] = open(f, encoding="utf-8", errors="ignore").read()
        except Exception: pass

# ── register components by their PascalCase EXPORT name, not just a PascalCase filename ──
# shadcn/ui primitives live in lowercase files (button.tsx → `export function Button`). Keying only on
# filename case skips them — yet Button/Badge/Input are exactly where "which variants do we actually
# ship" matters most. Scan exports so those primitives get usage counts too.
EXPORT_RE = re.compile(r"export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)")
for f, txt in files.items():
    if f.endswith((".stories.tsx", ".stories.jsx", ".test.tsx")):
        continue
    for m in EXPORT_RE.finditer(txt):
        names.setdefault(m.group(1), f)

# ── declared string-union values for a component's props (inline union or `type X=` alias) ──
def declared_unions(decl_file):
    """Return {propName: set(values)} for props typed by an inline string union or a resolvable alias."""
    if not decl_file or not os.path.isfile(decl_file): return {}
    txt = open(decl_file, encoding="utf-8", errors="ignore").read()
    # resolve `type Alias = 'a' | 'b'` (this file + types.ts)
    aliases = {}
    alias_src = txt + "\n" + (open(os.path.join(src, "types.ts")).read() if os.path.isfile(os.path.join(src, "types.ts")) else "")
    for m in re.finditer(r"type\s+(\w+)\s*=\s*((?:'[^']*'\s*\|?\s*)+);", alias_src):
        aliases[m.group(1)] = set(re.findall(r"'([^']*)'", m.group(2)))
    out = {}
    # Scope to the *Props interface/type body ONLY (else we match `const styles: Record<…> = { primary:… }`
    # object keys as if they were props). Grab the brace block after `interface XProps` / `type XProps =`.
    blocks = []
    for bm in re.finditer(r"(?:interface\s+\w*Props|type\s+\w*Props\s*=)\s*\{", txt):
        i = txt.find("{", bm.start()); depth = 0
        for j in range(i, len(txt)):
            if txt[j] == "{": depth += 1
            elif txt[j] == "}":
                depth -= 1
                if depth == 0: blocks.append(txt[i+1:j]); break
    body = "\n".join(blocks)
    # props inside the Props body: `name?: 'a'|'b'` OR `name?: Alias`
    for pm in re.finditer(r"(\w+)\s*\??\s*:\s*([^;,\n}]+)", body):
        prop, typ = pm.group(1), pm.group(2).strip()
        lits = set(re.findall(r"'([^']*)'", typ))
        if lits: out[prop] = lits
        else:
            for a, vals in aliases.items():
                if re.search(rf"\b{re.escape(a)}\b", typ): out[prop] = set(vals)
    return out

# ── 2. scan call sites per component ──
# Parse the OPENING TAG only, string/brace-aware. The previous regex matched any `\w+` and stopped at the
# first `>` — so `onClick={() => x}` truncated the tag (the `>` in `=>`) AND expression interiors like
# `cn("h-7", x && "bg-brand-700")` or `style={{ width: 700 }}` leaked their inner tokens (`700`, `x`,
# `cn`, identifiers) in as fake props. A real prop name is a JSX identifier; values are quoted literals or
# a balanced `{…}` expression. Walking the tag with quote+brace tracking parses exactly the attribute list
# and nothing inside it — no numeric/identifier noise, no early truncation.
NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_:.\-]*")

def parse_open_tag(s):
    """s = text right after `<Name`. Parse attributes until the depth-0 tag close (`>`/`/>`).
       Returns [(name, literal_value_or_None, is_expr)]; expression interiors are skipped, not scanned."""
    i, n = 0, len(s)
    out = []
    while i < n:
        c = s[i]
        if c == ">" or (c == "/" and i + 1 < n and s[i + 1] == ">"):
            break
        if c.isspace():
            i += 1; continue
        m = NAME_RE.match(s, i)
        if not m:                      # stray char (e.g. `{...spread}`) — skip its braces if any
            if c == "{":
                i = _skip_braces(s, i)
            else:
                i += 1
            continue
        name = m.group(0); i = m.end()
        while i < n and s[i].isspace(): i += 1
        if i < n and s[i] == "=":
            i += 1
            while i < n and s[i].isspace(): i += 1
            if i < n and s[i] in ("\"", "'"):
                q = s[i]; i += 1; start = i
                while i < n and s[i] != q: i += 1
                out.append((name, s[start:i], False)); i += 1
            elif i < n and s[i] == "{":
                i = _skip_braces(s, i); out.append((name, None, True))
            else:
                out.append((name, None, False))   # `=` then something odd
        else:
            out.append((name, None, False))       # bare boolean prop
    return out

def _skip_braces(s, i):
    """i points at `{`. Return index just past the matching `}`, respecting strings/templates inside."""
    n = len(s); depth = 0
    while i < n:
        ch = s[i]
        if ch in ("\"", "'", "`"):
            q = ch; i += 1
            while i < n and s[i] != q:
                if s[i] == "\\": i += 1
                i += 1
            i += 1; continue
        if ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    return n

usage = {}
for name, decl in names.items():
    tag_re = re.compile(r"<" + re.escape(name) + r"(?=[\s/>])")
    props = {}     # prop -> {"count":n, "values":{v:n}, "exprCount":n}
    sites = 0; site_files = set()
    for path, txt in files.items():
        for m in tag_re.finditer(txt):
            sites += 1; site_files.add(path)
            for pname, val, is_expr in parse_open_tag(txt[m.end():]):
                rec = props.setdefault(pname, {"count": 0, "values": {}, "exprCount": 0})
                rec["count"] += 1
                if val is not None:
                    rec["values"][val] = rec["values"].get(val, 0) + 1
                elif is_expr:
                    rec["exprCount"] += 1
                # bare boolean prop → counted, no value
    if sites == 0:
        continue
    # declared-but-unused: prop never passed; union value never used
    unions = declared_unions(decl)
    declared_unused = []
    for p, vals in unions.items():
        if p not in props:
            declared_unused.append(p)
        else:
            used_vals = set(props[p]["values"].keys())
            for v in sorted(vals - used_vals):
                declared_unused.append(f"{p}={v}")
    usage[name] = {
        "callSites": sites,
        "files": sorted(os.path.relpath(f) for f in site_files),
        "props": props,
        "declaredButUnused": sorted(declared_unused),
    }

# ── 3. per-page rollup: which real components each page renders ──
pages = {}
for path, txt in files.items():
    if "/pages/" not in path and "/app/" not in path and "/routes/" not in path and "/views/" not in path:
        continue
    rendered = sorted(n for n in names if re.search(r"<" + re.escape(n) + r"(?=[\s/>])", txt))
    if rendered:
        pages[os.path.relpath(path)] = rendered

report = {
    "components": usage,
    "pages": pages,
    "meta": {
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "componentsScanned": len(names),
        "componentsUsed": len(usage),
        "note": "static call-site analysis; {...spread}/dynamic values counted as exprCount, not resolved",
    },
}
tmp = out_path + ".tmp"
os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
json.dump(report, open(tmp, "w"), indent=2)
os.replace(tmp, out_path)

# human summary
used = sorted(usage.items(), key=lambda kv: -kv[1]["callSites"])
print("")
print("✓ Wrote %s — %d component(s) used across %d page(s)" % (out_path, len(usage), len(pages)))
for n, u in used[:8]:
    parts = []
    for p, d in list(u["props"].items())[:3]:
        if d["values"]:
            vs = "/".join("%s×%d" % (v, c) for v, c in d["values"].items())
        else:
            vs = "%d×expr" % d["exprCount"]
        parts.append("%s=%s" % (p, vs))
    unused = (" · unused: " + ", ".join(u["declaredButUnused"])) if u["declaredButUnused"] else ""
    print("  %s: %d call site(s) — %s%s" % (n, u["callSites"], ", ".join(parts), unused))
PYEOF
