# With-MCP Workflow (Storybook 10.3+ on Vite)

When `@storybook/addon-mcp` is installed AND wired to your agent (`.mcp.json` lists it, agent session has the tools loaded), defer to MCP for everything mechanical. The skill's job here is to teach the *call sequence* and the *judgment* MCP can't do.

## The 6 tools and when to call them

| Tool | When to call | What it gives you |
|---|---|---|
| `list-all-documentation` | Once at start of any task — discovery | Full component + story index. Use returned IDs in every subsequent call. |
| `get-documentation` | After picking a target component | Description + first 3 stories with source + remaining stories listed + full TS props with JSDoc |
| `get-documentation-for-story` | Need a story not in the first 3 | Full story source + linked MDX. Inputs: `componentId` AND `storyName` (two args). |
| `get-storybook-story-instructions` | Before writing your first story this session | ~7,452 chars of CSF3 + coverage + a11y conventions. **Treat as system-prompt-level guidance.** |
| `preview-stories` | After every story change | Preview URL (or embedded iframe). Always include the URL in the user-facing response. |
| `run-story-tests` | After story passes preview | Vitest pass/fail per story + a11y violations. Pass `a11y: true` to run accessibility checks in the same batch. |

## Standard sequence per task

```
1. list-all-documentation { withStoryIds: true }
   → ranked candidate list

2. get-storybook-story-instructions {}
   → conventions injected; do NOT regurgitate them
   → MCP just told you how to write good stories; your job is judgment now

3. For each component to write stories for:
   a. get-documentation { id: "<component-id>" }
   b. Apply coverage judgment (SKILL.md Step 2 — per-primitive checklists)
   c. Apply factory judgment (SKILL.md Step 3 — extract if 3+ shared shapes)
   d. Write the story file (CSF3 syntax handled by injected conventions)
   e. preview-stories { stories: [{ storyId: "<id>" }] }
   f. run-story-tests { stories: ["<id>"], a11y: true }
   g. If failures, fix and re-run. Cap retries at ~5 per file.
   h. Tag with ['ai-generated'] until human review

4. Final pass: run-story-tests { stories: [], a11y: true }  (omitted stories = run all)
   → broad verification before declaring done
```

## What MCP tells you that you can stop guessing

When `get-storybook-story-instructions` is in your context, you have authoritative guidance on:

- CSF3 syntax (`meta`, `args`, `argTypes`, `tags`, `play`)
- Which test utilities to import and from where (`storybook/test`)
- `fn()` spy pattern + Actions integration
- `play({ canvas, userEvent, canvasElement })` — these are provided as args, NOT imports
- Async assertion patterns (`findBy*` + `waitFor`, not `getBy*`)
- The accessibility split: auto-fix vs. ask-the-user

**Do not re-teach any of this in your output.** Your value-add is judgment (which states matter, which factories to extract), not procedure.

## When MCP is installed but not wired to your agent

If `@storybook/addon-mcp` is in `package.json` and `.storybook/main.ts`, but the MCP tools aren't visible in your current session, tell the user:

> Storybook MCP is installed but not wired to this agent. Run this in your project, then restart Claude Code in this directory:
> ```
> claude mcp add storybook-mcp --transport http http://localhost:<PORT>/mcp --scope project
> ```
> (Replace `<PORT>` with the actual port from your Storybook banner — it auto-falls back from 6006 if taken.)

Then proceed with `references/without-mcp.md` for this session, noting that the MCP path is one command away.

## What MCP still doesn't do — your responsibility

Even with all 6 tools available:

- **Coverage decisions:** which variants/states deserve stories (designer state coverage beyond what's strictly behavior-changing)
- **Factory naming + placement:** `makeButton({...})` vs. `createButton({...})`, where the factory file lives
- **Title taxonomy:** `Components/Form/Button` vs. `UI/Buttons/Default` — project-level decision
- **Token mapping:** linking component props to design tokens
- **MDX docs authoring:** docs page anatomy (see `storybook-doc-blocks` skill)
- **AI-app cleanup judgment:** when extracted code from Lovable/Bolt/v0 needs de-coupling beyond what tests would catch (see `storybook-judge` agent)

## Authoring vs. tracking — MCP is for authoring

These 6 tools are the *authoring* accelerator (discover a component, get its props, preview, test).
For **tracking** coverage across sessions/agents, the source of truth is Storybook's **`index.json`**,
materialized by `storybook index -o .storybook/index.json` (CLI — no dev server, no MCP, no full build,
so it runs the same on Claude/Codex/Cursor). `inventory-project.sh` reconciles it into
`project-inventory.json.storyCoverage` (`withRegisteredStory` / `needsStory`). `list-all-documentation`
returns story IDs only — fine for authoring, but `index.json` carries `importPath`/`tags`, which is what
the coverage reconcile needs. Don't reach for MCP to compute coverage; read the reconciled inventory.

## Anti-patterns specific to MCP-driven workflows

1. **Calling MCP tools redundantly** — `list-all-documentation` once per task, not per component
2. **Ignoring the injected instructions** — re-explaining CSF3 syntax in your output when MCP already told you the conventions
3. **Skipping `preview-stories`** — the injected workflow guide explicitly requires you to include the preview URL in user-facing responses
4. **Calling `run-story-tests` without `a11y: true`** — separate a11y runs cost two passes; one combined pass is cheaper
5. **Inventing component / story IDs** — only use IDs returned by `list-all-documentation`. If a name isn't in the index, the component or story doesn't exist yet.

## Verification record

Live-verified against Storybook 10.4.1 + addon-mcp 0.6.0 + Vite 8 + React 19 on 2026-05-26.
Full report: `docs/publishing/storybook-mcp-verification.md`.
