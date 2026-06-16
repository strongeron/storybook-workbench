/**
 * DecisionsDashboard — query all stories tagged decision:* and render a
 * Pending / Chosen / Rejected status board, plus a collapsible "Past
 * decisions (archived)" section for stories also tagged 'archived' (L2).
 *
 * The layered preservation model (see references/propagate-workflow.md):
 *   L1 Active   — decision:* without 'archived' tag (last ~3 months)
 *   L2 Archive  — decision:* WITH 'archived' tag (3-12 months old)
 *   L3 Ledger   — pruned to docs/design-decisions.md (12+ months)
 *
 * Default view shows L1 only. Toggle expands L2. Footer points at L3.
 *
 * Fully token-driven (app CSS vars), so it themes light AND dark via the toolbar,
 * and shares the dot + foreground-label + count-badge grammar of ProjectInventory
 * and DesignSystemHealth so the wrapper library reads as one designed surface.
 *
 * @example
 * // src/stories/decisions/Dashboard.stories.tsx
 * import { DecisionsDashboard } from '../../.storybook/wrappers/DecisionsDashboard';
 *
 * export const All: Story = { render: () => <DecisionsDashboard /> };
 *
 * Storybook-only — never imported from app code.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ReportIntro } from './ReportIntro';

type DecisionStatus = 'pending' | 'chosen' | 'rejected';

interface DecisionEntry {
  id: string;
  title: string;
  storyName: string;
  status: DecisionStatus;
  archived: boolean;
  rationale?: string;
  target?: string;
  date?: string;
  winner?: string;
  reviewers?: string[];
}

interface StoryModule {
  default?: { title?: string; tags?: string[]; parameters?: { decision?: Partial<DecisionEntry> } };
  [exportName: string]: unknown;
}

const modules = {
  ...(import.meta as { glob: (path: string, opts?: { eager: boolean }) => Record<string, StoryModule> })
    .glob('../../src/**/*.stories.tsx', { eager: true }),
  ...(import.meta as { glob: (path: string, opts?: { eager: boolean }) => Record<string, StoryModule> })
    .glob('../../stories/**/*.stories.tsx', { eager: true }),
};

function collectDecisions(): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  for (const [, mod] of Object.entries(modules)) {
    const meta = mod.default;
    if (!meta?.title) continue;
    const metaTags = meta.tags ?? [];

    for (const [exportName, story] of Object.entries(mod)) {
      if (exportName === 'default') continue;
      const storyTags = ((story as { tags?: string[] }).tags) ?? [];
      const allTags = [...metaTags, ...storyTags];
      const decisionTag = allTags.find((t) => t.startsWith('decision:'));
      if (!decisionTag) continue;

      const status = decisionTag.split(':')[1] as DecisionStatus;
      if (!['pending', 'chosen', 'rejected'].includes(status)) continue;

      const archived = allTags.includes('archived');

      const decisionParam = (story as { parameters?: { decision?: Partial<DecisionEntry> } }).parameters?.decision
        ?? meta.parameters?.decision
        ?? {};

      entries.push({
        id: decisionParam.id ?? `${meta.title}--${exportName}`,
        title: meta.title,
        storyName: exportName,
        status,
        archived,
        rationale: decisionParam.rationale,
        target: decisionParam.target,
        date: decisionParam.date,
        winner: decisionParam.winner,
        reviewers: decisionParam.reviewers,
      });
    }
  }
  return entries;
}

const SANS = 'var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)';
const DISPLAY = 'var(--font-family-display, ' + SANS + ')';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const COLUMN_STYLE: Record<DecisionStatus, { label: string; dot: string; tone: 'warning' | 'success' | 'error' }> = {
  pending:  { label: 'Pending',  dot: 'var(--color-warning)', tone: 'warning' },
  chosen:   { label: 'Chosen',   dot: 'var(--color-success)', tone: 'success' },
  rejected: { label: 'Rejected', dot: 'var(--color-error)',   tone: 'error' },
};

