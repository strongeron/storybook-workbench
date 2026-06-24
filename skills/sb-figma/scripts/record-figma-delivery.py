#!/usr/bin/env python3
"""record-figma-delivery.py — upsert one delivered Figma feature into the Figma Inventory.

When sb-figma finishes delivering a Figma feature into Storybook, the stories it created scatter across
the component/page taxonomy. This records the delivery into ONE place — `.storybook/figma-inventory.json`
— so a root "Figma Inventory" surface can answer "what did this feature bring in, and where's the board?"
(spec: docs/specs/2026-06-23-figma-feature-inventory.md).

Idempotent by feature KEY (a normalized slug of the feature name, or derived from the Figma file name when
--feature is omitted). Re-recording the same feature REPLACES its entry (a delivery is re-run, not doubled).
Stories passed across calls for the same feature are UNIONED by storyId, so an incremental delivery adds to
the list rather than dropping earlier stories.

  record-figma-delivery.py [ROOT] --figma-url URL [--feature NAME] [--spec-url URL]
      [--node-ids 101-9717,312-11556] [--description TEXT]
      [--story "Title/Path:story-id:kind" ...]   (repeatable)  |  --stories '<json array>'

ROOT defaults to "."; writes ROOT/.storybook/figma-inventory.json.
"""
import argparse, json, os, re, sys, tempfile
from datetime import datetime, timezone


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def derive_feature_from_url(url):
    # https://www.figma.com/design/<key>/<File-Name>?node-id=... → "File Name"
    m = re.search(r"/(?:design|file)/[^/]+/([^/?#]+)", url or "")
    if not m:
        return None
    name = re.sub(r"-+", " ", m.group(1)).strip()
    # Drop a trailing "(Copy)" / "Copy" Figma appends to duplicated files.
    name = re.sub(r"\(?\bcopy\b\)?\s*$", "", name, flags=re.I).strip()
    return name or None


def parse_story(spec):
    # "Title/Path:story-id:kind" — kind optional (defaults to "story"); title may itself contain no colon.
    parts = spec.split(":")
    if len(parts) == 1:
        return {"title": parts[0].strip(), "storyId": None, "kind": "story"}
    title = parts[0].strip()
    story_id = parts[1].strip() or None
    kind = parts[2].strip() if len(parts) > 2 and parts[2].strip() else "story"
    return {"title": title, "storyId": story_id, "kind": kind}


def load(path):
    try:
        with open(path) as f:
            doc = json.load(f)
            if isinstance(doc, dict) and isinstance(doc.get("features"), dict):
                return doc
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {"features": {}}


def main():
    ap = argparse.ArgumentParser(description="Record a delivered Figma feature into the Figma Inventory.")
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--figma-url", required=True)
    ap.add_argument("--feature", help="display name; derived from the Figma file name when omitted")
    ap.add_argument("--spec-url", help="the spec node URL (defaults to --figma-url)")
    ap.add_argument("--node-ids", help="comma-separated node ids, e.g. 101-9717,312-11556")
    ap.add_argument("--description", default="")
    ap.add_argument("--story", action="append", default=[], help='"Title/Path:story-id:kind" (repeatable)')
    ap.add_argument("--stories", help="JSON array of {title, storyId, kind} (alternative to --story)")
    ap.add_argument("--now", help="ISO timestamp override (tests); defaults to current UTC")
    args = ap.parse_args()

    feature = args.feature or derive_feature_from_url(args.figma_url)
    if not feature:
        print("✗ could not derive a feature name — pass --feature", file=sys.stderr)
        sys.exit(2)
    key = slug(feature)
    if not key:
        print(f"✗ feature name {feature!r} has no usable slug — pass --feature", file=sys.stderr)
        sys.exit(2)

    stories = []
    if args.stories:
        try:
            raw = json.loads(args.stories)
            for s in raw if isinstance(raw, list) else []:
                stories.append({"title": s.get("title"), "storyId": s.get("storyId"), "kind": s.get("kind", "story")})
        except json.JSONDecodeError:
            print("✗ --stories is not valid JSON", file=sys.stderr)
            sys.exit(2)
    stories.extend(parse_story(s) for s in args.story)

    now = args.now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sb = os.path.join(args.root, ".storybook")
    out = os.path.join(sb, "figma-inventory.json")
    doc = load(out)

    prev = doc["features"].get(key, {})
    # Union stories by storyId (fall back to title when an id is missing) so incremental deliveries accrete.
    merged, seen = [], set()
    for s in (prev.get("stories", []) + stories):
        ident = s.get("storyId") or s.get("title")
        if not ident or ident in seen:
            continue
        seen.add(ident)
        merged.append(s)

    doc["features"][key] = {
        "feature": feature,
        "figmaUrl": args.figma_url,
        "specUrl": args.spec_url or args.figma_url,
        "nodeIds": [n.strip() for n in (args.node_ids or "").split(",") if n.strip()] or prev.get("nodeIds", []),
        "description": args.description or prev.get("description", ""),
        "stories": merged,
        "deliveredAt": now,
    }
    doc["generatedAt"] = now

    os.makedirs(sb, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=sb, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, out)
    print(f"✓ recorded feature '{feature}' ({key}) → {out}  ({len(merged)} stories, {len(doc['features'])} feature(s) total)")


if __name__ == "__main__":
    main()
