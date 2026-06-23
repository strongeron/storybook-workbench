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


_RE_COLOR_FUNC = re.compile(
    r"^\s*(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color)\s*\()", re.I)
# A bare channel triplet: `L C H` (OKLCH) or `H S% L%` (shadcn-HSL), optional `/ alpha`.
# Used by withOklch-style themes where the var holds raw channels and a helper wraps
# oklch()/hsl() around it at use-site (so the value never literally says "oklch"). Units
# like px/rem/em disqualify it (those are scale values, e.g. a shadow `0 1px 2px`).
_RE_COLOR_TRIPLET = re.compile(
    r"^\s*-?[\d.]+%?\s+-?[\d.]+%?\s+-?[\d.]+(?:deg)?\s*(?:/\s*[\d.]+%?\s*)?;?\s*$")


def value_is_color(v):
    """True when a token VALUE is a color — a CSS color function/hex, or a bare channel
    triplet. Project-agnostic: catches shadcn-style bare role tokens (`--accent: 0.95 0.001
    234`) and chart colors that carry no `color-` namespace or name prefix."""
    if not v:
        return False
    v = v.strip().rstrip(";").strip()
    return bool(_RE_COLOR_FUNC.match(v) or _RE_COLOR_TRIPLET.match(v))


def resolve_literal(tok, declared, _seen=None):
    """Follow a `var(--x)` alias chain to the first literal value, so an aliased role token
    (`--primary: var(--payne-blue-600)`) is classified by the primitive it points at, not by
    the opaque `var()` string. Cycle-guarded."""
    if _seen is None:
        _seen = set()
    if tok in _seen or tok not in declared:
        return declared.get(tok, (None, None, None))[2]
    _seen.add(tok)
    v = (declared[tok][2] or "").strip().rstrip(";").strip()
    m = re.match(r"var\(\s*(--[a-z0-9-]+)\s*\)\s*$", v, re.I)
    if m:
        return resolve_literal(m.group(1), declared, _seen)
    return v


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


# Tailwind v4 DEFAULT type scale — the framework's own utilities, used even when the project declares no
# --text-*/--font-* token of its own (the common case: a project themes colors but rides Tailwind's type
# scale). These suffixes are Tailwind's documented defaults — a FRAMEWORK constant, not a project's role
# vocabulary — so matching them surfaces the REAL typographic system in use, the part a declared-token-only
# scan can't see, without guessing. Color `text-<role>` can't collide: only size suffixes live under `text`.
TW_DEFAULT_TYPO = {
    "text":     ("xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"),
    "font":     ("thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black",
                 "sans", "serif", "mono"),
    "leading":  ("none", "tight", "snug", "normal", "relaxed", "loose", "3", "4", "5", "6", "7", "8", "9", "10"),
    "tracking": ("tighter", "tight", "normal", "wide", "wider", "widest"),
}


def default_typography_rows(files, declared):
    """One row per Tailwind-DEFAULT type utility actually used (text-sm, font-medium, leading-none, …) that
    the project does NOT back with its own declared token. Real usage that belongs in the explorer's
    typography lane but has no `--token` declaration, so each carries source:'tailwind-default' and is
    status:'used' only (never an orphan candidate). Resolves to components/pages downstream via its files[]."""
    rows = []
    for prefix, suffixes in TW_DEFAULT_TYPO.items():
        for suf in suffixes:
            cls = f"{prefix}-{suf}"
            if f"--{prefix}-{suf}" in declared:     # project declares its own token for this step → handled already
                continue
            rx = re.compile(r"(?:^|[^\w-])" + re.escape(cls) + r"(?![\w-])")
            count, hit = 0, []
            for p, code in files.items():
                n = len(rx.findall(code))
                if n:
                    count += n
                    hit.append(os.path.relpath(p).replace("\\", "/"))
            if count:
                rows.append({"token": cls, "category": "typography", "value": None,
                             "status": "used", "count": count, "files": sorted(set(hit)),
                             "declaredIn": f"tailwind-default:{cls}", "source": "tailwind-default",
                             "utilities": [cls]})
    return rows


# Each Tailwind-v4 @theme namespace → the explorer lane its tokens belong to. This is the SOURCE of truth
# for category: a token's lane is decided by the namespace it lives in (or the namespace of the @theme
# bridge that aliases it), NOT by a hardcoded list of role names. That keeps classification project-agnostic
# — it reads the theme the project actually declared instead of assuming shadcn's vocabulary.
NS_CATEGORY = {
    "color": "color",
    "text": "typography", "font": "typography", "leading": "typography", "tracking": "typography",
    "radius": "scale", "shadow": "scale", "spacing": "scale", "blur": "scale", "aspect": "scale",
    "container": "scale", "ease": "scale", "duration": "scale", "animate": "scale",
}


