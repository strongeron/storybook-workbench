# Design decisions ledger

History of pruned Storybook experiments (L3 of the layered preservation model). For active experiments (L1) and recently archived ones (L2), open Storybook's `Decisions/Dashboard` story.

## How to read this

| Column     | What it tells you                                                                       |
|------------|-----------------------------------------------------------------------------------------|
| Date       | When the decision was made (YYYY-MM-DD)                                                 |
| Decision   | One-line description matching `parameters.decision.id`                                   |
| Winner     | The winning variant label (or `—` if rejected)                                          |
| Rationale  | One-line "why" from `parameters.decision.rationale`                                      |
| Shipped to | Storybook title of the production version (or `—` if rejected)                          |
| PR         | GitHub PR number for the Ship (link prefix below)                                        |
| Git ref    | Commit SHA where the experiment story still exists in history                            |

## To recover a pruned experiment

```bash
git show <git-ref>:src/explore/<topic>/<file>.stories.tsx
```

The component code (`src/components/<name>/<Name>.tsx`) is shipping — only the original Explore story has been pruned. If you need to revive the experimental variant, the file is recoverable from git history at the listed ref.

## PR link prefix

(Edit this once per project to your repo's URL pattern, e.g. `https://github.com/<org>/<repo>/pull/`)

## Decisions (newest first)

| Date | Decision | Winner | Rationale | Shipped to | PR | Git ref |
|------|----------|--------|-----------|------------|----|---------|
