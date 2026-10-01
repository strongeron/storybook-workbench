# Storybook surface — the one place that names Storybook's moving parts

Every version pin, MCP tool name, and agent CLI command this bundle relies on lives here. Other files
describe *when* to call a tool and link here for its *name*. When Storybook renames something, edit
this file, not eight references.

**Baseline:** Storybook 10.6.0 · `@storybook/addon-mcp` 10.6.0 · Vite 8 · React 19 · Node 22.12+.
Live-verified 2026-09-27 against the demo app (tools listed over MCP and via `storybook tools --help`);
tool names unchanged on 10.6.1 (2026-09-30).

## Ask the running Storybook first

The installed Storybook is the source of truth; this file is a snapshot of it.

```bash
npx storybook tools --help        # every tool this Storybook serves, with arguments (10.6+)
npx storybook skills --all        # Storybook's own agent workflow (stories, write-story, setup)
```

With MCP wired, the server's `initialize` instructions carry the same workflow. Follow them over
anything here if they disagree.

## MCP tools (addon-mcp 10.6+, served at `http://localhost:<port>/mcp`)

| Tool | CLI equivalent (`npx storybook tools …`) | What it is for | Before 10.6 |
|---|---|---|---|
| `docs-list` | `docs list` | Every component + docs entry and the IDs the other tools take | `list-all-documentation` |
| `docs-show` | `docs show --id <id>` | Props (TS + JSDoc), first 3 stories with source | `get-documentation` |
| `docs-show-story` | `docs show-story --storyId <id>` | One story's source + usage | `get-documentation-for-story` |
| `get-storybook-story-instructions` | `npx storybook skills write-story` | Project conventions for writing/testing stories | same name |
| `stories-find-by-component` | `stories find-by-component` | Component file → stories that render it, by import distance | `get-stories-by-component` (0.7) |
| `stories-changed` | `stories changed` | New / modified / related stories from the working tree | `get-changed-stories` (0.7) |
| `stories-preview` | `stories preview` | Preview URLs (needs a running dev server) | `preview-stories` |
| `test-run` | `test run` | Vitest pass/fail per story + a11y violations (`a11y: true`) | `run-story-tests` |
| `review-create` | `review create` | Publish a curated review page (`/?path=/review/`) | `display-review` (0.7) |

- Old names are **not aliased** on 10.6: a call to `list-all-documentation` fails. On a project still
  pinned to addon-mcp 0.x, use the "Before 10.6" column — or upgrade (`npx storybook@latest upgrade`).
- `review-create` only appears with `features: { experimentalReview: true }` in `.storybook/main.ts`.
- `stories-changed` needs change detection (on by default in dev; git + Vite/webpack5). Use the MCP
  tool: on 10.6.0 the CLI form (`storybook tools stories changed`, with or without `-p`) returned no
  stories while the MCP call on the same server returned 19 (2026-09-30). It also flags stories that
  read a changed `.storybook/*.json`, so a `refresh-usage.sh` run shows up as modified report stories.
- `stories-find-by-component` follows JS imports only. A CSS/token file returns "no stories found" —
  token blast radius stays with `sb-inventory`'s `token-usage.py` + `component-pages.json`.

## Setup commands

| Situation | Command |
|---|---|
| No Storybook yet (React + Vite) | `npm create storybook@latest` — prints follow-up instructions for the agent |
| Storybook present, agent should finish setup | `npx storybook skills setup` (10.6+; needs `.storybook/main.*`) |
| Storybook 10.4–10.5 | `npx storybook ai setup` (deprecated in 10.6, prints a warning, same prompt) |
| Upgrade | `npx storybook@latest upgrade` (installs/updates addon-mcp when an agent runs it) |

## Manifests

`/manifests/components.json` and `/manifests/docs.json` on the dev server; debugger at
`/manifests/components.html`. The schema is not a public API — read it through `docs-list`/`docs-show`
where you can. With `features.experimentalDocgenServer` the JSON routes 404 in dev.

## Coming in Storybook 11 (alpha, not yet targeted)

Node 22.12+, TypeScript 5.9+, React 18+, Vite 6.3+, Vitest 4 (`test.projects`), no Yarn PnP,
`storybook dev` never auto-opens a browser. CSF Factories are still Preview; CSF3 remains our format.