def own_namespace(tok):
    """The @theme namespace a token declares itself in (`--text-sm` → text), or None for a bare token."""
    parts = tok.split("-")  # '--text-sm' → ['', '', 'text', 'sm']
    return parts[2] if len(parts) > 2 and parts[2] in THEME_NAMESPACES else None


def category(tok, bridge_ns=None, value=None):
    """Classify a token by the namespace it (or its @theme bridge) lives in — source-derived, not by name.

    bridge_ns is the namespace of a `--<ns>-x: var(--tok)` bridge that aliases this bare token (so `--card`,
    aliased by `--color-card`, inherits the color lane). `value` is the token's RESOLVED literal value (var()
    chains followed) — used as a project-agnostic fallback so bare shadcn role tokens (`--accent`, `--card`,
    `--chart-2`, `--primary`) whose names carry no `color-` namespace still land in the color lane via their
    OKLCH/hex value. Falls back to loose prefix heuristics for projects with no @theme namespaces."""
    eff_ns = own_namespace(tok) or bridge_ns
    if eff_ns in NS_CATEGORY:
        return NS_CATEGORY[eff_ns]
    t = tok.lstrip("-")
    if t.startswith(("text-", "font-", "leading-", "line-height-", "tracking-", "letter-spacing-")):
        return "typography"
    if t.startswith(("color-", "base-", "bg-", "fg-", "surface-", "brand-", "border-", "ring-",
                     "accent-", "muted-", "primary-", "secondary-", "destructive-", "foreground", "background")):
        return "color"
    # Value-based fallback (before scale): a bare role token whose resolved value is a color
    # — catches `--accent`/`--card`/`--chart-2`/`--primary`/`--shadow-color` that no name prefix covers.
    if value_is_color(value):
        return "color"
    if t.startswith(("spacing-", "space-", "radius-", "rounded-", "size-", "sizing-", "gap-",
                     "breakpoint-", "container-", "aspect-", "blur-", "shadow-", "elevation-",
                     "duration-", "ease-", "animate-", "transition-", "z-", "inset-",
                     "control-", "icon-", "opacity-", "hover-", "active-", "focus-", "border-width")):
        return "scale"
    return "other"


def alias_targets(declared):
    """Resolve the two source-derived Tailwind-v4 alias shapes, each with its own usage direction.

    Both are read from the CSS, never assumed — so this stays project-agnostic:
      • @theme bridge (`--color-card: var(--card)`) — the bridge compiles `bg-card`; its usage flows UP to
        the bare `--card`, the token a person searches for. Returned in `bridges` as {bridge: bare}.
      • font-size modifier (`--text-xxs--line-height`) — the Tailwind v4 paired sub-property applied
        automatically whenever `text-xxs` is used. It has no utility of its own, so its used-ness flows DOWN
        from the parent size token. Returned in `modifiers` as {modifier: parent}.
    Returns (bridges, modifiers). Bridges are resolved transitively (cycle-guarded) so chains collapse."""
    direct, modifiers = {}, {}
    for tok, (_df, _dl, dv) in declared.items():
        m = re.match(r"\s*var\(\s*(--[a-z][a-z0-9-]*)\s*\)\s*;?\s*$", dv or "")
        if m and m.group(1) != tok and m.group(1) in declared:
            direct[tok] = m.group(1)                        # @theme bridge → its bare role (usage flows up)
            continue
        sub = re.match(r"(--.+?)--(?:line-height|letter-spacing|font-weight)$", tok)
        if sub and sub.group(1) in declared:
            modifiers[tok] = sub.group(1)                   # font-size modifier → parent (status flows down)
    bridges = {}
    for tok in direct:
        t, seen = tok, set()
        while t in direct and t not in seen:
            seen.add(t)
            t = direct[t]
        if t != tok:
            bridges[tok] = t
    return bridges, modifiers


