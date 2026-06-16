#!/usr/bin/env python3
"""token-usage.py — the single source of truth for design-token usage.

Scans a React+Vite project's real source and classifies every DECLARED custom
property (`--foo: …` in a CSS file) as used or orphan, with an accurate
reference count and the files where it's consumed. Three consumption signals,
because a Tailwind v4 @theme token is rarely referenced via a literal var():

  1. var(--token)            — inline styles, CSS rules, custom @utility bodies, aliasing.
  2. Tailwind color utility  — `--color-<name>` consumed as `bg-/text-/border-/…-<name>`.
  3. custom @utility class    — `@utility <name> { … var(--token) … }` consumed as `<name>`.

This replaces three divergent scanners (sb-inventory `tw_theme_used`, sb-health
`unused-token`, the demo's `swatches.tokenUsage`) with one rule. sb-inventory
writes the result to project-inventory.json (`tokens.map`); sb-health reads the
orphans from there instead of re-scanning.

Usage:
  token-usage.py [SCAN_PATH ...]            # prints JSON {tokens:[…], summary:{…}} to stdout
Defaults SCAN_PATH to ./src then ./app/frontend.
"""
import sys, os, re, json, glob

SCAN_PATHS = [p for p in sys.argv[1:] if os.path.isdir(p)] or \
             [p for p in ("src", "app/frontend") if os.path.isdir(p)]

# Tailwind v4 @theme namespace → the utility prefixes that consume a token in that namespace.
# Each token is matched ONLY against its own namespace's utilities, so scale tokens that share a
# suffix (--radius-md vs --shadow-md) can't cross-contaminate each other's counts.
TW_COLOR_PREFIXES = ("bg|text|border|ring|fill|stroke|from|via|to|outline|"
                     "divide|decoration|accent|caret|placeholder|shadow")
NS_PREFIXES = {
    "color":     TW_COLOR_PREFIXES,
    "radius":    r"rounded(?:-[a-z]{1,2})?",
    "shadow":    r"shadow|inset-shadow|drop-shadow",
    "text":      r"text",                       # --text-sm  → text-sm  (font-size scale)
    "font":      r"font",                       # --font-sans → font-sans (family)
    "leading":   r"leading",
    "tracking":  r"tracking",
    "blur":      r"blur|backdrop-blur",
    "aspect":    r"aspect",
    "container": r"container|max-w|min-w|w",
    "ease":      r"ease",
    "duration":  r"duration",
    "animate":   r"animate",
    "spacing":   (r"p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|size|"
                  r"min-[wh]|max-[wh]|inset(?:-[xy])?|top|right|bottom|left|start|end|basis|"
                  r"translate-[xy]|scroll-[pm][xytrbl]?"),
}
THEME_NAMESPACES = tuple(NS_PREFIXES)

CODE_EXT = (".tsx", ".jsx", ".ts", ".js", ".html", ".css")
UTIL_EXT = (".tsx", ".jsx", ".ts", ".js", ".html")  # where class names live (not CSS)


def _read_all():
    files = {}
    for root in SCAN_PATHS:
        for dirpath, _dirs, names in os.walk(root):
            if "node_modules" in dirpath or "/.git" in dirpath:
                continue
            for n in names:
                if n.endswith(CODE_EXT) and ".stories." not in n:
                    p = os.path.join(dirpath, n)
                    try:
                        files[p] = open(p, errors="ignore").read()
                    except OSError:
                        pass
    return files


def _is_theme_file(path):
    # token DECLARATION files — counted for declarations, excluded from "usage" counts
    base = os.path.basename(path)
    return bool(re.search(r"theme(\.[a-z]+)?\.css$", base)) or base in ("tokens.css", "index.css")


