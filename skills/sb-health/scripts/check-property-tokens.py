#!/usr/bin/env python3
"""check-property-tokens.py — property→token-family correctness (opt-in, designer-owned).

The semantic error sb-health's other checks can't see: a VALID, declared token
used on the WRONG property family — e.g. `color: var(--color-container)` (a
container token used as text color). raw-color catches "no token at all";
undefined-token catches "token doesn't exist"; this catches "real token, wrong
slot". The logic that decides which token family belongs on which property is
DESIGN intent, so it lives in a designer-owned rules file, not in this script.

Rules file (first found wins; or pass --rules PATH):
    design-system/lint/colors.json
    .storybook/lint/colors.json

Shape (see references/colors.schema.json):
    { "propertyTokens": {
        "color":       ["--color-content"],
        "background*": ["--color-container", "--color-canvas", "--color-backdrop"],
        "box-shadow":  ["--color-border", "--color-shadow"],
        "border*":     ["--color-border"]
    }}

  - Key is a CSS property; a trailing `*` makes it a prefix family
    (`background*` → background, background-color, …; `border*` → border,
    border-color, border-top, …). No `*` = exact match (`color` ≠ border-color).
  - Values are token PREFIXES: `--color-border` allows --color-border AND
    --color-border-strong, but not --color-borderless.
  - Only properties named in the file are governed. Everything else is ignored,
    so the designer opts in property-by-property.

If no rules file exists this is a NO-OP — the zero-config default is preserved.

Escape hatches (in source files), in order of preference:
    /* color-lint-alias: --color-theme --color-container */   file-level prefix remap
    /* color-lint-ignore */                                   per-line suppression (counted)
  Suppressions are counted and reported; past 10 the report nudges a refactor.
  The number growing is the signal — mute quickly, refactor deliberately.

Output: tab-separated findings to stdout, one per line, matching the validator's
emit() channel:  kind \\t severity \\t file \\t line \\t message \\t fix
Finding kinds:
    property-token-family   warning   token on the wrong property family
    property-rules-drift    warning   a rule allows a token-prefix nothing declares (stale config)
    property-rules-invalid  warning   rules file present but unparseable
    property-lint-suppressions  info  count of /* color-lint-ignore */ lines

Usage:
    check-property-tokens.py --rules PATH [SCAN_PATH ...]
    check-property-tokens.py --init [DIR]   # scaffold a starter rules file + schema
Defaults SCAN_PATH to ./src then ./app/frontend.
"""
import sys, os, re, json, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(HERE)  # scripts/ -> skill root
SCHEMA_SRC = os.path.join(SKILL_ROOT, "references", "colors.schema.json")
EXAMPLE_SRC = os.path.join(SKILL_ROOT, "references", "colors.example.json")

SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".storybook", "coverage", ".next"}
CODE_EXT = (".tsx", ".jsx", ".ts", ".js")

# camelCase style-object key → CSS property (so inline `style={{ backgroundColor }}` is governed too)
def camel_to_kebab(prop):
    return re.sub(r"([A-Z])", lambda m: "-" + m.group(1).lower(), prop)

VAR_RE = re.compile(r"var\(\s*(--[a-z0-9-]+)")
# property: …value-with-var…  (line-scoped; we only care about declarations that reference a token)
DECL_RE = re.compile(r"(^|[\s;{])([A-Za-z][A-Za-z-]*)\s*:\s*([^;{}]*var\([^;{}]*)")
ALIAS_RE = re.compile(r"color-lint-alias:\s*(--[a-z0-9-]+)\s+(--[a-z0-9-]+)")
IGNORE_RE = re.compile(r"color-lint-ignore")
DECLARED_RE = re.compile(r"(--[a-z][a-z0-9-]*)\s*:")


def emit(kind, sev, f, line, msg, fix=""):
    sys.stdout.write("%s\t%s\t%s\t%s\t%s\t%s\n" % (kind, sev, f, line, msg, fix))


def iter_files(paths, exts):
    for p in paths:
        if os.path.isfile(p):
            if p.endswith(exts):
                yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fn in files:
                if fn.endswith(exts):
                    yield os.path.join(root, fn)


def family_for(prop, families):
    """Return the most specific governing rule key for a CSS property, or None."""
    best = None
    for key in families:
        if key.endswith("*"):
            if prop.startswith(key[:-1]):
                if best is None or len(key) > len(best):
                    best = key
        elif prop == key:
            return key  # exact wins outright
    return best


def prefix_matches(token, prefix):
    return token == prefix or token.startswith(prefix + "-")


def token_allowed(token, allowed, aliases):
    """token allowed if it (or any alias-remapped form) matches an allowed prefix."""
    candidates = [token]
    for frm, to in aliases:
        if prefix_matches(token, frm):
            candidates.append(to + token[len(frm):])
    return any(prefix_matches(c, pfx) for c in candidates for pfx in allowed)


