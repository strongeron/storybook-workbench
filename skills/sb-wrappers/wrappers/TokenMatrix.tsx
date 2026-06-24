/**
 * TokenMatrix — the semantic-token audit table on one canvas.
 *
 * For every role-named token it shows: the token + role, its resolved value in
 * BOTH theme modes (light + dark, read live), real adoption (reference count),
 * and health. Health is sb-health's REAL findings only (raw color, undefined token,
 * scale gap, contrast — from design-system-health.json); used-vs-unused is NOT
 * shown here because the Adoption column already carries it. `unused-token` findings
 * are dropped (duplicate of Adoption 0, and a false positive when uses > 0).
 *
 * How modes are read: hidden probes render `background: var(--token)` both outside
 * and inside a `.dark` container; getComputedStyle reads each resolved value. The
 * app must load its theme CSS in the Storybook preview (it does, via index.css).
 *
 * Style is self-contained (mono chrome, neutral hairlines, theme-tinted via token
 * fallbacks) so the wrapper matches the Foundations language without importing app
 * or story code. Adoption (`uses` + `usedIn`) is supplied by the story.
 *
 * Storybook-only — never imported from app code.
 */
import type { CSSProperties, ReactElement } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { ReportIntro } from './ReportIntro'
import { resolvePaint } from './resolve-paint'
import { UsageDetail, resolveUsage, usageSummary } from './usage-index'

const ink = 'var(--color-foreground, oklch(0.30 0.03 155))'
const dim = 'var(--color-muted-foreground, oklch(0.48 0.022 155))'
const line = 'var(--color-border-subtle, oklch(0.905 0.008 155))'
const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

