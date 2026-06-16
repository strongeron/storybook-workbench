/**
 * ProjectInventory — Setup-phase ground truth, rendered as a Storybook story.
 *
 * Reads `.storybook/project-inventory.json` (from inventory-project.sh): library
 * stack, dominant design-system source, real vs dead components, token usage, and
 * orphan stories. Replaces "trust AGENTS.md / CLAUDE.md" with "see what's actually
 * in the project."
 *
 * Fully token-driven (app CSS vars), so it themes light AND dark via the toolbar.
 * Storybook-only — never imported from app code.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';
import { ReportIntro } from './ReportIntro';

export interface ProjectInventoryReport {
  generatedAt?: string;
  ranBy?: string;
  libraries: {
    react: boolean; vite: boolean; tailwindV4: boolean; tailwindV3: boolean;
    shadcn: boolean; radix: boolean; baseui: boolean; r3f: boolean;
  };
  designSystem: {
    dominant: 'tailwind-v4' | 'shadcn' | 'dtcg' | 'css-vars' | 'none';
    mixed: boolean;
    mixedReason?: string | null;
    tokenCounts: { 'tailwind-v4': number; shadcn: number; dtcg: number; 'css-vars': number };
  };
  components: {
    totalFiles: number; realCount: number; deadCount: number;
    real: Array<{ file: string; importers: number }>;
    dead: Array<{ file: string; importers: number }>;
    storyCoverage?: { real: number; storyFiles?: number; withColocatedStory?: number; withStory: number; needsCount: number; needsStory: string[] };
  };
  tokens: { totalDeclared: number; usedCount: number; orphanCount: number; orphan: string[] };
  orphanStories: { count: number; items: Array<{ story: string; missing_import: string }> };
}

const inventoryFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<ProjectInventoryReport>('../../.storybook/project-inventory.json', { eager: true });

// component-usage.json carries the real UI-component call-site usage (only things that render
// as JSX appear here — types/utils never do, so it's the clean UI list). The importer-ranked
// `components.real` from the inventory mixes in types/utils; for "what to story next" we rank by
// actual call-site usage instead.
interface ComponentUsageReport {
  components?: Record<string, { callSites?: number; files?: string[]; props?: Record<string, unknown> }>;
}
const usageFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<ComponentUsageReport>('../../.storybook/component-usage.json', { eager: true });

const SANS = 'var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)';
const DISPLAY = 'var(--font-family-display, ' + SANS + ')';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// ── One semantic color legend, shared by every widget in this view ──────────
//   good  → green  (in-use / healthy):     real, used, "Top real components"
//   warn  → amber  (benign caution):       orphan tokens (expected for Tailwind)
//   bad   → red    (waste / broken):       dead components, orphan stories
//   none  → gray   (neutral denominator):  total, declared
// Numbers use the legible `text` shade (WCAG-safe on the near-white surface);
// dots/badges use the vibrant `dot`/`surface` shades since they're graphic.
const LEGEND = {
  good: { text: 'var(--color-success-text)',     dot: 'var(--color-success)', surface: 'var(--color-success-surface)' },
  warn: { text: 'var(--color-warning-text)',     dot: 'var(--color-warning)', surface: 'var(--color-warning-surface)' },
  bad:  { text: 'var(--color-error-text)',       dot: 'var(--color-error)',   surface: 'var(--color-error-surface)' },
  none: { text: 'var(--color-muted-foreground)', dot: 'var(--color-muted-foreground)',   surface: 'var(--color-border-subtle)' },
} as const;
type Tone = keyof typeof LEGEND;

// Bridge this view's design-system token vocabulary onto stock shadcn/Tailwind-v4
// primitives, with fixed fallbacks. Scoped to the wrapper root (cascades to descendants,
// never leaks to the app). Without it, apps that don't ship --color-surface /
// --color-border-subtle / a semantic palette render this view unstyled and low-contrast.
// No token self-references (e.g. `--x: var(--x, …)`) — that creates a CSS dependency
// cycle that voids the fallback; every fallback names a DIFFERENT primitive or a literal.
const TOKEN_SHIM: Record<string, string> = {
  '--color-surface': 'var(--color-card, var(--color-background))',
  '--color-border-subtle': 'var(--color-border, color-mix(in oklab, var(--color-muted-foreground) 22%, transparent))',
  '--color-brand-500': 'var(--color-primary, var(--color-foreground))',
  '--color-brand-200': 'var(--color-border, var(--color-primary, currentColor))',
  '--color-brand-50': 'var(--color-accent, var(--color-muted))',
  '--color-text-brand-primary': 'var(--color-primary, var(--color-foreground))',
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
      storybook-workbench · ground truth
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.1rem 1.2rem' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 0 0.8rem', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

// A modest stat trio (count + label), token-driven. Not a hero-metric (no big-number gradient).
// Each number's color comes from the shared LEGEND so meaning stays consistent everywhere.
function Stats({ items }: { items: Array<{ n: number; label: string; tone?: Tone }> }) {
  return (
    <div style={{ display: 'flex', gap: '1.6rem' }}>
      {items.map((s) => (
        <div key={s.label}>
          <div style={{ fontSize: '1.35rem', fontWeight: 600, fontFamily: DISPLAY, fontVariantNumeric: 'tabular-nums', color: s.tone ? LEGEND[s.tone].text : 'var(--color-foreground)' }}>{s.n}</div>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted-foreground)' }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Pill({ on, label }: { on: boolean; label: string }) {
  // "on" = library detected in the project. Use the success/detected semantic (the check already
  // means "present") rather than the --color-brand-* tokens: those shim to --color-accent, which in
  // shadcn / Tailwind v4 is a neutral GRAY, so detected libraries rendered indistinguishable from off.
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.18rem 0.6rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: on ? 600 : 500,
      background: on ? LEGEND.good.surface : 'transparent',
      color: on ? LEGEND.good.text : 'var(--color-muted-foreground)',
      border: `1px solid ${on ? 'color-mix(in oklab, ' + LEGEND.good.dot + ' 38%, transparent)' : 'var(--color-border-subtle)'}`,
    }}>
      {on ? <Icon.check size={12} /> : <Icon.dot size={8} />} {label}
    </span>
  );
}

function SourceBar({ counts }: { counts: ProjectInventoryReport['designSystem']['tokenCounts'] }) {
  const labels: Array<keyof typeof counts> = ['tailwind-v4', 'shadcn', 'dtcg', 'css-vars'];
  const total = Math.max(1, labels.reduce((a, k) => a + counts[k], 0));
  // Restrained, token-anchored hues for the four sources (functional data-viz).
  // Distinct, well-separated hues per source (not neutral brand/gray, which blend together).
  // Each is a saturated oklch readable on a light surface; spread around the wheel so the bar
  // segments and legend dots stay visually distinguishable regardless of the app's own palette.
  const hue: Record<string, string> = {
    'tailwind-v4': 'oklch(0.70 0.13 195)', shadcn: 'oklch(0.58 0.16 265)', dtcg: 'oklch(0.76 0.15 75)', 'css-vars': 'oklch(0.62 0.18 300)',
  };
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--color-border-subtle)' }}>
        {labels.map((k) => counts[k] > 0 && <div key={k} style={{ flexGrow: counts[k], background: hue[k] }} title={`${k}: ${counts[k]}`} />)}
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginTop: '0.5rem', fontSize: '0.76rem', color: 'var(--color-muted-foreground)' }}>
        {labels.map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 9, height: 9, background: hue[k], borderRadius: 999, opacity: counts[k] ? 1 : 0.35 }} /> {k}: <strong style={{ color: 'var(--color-foreground)' }}>{counts[k]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function FileRows({ rows, right }: { rows: Array<{ file: string; importers?: number }>; right?: (r: { importers?: number }) => ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-surface)' }}>
      {rows.map((r, i) => (
        <div key={r.file} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '1rem', padding: '0.5rem 1rem', borderTop: i ? '1px solid var(--color-border-subtle)' : 'none' }}>
          <code style={{ fontFamily: MONO, fontSize: '0.76rem', color: 'var(--color-foreground)', wordBreak: 'break-all' }}>{r.file}</code>
          {right && <span style={{ whiteSpace: 'nowrap' }}>{right(r)}</span>}
        </div>
      ))}
    </div>
  );
}

// Count badge + section header — the SAME grammar DesignSystemHealth uses: a severity
// dot and a count badge carry tone, the label stays foreground, the descriptor sits on
// its own line aligned under the label. Keeps the two wrapper views reading as one system.
function CountBadge({ n, tone }: { n: number; tone: Tone }) {
  const c = LEGEND[tone];
  return (
    <span style={{ minWidth: 22, textAlign: 'center', fontFamily: MONO, fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.text, background: c.surface, borderRadius: 999, padding: '0.08rem 0.5rem' }}>
      {n}
    </span>
  );
}

function SectionHead({ tone, label, count, desc }: { tone: Tone; label: string; count?: ReactNode; desc: string }) {
  const dot = LEGEND[tone].dot;
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: dot, flexShrink: 0 }} />
        <h2 style={{ fontFamily: DISPLAY, fontSize: '1.12rem', fontWeight: 600, color: 'var(--color-foreground)', margin: 0, letterSpacing: '-0.01em' }}>{label}</h2>
        {count}
      </div>
      <p style={{ margin: '0.3rem 0 0', paddingLeft: '1.15rem', fontSize: '0.9rem', color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>{desc}</p>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <Shell>
      <Eyebrow />
      <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.4rem', letterSpacing: '-0.01em' }}>Project inventory</h1>
      <p style={{ color: 'var(--color-muted-foreground)', maxWidth: '64ch', lineHeight: 1.55, margin: 0 }}>
        No inventory yet. Run the discovery script to capture the project's ground truth (replaces trusting CLAUDE.md / AGENTS.md):
      </p>
      <pre style={{ fontFamily: MONO, fontSize: '0.82rem', background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.9rem', margin: '0.9rem 0' }}>
        inventory-project.sh src
      </pre>
    </Shell>
  );
}

export function ProjectInventory({ fillViewport = true }: { fillViewport?: boolean } = {}): JSX.Element {
  const report = useMemo<ProjectInventoryReport | null>(() => {
    const reports = Object.values(inventoryFiles);
    return reports.length > 0 ? reports[0] : null;
  }, []);

  if (!report) return <EmptyState />;

  const c = report.components;
  const slopRate = c.totalFiles > 0 ? Math.round((c.deadCount / c.totalFiles) * 100) : 0;

  // Rank real UI components by actual call-site usage (component-usage.json) — the priority
  // for stories. Falls back to the inventory's importer-ranked list if usage data is absent.
  const usageMap = Object.values(usageFiles)[0]?.components ?? {};
  const topByUsage = Object.entries(usageMap)
    .map(([name, v]) => ({ file: name, importers: v.callSites ?? 0 }))
    .filter((r) => r.importers > 0)
    .sort((a, b) => b.importers - a.importers)
    .slice(0, 14);
  // Prefer the HARD count (own components with their own story file); fall back to the loose
  // upper bound only when an older inventory JSON predates the withColocatedStory split.
  const withStory = c.storyCoverage?.withColocatedStory ?? c.storyCoverage?.withStory ?? 0;
  const totalReal = c.storyCoverage?.real ?? c.realCount;

  return (
    <Shell fillViewport={fillViewport}>
      <ReportIntro
        what="A live inventory of what's actually in this project — which components really render, which are dead weight, and how many design tokens are used versus declared. It replaces trusting AGENTS.md / CLAUDE.md with what the code actually does."
        source={{ file: 'project-inventory.json', skill: 'sb-inventory' }}
        pipeline={[{ skill: 'sb-inventory', role: 'the inventory' }, { skill: 'sb-wrappers', role: 'this view' }]}
        refresh="inventory-project.sh"
        generatedAt={report.generatedAt}
      />
      <header style={{ marginBottom: '1.6rem' }}>
        <Eyebrow />
        <h1 style={{ fontFamily: DISPLAY, fontSize: '1.7rem', margin: '0.8rem 0 0.35rem', letterSpacing: '-0.01em' }}>Project inventory</h1>
        <p style={{ color: 'var(--color-muted-foreground)', fontSize: '0.95rem', margin: 0 }}>
          <strong style={{ color: LEGEND.good.text }}>{c.realCount}</strong> real · <strong style={{ color: LEGEND.bad.text }}>{c.deadCount}</strong> dead ({slopRate}% slop) · <strong style={{ color: 'var(--color-foreground)' }}>{report.tokens.usedCount}/{report.tokens.totalDeclared}</strong> tokens used
          {report.generatedAt && <span style={{ color: 'var(--color-muted-foreground)' }}> · {report.generatedAt.slice(0, 10)}</span>}
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <Panel title="Stack" icon={<Icon.box size={13} />}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <Pill on={report.libraries.react} label="React" />
            <Pill on={report.libraries.vite} label="Vite" />
            <Pill on={report.libraries.tailwindV4} label="Tailwind v4" />
            <Pill on={report.libraries.tailwindV3} label="Tailwind v3" />
            <Pill on={report.libraries.shadcn} label="shadcn" />
            <Pill on={report.libraries.radix} label="Radix" />
            <Pill on={report.libraries.baseui} label="Base UI" />
            <Pill on={report.libraries.r3f} label="R3F" />
          </div>
        </Panel>

        <Panel title="Design system" icon={<Icon.palette size={13} />}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: DISPLAY, marginBottom: report.designSystem.mixed ? '0.3rem' : '0.6rem' }}>
            {report.designSystem.dominant === 'none' ? '(none detected)' : report.designSystem.dominant}
          </div>
          {report.designSystem.mixed && (
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: 'var(--color-warning-text)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Icon.warning size={12} /> Mixed: {report.designSystem.mixedReason}
            </p>
          )}
          <SourceBar counts={report.designSystem.tokenCounts} />
        </Panel>

        <Panel title="Components" icon={<Icon.box size={13} />}>
          <Stats items={[
            { n: c.realCount, label: 'real', tone: 'good' },
            { n: c.deadCount, label: 'dead', tone: 'bad' },
            { n: c.totalFiles, label: 'total', tone: 'none' },
          ]} />
        </Panel>

        <Panel title="Tokens" icon={<Icon.tokens size={13} />}>
          <Stats items={[
            { n: report.tokens.usedCount, label: 'used', tone: 'good' },
            { n: report.tokens.orphanCount, label: 'orphan', tone: 'warn' },
            { n: report.tokens.totalDeclared, label: 'declared', tone: 'none' },
          ]} />
          {report.designSystem.dominant === 'tailwind-v4' && (
            <p style={{ margin: '0.7rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted-foreground)', lineHeight: 1.4 }}>
              "Orphan" = declared but never consumed — no <code style={{ fontFamily: MONO }}>var(--foo)</code>, no Tailwind utility (<code style={{ fontFamily: MONO }}>bg-/text-/…</code>), and no custom <code style={{ fontFamily: MONO }}>@utility</code>. Large counts are normal when a project declares a full palette but uses a fraction.
            </p>
          )}
        </Panel>
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <SectionHead
          tone="good"
          label="Top components by usage"
          desc={topByUsage.length > 0
            ? `Real call-site usage — the priority for stories. Coverage: ${withStory}/${totalReal} have a story, so everything below still needs one.`
            : 'Most-imported (call-site usage unavailable — run component-usage discovery).'}
        />
        <FileRows
          rows={topByUsage.length > 0 ? topByUsage : c.real.slice(0, 12)}
          right={(r) => <span style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>{r.importers} {topByUsage.length > 0 ? 'call sites' : 'importers'}</span>}
        />
      </section>

      {c.dead.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <SectionHead
            tone="bad"
            label="Dead components"
            count={<CountBadge n={c.deadCount} tone="bad" />}
            desc={`Defined but never imported outside their own file${c.deadCount > 20 ? ' · showing first 20' : ''}`}
          />
          <FileRows
            rows={c.dead.slice(0, 20)}
            right={() => <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--color-error)', display: 'inline-block' }} />}
          />
        </section>
      )}

      {report.orphanStories.count > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <SectionHead
            tone="bad"
            label="Orphan stories"
            count={<CountBadge n={report.orphanStories.count} tone="bad" />}
            desc="Importing components that no longer exist."
          />
          <FileRows
            rows={report.orphanStories.items.slice(0, 10).map((o) => ({ file: o.story, importers: undefined }))}
          />
        </section>
      )}

      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground)', fontFamily: MONO, marginTop: '2rem', paddingTop: '0.9rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        Source: .storybook/project-inventory.json{report.ranBy ? ` · ${report.ranBy}` : ''}
      </p>
    </Shell>
  );
}
