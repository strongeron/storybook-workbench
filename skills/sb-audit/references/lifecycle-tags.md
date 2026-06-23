# Lifecycle Tags — status taxonomy as the 5th tag layer

The recurring gap this reference closes: **teams encode component lifecycle in story names** (`V2: Hero`, `FutureSocialLinks`, `Iteration_Flow_Complete`) — but the agent can't grep, filter, or codemod against naming conventions. Tags fix this.

## When to load this reference

- A story is a redesign / V2 / experimental — what tag?
- Old stories pile up and the user asks "find all deprecated stories"
- Propagating an experiment to the app and marking the old version for retirement
- Reviewing a story and noticing it should carry a lifecycle marker
- The user asks "how do we mark this as not-ready" / "how do we show this is being deprecated"

## The 5 lifecycle tags (3 essential + 2 optional)

### Essential (every project should adopt)

| Tag | Meaning | When to apply | Visual cue (optional addon) |
|---|---|---|---|
| `'deprecated'` | Replaced. Kept for design history + visual regression of the old design during migration window. | When propagation has shipped to all callsites and V2 is now production. | Red badge |
| `'ai-generated'` | Written by an agent, not yet human-reviewed. | Default for any story the agent writes (until removed by a reviewer). | Gray badge |
| `'v2-preview'` | Redesign candidate, parallel to a shipping V1. | After Labs/Explore stabilizes but before V1 callsites are migrated. | Blue badge |
| `'archived'` | L1 → L2 transition marker. Story is preserved in code but hidden from the default Storybook sidebar. | Auto-suggested by `scripts/audit-archived.sh` 90 days after `decision:chosen`. Agent adds the tag manually after surfacing the suggestion. | Purple badge |
| `'canonical-reference'` | Story should NOT be pruned to L3 even when old. Catches a visual regression class no other story does. | Designer flag — applied only to a few critical archived stories. `scripts/prune-to-ledger.sh` skips these. | (no badge — internal signal) |

### Optional (use when the team's process needs them)

| Tag | Meaning | Why often skipped |
|---|---|---|
| `'experimental'` | WIP, may not graduate. | Overlaps with the `'labs'` / `'explore'` track tag — most projects pick one of the two. |
| `'needs-design-review'` | Engineer-authored, designer hasn't signed off. | Overlaps with `'ai-generated'` for AI-written code; only adds value when there's a distinct engineer-vs-designer review queue. |

These are *additive* — a story can carry multiple. `['v2-preview', 'ai-generated']` is meaningful: redesign candidate + needs review.

## Decision tags (v1.7 — paired with the wrapper library)

Three additional tags feed the `<DecisionsDashboard>` wrapper. These represent the **lifecycle of a design decision** as it moves from exploration to shipping:

| Tag | Meaning | Wrapper pairing |
|---|---|---|
| `'decision:pending'` | Option being evaluated; awaiting stakeholder review | `<TrackedDecision status="pending">` |
| `'decision:chosen'` | Winning option; ready for Ship event | `<TrackedDecision status="chosen" winner="V2">` |
| `'decision:rejected'` | Explored, declined; kept for archive | `<TrackedDecision status="rejected">` |

The flow: a story gets tagged `decision:pending` when entering Compare mode. Stakeholder reviews via Storybook URL. After the meeting, the tag flips to `decision:chosen` (or `:rejected`). `<DecisionsDashboard>` queries all three states via `import.meta.glob` and renders a status board.

See `references/wrapper-library.md` for the full wrapper API including `<TrackedDecision>` and `<DecisionsDashboard>`.

## How this slots into the 4-layer taxonomy from `galleries-and-tags.md`

The existing taxonomy has 4 layers (autodocs / audience / state / track). Lifecycle is the **5th orthogonal layer**:

| Layer | Examples | Where applied |
|---|---|---|
| `autodocs` | `'autodocs'`, `'!autodocs'` | Meta |
| Audience | `'platform'`, `'public'`, `'admin'` | Meta |
| State | `'empty-state'`, `'loading'`, `'error'` | Story |
| Track | `'labs'`, `'motion'`, `'wip'` | Meta |
| **Lifecycle** | `'experimental'`, `'v2-preview'`, `'deprecated'`, `'ai-generated'`, `'needs-design-review'` | Story (sometimes meta if all stories in the file share status) |