def main():
    files = _read_all()
    declared, util_to_token = collect(files)

    # 1. base consumption per declared token (count, files, utility classes).
    base = {tok: usage(tok, files, util_to_token) for tok in declared}
    base_utils = {tok: utilities_used(tok, files, util_to_token) for tok in declared}

    # 2. alias inheritance: fold each @theme bridge's usage into the bare role it aliases, so
    # --card/--primary/--sidebar carry the bg-card/bg-primary/bg-sidebar usage the bridge collected
    # instead of collapsing to count=1 (their own self-referential `var()` declaration line). The bridge
    # token keeps its own usage too — both resolve in the explorer; the bare one is no longer dead.
    bridges, modifiers = alias_targets(declared)
    agg_count = {t: base[t][0] for t in declared}
    agg_files = {t: set(base[t][1]) for t in declared}
    agg_utils = {t: set(base_utils[t]) for t in declared}
    for bridge, target in bridges.items():
        agg_count[target] += base[bridge][0]
        agg_files[target] |= set(base[bridge][1])
        agg_utils[target] |= set(base_utils[bridge])

    # the @theme namespace of the bridge that aliases each bare token — so `--card` (aliased by --color-card)
    # is classified into the color lane from the SOURCE, with no role-name list to maintain.
    bridge_ns = {}
    for bridge, target in bridges.items():
        ns = own_namespace(bridge)
        if ns and target not in bridge_ns:
            bridge_ns[target] = ns

    aliases = dict(bridges)             # {alias → canonical} for aliasOf marking + suspect exclusion (both kinds)
    aliases.update(modifiers)

    # 3. self-escalation — "if we can't see the full picture, scan harder before calling a token unused."
    # Any token still ≤1 reference after the namespace + alias passes gets a BROADER idiom sweep: Tailwind
    # arbitrary values (`text-[--card]`, `w-[--gap]`). The var()-wrapped form is already caught by the var()
    # signal, so this adds only the non-overlapping bracket idiom — precise, low false-positive. We track how
    # many tokens it rescues so a still-thin graph is visibly the result of exhausted signals, not an early exit.
    rescued = 0
    for t in [tok for tok in declared if agg_count[tok] <= 1]:
        rx = re.compile(r"-\[\s*" + re.escape(t) + r"\s*\]")
        extra, hit = 0, set()
        for p, code in files.items():
            n = len(rx.findall(code))
            if n:
                extra += n
                hit.add(os.path.relpath(p).replace("\\", "/"))
        if hit - agg_files[t]:
            agg_count[t] += extra
            agg_files[t] |= hit
            rescued += 1

    # 4. modifier inheritance: a font-size modifier (`--text-xxs--line-height`) is applied wherever its
    # parent size token is used, so it carries the parent's resolved usage — never a false orphan. Run last,
    # after the parent's count is final (namespace + alias + escalation).
    for modifier, parent in modifiers.items():
        agg_count[modifier] = max(agg_count[modifier], agg_count[parent])
        agg_files[modifier] |= agg_files[parent]

    rows = []
    for tok, (df, dl, dv) in sorted(declared.items()):
        c, fs = agg_count[tok], sorted(agg_files[tok])
        rec = {"token": tok, "category": category(tok, bridge_ns.get(tok), resolve_literal(tok, declared)), "value": dv,
               "status": "used" if c > 0 else "orphan", "count": c,
               "files": fs, "declaredIn": f"{os.path.relpath(df)}:{dl}"}
        if tok in aliases:              # transparency: which canonical token this alias/bridge feeds
            rec["aliasOf"] = aliases[tok]
        utils = sorted(agg_utils[tok])
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

    # Tailwind-DEFAULT type utilities actually used (text-sm, font-medium, leading-none…) — surfaced so the
    # explorer's typography lane reflects the REAL type system, not just the handful of declared --text-*.
    default_typo = default_typography_rows(files, declared)
    rows.extend(default_typo)

    rows.sort(key=lambda r: (r["category"], r["status"] == "used", r["token"]))
    # The declared-token health triple stays internally consistent (used + orphan == declared); Tailwind
    # default utilities are real usage but undeclared, so they're counted separately, never as orphans.
    declared_rows = [r for r in rows if r.get("source") != "tailwind-default"]
    declared_used = sum(1 for r in declared_rows if r["status"] == "used")
    summary = {"totalDeclared": len(declared_rows), "usedCount": declared_used,
               "orphanCount": len(declared_rows) - declared_used, "totalRows": len(rows)}
    if default_typo:
        summary["tailwindDefaultTypography"] = len(default_typo)
    if rescued:
        summary["escalationRescued"] = rescued

    # Self-diagnosis (mirrors extract-app-graph.mjs's UNDER-EXTRACTION alarm): a CLASSIFIED token (color,
    # typography, or scale — a thing the app's design system clearly references) that still resolves to ≤1
    # reference after every pass is most likely a SCANNER miss (an unhandled consumption idiom), not a real
    # orphan. Bare "other" tokens are excluded — those genuinely may be one-offs. Surfaced in summary
    # (machine-readable, survives the orchestrator's 2>/dev/null) AND on stderr so a thin graph never passes
    # silently as complete. The fix loop is: add the idiom to usage()/escalation, not lower the bar.
    suspects = sorted(r["token"] for r in rows
                      if r["category"] in ("color", "typography", "scale")
                      and r["count"] <= 1 and r["token"] not in aliases
                      and r.get("source") != "tailwind-default")  # default utilities are exact scans, not misses
    if suspects:
        summary["suspectUnderExtracted"] = suspects
        print(f"⚠ token-usage: {len(suspects)} classified token(s) resolve to ≤1 reference after "
              f"namespace + alias + arbitrary-value passes — likely an unhandled consumption idiom, not real "
              f"orphans: {', '.join(suspects[:12])}{' …' if len(suspects) > 12 else ''}", file=sys.stderr)

    print(json.dumps({"tokens": rows, "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