// Theme-safe shim: maps the tokens this view expects onto stock shadcn/Tailwind-v4
// primitives, with fixed fallbacks. Scoped to the wrapper root (cascades to descendants,
// never leaks to the app). Without it, apps that don't ship --color-surface /
// --color-border-subtle / a semantic palette render this board unstyled and low-contrast.
// No token self-references (`--x: var(--x, …)` voids the fallback via a CSS dependency
// cycle) — every fallback names a DIFFERENT primitive or literal.
const TOKEN_SHIM: Record<string, string> = {
  '--color-surface': 'var(--color-card, var(--color-background))',
  '--color-border-subtle': 'var(--color-border, color-mix(in oklab, var(--color-muted-foreground) 22%, transparent))',
  '--color-border-default': 'var(--color-border, color-mix(in oklab, var(--color-muted-foreground) 40%, transparent))',
  '--color-brand-500': 'var(--color-primary, var(--color-foreground))',
  '--color-text-brand-tertiary': 'var(--color-muted-foreground, var(--color-foreground))',
  '--color-success': 'oklch(0.60 0.16 150)',
  '--color-success-text': 'oklch(0.48 0.14 150)',
  '--color-success-surface': 'color-mix(in oklab, oklch(0.60 0.16 150) 14%, var(--color-background))',
  '--color-warning': 'oklch(0.75 0.15 75)',
  '--color-warning-text': 'oklch(0.50 0.12 75)',
  '--color-warning-surface': 'color-mix(in oklab, oklch(0.75 0.15 75) 16%, var(--color-background))',
  '--color-error': 'var(--color-destructive, oklch(0.58 0.22 27))',
  '--color-error-text': 'var(--color-destructive, oklch(0.50 0.20 27))',
  '--color-error-surface': 'color-mix(in oklab, var(--color-destructive, oklch(0.58 0.22 27)) 14%, var(--color-background))',
};

function Shell({ children, fillViewport = true }: { children: ReactNode; fillViewport?: boolean }) {
  return (
    <div style={{ ...TOKEN_SHIM, background: 'var(--color-background)', color: 'var(--color-foreground)', minHeight: fillViewport ? '100dvh' : undefined, fontFamily: SANS, padding: '2.5rem 2rem 5rem' } as CSSProperties}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Eyebrow() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-brand-tertiary)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-brand-500)' }} />
      storybook-workbench · decisions
    </div>
  );
}

// shadcn-style disclosure chevron, shared grammar with DesignSystemHealth: points
// down when closed, rotates 180° to point up when open. Sits at the row's right edge.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="dec-chevron" width="15" height="15" viewBox="0 0 16 16" aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)', color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
      <path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Same count-badge grammar as ProjectInventory / DesignSystemHealth: the dot carries
// status color, the label stays foreground, the badge tints to match.
function CountBadge({ n, tone }: { n: number; tone: 'warning' | 'success' | 'error' | 'neutral' }) {
  const map = {
    warning: { bg: 'var(--color-warning-surface)', fg: 'var(--color-warning-text)' },
    success: { bg: 'var(--color-success-surface)', fg: 'var(--color-success-text)' },
    error:   { bg: 'var(--color-error-surface)',   fg: 'var(--color-error-text)' },
    neutral: { bg: 'var(--color-border-subtle)',   fg: 'var(--color-muted-foreground)' },
  }[tone];
  return (
    <span style={{ minWidth: 22, textAlign: 'center', fontFamily: MONO, fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: map.fg, background: map.bg, borderRadius: 999, padding: '0.08rem 0.5rem' }}>
      {n}
    </span>
  );
}

function DecisionCard({ entry }: { entry: DecisionEntry }): JSX.Element {
  return (
    <article
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '0.65rem 0.8rem',
        marginBottom: '0.5rem',
        fontSize: '0.82rem',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: 'var(--color-muted-foreground)', display: 'block', marginBottom: '0.2rem', wordBreak: 'break-all' }}>
        {entry.id}
      </span>
      <div style={{ fontWeight: 600, color: 'var(--color-foreground)' }}>{entry.title}</div>
      {entry.rationale && (
        <div style={{ fontSize: '0.74rem', color: 'var(--color-muted-foreground)', marginTop: '0.2rem', lineHeight: 1.45 }}>{entry.rationale}</div>
      )}
      <div style={{ fontSize: '0.7rem', color: 'var(--color-muted-foreground)', marginTop: '0.2rem' }}>
        {entry.status === 'pending'  && entry.target && <>Target: {entry.target}</>}
        {entry.status === 'chosen'   && entry.winner && <>Winner: {entry.winner} {entry.date && <>· {entry.date}</>}</>}
        {entry.status === 'rejected' && entry.date && <>Rejected: {entry.date}</>}
      </div>
    </article>
  );
}