def collect(files):
    # 1. declared custom properties: left-hand side of a `--foo:` declaration in a CSS file.
    declared = {}  # token -> (file, line)
    decl_re = re.compile(r"(?:^|[^\w-])(--[a-z][a-z0-9-]*)\s*:", re.M)
    for p, code in files.items():
        if not p.endswith(".css"):
            continue
        for i, line in enumerate(code.splitlines(), 1):
            # capture the RHS value too (first declaration wins — usually the light/:root value)
            m = re.match(r"\s*(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);?", line)
            if m and m.group(1) not in declared:
                declared[m.group(1)] = (p, i, m.group(2).strip())

    # 2. custom @utility class -> token it wires (e.g. `@utility border-strong { border-color: var(--color-border-strong) }`)
    util_to_token = {}
    for p, code in files.items():
        if not p.endswith(".css"):
            continue
        for m in re.finditer(r"@utility\s+([a-z][a-z0-9-]*)\s*\{([^}]*)\}", code, re.S):
            name, body = m.group(1), m.group(2)
            vm = re.search(r"var\(\s*(--[a-z][a-z0-9-]*)", body)
            if vm:
                util_to_token.setdefault(vm.group(1), []).append(name)
    return declared, util_to_token


def usage(tok, files, util_to_token):
    """Return (count, sorted_files) of real consumption sites for one token."""
    patterns = [r"var\(\s*" + re.escape(tok) + r"(?![\w-])"]
    parts = tok.split("-")  # '--color-error-border' → ['', '', 'color', 'error', 'border']
    ns = parts[2] if len(parts) > 2 and parts[2] in THEME_NAMESPACES else None
    suffix = tok[len("--" + ns + "-"):] if ns else None
    if ns and suffix:
        # consumed as a Tailwind utility for THIS namespace only: <prefix>-<suffix> whole class token.
        patterns.append(r"(?:^|[^\w-])(?:" + NS_PREFIXES[ns] + r")-" + re.escape(suffix) + r"(?![\w-])")
    for cls in util_to_token.get(tok, []):
        patterns.append(r"(?:^|[^\w-])" + re.escape(cls) + r"(?![\w-])")
    rx = re.compile("|".join(patterns))
    count, hit_files = 0, []
    for p, code in files.items():
        # The token's own declaration (`--tok: value`) never contains var(--tok) or a utility class,
        # so declaration sites don't inflate the count; @utility bodies and aliasing legitimately do.
        n = len(rx.findall(code))
        if n:
            count += n
            hit_files.append(os.path.relpath(p).replace("\\", "/"))
    return count, sorted(set(hit_files))