A typical lifecycle-tagged story:

```tsx
const meta = {
  title: 'Components/Marketing/Hero',
  component: Hero,
  tags: ['autodocs', 'public'],   // autodocs + audience
} satisfies Meta<typeof Hero>;

export const V2: Story = {
  tags: ['v2-preview'],            // lifecycle
  args: { variant: 'redesign' },
  parameters: {
    docs: { description: { story: 'Redesign candidate. V1 still shipping; this awaits propagation.' } },
  },
};

export const Default: Story = {};  // current production, no lifecycle tag = stable
```

## Core implementation — tag-only (zero new dependencies, ship today)

This is what the skill ships and recommends by default. The tags alone unlock:

- **Galleries** — `<TagGallery tag="deprecated" />` aggregates every deprecated story onto one canvas (see `references/galleries-and-tags.md`). The agent can answer "show me all deprecated stories" without any addon.
- **Sidebar filter** — Storybook's built-in tag filter shows/hides tagged stories.
- **Agent grep** — `grep -rE "tags:\s*\[[^\]]*'(deprecated|v2-preview)'" stories/` lets the agent enumerate.
- **Codemod target** — propagation scripts (`ast-grep --pattern "tags: \\['deprecated'\\]"`) can find every deprecated story for batch removal at the end of a migration window.

That's enough to answer the lifecycle questions the skill is designed for. The visual badges are nice-to-have, not required.

## Optional decorator — tag-driven banner (no new dependency)

If you want a visual cue without installing an addon, ship a small decorator in `.storybook/preview.tsx` that reads `story.tags` and renders a colored banner. The pattern matches a production app's existing amber-banner convention but is tag-driven instead of inline:

```tsx
// .storybook/preview.tsx — add to decorators
const LIFECYCLE_BANNERS: Record<string, { label: string; bg: string; fg: string }> = {
  'experimental': { label: '🧪 Experimental — API may change', bg: 'bg-yellow-50', fg: 'text-yellow-900' },
  'v2-preview':   { label: '👀 V2 Preview — not yet shipping', bg: 'bg-blue-50',   fg: 'text-blue-900'   },
  'deprecated':   { label: '⚠️ Deprecated — being replaced',     bg: 'bg-red-50',    fg: 'text-red-900'    },
  'ai-generated': { label: '🤖 AI-generated — needs human review', bg: 'bg-gray-100', fg: 'text-gray-900' },
  'needs-design-review': { label: '🎨 Pending design review', bg: 'bg-orange-50', fg: 'text-orange-900' },
};

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const tags = (context.tags ?? []) as string[];
      const banner = tags.map(t => LIFECYCLE_BANNERS[t]).find(Boolean);
      return (
        <>
          {banner && (
            <div className={`${banner.bg} ${banner.fg} mb-4 rounded-md px-4 py-2 text-sm font-medium`}>
              {banner.label}
            </div>
          )}
          <Story />
        </>
      );
    },
  ],
};
```

This works on any Storybook version, has zero supply-chain surface, and replaces the production app's inline amber-banner convention with a tag-driven one.

## Optional addon — visual sidebar badges (pending validation)

**Status: candidate, not yet validated on a real project.**

For richer visuals (sidebar badges, toolbar pills, configurable colors and tooltips), the candidate is:

```
@geometricpanda/storybook-addon-badges@^2.0.5
```

- Scoped namespace — original maintainer, harder to take over silently
- Last published a year ago — quiet but stable
- Configurable tag → badge mapping
- Supports SB10 per current docs (but we have not validated on a production SB10 install yet)

**Warning — do NOT install the unscoped `storybook-addon-badges`.** That package is a different codebase under a different maintainer (`tetarchus`), forked or namespace-transferred from the scoped origin. It may be fine, it may not — run `socket-scan` against it (see the `socket-scan` skill) before considering. The skill's default recommendation is the scoped `@geometricpanda/` variant only.

**Validation tasks (must complete before promoting to install-wizard recommended)**

