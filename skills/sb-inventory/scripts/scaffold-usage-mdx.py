#!/usr/bin/env python3
"""scaffold-usage-mdx.py — generate a per-component "Real usage in this app" autodocs MDX.

Reads .storybook/component-usage.json (extract-component-usage.sh) + storiesLocation from
.storybook/audit/status.md, then for every USED component stamps the usage-profile.mdx template
with the component name, the correct relative import path to component-usage.json, and a title —
so the human never edits the 3 TODOs by hand. Re-run any time usage changes; idempotent overwrite.

Usage:
  scaffold-usage-mdx.py                 # all used components → <storiesLocation>/components/<Name>.usage.mdx
  scaffold-usage-mdx.py Button Card     # only these
  scaffold-usage-mdx.py --usage F --out-root DIR --title-prefix Components
"""
import os, re, sys, json

usage_path = ".storybook/component-usage.json"
out_root = None
title_prefix = "Components"
only = []
per_component = False   # default: embed usage into each component's autodocs via <UsageSection>, not separate pages
args = sys.argv[1:]
while args:
    a = args.pop(0)
    if a == "--usage": usage_path = args.pop(0)
    elif a == "--out-root": out_root = args.pop(0)
    elif a == "--title-prefix": title_prefix = args.pop(0)
    elif a == "--per-component": per_component = True   # opt back into one standalone <Name>.usage.mdx per component
    elif a in ("-h", "--help"): print(__doc__); sys.exit(0)
    else: only.append(a); per_component = True          # naming components implies per-component generation

if not os.path.isfile(usage_path):
    sys.exit(f"ERROR: {usage_path} not found — run extract-component-usage.sh first.")
usage = json.load(open(usage_path))
components = usage.get("components", {})
if only:
    components = {k: v for k, v in components.items() if k in only}

# storiesLocation → where the .usage.mdx files live (mirrors where stories go)
def stories_root():
    if out_root:
        return out_root
    sb_dir = os.path.dirname(usage_path) or "."
    status = os.path.join(sb_dir, "audit", "status.md")
    loc = "isolated"
    if os.path.isfile(status):
        m = re.search(r"storiesLocation:\s*(\S+)", open(status).read())
        if m: loc = m.group(1)
    if loc == "isolated":
        return os.path.join(sb_dir, "stories", "components")
    if loc == "colocated":
        return os.path.join("src", "components")        # next to components (one file each below)
    return os.path.join(loc, "components")              # custom path

# template dir holds the per-component template + the app-page templates
tmpl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "usage-profile.mdx")

# Per-component standalone pages are OPT-IN (--per-component or naming components). The default is to
# embed usage into each component's autodocs Docs page via <UsageSection> (preview.ts docs.page) — far
# fewer sidebar entries. App-wide pages below are always generated.
written = []
if per_component:
    root = stories_root()
    os.makedirs(root, exist_ok=True)
    tmpl = open(tmpl_path).read()
    for name in sorted(components):
        out_file = os.path.join(root, f"{name}.usage.mdx")
        rel = os.path.relpath(usage_path, os.path.dirname(out_file)).replace(os.sep, "/")
        # strip the template's leading instructional {/* … */} header — a generated file doesn't
        # carry authoring guidance (and that block is the only other place "TODO" appears).
        body = re.sub(r"\A\{/\*.*?\*/\}\s*", "", tmpl, count=1, flags=re.S)
        body = re.sub(r"import usage from '[^']*';\s*\{/\*[^*]*\*/\}", f"import usage from '{rel}';", body)
        # ReportIntro lives in .storybook/wrappers/ — compute the path from THIS mdx's location so the
        # generated file imports it correctly (no human "fix the relative path" TODO left behind).
        ri_target = os.path.join(os.path.dirname(usage_path) or ".", "wrappers", "ReportIntro")
        ri_rel = os.path.relpath(ri_target, os.path.dirname(out_file)).replace(os.sep, "/")
        body = re.sub(r"import \{ ReportIntro \} from '[^']*';\s*\{/\*[^*]*\*/\}", f"import {{ ReportIntro }} from '{ri_rel}';", body)
        body = re.sub(r"<Meta title=\"[^\"]*\" />\s*\{/\*[^*]*\*/\}", f'<Meta title="{title_prefix}/{name}/Real usage" />', body)
        body = re.sub(r"export const COMPONENT = '[^']*';\s*\{/\*[^*]*\*/\}", f"export const COMPONENT = '{name}';", body)
        tmp = out_file + ".tmp"
        open(tmp, "w").write(body)
        os.replace(tmp, out_file)
        written.append(out_file)
    print(f"✓ Generated {len(written)} per-component usage MDX page(s) under {root}/")
    for f in written[:10]:
        print(f"  {os.path.relpath(f)}")
else:
    print("• Nothing stamped (default) — usage embeds into each component's AND each Foundation section's")
    print("  Docs page via <UsageSection> in preview.ts docs.page. Use --per-component for standalone pages.")
