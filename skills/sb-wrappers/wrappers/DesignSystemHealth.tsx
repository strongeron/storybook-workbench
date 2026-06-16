/**
 * DesignSystemHealth — read findings from validate-design-system.sh and render
 * them as a Storybook story.
 *
 * Grouped by KIND, as an accordion: each row is the high-level summary (title,
 * count badge, check-source badge, description); expand to see the complete list
 * of sources from the JSON. Every kind the audit can detect is shown — clean ones
 * carry an example of what the check would catch, so the view doubles as a catalog
 * of what typically goes wrong in an AI-generated app's design system.
 *
 * Fully token-driven (app CSS vars), so it themes light AND dark via the toolbar.
 * Storybook-only — never imported from app code.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type WrapperIcon } from './icons';
import { ReportIntro } from './ReportIntro';

export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingKind =
  | 'raw-color' | 'undefined-token' | 'scale-gap' | 'contrast'
  | 'naming-drift' | 'unused-token' | 'stylelint' | 'other';

export interface HealthFinding {
  kind: FindingKind;
  severity: FindingSeverity;
  file?: string;
  line?: number;
  message: string;
  fix?: string;
}

export interface HealthReport {
  generatedAt?: string;
  ranBy?: string;
  findings: HealthFinding[];
  summary?: { total: number; errors: number; warnings: number; info: number; checksRun: string[] };
}

const healthFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<HealthReport>('../../.storybook/design-system-health.json', { eager: true });

const SEV: Record<FindingSeverity, { label: string; text: string; dot: string; icon: WrapperIcon }> = {
  error:   { label: 'Error',   text: 'var(--color-error-text)',       dot: 'var(--color-error)',   icon: Icon.x },
  warning: { label: 'Warning', text: 'var(--color-warning-text)',     dot: 'var(--color-warning)', icon: Icon.warning },
  info:    { label: 'Info',    text: 'var(--color-muted-foreground)', dot: 'var(--color-muted-foreground)',   icon: Icon.info },
};

// The full catalog of what the audit detects — worst-first. `source` is the mechanism;
// `example` is a representative finding shown when a project has none, to demonstrate the check.
const CATALOG: Array<{ kind: FindingKind; label: string; severity: FindingSeverity; source: string; blurb: string; example: { message: string; where: string } }> = [
  { kind: 'undefined-token', label: 'Undefined token', severity: 'error',   source: 'grep',         blurb: 'A component references var(--foo) that is never declared. Define the token, or fix the name.', example: { message: 'var(--color-primary) referenced but never declared', where: 'src/components/Header.tsx:42' } },
  { kind: 'contrast',        label: 'Contrast ratio',   severity: 'error',   source: 'APCA / WCAG',  blurb: 'A foreground / background pair fails WCAG / APCA. Adjust lightness until text is legible.', example: { message: 'Text #8a8a8a on #ffffff is 2.9:1, needs 4.5:1 (WCAG AA)', where: 'src/components/Card.tsx:18' } },
  { kind: 'raw-color',       label: 'Raw color literal', severity: 'warning', source: 'grep',         blurb: 'A hardcoded #hex / rgba() / hsl() in component source. Replace with a token so light/dark themes work.', example: { message: 'Hardcoded #3b82f6 should be a design token', where: 'src/components/Button.tsx:12' } },
  { kind: 'scale-gap',       label: 'Scale gap',        severity: 'warning', source: 'grep + ratio', blurb: 'An unexpected jump in the spacing or type scale. Add the missing step, or consolidate the scale.', example: { message: 'Spacing jumps 16px to 48px with nothing between', where: 'src/theme.css:30' } },
  { kind: 'naming-drift',    label: 'Naming drift',     severity: 'warning', source: 'LLM sub-agent', blurb: 'Similar tokens with inconsistent names. Unify the naming so intent is unambiguous.', example: { message: '--color-border and --border-color both exist for one role', where: 'src/theme.css' } },
  { kind: 'stylelint',       label: 'stylelint',        severity: 'warning', source: 'stylelint',    blurb: 'A stylelint rule violation in the stylesheet (runs when a config is present).', example: { message: 'Unexpected duplicate property "color"', where: 'src/index.css:88' } },
  { kind: 'unused-token',    label: 'Unused token',     severity: 'info',    source: 'grep',         blurb: 'Declared but never referenced. Prune to shrink the system and speed up scans.', example: { message: '--color-accent-legacy declared but never referenced', where: 'src/theme.css' } },
];

const SANS = 'var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)';
const DISPLAY = 'var(--font-family-display, ' + SANS + ')';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Bridge this view's design-system token vocabulary onto stock shadcn/Tailwind-v4
// primitives, with fixed fallbacks. Scoped to the wrapper root (cascades to descendants,
// never leaks to the app). Without it, apps that don't ship --color-surface /
// --color-border-subtle / --color-border-default / a semantic palette render this view
// unstyled and low-contrast. No token self-references (`--x: var(--x, …)` voids the
// fallback via a CSS dependency cycle) — every fallback names a DIFFERENT primitive or literal.
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
      storybook-workbench · design system
    </div>
  );
}

// shadcn-style disclosure chevron: points down when closed, rotates 180° to point up
// when open. Lives at the right edge of the trigger row (see the accordion below).
function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="dsh-acc-chevron" width="15" height="15" viewBox="0 0 16 16" aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)', color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
      <path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span title="how this check is performed" style={{ fontFamily: MONO, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted-foreground)', border: '1px solid var(--color-border-default)', borderRadius: 999, padding: '0.08rem 0.5rem', whiteSpace: 'nowrap' }}>
      {source}
    </span>
  );
}

function CountBadge({ n, tone }: { n: number; tone: { bg: string; fg: string } }) {
  return (
    <span style={{ minWidth: 22, textAlign: 'center', fontFamily: MONO, fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone.fg, background: tone.bg, borderRadius: 999, padding: '0.08rem 0.5rem' }}>
      {n}
    </span>
  );
}

function SourceChips({ items }: { items: HealthFinding[] }) {
  const src = (f: HealthFinding) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '');
  // All findings share one message (e.g. raw-color): the message is the kind, so show only sources.
  const sameMessage = new Set(items.map((f) => f.message)).size <= 1 && items.every((f) => f.file);
  if (sameMessage) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {items.map((f, i) => (
          <code key={i} style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--color-muted-foreground)', background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, padding: '0.15rem 0.45rem' }}>
            {src(f)}
          </code>
        ))}
      </div>
    );
  }
  // Messages differ (or some lack a file): show the subject + its source. Robust to any shape —
  // missing file shows nothing on the right; missing message is fine; long values wrap/truncate.
  return (
    <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' }}>
      {items.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: '0.9rem', padding: '0.5rem 0.9rem', borderTop: i ? '1px solid var(--color-border-subtle)' : 'none' }}>
          <span style={{ fontSize: '0.86rem', wordBreak: 'break-word' }}>
            {f.message}
            {f.fix && <span style={{ color: 'var(--color-muted-foreground)', fontSize: '0.8rem' }}> · Fix: {f.fix}</span>}
          </span>
          {f.file && <code style={{ fontFamily: MONO, fontSize: '0.73rem', color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>{src(f)}</code>}
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <Shell>
      <Eyebrow />
      <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.4rem', letterSpacing: '-0.01em' }}>Design system health</h1>
      <p style={{ color: 'var(--color-muted-foreground)', maxWidth: '64ch', lineHeight: 1.55, margin: 0 }}>
        No report yet. Run the validator to generate <code style={{ fontFamily: MONO, fontSize: '0.85em' }}>.storybook/design-system-health.json</code>:
      </p>
      <pre style={{ fontFamily: MONO, fontSize: '0.82rem', background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.9rem', margin: '0.9rem 0' }}>
        validate-design-system.sh src
      </pre>
    </Shell>
  );
}

export function DesignSystemHealth({ fillViewport = true }: { fillViewport?: boolean } = {}): JSX.Element {
  const report = useMemo<HealthReport | null>(() => {
    const reports = Object.values(healthFiles);
    return reports.length > 0 ? reports[0] : null;
  }, []);
  const [open, setOpen] = useState<Set<FindingKind>>(new Set());

  if (!report || !report.findings) return <EmptyState />;

  const byKind = new Map<FindingKind, HealthFinding[]>();
  for (const f of report.findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }
  const total = report.findings.length;
  const bySev = { error: 0, warning: 0, info: 0 };
  for (const f of report.findings) bySev[f.severity]++;
  const sevOrder: FindingSeverity[] = ['error', 'warning', 'info'];
  const present = sevOrder.filter((s) => bySev[s] > 0);
  const status = total === 0 ? 'No findings. The design system is clean.' : present.map((s) => `${bySev[s]} ${SEV[s].label.toLowerCase()}${bySev[s] === 1 ? '' : 's'}`).join(' · ');

  const toggle = (k: FindingKind) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  return (
    <Shell fillViewport={fillViewport}>
      {/* shadcn-style accordion chrome: hover underlines the trigger label, the chevron
          darkens on hover, focus is keyboard-visible, and the panel fades in (motion-safe). */}
      <style>{`
        .dsh-acc-trigger:hover .dsh-acc-label { text-decoration: underline; text-underline-offset: 3px; }
        .dsh-acc-trigger:hover .dsh-acc-chevron { color: var(--color-foreground); }
        .dsh-acc-trigger:focus-visible { outline: 2px solid var(--color-brand-500); outline-offset: 3px; border-radius: var(--radius-sm); }
        .dsh-acc-panel { animation: dshAccIn 0.22s cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes dshAccIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .dsh-acc-panel { animation: none; }
          .dsh-acc-chevron { transition: none !important; }
        }
      `}</style>
      <ReportIntro
        what="A health check of the design system: raw color literals, undefined or unused tokens, contrast failures, scale gaps, and naming drift — each finding pointing at the exact file and line, so you fix the source, not a doc."
        source={{ file: 'design-system-health.json', skill: 'sb-health' }}
        pipeline={[{ skill: 'sb-health', role: 'the findings' }, { skill: 'sb-wrappers', role: 'this view' }]}
        refresh="validate-design-system.sh src"
        generatedAt={report.generatedAt}
      />
      <header style={{ marginBottom: '1.6rem' }}>
        <Eyebrow />
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.35rem', letterSpacing: '-0.01em' }}>Design system health</h1>
        <p style={{ color: 'var(--color-muted-foreground)', fontSize: '0.95rem', margin: 0 }}>
          {total} {total === 1 ? 'finding' : 'findings'} · {status}
          {report.generatedAt && <span style={{ color: 'var(--color-muted-foreground)' }}> · {report.generatedAt.slice(0, 10)}</span>}
        </p>
      </header>

      {total > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--color-border-subtle)' }}>
            {present.map((s) => <div key={s} title={`${bySev[s]} ${SEV[s].label.toLowerCase()}`} style={{ flexGrow: bySev[s], background: SEV[s].dot }} />)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', marginTop: '0.7rem', fontSize: '0.85rem', color: 'var(--color-muted-foreground)' }}>
            {sevOrder.map((s) => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: SEV[s].dot, opacity: bySev[s] ? 1 : 0.35 }} />
                <strong style={{ color: 'var(--color-foreground)', fontVariantNumeric: 'tabular-nums' }}>{bySev[s]}</strong> {SEV[s].label.toLowerCase()}s
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Accordion: one row per detectable kind. Collapsed = high level; expand for the full source list.
          No surface fill — a hairline-divided list on the page background, aligned with the header. */}
      {/* One row style for every kind. Issues on top (expandable to full sources); clean checks
          below as static rows with a visible example of what that check catches. */}
      {(() => {
        const withFindings = CATALOG.filter((c) => (byKind.get(c.kind)?.length ?? 0) > 0);
        const cleanKinds = CATALOG.filter((c) => !(byKind.get(c.kind)?.length));
        const ordered = [...withFindings, ...cleanKinds];
        return (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            {ordered.map((cat) => {
              const items = byKind.get(cat.kind) ?? [];
              const has = items.length > 0;
              const s = SEV[cat.severity];
              const isOpen = open.has(cat.kind);
              const countTone = {
                bg: cat.severity === 'error' ? 'var(--color-error-surface)' : cat.severity === 'warning' ? 'var(--color-warning-surface)' : 'var(--color-border-subtle)',
                fg: s.text,
              };
              const head = (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: has ? s.dot : 'var(--color-success)', flexShrink: 0 }} />
                    <span className="dsh-acc-label" style={{ fontFamily: DISPLAY, fontSize: '1.12rem', fontWeight: 600, color: 'var(--color-foreground)' }}>{cat.label}</span>
                    {has
                      ? <CountBadge n={items.length} tone={countTone} />
                      : <span style={{ display: 'inline-flex', color: 'var(--color-success)' }}><Icon.check size={15} /></span>}
                    <SourceBadge source={cat.source} />
                    {has && <span style={{ marginLeft: 'auto', display: 'inline-flex', paddingLeft: '0.6rem' }}><Chevron open={isOpen} /></span>}
                  </div>
                  <p style={{ margin: '0.4rem 0 0', paddingLeft: '1.15rem', fontSize: '0.92rem', color: 'var(--color-muted-foreground)', lineHeight: 1.5, maxWidth: '76ch' }}>{cat.blurb}</p>
                </>
              );
              return (
                <section key={cat.kind} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {has ? (
                    <button className="dsh-acc-trigger" onClick={() => toggle(cat.kind)} aria-expanded={isOpen} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', width: '100%', padding: '0.95rem 0' }}>
                      {head}
                    </button>
                  ) : (
                    <div style={{ padding: '0.95rem 0' }}>
                      {head}
                      <div style={{ paddingLeft: '1.15rem', marginTop: '0.55rem', fontSize: '0.85rem', color: 'var(--color-muted-foreground)' }}>
                        <span style={{ fontFamily: MONO, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted-foreground)', border: '1px solid var(--color-border-subtle)', borderRadius: 999, padding: '0.05rem 0.4rem', marginRight: '0.55rem' }}>example</span>
                        {cat.example.message} <code style={{ fontFamily: MONO, fontSize: '0.74rem', color: 'var(--color-muted-foreground)' }}>{cat.example.where}</code>
                      </div>
                    </div>
                  )}
                  {has && isOpen && (
                    <div className="dsh-acc-panel" style={{ padding: '0 0 1.1rem 1.15rem' }}>
                      <SourceChips items={items} />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        );
      })()}

      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground)', fontFamily: MONO, marginTop: '2rem', paddingTop: '0.9rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        Source: .storybook/design-system-health.json{report.ranBy ? ` · ${report.ranBy}` : ''}
      </p>
    </Shell>
  );
}
