# Contributing — and how feedback compounds

## Found a bug or strange behavior?

Let the skill draft the report (sanitized — versions + `.storybook/*.json` shapes/counts only, **never**
your source, token values, or component names). From your project root:

```bash
# installed:
~/.claude/skills/sb-hub/scripts/report-issue.sh --asked "…" --observed "…" --expected "…"
# or just describe it — sb-hub Mode 3 ("report a bug") runs this for you
```

It writes a local body file and prints a `gh issue create …` command + a blank-issue URL. It makes **no
network call** — you review and submit. Set `SB_ISSUE_REPO=owner/name` to target a different repo.

Prefer the web? Open an issue with the **Bug / strange behavior** template.

## How a report becomes a fix (the compounding loop)

Feedback doesn't sit in a tracker — it feeds the same loop the maintainers already run:

1. **Report** → a sanitized issue (above).
2. **Reproduce** → a minimal fixture under `evals/` that triggers the behavior.
3. **Eval case** → a deterministic gate (`evals/scripts/test-*.sh`) or an `evals/cases/*.json` that
   FAILS on the bug. This is the self-improvement: every bug becomes a permanent regression test.
4. **Fix** → make the gate pass; the full suite (`evals/run-evals.sh`) stays green.
5. **Field-learning** → distill the correction into `skills/sb-inventory/references/field-learnings.md`
   so the next run doesn't re-discover it.

No skill rewrites itself at runtime — improvement is human-reviewed and **eval-gated**. That's why a
report is valuable: it turns one person's surprise into a test that protects everyone.

## Privacy

The reporter captures **shapes, counts, and versions only** — never file contents, source, token
values, or secrets. Nothing leaves your machine until you run the `gh` command or open the URL yourself.
This is enforced by `evals/scripts/test-report-issue.sh` (a seeded secret must never appear in a draft).
