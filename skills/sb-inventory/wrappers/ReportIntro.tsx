/**
 * ReportIntro + ExperimentBanner — top-of-page orientation for the storybook-workbench surfaces.
 *
 * Why this exists
 * ---------------
 * A first-time viewer who clicks the published Storybook lands on a page of data with no idea
 * WHAT question it answers or WHERE the numbers came from. Every report surface used to bury its
 * provenance in a footer line (or a source-code comment the viewer never sees). These two banners
 * hoist that to the top in one shared grammar:
 *
 *   · ReportIntro      — for DERIVED-REPORT surfaces (ProjectInventory, AppFlowGraph,
 *                        DesignSystemHealth, ComponentUsage, TokenMatrix, DecisionsDashboard,
 *                        and the usage MDX docs). Answers: what is this · where is it from ·
 *                        how does it stay current. The whole value prop of this plugin is
 *                        "ground truth from code, not hand-maintained docs" — so the source line
 *                        is the point, not a footnote.
 *
 *   · ExperimentBanner — for EXPLORE / A-B surfaces (ABCanvas, sandbox stories). NOT a data-source
 *                        line — a LIFECYCLE-STATUS line: "this is an experiment, not shipped,
 *                        decision pending", plus its graduation target.
 *
 * Deliberately NOT on: component state grids (StateGrid/StorySet/StateMatrix) and individual
 * stories — those are human-authored catalogs, self-evident, and a provenance block would be both
 * noise and untrue.
 *
 * Visibility — OFF BY DEFAULT. The provenance banner orients a first-time viewer of the PUBLISHED
 * Storybook demo; it explains the plugin's plumbing (which skill made the data, what file, how to
 * refresh). In a real client deliverable that meta-narration is noise, so ReportIntro renders
 * nothing unless provenance is switched on — reachable on demand for when someone asks "where is
 * this from?":
 *   · setProvenance(true)  — or  globalThis.__SB_WB_PROVENANCE__ = true  (set in .storybook/preview.ts,
 *                            a toolbar global, or at runtime) → every banner appears.
 *   · <ReportIntro show />  — reveal a single one without the global switch.
 * ExperimentBanner is unaffected: a lifecycle-status line ("not shipped, decision pending") is real
 * deliverable content, not demo orientation.
 *
 * Self-contained: only CSS custom properties with literal fallbacks, so it renders identically
 * inside a wrapper's themed Shell AND in a bare MDX docs page (no token shim needed).
 * Storybook-only — never imported from app code.
 */
import type { CSSProperties, ReactNode } from 'react';

// ── Provenance visibility gate ───────────────────────────────────────────────────
// One switch controls every "what is this?" banner. Default OFF so real deliverables aren't
// cluttered with the plugin's own plumbing; reachable on demand (see the Visibility note above).
const PROVENANCE_GLOBAL = '__SB_WB_PROVENANCE__';

/** Turn the provenance banners on (or off). The reachable, on-demand switch. */
export function setProvenance(on: boolean = true): void {
  (globalThis as Record<string, unknown>)[PROVENANCE_GLOBAL] = on;
}

/**
 * Resolve whether a provenance banner should show. Precedence: an explicit per-call `show` wins;
 * otherwise the global switch; default false (hidden). Absent switch → false, so the real-usage
 * default needs zero configuration.
 */
export function provenanceEnabled(show?: boolean): boolean {
  if (typeof show === 'boolean') return show;
  return (globalThis as Record<string, unknown>)[PROVENANCE_GLOBAL] === true;
}