// The `--token` name as a click-to-copy button (copies `--token`) + copy icon + brief feedback.
function TokenName({ token }: { token: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const text = `--${token}`
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  return (
    <button type="button" onClick={copy} title={`Copy ${text}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer', fontFamily: mono, fontSize: 12, fontWeight: 700, color: ink }}>
      <code style={{ fontFamily: mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</code>
      <span style={{ display: 'inline-flex', color: copied ? 'var(--color-success, oklch(0.6 0.16 150))' : dim }}>
        {copied ? '✓' : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  )
}
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

// ── sb-health feed — single source of truth for issues ─────────────────────────
// Read validate-design-system.sh output, the same JSON the DesignSystemHealth
// wrapper renders, so the Health column never drifts and picks up new rules.
interface HealthFinding {
  kind: string
  severity: 'error' | 'warning' | 'info'
  file?: string | null
  line?: number | null
  message?: string
}
interface HealthReport {
  findings: HealthFinding[]
  summary?: { total: number; errors: number; warnings: number; info: number; checksRun?: string[] }
  ranBy?: string
  generatedAt?: string
}
const healthGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<HealthReport>('../../.storybook/design-system-health.json', { eager: true })
const HEALTH: HealthReport | null = Object.values(healthGlob)[0] ?? null

// Attribute findings to a token by the `--token` names in their message — generic,
// so future per-token finding kinds attach automatically.
const HEALTH_BY_TOKEN: Record<string, HealthFinding[]> = {}
if (HEALTH) {
  for (const f of HEALTH.findings) {
    const names = new Set((f.message ?? '').match(/--[a-z0-9-]+/gi)?.map((s) => s.slice(2)) ?? [])
    for (const n of names) (HEALTH_BY_TOKEN[n] ??= []).push(f)
  }
}

// ── sb-figma parity feed (optional) — design↔code token drift from build-token-parity.mjs ──────
// The same figma-token-parity.json the foundation stories read: per token, the Figma variable it maps to,
// both resolved values, and whether they DRIFT. Surfaced in THIS table (opt-in via `figmaParity`) so the
// design↔code answer lives next to the token, not only in docs/figma-token-parity.md (session ask: "can we
// have parity into the color wrapper to show all in one place?"). Keyed without `--` to match flagsFor.
interface ParityEntry { figmaVar?: string; figmaHex?: string; codeHex?: string; mapsTo?: string; drift?: boolean }
interface ParityReport { color?: Record<string, ParityEntry>; spacing?: Record<string, ParityEntry>; type?: Record<string, ParityEntry>; appOnly?: string[]; figmaOnly?: string[] }
const parityGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<ParityReport>('../../.storybook/figma-token-parity.json', { eager: true })
const PARITY: ParityReport | null = Object.values(parityGlob)[0] ?? null
const PARITY_BY_TOKEN: Record<string, ParityEntry> = {}
if (PARITY) for (const section of [PARITY.color, PARITY.spacing, PARITY.type]) {
  for (const [tok, e] of Object.entries(section ?? {})) PARITY_BY_TOKEN[tok.replace(/^--/, '')] = e
}
const KIND_LABEL: Record<string, string> = {
  'unused-token': 'unused', 'raw-color': 'raw color', 'undefined-token': 'undefined',
  'scale-gap': 'scale gap', 'naming-drift': 'naming drift',
}

export interface TokenMatrixRow {
  /** token name without the leading `--`, e.g. "color-foreground" */
  token: string
  /** human role, e.g. "Primary text" */
  role?: string
  /** Tailwind utilities that map to this token (used by the story's usage scan) */
  utilities?: string[]
  /** live reference count (utilities + var()) — story computes via tokenUsage */
  uses?: number
  /** files (relative to src/) that reference the token — shown on hover */
  usedIn?: string[]
  /** for a semantic role: the primitive palette step it resolves to (declared or value-matched) */
  mapsTo?: string
  /** true when mapsTo was value-matched (a guess), false/absent when declared via var() */
  mapsToInferred?: boolean
  /** a flat color that is NOT a palette step — a one-off the audit should surface */
  rawColor?: boolean
  /** for a primitive: the role tokens that resolve to it (the reverse of mapsTo) */
  usedBy?: string[]
  /** the published Figma variable this token mirrors, e.g. "semantic/accent" — shown on a
   *  dedicated `figma` line so design↔code parity reads as a name, not just a hex. */
  figmaVar?: string
  /** the Figma variable's published value, e.g. "#eeeeef" — appended after `figmaVar`. */
  figmaHex?: string
}
export interface TokenMatrixGroup {
  title: string
  rows: TokenMatrixRow[]
}
export interface TokenMatrixProps {
  groups: TokenMatrixGroup[]
  eyebrow?: string
  title?: string
  /** ISO timestamp from design-system-health.json, shown in the orientation banner. */
  generatedAt?: string
  /** suppress the top "what is this / where from" banner (e.g. when embedded under another report). */
  hideIntro?: boolean
  /** Storybook story id of the UsageExplorer (e.g. "skill-audit--usage"). When set, each row's expanded
   *  usage gains a "see all →" deep link that opens the explorer focused on that token. */
  usageExplorerStoryId?: string
  /** show the per-token Health column + health summary. OFF by default — health has a dedicated home
   *  (Foundations/Health → DesignSystemHealth), and per-token health duplicates the Adoption column. */
  health?: boolean
  /** surface Figma↔code token parity (drift) in the issue column, from figma-token-parity.json
   *  (sb-figma's build-token-parity.mjs). OFF by default. Shares the column with `health`. */
  figmaParity?: boolean
}

type ValueMap = Record<string, string>

const tableWrap: CSSProperties = {
  // No overflow clip: an overflow container would trap `position: sticky` on the header, so the
  // column header can stay pinned to the viewport top while scanning a long section.
  border: `1px solid ${line}`,
  borderRadius: 10,
  background: 'var(--color-surface, oklch(0.993 0.003 155))',
}
const tableBase: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  tableLayout: 'fixed',
}
const thBase: CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: dim,
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: `1px solid ${line}`,
  background: 'var(--color-surface, oklch(0.975 0.006 155))',
  whiteSpace: 'nowrap',
  // Pin the column header to the viewport top so it stays visible while scanning a long table.
  position: 'sticky',
  top: 0,
  zIndex: 2,
}
const tdBase: CSSProperties = {
  padding: '10px 12px',
  borderBottom: `1px solid ${line}`,
  // Top-align so the swatch + value read next to the token name, not floating mid-row against the
  // taller token cell (token + maps-to + utility).
  verticalAlign: 'top',
}
const codeValue: CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  color: dim,
  whiteSpace: 'nowrap',
}

// Swatch + value. The value label uses ONE consistent text style (no per-state
// color fill) — the swatch itself carries the color, so the rgb text stays neutral.
function ColorValue({ token, value, mode }: { token: string; value?: string; mode: 'light' | 'dark' }): ReactElement {
  const empty = !value || value === TRANSPARENT
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span
        className={mode === 'dark' ? 'dark' : undefined}
        title={`${mode}: ${empty ? 'not emitted' : value}`}
        style={{
          display: 'block',
          width: 34,
          height: 24,
          borderRadius: 6,
          border: `1px solid ${line}`,
          flexShrink: 0,
          overflow: 'hidden',
          backgroundImage:
            'linear-gradient(45deg,#00000012 25%,transparent 25%,transparent 75%,#00000012 75%),linear-gradient(45deg,#00000012 25%,transparent 25%,transparent 75%,#00000012 75%)',
          backgroundSize: '10px 10px',
          backgroundPosition: '0 0, 5px 5px',
        }}
      >
        {/* Paint the RESOLVED color (from the probe), not `var(--token)` — bare-channel
            tokens aren't valid colors unwrapped, so the raw var would render transparent. */}
        <span style={{ display: 'block', width: '100%', height: '100%', background: empty ? 'transparent' : value }} />
      </span>
      <code style={{ ...codeValue, overflow: 'hidden', textOverflow: 'ellipsis' }}>{empty ? 'not emitted' : value}</code>
    </div>
  )
}

// One labeled relation line under the token name: a dim fixed-width label so the values align,
// and the value in normal weight. Keeps the three stacked facts (token / maps-to / utility) legible.
const relRow: CSSProperties = { fontFamily: mono, fontSize: 10.5, color: dim, display: 'block', marginTop: 3 }
// Wide enough that the longest label ("raw color") still clears its value with a gap, and every
// value aligns in one column. paddingRight guarantees the gap even if a label ever exceeds minWidth.
const relLabel: CSSProperties = { display: 'inline-block', minWidth: 60, paddingRight: 8, opacity: 0.5 }
const strip = (t: string) => t.replace(/^--/, '').replace(/^color-/, '')

function TokenCell({ row }: { row: TokenMatrixRow }): ReactElement {
  // The relations, all from code: the primitive a role resolves to (→, ~ when inferred by value-match),
  // a flat color that isn't a palette step (raw color), the reverse on primitives (← which roles use it),
  // and the Tailwind utility the app consumes it through. `role` is a fallback when no utilities.
  const mapsTo = row.mapsTo ? strip(row.mapsTo) : undefined
  const usedBy = (row.usedBy ?? []).map(strip)
  const utils = (row.utilities ?? []).filter(Boolean)
  // A heavily-used token resolves to many utilities (bg-/text-/border-/…); show a couple + a count
  // so the cell stays scannable. Empty for a var()-only project — then `role` (if any) shows instead.
  const utilText = utils.length > 2 ? `${utils.slice(0, 2).join(' · ')} +${utils.length - 2}` : utils.join(' · ')
  const secondary = utils.length > 0
    ? { label: utils.length > 1 ? 'utils' : 'utility', text: utilText }
    : row.role ? { label: 'role', text: row.role } : null
  return (
    <div style={{ minWidth: 0 }}>
      <TokenName token={row.token} />
      {mapsTo && (
        <span style={relRow} title={row.mapsToInferred ? 'inferred by value-match, not a declared var() chain' : 'declared parent'}>
          <span style={relLabel}>maps to</span><span style={{ opacity: 0.6 }}>→ </span>{row.mapsToInferred ? '~' : ''}{mapsTo}
        </span>
      )}
      {!mapsTo && row.rawColor && (
        <span style={relRow} title="a flat color that is not one of the palette scale steps">
          <span style={relLabel}>raw color</span><span style={{ opacity: 0.7 }}>not in palette</span>
        </span>
      )}
      {usedBy.length > 0 && (
        <span style={relRow}>
          <span style={relLabel}>used by</span><span style={{ opacity: 0.6 }}>← </span>{usedBy.join(' · ')}
        </span>
      )}
      {secondary && (
        <span style={relRow}>
          <span style={relLabel}>{secondary.label}</span>{secondary.text}
        </span>
      )}
      {row.figmaVar && (
        <span style={relRow} title="published Figma variable — name · value">
          <span style={relLabel}>figma</span>{row.figmaVar}{row.figmaHex ? <span style={{ opacity: 0.6 }}> · {row.figmaHex}</span> : null}
        </span>
      )}
    </div>
  )
}

// ── Health (issue) model — aligned to sb-health finding kinds ──────────────────
const RED = 'oklch(0.55 0.16 25)'
const AMBER = 'oklch(0.58 0.12 75)'
const GREEN = 'oklch(0.55 0.10 155)'

type Severity = 'error' | 'warning' | 'info'
interface Flag {
  label: string
  severity: Severity
  kind?: string
  /** explicit tooltip (e.g. a figma-drift flag spells out "code #X vs figma #Y"). */
  title?: string
}
const SEV_COLOR: Record<Severity, string> = { error: RED, warning: AMBER, info: dim }
const SBHEALTH_KINDS = new Set(['raw-color', 'unused-token', 'undefined-token', 'scale-gap'])

function HealthCell({ flags }: { flags: Flag[] }): ReactElement {
  if (!flags.length) {
    // No design-system finding. Usage lives in the Adoption column, so don't echo "in use" here.
    return <span style={{ fontFamily: mono, fontSize: 11, color: line }} title="no design-system findings">—</span>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {flags.map((f) => (
        <span
          key={f.label}
          title={
            f.title
              ?? (f.kind === 'unused'
                ? 'live scan: 0 references (utilities + var()) across real pages/components; sb-health did not flag it'
                : f.kind
                  ? SBHEALTH_KINDS.has(f.kind) ? `sb-health: ${f.kind}` : f.kind
                  : undefined)
          }
          style={{
            fontFamily: mono,
            fontSize: 10,
            color: SEV_COLOR[f.severity],
            border: `1px solid ${SEV_COLOR[f.severity]}`,
            borderRadius: 6,
            padding: '1px 6px',
            whiteSpace: 'nowrap',
            background: 'color-mix(in oklch, currentColor 8%, transparent)',
          }}
        >
          {f.label}
        </span>
      ))}
    </div>
  )
}

// Adoption = the real number of usage sites. The file list stays on hover only
// (title), so the cell is a clean number, not a wall of chips.
function UsageCell({ uses, usedIn, expanded, onToggle }: { uses: number; usedIn?: string[]; expanded: boolean; onToggle: () => void }): ReactElement {
  if (uses === 0) {
    return <span style={{ fontFamily: mono, fontSize: 11, color: line }}>0</span>
  }
  const files = usedIn ?? []
  // Resolve raw paths to the components/pages that consume the token, so the toggle reads
  // "6 components · 5 pages" — names you recognize — and falls back to a file count when nothing resolves.
  const summary = files.length ? (usageSummary(resolveUsage(files)) || `${files.length} file${files.length === 1 ? '' : 's'}`) : ''
  return (
    <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>
      <span style={{ color: ink, fontWeight: 700 }}>{uses}</span> uses
      {summary ? (
        <> · <button type="button" onClick={onToggle} title={expanded ? 'Hide where it is used' : 'Show where it is used'}
          style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', fontFamily: mono, fontSize: 11, color: dim, textAlign: 'left' }}>
          {expanded ? '▾' : '▸'} {summary}
        </button></>
      ) : null}
    </span>
  )
}

export function TokenMatrix({ groups, eyebrow, title, generatedAt, hideIntro, usageExplorerStoryId, health = false, figmaParity = false }: TokenMatrixProps): ReactElement {
  // The issue column shows when EITHER feed is on; flagsFor merges both. Parity drift reads in the same
  // place as health findings, so the design↔code answer sits next to the token.
  const showIssues = health || figmaParity
  const root = useRef<HTMLDivElement>(null)
  const [light, setLight] = useState<ValueMap>({})
  const [dark, setDark] = useState<ValueMap>({})
  // tokens whose "N files" disclosure is expanded — the using files then show inline (at table level).
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set())
  const toggleFiles = (t: string) => setOpenFiles((prev) => {
    const next = new Set(prev)
    if (next.has(t)) next.delete(t); else next.add(t)
    return next
  })

  useEffect(() => {
    if (!root.current) return
    const read = (sel: string): ValueMap => {
      const out: ValueMap = {}
      root.current!.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const t = el.getAttribute('data-token')
        if (!t) return
        // resolvePaint paints + retries bare-channel oklch()/hsl() tokens (see resolve-paint.ts);
        // restore=true repaints the plain probe so the SAME element re-reads clean in the other mode.
        out[t] = resolvePaint(el, t, true)
      })
      return out
    }
    // Light probes live outside a local `.dark`, but the GLOBAL theme toolbar may
    // put `.dark` on <html> — strip it for the (synchronous) light read, then restore.
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    if (wasDark) html.classList.remove('dark')
    const semL = read('[data-sem-light]')
    if (wasDark) html.classList.add('dark')
    const semD = read('[data-sem-dark]') // local `.dark` container → dark either way
    setLight(semL)
    setDark(semD)
  }, [])

  const allTokens = groups.flatMap((g) => g.rows.map((r) => r.token))
  const usesByToken: Record<string, number> = {}
  for (const g of groups) for (const r of g.rows) usesByToken[r.token] = r.uses ?? 0

  const head: CSSProperties = {
    fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dim,
  }

  // Per-token issues = REAL sb-health findings only (raw color, undefined token, scale gap, contrast,
  // naming drift). Used-vs-unused is deliberately NOT shown here — the Adoption column already says it
  // ("633 uses…" vs "0"), so echoing "in use"/"unused" in Health is pure duplication. We therefore drop
  // every `unused-token` finding: when uses>0 it's a false positive (the grep scanner can't see Tailwind
  // @theme-inline utilities), and when uses===0 the Adoption "0" already carries it.
  const flagsFor = (token: string): Flag[] => {
    const flags: Flag[] = (HEALTH_BY_TOKEN[token] ?? [])
      .filter((f) => f.kind !== 'unused-token')
      .map((f) => ({ label: KIND_LABEL[f.kind] ?? f.kind, severity: f.severity as Severity, kind: f.kind }))
    // Figma parity drift (opt-in) reads as one more finding, with the two values spelled out on hover.
    const p = figmaParity ? PARITY_BY_TOKEN[token] : undefined
    if (p?.drift) flags.push({ label: 'figma Δ', severity: 'warning', kind: 'figma-drift', title: `figma drift: code ${p.codeHex ?? '?'} vs figma ${p.figmaHex ?? '?'}${p.figmaVar ? ` (${p.figmaVar})` : ''}` })
    return flags
  }

  // Summary — real findings only, so it agrees with the rows.
  const flaggedTokens = allTokens.filter((t) => flagsFor(t).length > 0).length
  const healthyTokens = allTokens.length - flaggedTokens
  const sysCounts: Record<string, number> = {}
  // Exclude unused-token from the system-wide rollup too, so the summary agrees with the column
  // (used-vs-unused is an Adoption concern, not a Health one). Full breakdown lives in Foundations/Health.
  if (HEALTH) for (const f of HEALTH.findings) if (f.kind !== 'unused-token') sysCounts[f.kind] = (sysCounts[f.kind] ?? 0) + 1

  return (
    <div ref={root}>
      {!hideIntro && (
        <ReportIntro
          what={health
            ? "Every color token on one canvas — semantic roles and the primitive scales they resolve to (→). Each row shows its value in light and dark, the palette step it maps to, how many places reference it (Adoption), and any real design-system finding (Health: raw color, undefined token, scale gap, contrast)."
            : "Every color token on one canvas — semantic roles and the primitive scales they resolve to (→). Each row shows its value in light and dark, the palette step it maps to, and how many places reference it (Adoption: components + pages). Design-system health lives in Foundations/Health, not duplicated here."}
          source={{ file: 'project-inventory.json', skill: 'sb-inventory' }}
          pipeline={[
            { skill: 'sb-inventory', role: 'tokens · usage · mapping' },
            { skill: 'sb-health', role: 'the health column' },
            { skill: 'sb-wrappers', role: 'this view' },
          ]}
          refresh="refresh-usage.sh"
          generatedAt={generatedAt}
        />
      )}
      {/* hidden probes — resolve every token's value in each mode once */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        {allTokens.map((t) => <div key={`sl-${t}`} data-sem-light data-token={t} style={{ background: `var(--${t})` }} />)}
        <div className="dark">
          {allTokens.map((t) => <div key={`sd-${t}`} data-sem-dark data-token={t} style={{ background: `var(--${t})` }} />)}
        </div>
      </div>

      {(eyebrow != null || title != null) && (
        <header style={{ marginBottom: 22 }}>
          {eyebrow && <div style={{ ...head, fontSize: 10.5, letterSpacing: '0.12em' }}>{eyebrow}</div>}
          {title && <h1 style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: ink, margin: '4px 0 0' }}>{title}</h1>}
        </header>
      )}

      <div style={{ margin: '0 0 18px', padding: '10px 14px', border: `1px solid ${line}`, borderRadius: 10, background: 'var(--color-surface, oklch(0.975 0.006 155))', fontFamily: mono, fontSize: 11.5 }}>
        {!health ? (
          // Adoption-focused summary. Health has its own home (Foundations/Health) — not duplicated here.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
            <b style={{ color: ink }}>{allTokens.length} color tokens</b>
            <span style={{ color: dim }}>{allTokens.filter((t) => (usesByToken[t] ?? 0) > 0).length} referenced</span>
            <span style={{ color: dim }}>{allTokens.filter((t) => (usesByToken[t] ?? 0) === 0).length} unused</span>
            <span style={{ color: line }}>|</span>
            <span style={{ color: dim }}>design-system health → Foundations/Health</span>
          </div>
        ) : HEALTH ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
            <b style={{ color: ink }}>{allTokens.length} color tokens</b>
            <span style={{ color: GREEN }}>{healthyTokens} clear</span>
            <span style={{ color: flaggedTokens ? AMBER : dim }}>{flaggedTokens} flagged (sb-health)</span>
            <span style={{ color: line }}>|</span>
            <span style={{ color: dim }}>system-wide:</span>
            {Object.entries(sysCounts).map(([kind, n]) => (
              <span key={kind} style={{ color: dim }}>{n} {KIND_LABEL[kind] ?? kind}</span>
            ))}
            <span style={{ color: dim }}>· full report → Foundations/Health</span>
          </div>
        ) : (
          <span style={{ color: RED }}>
            No sb-health report. Run <code>validate-design-system.sh</code> → <code>.storybook/design-system-health.json</code>.
          </span>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.title} style={{ marginBottom: 34 }}>
          <h2 style={{ ...head, fontSize: 12, margin: '0 0 6px' }}>{g.title}</h2>
          <div style={tableWrap}>
            <table style={tableBase}>
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '22%' }} />
                {showIssues && <col style={{ width: '14%' }} />}
              </colgroup>
              <thead>
                <tr>
                  <th style={thBase}>Token</th>
                  <th style={thBase}>Light value</th>
                  <th style={thBase}>Dark value</th>
                  <th style={thBase}>Adoption</th>
                  {showIssues && <th style={thBase}>{health && figmaParity ? 'Health · Figma' : health ? 'Health' : 'Figma'}</th>}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, index) => {
                  const uses = r.uses ?? 0
                  const last = index === g.rows.length - 1
                  const td = last ? { ...tdBase, borderBottom: 0 } : tdBase
                  // Issues are signalled by the Health badge only — no row tint, so
                  // a color grid keeps a neutral background and swatches read true.
                  const expanded = openFiles.has(r.token)
                  const files = r.usedIn ?? []
                  return (
                    <Fragment key={r.token}>
                      <tr>
                        <td style={td}><TokenCell row={r} /></td>
                        <td style={td}><ColorValue token={r.token} value={light[r.token]} mode="light" /></td>
                        <td style={td}><ColorValue token={r.token} value={dark[r.token]} mode="dark" /></td>
                        <td style={td}><UsageCell uses={uses} usedIn={r.usedIn} expanded={expanded} onToggle={() => toggleFiles(r.token)} /></td>
                        {showIssues && <td style={td}><HealthCell flags={flagsFor(r.token)} /></td>}
                      </tr>
                      {expanded && files.length > 0 && (
                        <tr>
                          <td colSpan={showIssues ? 5 : 4} style={{ ...td, paddingTop: 0 }}>
                            <div style={{ padding: '2px 0 8px' }}>
                              <UsageDetail files={files}
                                seeAllHref={usageExplorerStoryId ? `/?path=/story/${usageExplorerStoryId}&args=focus:--${r.token}` : undefined} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
