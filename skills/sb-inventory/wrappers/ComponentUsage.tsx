/**
 * ComponentUsage — the full component worklist: every real UI component, ranked by real
 * call-site usage, with the PAGES it ends up rendered on (chips) and a link into the app flow.
 *
 * Reads `.storybook/component-pages.json` (component → {callSites, props, parents[], children[],
 * pages[]}, where `pages` is resolved transitively: each call-site file mapped to its hosting route,
 * directly if it is a routed page else via the import graph; `parents`/`children` are the immediate
 * nesting graph — the host component(s) this one renders inside, and the component(s) it wraps).
 * Answers "what do we have, how heavily is each used, what is it nested inside, on which screens,
 * and where does that sit in the flow?" — the question ProjectInventory's top-N teaser and the
 * per-component autodocs embed don't.
 *
 * Storybook-only — never imported from app code.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';
import { ReportIntro } from './ReportIntro';

interface PageRef { path: string; title: string; role?: string; storyId: string | null }
interface CompEntry { callSites: number; props: number; declaredButUnused?: number; globalNav?: boolean; hosts?: string[]; parents?: string[]; children?: string[]; pages: PageRef[] }
interface ComponentPagesReport { generatedAt?: string; appMapStoryId?: string; components: Record<string, CompEntry> }

const reportFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<ComponentPagesReport>('../../.storybook/component-pages.json', { eager: true });

const SANS = 'var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)';
const DISPLAY = 'var(--font-family-display, ' + SANS + ')';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Bridge design-system tokens onto stock shadcn/Tailwind-v4 primitives with fallbacks (scoped to
// the wrapper root, cascades to descendants, never leaks). No self-references (those void the fallback).
const TOKEN_SHIM: Record<string, string> = {
  '--color-surface': 'var(--color-card, var(--color-background))',
  '--color-border-subtle': 'var(--color-border, color-mix(in oklab, var(--color-muted-foreground) 22%, transparent))',
  '--color-text-brand-tertiary': 'var(--color-muted-foreground, var(--color-foreground))',
  '--color-brand-500': 'var(--color-primary, var(--color-foreground))',
};

// Role lane → chip hue, matching the App Map's 5 real tiers (route-access-service-derived).
// Legacy public/user/admin kept so older component-pages.json still colours correctly.
const ROLE_HUE: Record<string, string> = {
  public: 'oklch(0.62 0.17 300)',
  departmentMember: 'oklch(0.70 0.13 195)',
  departmentAdmin: 'oklch(0.62 0.13 245)',
  propertyAdmin: 'oklch(0.58 0.16 265)',
  corporate: 'oklch(0.55 0.18 320)',
  user: 'oklch(0.70 0.13 195)',
  admin: 'oklch(0.58 0.16 265)',
};
const ROLE_LANES = ['public', 'departmentMember', 'departmentAdmin', 'propertyAdmin', 'corporate'] as const;
const ROLE_LANE_LABEL: Record<string, string> = {
  public: 'public', departmentMember: 'dept member', departmentAdmin: 'dept admin', propertyAdmin: 'property admin', corporate: 'corporate',
};
const roleHue = (r?: string) => ROLE_HUE[r ?? ''] ?? 'var(--color-muted-foreground)';

function Shell({ children, fillViewport = true }: { children: ReactNode; fillViewport?: boolean }) {
  return (
    <div style={{ ...TOKEN_SHIM, background: 'var(--color-background)', color: 'var(--color-foreground)', minHeight: fillViewport ? '100dvh' : undefined, fontFamily: SANS, padding: '2.5rem 2rem 5rem' } as CSSProperties}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Eyebrow() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-brand-tertiary)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-brand-500)' }} />
      storybook-workbench · component worklist
    </div>
  );
}

function EmptyState() {
  return (
    <Shell>
      <Eyebrow />
      <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.4rem' }}>Components</h1>
      <p style={{ color: 'var(--color-muted-foreground)', maxWidth: '64ch', lineHeight: 1.55 }}>
        No worklist yet. Run <code style={{ fontFamily: MONO }}>refresh-usage.sh</code> (or
        <code style={{ fontFamily: MONO }}>build-component-pages.py</code> after the inventory/usage/flows
        extractors) — it writes <code style={{ fontFamily: MONO }}>.storybook/component-pages.json</code>,
        resolving each component to its parents/children and the pages it renders on.
      </p>
    </Shell>
  );
}

// Structural foundation lines under each component name: what it is nested inside (parents, line 1)
// and — when it is a container — every component it renders (children, line 2). All names are listed
// in full (not hidden behind a count) and clickable, so you can walk the tree either direction:
// click a parent to jump up, click a child to jump down (child → parent → page).
function NameList({ names, onPick }: { names: string[]; onPick: (n: string) => void }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <button
            type="button"
            onClick={() => onPick(n)}
            style={{ font: 'inherit', color: 'var(--color-foreground)', background: 'none', border: 'none', borderBottom: '1px dotted var(--color-border-subtle)', padding: 0, cursor: 'pointer' }}
          >
            {n}
          </button>
          {i < names.length - 1 ? <span aria-hidden="true">·</span> : null}
        </span>
      ))}
    </>
  );
}

function Nesting({ parents, childNames, onPick }: { parents?: string[]; childNames?: string[]; onPick: (n: string) => void }) {
  const hasParents = !!parents && parents.length > 0;
  const kids = childNames ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontFamily: MONO, fontSize: '0.66rem', color: 'var(--color-muted-foreground)' }}>
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem' }}>
        {hasParents ? (
          <>
            <span title="parent components this one is nested inside — click a name to jump up" style={{ minWidth: '5em', flexShrink: 0 }}>parents</span>
            <NameList names={parents!} onPick={onPick} />
          </>
        ) : (
          <span title="not nested in any component — rendered directly on a page or in app nav chrome" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--color-brand-500)', flexShrink: 0 }} /> top-level
          </span>
        )}
      </span>
      {kids.length > 0 ? (
        <span title={`child components this one renders — click a name to jump down`} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ minWidth: '5em', flexShrink: 0 }}>children</span>
          <NameList names={kids} onPick={onPick} />
        </span>
      ) : null}
    </div>
  );
}

export function ComponentUsage({ fillViewport = true }: { fillViewport?: boolean } = {}): JSX.Element {
  const report = useMemo<ComponentPagesReport | null>(() => Object.values(reportFiles)[0] ?? null, []);
  const [needle, setNeedle] = useState('');
  if (!report || !report.components) return <EmptyState />;

  const all = Object.entries(report.components)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.callSites - a.callSites);
  const rows = needle.trim()
    ? all.filter((r) => r.name.toLowerCase().includes(needle.toLowerCase()) || r.pages.some((p) => p.title.toLowerCase().includes(needle.toLowerCase())))
    : all;
  const resolved = all.filter((r) => r.pages.length > 0).length;
  const nested = all.filter((r) => r.parents && r.parents.length > 0).length;
  const appMap = report.appMapStoryId;
  const appMapHref = appMap ? `/?path=/story/${appMap}` : undefined;

  return (
    <Shell fillViewport={fillViewport}>
      <ReportIntro
        what="Every component the app really renders, ranked by how often it's used at call sites, with where each one shows up — the import graph between components and pages, not a hand-kept list."
        source={{ file: 'component-pages.json', skill: 'sb-inventory' }}
        pipeline={[{ skill: 'sb-inventory', role: 'the import graph' }, { skill: 'sb-wrappers', role: 'this view' }]}
        refresh="build-component-pages.py"
        generatedAt={report.generatedAt}
      />
      <header style={{ marginBottom: '1.4rem' }}>
        <Eyebrow />
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.35rem', letterSpacing: '-0.01em' }}>Components</h1>
        <p style={{ color: 'var(--color-muted-foreground)', fontSize: '0.95rem', margin: 0 }}>
          <strong style={{ color: 'var(--color-foreground)' }}>{all.length}</strong> components by real call-site usage ·{' '}
          <strong style={{ color: 'var(--color-foreground)' }}>{nested}</strong> nested in another component ·{' '}
          <strong style={{ color: 'var(--color-foreground)' }}>{resolved}</strong> mapped to a page ·{' '}
          {appMapHref ? <a href={appMapHref} target="_top" style={{ color: roleHue('user'), textDecoration: 'none' }}>open the App Map →</a> : 'App Map not built'}
        </p>
      </header>

      <input
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        placeholder="Filter by component or page…"
        style={{ width: '100%', maxWidth: 360, marginBottom: '1rem', fontFamily: SANS, fontSize: '0.85rem', padding: '0.45rem 0.7rem', borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', color: 'var(--color-foreground)' }}
      />

      <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden', background: 'var(--color-surface)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr auto auto 2fr', gap: '1rem', padding: '0.55rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', fontFamily: MONO, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
          <span>Component · hierarchy</span><span style={{ textAlign: 'right' }}>Uses</span><span style={{ textAlign: 'right' }}>Props</span><span>Used on pages</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '1.7fr auto auto 2fr', gap: '1rem', alignItems: 'center', padding: '0.5rem 1rem', borderTop: i ? '1px solid var(--color-border-subtle)' : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
              <code style={{ fontFamily: MONO, fontSize: '0.78rem', color: 'var(--color-foreground)', fontWeight: 600, wordBreak: 'break-all' }}>{r.name}</code>
              <Nesting parents={r.parents} childNames={r.children} onPick={setNeedle} />
            </div>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: '0.78rem', color: 'var(--color-foreground)', fontVariantNumeric: 'tabular-nums' }}>{r.callSites}</span>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: '0.78rem', color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>{r.props}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
              {r.pages.length > 0 ? (
                r.pages.map((p) => (
                  <a
                    key={p.path}
                    href={appMapHref}
                    target="_top"
                    title={`${p.title} (${p.path}) — open the App Map`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', padding: '0.1rem 0.5rem', borderRadius: 999, border: `1px solid ${roleHue(p.role)}`, color: 'var(--color-foreground)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: roleHue(p.role), flexShrink: 0 }} />
                    {p.title}
                  </a>
                ))
              ) : r.globalNav ? (
                // genuinely app-wide chrome (sidebar/header/nav) — present on every screen, not one page
                <span title="rendered in app-wide nav chrome (sidebar/header) — present on every screen" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontFamily: MONO, padding: '0.1rem 0.5rem', borderRadius: 999, border: '1px solid var(--color-brand-500)', color: 'var(--color-foreground)', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--color-brand-500)', flexShrink: 0 }} /> global nav
                </span>
              ) : r.hosts && r.hosts.length > 0 ? (
                // no routed host page resolved — surface the immediate host component(s) we DO know
                <span title="no routed host page resolved by the import trace — used inside these component(s)" style={{ fontSize: '0.72rem', fontFamily: MONO, color: 'var(--color-muted-foreground)' }}>
                  via {r.hosts.join(', ')}
                </span>
              ) : (
                <span title="used, but no host page or component resolved by the import trace" style={{ fontSize: '0.72rem', fontFamily: MONO, color: 'var(--color-muted-foreground)', fontStyle: 'italic', opacity: 0.8 }}>unresolved</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', marginTop: '0.8rem', fontSize: '0.74rem', color: 'var(--color-muted-foreground)' }}>
        {ROLE_LANES.map((r) => (
          <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: roleHue(r) }} /> {ROLE_LANE_LABEL[r]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Icon.info size={12} /> page chips link to the App Map · <strong style={{ color: 'var(--color-foreground)' }}>parents</strong> = components it's nested inside · <strong style={{ color: 'var(--color-foreground)' }}>children</strong> = components it renders · names are clickable (jump up/down the tree) · <strong style={{ color: 'var(--color-foreground)' }}>top-level</strong> = rendered directly · <strong style={{ color: 'var(--color-foreground)' }}>via X</strong> = host component, no page resolved</span>
      </div>
    </Shell>
  );
}