const SANS = 'var(--font-family-sans, ui-sans-serif, system-ui, sans-serif)';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
// Tinted neutrals (never pure #000/#fff): literal fallbacks lean a hair toward the brand hue so
// the block still reads as designed when a project ships no semantic palette.
const FG = 'var(--color-foreground, oklch(0.24 0.012 265))';
const MUTED = 'var(--color-muted-foreground, oklch(0.55 0.014 265))';
const BRAND = 'var(--color-primary, oklch(0.55 0.14 265))';
// Hairline frame around the block.
const BORDER = 'var(--color-border, color-mix(in oklab, var(--color-muted-foreground, oklch(0.55 0.014 265)) 20%, transparent))';
// A faint brand wash gives the block identity without a colored side-stripe (a banned pattern).
const TINT = 'color-mix(in oklab, var(--color-primary, oklch(0.55 0.14 265)) 4%, var(--color-card, var(--color-background, oklch(0.99 0.003 265))))';

// Status hues for ExperimentBanner — saturated oklch readable on a light surface, with literal
// fallbacks so it themes without depending on a project's semantic palette.
const STATUS = {
  experiment: { dot: 'var(--color-primary, oklch(0.58 0.16 265))', label: 'experiment' },
  pending: { dot: 'var(--color-warning, oklch(0.75 0.15 75))', label: 'decision pending' },
  chosen: { dot: 'var(--color-success, oklch(0.60 0.16 150))', label: 'chosen' },
  rejected: { dot: 'var(--color-muted-foreground, #71717a)', label: 'rejected' },
} as const;

function Eyebrow({ children, dot = BRAND }: { children: ReactNode; dot?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontFamily: MONO, fontSize: '0.64rem', letterSpacing: '0.11em', textTransform: 'uppercase', color: MUTED }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: `0 0 0 3px color-mix(in oklab, ${dot} 16%, transparent)` }} />
      {children}
    </div>
  );
}

// A bounded provenance header — full hairline frame + faint brand wash (no colored side-stripe).
const cardStyle: CSSProperties = {
  fontFamily: SANS,
  border: `1px solid ${BORDER}`,
  borderRadius: 'var(--radius-lg, 11px)',
  background: TINT,
  padding: '0.95rem 1.15rem 0.85rem',
  margin: '0 0 1.6rem',
};

// Provenance as an aligned label/value definition list: each fact reads as
// LABEL  value, so "output", "refresh", "note" are scannable at a glance.
const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '0.36rem 0.9rem',
  alignItems: 'baseline', // label + value share one baseline on every row, regardless of font size
  fontFamily: MONO,
  fontSize: '0.74rem',
  lineHeight: 1.45,
  margin: 0,
};

const labelStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.6rem',
  fontWeight: 600,
  fontStyle: 'normal', // Storybook Docs styles <dt> italic; keep field labels upright
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: MUTED,
};

const valueStyle: CSSProperties = { margin: 0, color: MUTED };

// One mono token (filename, command, skill name). Pinned size + neutral chrome so Storybook Docs
// can't inflate or chip-style a bare <code> — it reads identically in a story canvas and a Docs page.
const monoStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: '0.74rem',
  fontStyle: 'normal',
  color: FG,
  background: 'none',
  padding: 0,
  border: 0,
  borderRadius: 0,
};
function Mono({ children }: { children: ReactNode }) {
  return <code style={monoStyle}>{children}</code>;
}

// Muted text in the "made by" row (the role parens + the separator). Pinned size/upright for the
// same reason as Mono — a bare <span> in Storybook Docs inflates to body size, which makes the row
// taller than OUTPUT/RUN and knocks the skill names out of baseline with the label.
const roleStyle: CSSProperties = { fontSize: '0.74rem', fontStyle: 'normal', color: MUTED };
const sepStyle: CSSProperties = { fontSize: '0.74rem', color: MUTED, opacity: 0.5 };

// One label/value row inside the provenance <dl>.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{children}</dd>
    </>
  );
}

export interface ReportSource {
  /** the artifact the page reads, e.g. 'flows.json', or a live query like 'decision:* tagged stories'. */
  file: string;
  /** the skill that produces it, e.g. 'sb-flows'. */
  skill: string;
}