- [ ] Install `@geometricpanda/storybook-addon-badges@^2.0.5` on one SB10 project
- [ ] Confirm sidebar badges render for `experimental`, `v2-preview`, `deprecated`, `ai-generated`, `needs-design-review`
- [ ] Confirm tag → badge mapping survives a Storybook restart
- [ ] Socket-scan the package
- [ ] If validation passes → update `install-wizard.md` Phase 2 Q4 to recommend; if it fails → keep tag-only + decorator as default forever

When validation passes, the config looks like this (kept here so the validation can copy-paste):

```ts
// .storybook/preview.ts (after addon validated)
import { withBadges } from '@geometricpanda/storybook-addon-badges';

const preview: Preview = {
  parameters: {
    badgesConfig: {
      experimental:          { contrast: '#854d0e', color: '#fef9c3', tooltip: { title: 'Experimental', desc: 'API may change' } },
      'v2-preview':          { contrast: '#1e3a8a', color: '#dbeafe', tooltip: { title: 'V2 Preview' } },
      deprecated:            { contrast: '#7f1d1d', color: '#fee2e2', tooltip: { title: 'Deprecated' } },
      'ai-generated':        { contrast: '#374151', color: '#f3f4f6', tooltip: { title: 'AI-generated' } },
      'needs-design-review': { contrast: '#7c2d12', color: '#fed7aa', tooltip: { title: 'Needs design review' } },
    },
  },
  decorators: [withBadges],
};
```

## The propagation workflow — agent-callable

When a Labs experiment graduates and the team wants to mark the old version deprecated + plan removal, the agent runs this loop:

1. **Enumerate callsites of the old component.**
   ```bash
   grep -rln "from ['\"]@/components/old-hero['\"]" src/
   ```
2. **Codemod-update callsites** (see `references/figma-to-storybook.md` Step 4 for the `ast-grep` sketches).
3. **Tag the old story as deprecated.**
   ```ts
   tags: ['autodocs', 'deprecated']
   ```
4. **Add a removal date to the docs description.**
   ```ts
   parameters: { docs: { description: { component: '**DEPRECATED 2026-05-27** — scheduled for removal in v3.2 (target: 2026-07-01)' } } }
   ```
5. **Open the deprecated gallery and confirm.**
   `<TagGallery tag="deprecated" />` should now show this story. If the team is using the decorator banner, it renders in red.
6. **At removal time, search for any remaining callsites** (codemod missed?), delete the old component, delete the deprecated story.

## Agent prompts — surface lifecycle questions

The agent should ask, not assume, when:

- Writing a story that's clearly a redesign — "Should this carry `tags: ['v2-preview']` while V1 is still shipping?"
- Writing a story that's an exploration — "Is this experimental (`tags: ['experimental']`) or production?"
- Asked to delete or replace an old story — "Mark deprecated for one release window, or delete now?"
- Writing a story from a prompt the user wrote — "Tag `ai-generated` until you review the visual output?"

These four prompts catch ~90% of lifecycle decisions without false confidence.

## Anti-patterns

1. **Lifecycle in story names instead of tags.** `V2: Hero` works for humans but blocks every grep/filter/codemod the agent can do. Always use `tags: ['v2-preview']` + a clean name like `V2` or `Redesign`.
2. **`deprecated` tag without a removal date** in `parameters.docs.description.component`. Deprecation must have an end date or it becomes permanent.
3. **`experimental` tag in `Components/` (production) titles.** Experimental belongs under `Labs/`. If a `Components/` story needs `experimental`, it was graduated too early — move it back.
4. **Skipping the `ai-generated` tag on agent-written stories.** Required default by the existing anti-patterns rule (#18) — extend to all 5 lifecycle states; lifecycle is the same shape.
5. **Multiple conflicting lifecycle tags.** `['experimental', 'deprecated']` is incoherent. The agent must pick one when writing; the validator (when extended) can flag conflicts.

## Verification record

- The 5 tags are the union of the production app's naming-convention encodings (`V2:`, `Future*`, `Iteration*`) + Storybook docs' suggested lifecycle markers + the existing anti-patterns rule #18 (`ai-generated`).
- Tag-only-as-default decision: 2026-05-27, after user supply-chain concern about `storybook-addon-badges` (unscoped).
- Decorator banner pattern derived from a production app's existing amber-banner convention (e.g., a production story's future-feature variant).