def do_init(target_dir):
    dest = os.path.join(target_dir, "design-system", "lint")
    os.makedirs(dest, exist_ok=True)
    out_rules = os.path.join(dest, "colors.json")
    if os.path.isfile(SCHEMA_SRC):
        shutil.copy2(SCHEMA_SRC, os.path.join(dest, "colors.schema.json"))
    if os.path.exists(out_rules):
        print("exists, left as-is: %s" % out_rules)
    elif os.path.isfile(EXAMPLE_SRC):
        shutil.copy2(EXAMPLE_SRC, out_rules)
        print("wrote starter rules: %s" % out_rules)
    else:
        with open(out_rules, "w") as o:
            json.dump({"$schema": "./colors.schema.json", "propertyTokens": {}}, o, indent=2)
        print("wrote empty rules: %s" % out_rules)
    print("Edit propertyTokens, then re-run validate-design-system.sh.")


def main(argv):
    if "--init" in argv:
        i = argv.index("--init")
        target = argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("-") else "."
        do_init(target)
        return 0

    rules_path = None
    paths = []
    skip = -1
    for idx, a in enumerate(argv):
        if idx == skip:
            continue
        if a == "--rules":
            rules_path = argv[idx + 1] if idx + 1 < len(argv) else None
            skip = idx + 1
        else:
            paths.append(a)
    paths = [p for p in paths if os.path.isdir(p) or os.path.isfile(p)]
    if not paths:
        paths = [p for p in ("src", "app/frontend") if os.path.isdir(p)]

    if not rules_path:
        for cand in ("design-system/lint/colors.json", ".storybook/lint/colors.json"):
            if os.path.isfile(cand):
                rules_path = cand
                break
    if not rules_path or not os.path.isfile(rules_path):
        return 0  # no-op: zero-config default preserved

    try:
        rules = json.load(open(rules_path))
        families = rules.get("propertyTokens") or {}
        if not isinstance(families, dict):
            raise ValueError("propertyTokens must be an object")
    except Exception as e:
        emit("property-rules-invalid", "warning", rules_path, "",
             "Rules file present but unparseable: %s" % e,
             "Fix the JSON, or remove the file to disable the check")
        return 0

    if not families:
        return 0  # opted in but governs nothing yet

    # declared tokens (for the drift guard) — CSS only
    declared = set()
    for f in iter_files(paths, (".css",)):
        try:
            text = open(f, errors="ignore").read()
        except OSError:
            continue
        declared.update(DECLARED_RE.findall(text))

    suppressed = 0

    for f in iter_files(paths, (".css",) + CODE_EXT):
        try:
            lines = open(f, errors="ignore").read().splitlines()
        except OSError:
            continue
        is_code = f.endswith(CODE_EXT)
        aliases = []
        for ln in lines:
            aliases.extend(ALIAS_RE.findall(ln))
        prev_ignore = False
        for i, ln in enumerate(lines):
            line_ignored = bool(IGNORE_RE.search(ln)) or prev_ignore
            prev_ignore = bool(IGNORE_RE.search(ln)) and "var(" not in ln  # comment-on-own-line guards next line
            for m in DECL_RE.finditer(ln):
                _pre, prop, val = m.groups()
                css_prop = camel_to_kebab(prop).lower() if is_code else prop.lower()
                key = family_for(css_prop, families)
                if key is None:
                    continue
                allowed = families[key]
                for token in VAR_RE.findall(val):
                    if token_allowed(token, allowed, aliases):
                        continue
                    if line_ignored:
                        suppressed += 1
                        continue
                    emit("property-token-family", "warning", f, i + 1,
                         "%s uses %s — not allowed for '%s' (expects %s)"
                         % (css_prop, token, key, " / ".join(allowed)),
                         "Use one of %s, or remap: /* color-lint-alias: %s %s */"
                         % (", ".join(allowed), token, allowed[0]))

    # drift guard: a rule allows a token-prefix nothing declares → stale/lying config
    if declared:
        seen = set()
        for key, allowed in families.items():
            for pfx in allowed:
                if pfx in seen:
                    continue
                seen.add(pfx)
                if not any(prefix_matches(t, pfx) for t in declared):
                    emit("property-rules-drift", "warning", rules_path, "",
                         "Rule allows %s (for '%s') but no declared token matches it — config may be stale"
                         % (pfx, key),
                         "Declare a %s token, or drop it from the rule" % pfx)

    if suppressed:
        hint = " — past 10, consider refactoring deliberately" if suppressed > 10 else ""
        emit("property-lint-suppressions", "info", "", "",
             "%d line(s) suppressed via color-lint-ignore%s" % (suppressed, hint),
             "Each suppression is debt; the number growing is the signal")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
