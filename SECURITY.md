# Security & privacy posture — storybook-workbench

This bundle is **read-mostly, dependency-free, and offline**. It reads your source
to discover ground truth and writes only Storybook artifacts. The statements below
are what the skills.sh **Gen Agent Trust Hub** content-safety review looks for, and
they are mechanically verifiable from the shipped files.

## Supply chain — zero runtime dependencies

- The bundle ships **no `package.json`, no lockfile, no vendored `node_modules`**.
  Skills are SKILL.md + portable `bash`/`tsx`. There is no install-time code execution.
- **Real Socket result:** `socket manifest auto` reports *"unable to discover any
  targets for which we can generate manifest files"* — there is no dependency manifest
  for a supply-chain engine to flag. (See `docs/pre-publish-audit.md` for the command.)
- The wrapper components (`shared/wrappers/*.tsx`) are copied into the *consuming*
  project, where they use only that project's already-present React/Storybook. The
  one optional peer dep (`@react-three/fiber`, for `R3FCanvas`) is **only suggested
  in a printed reminder** — never auto-installed.

## Network — none

- No shipped script or wrapper makes a network call. There is **no `curl`/`wget`,
  no `/dev/tcp`, no `fetch` to a remote host, no telemetry, no analytics**.
  Verify: `grep -rnE 'curl|wget|/dev/tcp|fetch\(|http://|https://' shared/ skills/`
  returns only documentation URLs (skills.sh, github.com, storybook.js.org), never
  a runtime call.
- `npx storybook ai setup` (invoked by `sb-setup`) is the consuming project's own
  Storybook installer, run explicitly by the user — not a network call this bundle makes.

## Secrets — none read, none written

- No script reads environment secrets, `~/.aws`, `~/.ssh`, `.env`, or 1Password.
  There are **no API keys, tokens, or credentials** anywhere in the bundle.
- Discovery scripts read **source code and CSS only** (`src/**`, `*.css`,
  `tokens.json`, `package.json` for *framework detection by name*, never its values).

## Write boundary — confined to Storybook surface

Every shipped script writes **only** to:

- `.storybook/` — discovery JSON (`project-inventory.json`, `flows.json`,
  `component-states.json`, `prop-shapes.json`, `design-system-health.json`),
  `wrappers/`, the audit ledger (`audit/{findings,plan,status}.md`), and the
  Storybook config (`main.ts`, `preview.*`).
- `src/stories/**` and `src/explore/**` — generated `*.stories.tsx`.

**Application code under `src/components/**` is never modified by discovery, build,
or validation skills.** The single skill that touches app code is `sb-ship`, and it
**copies** a graduated experiment (`cp`, never `git mv`), preserving the original as
history. Writes are **atomic** (tempfile → `os.replace`) so an interrupted run never
leaves a half-written JSON.

## Destructive operations — none

- No `rm -rf`, no `git push`, no `git reset --hard`, no force operations.
- `sb-ship` adds files; it does not delete or rewrite history.

## Automated audit notes (re: skills.sh scanner WARNs)

Two skills carry a **MEDIUM** scanner WARN. Both are **heuristic false positives** that fire on
*code execution* (which every functional skill does), not real vulnerabilities. Provenance:

- **`sb-setup` — Snyk W012 "unverifiable external dependency / runtime URL (0.90)".** This is the
  `npx storybook ai setup` line. `storybook` is the **official Storybook npm package** (`@storybook/cli`),
  not a URL and not bundled or controlled by this skill — it is the project's *own* Storybook installer,
  run explicitly by the user. The skill ships **zero** runtime dependencies and makes no network calls of
  its own (see *Network — none* above). Removing the step would defeat the skill's sole purpose
  (deferring to Storybook's official onboarding instead of reinventing it).
- **`sb-wrappers` — Socket "Security · SKILL.md · MEDIUM".** This is the `scaffold-wrapper.sh` invocation.
  That script is a **local bash file vendored inside the skill** — it only copies the bundled `.tsx`
  wrapper components into the project's `.storybook/`. No network, no install, no external/remote code.

Both are run **explicitly by the user/agent**, never silently, and both are reviewable in full from the
shipped source. We treat these WARNs as expected for a code-running skill; this section is the appeal
evidence for a re-audit.

## Reporting

This bundle lives in `strongeron/agent-skills`. Report any security concern via a
GitHub issue on that repo. Because the bundle is offline and dependency-free, the
realistic surface is limited to the correctness of the bash/tsx it ships — reviewable
in full from source.