def _norm_color(v):
    """Normalize a flat color value (rgb/rgba/hex) to a comparable key, or None for
    oklch / color-mix / var() / gradients (not flat-matchable to a primitive)."""
    if not v:
        return None
    v = v.strip().rstrip(";").strip()
    m = re.match(r"rgba?\(([^)]+)\)\s*$", v)
    if m:
        nums = re.findall(r"[\d.]+", m.group(1))
        return "c:" + ",".join(nums)
    m = re.match(r"#([0-9a-fA-F]{3,8})\s*$", v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        return "c:" + ",".join(str(int(h[i:i + 2], 16)) for i in range(0, 6, 2))
    return None


def is_primitive_color(tok):
    """A primitive is a raw palette step — `--color-<scale>-<n>`, `--base-*`, or white/black —
    as opposed to a role/semantic token (`--color-foreground`, `--color-border-subtle`)."""
    return bool(re.search(r"\d$", tok)) or tok.startswith("--base-") or tok in ("--color-white", "--color-black")


def utilities_used(tok, files, util_to_token):
    """The Tailwind / custom @utility class names actually present in the code for this token,
    e.g. --color-foreground -> ['text-foreground']. Empty for a var()-only project (no Tailwind),
    which is correct: the wrapper then shows no utility line. Derived from real usage, not authored."""
    parts = tok.split("-")
    ns = parts[2] if len(parts) > 2 and parts[2] in THEME_NAMESPACES else None
    suffix = tok[len("--" + ns + "-"):] if ns else None
    rx = re.compile(r"(?:^|[^\w-])((?:" + NS_PREFIXES[ns] + r")-" + re.escape(suffix) + r")(?![\w-])") if (ns and suffix) else None
    customs = util_to_token.get(tok, [])
    found = set()
    for _p, code in files.items():
        if rx:
            for m in rx.finditer(code):
                found.add(m.group(1))
        for c in customs:
            if re.search(r"(?:^|[^\w-])" + re.escape(c) + r"(?![\w-])", code):
                found.add(c)
    return sorted(found)


def category(tok):
    t = tok.lstrip("-")
    if t.startswith(("text-", "font-", "leading-", "line-height-", "tracking-", "letter-spacing-")):
        return "typography"
    if t.startswith(("color-", "base-", "bg-", "fg-", "surface-", "brand-", "border-", "ring-",
                     "accent-", "muted-", "primary-", "secondary-", "destructive-", "foreground", "background")):
        return "color"
    if t.startswith(("spacing-", "space-", "radius-", "rounded-", "size-", "sizing-", "gap-",
                     "breakpoint-", "container-", "aspect-", "blur-", "shadow-", "elevation-",
                     "duration-", "ease-", "animate-", "transition-", "z-", "inset-")):
        return "scale"
    return "other"


def main():
    files = _read_all()
    declared, util_to_token = collect(files)
    rows = []
    for tok, (df, dl, dv) in sorted(declared.items()):
        c, fs = usage(tok, files, util_to_token)
        rec = {"token": tok, "category": category(tok), "value": dv,
               "status": "used" if c > 0 else "orphan", "count": c,
               "files": fs, "declaredIn": f"{os.path.relpath(df)}:{dl}"}
        utils = utilities_used(tok, files, util_to_token)
        if utils:                       # empty for var()-only projects — no utility line then
            rec["utilities"] = utils
        rows.append(rec)

    # Color "maps to": how each role token is wired to a palette step. Two signals, in order:
    #   1. DECLARED — `--color-foreground: var(--color-neutral-900)` → the authored parent (exact).
    #   2. INFERRED — a raw color (`--color-foreground: rgb(42,42,40)`) that equals a primitive's
    #      value → value-match. Less exact (two same-valued tokens share a parent), but the only
    #      signal when a theme declares roles as raw colors, not var() chains.
    prim_index = {}
    for r in rows:
        if r["category"] == "color" and is_primitive_color(r["token"]):
            k = _norm_color(r["value"])
            if k:
                prim_index.setdefault(k, r["token"])
    reverse = {}  # primitive token -> [role tokens that resolve to it]
    for r in rows:
        if r["category"] != "color" or is_primitive_color(r["token"]):
            continue
        vm = re.match(r"var\(\s*(--[a-z][a-z0-9-]*)", r["value"] or "")
        if vm and vm.group(1) != r["token"]:
            r["mapsTo"] = vm.group(1)            # declared parent — exact
            reverse.setdefault(vm.group(1), []).append(r["token"])
        else:
            k = _norm_color(r["value"])
            mt = prim_index.get(k)
            if mt and mt != r["token"]:
                r["mapsTo"] = mt                 # value-matched — inferred
                r["mapsToInferred"] = True
                reverse.setdefault(mt, []).append(r["token"])
            elif k:
                r["rawColor"] = True             # a flat color that is not a palette step
    # reverse relation: which roles consume each primitive (answers "what breaks if I change it")
    for r in rows:
        roles = reverse.get(r["token"])
        if roles:
            r["usedBy"] = sorted(roles)

    rows.sort(key=lambda r: (r["category"], r["status"] == "used", r["token"]))
    used = [r for r in rows if r["status"] == "used"]
    summary = {"totalDeclared": len(rows), "usedCount": len(used),
               "orphanCount": len(rows) - len(used)}
    print(json.dumps({"tokens": rows, "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