export interface ReportIntroProps {
  /** one plain-language sentence: the question this page answers, including the load-bearing caveat. */
  what: ReactNode;
  /** where the data comes from: artifact ← skill. */
  source: ReportSource;
  /**
   * how it stays current. Defaults to the auto-derived line. Override for surfaces that don't read a
   * generated file (e.g. DecisionsDashboard queries live story tags).
   */
  freshness?: ReactNode;
  /** the command to re-run to refresh, shown as code. */
  refresh?: string;
  /** ISO timestamp from the generated report (only the date is shown). */
  generatedAt?: string;
  /**
   * the skills that together produce this section, in pipeline order (data → render → page).
   * Rendered as a concise "made by" row so a viewer sees the whole chain, not just the data skill.
   * e.g. [{skill:'sb-inventory',role:'usage data'},{skill:'sb-wrappers',role:'this band'},{skill:'sb-stories',role:'the stories'}]
   */
  pipeline?: Array<{ skill: string; role: string }>;
  /**
   * Force this one banner visible (true) or hidden (false), bypassing the global switch. Omit to
   * follow the default — OFF unless provenance is switched on (setProvenance / __SB_WB_PROVENANCE__).
   */
  show?: boolean;
}

/** Provenance banner for derived-report surfaces. OFF by default — see the Visibility note above. */
export function ReportIntro({ what, source, freshness, refresh, pipeline, show }: ReportIntroProps) {
  if (!provenanceEnabled(show)) return null;
  return (
    <aside aria-label="What this page is and where its data comes from" style={cardStyle}>
      {/* When a "made by" pipeline is shown below, drop the skill from the eyebrow (no duplication). */}
      <Eyebrow>{pipeline && pipeline.length > 0 ? 'what is this?' : `${source.skill} · what is this?`}</Eyebrow>
      <p style={{ margin: '0.5rem 0 1rem', fontSize: '1rem', lineHeight: 1.55, letterSpacing: '-0.003em', color: FG }}>{what}</p>
      <div>
        <dl style={metaGridStyle}>
          {/* Onboarding order: who made it → the file it writes → how to refresh. */}
          {pipeline && pipeline.length > 0 && (
            <Fact label="made by">
              {pipeline.map((p, i) => (
                <span key={p.skill}>
                  {i > 0 && <span style={sepStyle}> · </span>}
                  <Mono>{p.skill}</Mono>
                  <span style={roleStyle}> ({p.role})</span>
                </span>
              ))}
            </Fact>
          )}
          <Fact label="output"><Mono>{source.file}</Mono></Fact>
          {refresh && <Fact label="run"><Mono>{refresh}</Mono></Fact>}
          {freshness && <Fact label="note">{freshness}</Fact>}
        </dl>
      </div>
    </aside>
  );
}

export interface ExperimentBannerProps {
  /** which skill produced the experiment. */
  skill?: string;
  /** lifecycle status — defaults to 'experiment'. */
  status?: keyof typeof STATUS;
  /** one line of context: what's being tried and what the decision is. */
  note?: ReactNode;
  /** where it goes when it ships (the graduation target), e.g. 'src/components/Button'. */
  target?: string;
}

/** Lifecycle-status banner for Explore / A-B surfaces: not shipped, decision pending. */
export function ExperimentBanner({ skill = 'sb-explore', status = 'experiment', note, target }: ExperimentBannerProps) {
  const s = STATUS[status];
  return (
    <aside aria-label="Experiment status" style={cardStyle}>
      <Eyebrow dot={s.dot}>{skill} · {s.label}</Eyebrow>
      <p style={{ margin: '0.5rem 0 1rem', fontSize: '1rem', lineHeight: 1.55, letterSpacing: '-0.003em', color: FG }}>
        {note ?? 'A sandbox experiment, not shipped to the app yet.'}
      </p>
      <div>
        <dl style={metaGridStyle}>
          <Fact label="lives in">Explore, not the app</Fact>
          {target && <Fact label="ships to"><Mono>{target}</Mono></Fact>}
        </dl>
      </div>
    </aside>
  );
}