function DecisionColumn({ status, entries }: { status: DecisionStatus; entries: DecisionEntry[] }): JSX.Element {
  const style = COLUMN_STYLE[status];
  return (
    <div className={`decision-column decision-column--${status}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: style.dot, flexShrink: 0 }} />
        <h4 style={{ margin: 0, fontFamily: DISPLAY, fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-foreground)' }}>{style.label}</h4>
        <CountBadge n={entries.length} tone={entries.length ? style.tone : 'neutral'} />
      </div>
      {entries.map((entry) => <DecisionCard key={entry.id + entry.storyName} entry={entry} />)}
      {entries.length === 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground)' }}>None</div>
      )}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <Shell>
      <Eyebrow />
      <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.4rem', letterSpacing: '-0.01em' }}>Decisions</h1>
      <p style={{ color: 'var(--color-muted-foreground)', maxWidth: '64ch', lineHeight: 1.55, margin: 0 }}>
        No decisions yet. Tag a story <code style={{ fontFamily: MONO, fontSize: '0.85em' }}>decision:pending</code> ·{' '}
        <code style={{ fontFamily: MONO, fontSize: '0.85em' }}>decision:chosen</code> ·{' '}
        <code style={{ fontFamily: MONO, fontSize: '0.85em' }}>decision:rejected</code> and it shows up on this board.
      </p>
    </Shell>
  );
}

export function DecisionsDashboard({ fillViewport = true }: { fillViewport?: boolean } = {}): JSX.Element {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const entries = collectDecisions();

  if (entries.length === 0) return <EmptyState />;

  // L1 Active — decision:* WITHOUT 'archived' tag
  const active = entries.filter((e) => !e.archived);
  // L2 Archive — decision:* WITH 'archived' tag
  const archived = entries.filter((e) => e.archived);

  const groupBy = (items: DecisionEntry[]): Record<DecisionStatus, DecisionEntry[]> => ({
    pending: items.filter((e) => e.status === 'pending'),
    chosen: items.filter((e) => e.status === 'chosen'),
    rejected: items.filter((e) => e.status === 'rejected'),
  });

  const activeByStatus = groupBy(active);
  const archivedByStatus = groupBy(archived);

  return (
    <Shell fillViewport={fillViewport}>
      {/* shadcn-style disclosure chrome: hover underlines the toggle label and darkens
          the chevron, focus is keyboard-visible, motion respects the reduced-motion query. */}
      <style>{`
        .dec-toggle:hover .dec-toggle-label { text-decoration: underline; text-underline-offset: 3px; }
        .dec-toggle:hover .dec-chevron { color: var(--color-foreground); }
        .dec-toggle:focus-visible { outline: 2px solid var(--color-brand-500); outline-offset: 3px; border-radius: var(--radius-sm); }
        @media (prefers-reduced-motion: reduce) { .dec-chevron { transition: none !important; } }
      `}</style>

      <ReportIntro
        what="A board of the design decisions made in this catalog — pending, chosen, and rejected — each one anchored to the story where the alternatives were compared, so the rationale lives next to the code."
        source={{ file: 'decision:* tagged stories', skill: 'sb-ship / sb-wrappers' }}
        pipeline={[{ skill: 'sb-ship', role: 'tags decisions' }, { skill: 'sb-wrappers', role: 'this board' }]}
        freshness="queried live from your story tags · no generated file"
      />
      <header style={{ marginBottom: '1.6rem' }}>
        <Eyebrow />
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.35rem', letterSpacing: '-0.01em' }}>Decisions</h1>
        <p style={{ color: 'var(--color-muted-foreground)', fontSize: '0.95rem', margin: 0 }}>
          <strong style={{ color: 'var(--color-foreground)' }}>{active.length}</strong> active (L1, last ~3 months) · <strong style={{ color: 'var(--color-foreground)' }}>{archived.length}</strong> archived (L2) · older history in <code style={{ fontFamily: MONO, fontSize: '0.85em' }}>docs/design-decisions.md</code> (L3)
        </p>
      </header>

      {/* L1 Active — main 3-column board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <DecisionColumn status="pending"  entries={activeByStatus.pending} />
        <DecisionColumn status="chosen"   entries={activeByStatus.chosen} />
        <DecisionColumn status="rejected" entries={activeByStatus.rejected} />
      </div>

      {/* L2 Archive — collapsible section */}
      {archived.length > 0 && (
        <section style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="dec-toggle"
            onClick={() => setArchivedOpen((o) => !o)}
            aria-expanded={archivedOpen}
            style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.85rem 0' }}
          >
            <span className="dec-toggle-label" style={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-foreground)' }}>Past decisions</span>
            <CountBadge n={archived.length} tone="neutral" />
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted-foreground)' }}>L2 — archived</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex' }}><Chevron open={archivedOpen} /></span>
          </button>

          {archivedOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', margin: '0.5rem 0 1rem', opacity: 0.85 }}>
              <DecisionColumn status="pending"  entries={archivedByStatus.pending} />
              <DecisionColumn status="chosen"   entries={archivedByStatus.chosen} />
              <DecisionColumn status="rejected" entries={archivedByStatus.rejected} />
            </div>
          )}
        </section>
      )}

      {/* L3 Ledger pointer */}
      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground)', fontFamily: MONO, marginTop: '2rem', paddingTop: '0.9rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        Older decisions live in docs/design-decisions.md (L3 ledger) · run scripts/audit-archived.sh to see prune candidates.
      </p>
    </Shell>
  );
}
