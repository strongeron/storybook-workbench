#!/usr/bin/env python3
"""scaffold-page-story.py — Mode A (real-page capture) story scaffolder.

Consumes page-patterns.py detection for ONE page and emits a `Pages/*` story that IMPORTS the
real page component as-is and mocks ONLY its data layer (the detected provider), seeded from a
factory keyed on the detected `dataType`. It never re-authors the page's layout or JSX.

Decision rule: only scaffolds when the page is `importable` (has a default-export component).
Non-importable pages fall back to Page Composition (composition-patterns.md Pattern 4) — out of scope.

Usage:
  scaffold-page-story.py <project-root> <page-file-suffix> [--alias @] [--out FILE]
    page-file-suffix : enough of the path to match one page (e.g. "author/index.tsx")
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def humanize(name):
    name = re.sub(r"Page$", "", name or "")
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    return name.strip() or "Page"


def import_path(rel, alias):
    p = re.sub(r"\.(tsx|jsx)$", "", rel)
    for root in ("src/", "app/frontend/"):
        if p.startswith(root):
            return f"{alias}/" + p[len(root):]
    return "./" + p


def slug_of(rel):
    m = re.search(r"/(pages|routes|views|app)/(.+?)(/index)?\.(tsx|jsx)$", "/" + rel)
    if not m:
        return "/"
    seg = m.group(2)
    seg = re.sub(r"/index$", "", seg)
    return "/" + seg


def main():
    args = sys.argv[1:]
    alias, out_path = "@", None
    if "--alias" in args:
        i = args.index("--alias"); alias = args[i + 1]; del args[i:i + 2]
    if "--out" in args:
        i = args.index("--out"); out_path = args[i + 1]; del args[i:i + 2]
    if len(args) < 2:
        print(__doc__); sys.exit(2)
    root, suffix = args[0], args[1]

    raw = subprocess.run([sys.executable, os.path.join(HERE, "page-patterns.py"), root],
                         capture_output=True, text=True)
    pages = json.loads(raw.stdout)["pagePatterns"]
    matches = [p for p in pages if p["file"].endswith(suffix)]
    if not matches:
        print(f"ERROR: no page matched '{suffix}'", file=sys.stderr); sys.exit(2)
    pg = matches[0]

    if not pg["importable"]:
        print(f"ERROR: {pg['file']} has no default-export component — use Page Composition "
              f"(composition-patterns.md Pattern 4), not real-page capture.", file=sys.stderr)
        sys.exit(3)

    comp = pg["component"] or "Page"
    name = humanize(pg["component"]) if pg["component"] else humanize(os.path.basename(pg["file"]))
    imp = import_path(pg["file"], alias)
    slug = slug_of(pg["file"])
    dtype = pg["dataType"] or "PageProps"
    hook = pg["dataHook"]
    sections = ", ".join(pg["sections"]) or "(none detected)"

    if hook == "usePage":
        provider = f'parameters: {{ inertia: {{ url: "{slug}", props: {{}} /* seed: {dtype} factory */ }} }}'
        wiring = "Inertia (usePage)"
    else:
        provider = f'decorators: [/* TODO: wire {hook or "data provider"} mock, seed: {dtype} factory */]'
        wiring = hook or "unknown provider"

    story = f'''import type {{ Meta, StoryObj }} from "@storybook/react-vite"
import {comp} from "{imp}"

/**
 * Pages/{name} — the REAL {comp} page, imported as-is. Only the data layer is mocked
 * ({wiring}); the page's own layout and components render untouched (capture reality, don't recreate).
 *
 * Detected: layout {pg["layout"] or "—"} · provider {hook or "—"}<{dtype}> · sections {sections}
 * TODO: seed the props/data from a factory — `scaffold-factory.sh {dtype} <import-path>` — and
 *       add one story per materially-different data state (empty / populated / error).
 */
const meta = {{
  title: "Pages/{name}",
  component: {comp},
  parameters: {{ layout: "fullscreen" }},
  tags: ["autodocs"],
}} satisfies Meta<typeof {comp}>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {{
  {provider},
}}
'''
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(story)
        print(f"scaffolded Pages/{name} -> {out_path}")
    else:
        print(story)


if __name__ == "__main__":
    main()
