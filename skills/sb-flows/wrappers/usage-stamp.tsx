/**
 * usage-stamp — the shared visual + data "stamp" for the usage surfaces.
 *
 * The Usage explorer (standalone audit page) and the per-component "Where it's used" block (on each
 * component's Docs page) render the SAME thing — a header, relation lanes, clickable chips with story
 * coverage, the solid/dashed legend — over the SAME store (`component-pages.json`). This module owns
 * those primitives so both import one stamp instead of duplicating it. Edit the look here once.
 *
 * Reads `.storybook/component-pages.json` (build-component-pages.py) for the token⇄component⇄page graph
 * and `project-inventory.json` (tokens.map) for token swatch values. Storybook-only — never app code.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Icon } from './icons'
import { isTransparent, resolvePaint } from './resolve-paint'

/**
 * A color swatch that resolves bare-channel tokens. `value` is usually `var(--accent)`;
 * withOklch / shadcn-HSL themes hold raw channels (`0.95 0.001 234`) that aren't a valid
 * color unwrapped, so the raw var renders transparent. resolvePaint retries oklch()/hsl()
 * (see resolve-paint.ts), leaving the element painted with the wrapper that resolves.
 */
function Swatch({ value, size = 9, radius = 2 }: { value: string; size?: number; radius?: number }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!isTransparent(getComputedStyle(el).backgroundColor)) return
    // Only retry a `var(--token)` value — a literal (oklch()/hex) that reads transparent is a
    // genuine transparent, not a bare-channel token to re-wrap.
    if (/^var\(\s*--[a-z0-9-]+\s*\)\s*$/i.test(value)) resolvePaint(el, value)
  }, [value])
  return <span ref={ref} style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, border: `1px solid ${line}`, background: value }} />
}

export const ink = 'var(--color-foreground, oklch(0.30 0.03 155))'
export const dim = 'var(--color-muted-foreground, oklch(0.48 0.022 155))'
export const line = 'var(--color-border-subtle, oklch(0.905 0.008 155))'
export const surface = 'var(--color-surface, oklch(0.99 0.003 155))'
export const brand = 'var(--color-brand-500, var(--color-primary, oklch(0.55 0.16 250)))'
export const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
export const dashed = `color-mix(in oklab, ${dim} 40%, transparent)`

export interface PageRef { path: string; title: string; role?: string | null }
export interface CompEntry { callSites: number; props: number; parents: string[]; children: string[]; pages: PageRef[]; tokens?: string[]; isPage?: boolean; route?: string | null }
export interface TokenEntry { category?: string | null; count: number; components: string[]; pages: PageRef[] }
export interface Report { generatedAt?: string; components?: Record<string, CompEntry>; tokens?: Record<string, TokenEntry> }

const cpGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<Report>('../../.storybook/component-pages.json', { eager: true })
export const REPORT: Report = Object.values(cpGlob)[0] ?? {}

interface InvDoc { tokens?: { map?: { token: string; value?: string; category?: string; status?: string; mapsTo?: string; count?: number; source?: string }[] } }
const invGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<InvDoc>('../../.storybook/project-inventory.json', { eager: true })
export const TOKEN_META: Record<string, { value?: string; category?: string; status?: string; mapsTo?: string; source?: string }> = {}
for (const r of Object.values(invGlob)[0]?.tokens?.map ?? []) TOKEN_META[r.token] = r

export const isColor = (tok: string) => (TOKEN_META[tok]?.category ?? (tok.includes('color') ? 'color' : '')) === 'color'
// A Tailwind-DEFAULT type utility (text-sm, font-medium…) surfaced from real className usage — it has no
// `--token` declaration, so it's applied as a class, not resolved off :root. Detected by source, with a
// fallback for any token that isn't a custom property.
export const isUtility = (tok: string) => TOKEN_META[tok]?.source === 'tailwind-default' || !tok.startsWith('--')
export const isShadow = (tok: string) => /shadow/.test(tok)
export type TokenKind = 'color' | 'shadow' | 'scalar'
export const tokenKind = (tok: string): TokenKind => (isColor(tok) ? 'color' : isShadow(tok) ? 'shadow' : 'scalar')
// Display category. The inventory lumps shadows under 'scale'; tag them 'shadow' so the eyebrow reads true.
export const tokenCategory = (tok: string): string =>
  isShadow(tok) ? 'shadow' : (TOKEN_META[tok]?.category || (isColor(tok) ? 'color' : 'scalar'))
export const stripTok = (t: string) => t.replace(/^--/, '').replace(/^color-/, '')
export const stripPage = (t: string) => t.replace(/^Pages\//, '')

// project-inventory.json carries NO resolved token values, so read them LIVE: the computed value of each
// custom property off the themed <html> (preview.tsx toggles `.dark` there). A MutationObserver re-reads
// on theme flip so colors/shadows show their ACTIVE value. Works for every category — color, shadow,
// spacing, radius, duration, font — since it just reads the property's computed string.
export function useTokenValues(tokens: string[]): Record<string, string> {
  const [vals, setVals] = useState<Record<string, string>>({})
  const key = tokens.join(',')
  useEffect(() => {
    if (typeof document === 'undefined' || !tokens.length) return
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      const next: Record<string, string> = {}
      for (const t of tokens) next[t] = cs.getPropertyValue(t).trim()
      setVals(next)
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return vals
}

// The visual preview for a token: a color swatch, a box wearing the shadow, or nothing for a scalar
// (its value text carries the meaning). One stamp so the list and detail preview identically.
export function TokenPreview({ token, size = 13 }: { token: string; size?: number }): ReactElement | null {
  const kind = tokenKind(token)
  if (kind === 'color') {
    // Swatch resolves bare-channel tokens (withOklch / shadcn-HSL) that `var()` alone can't paint.
    return <Swatch value={`var(${token})`} size={size} radius={3} />
  }
  if (kind === 'shadow') {
    return <span style={{ width: size + 5, height: size, borderRadius: 3, flexShrink: 0, background: surface, border: `1px solid ${line}`, boxShadow: `var(${token})` }} />
  }
  return null
}

// One related entity. When it HAS a story, the WHOLE chip opens it (label + ↗ are one click target — not
// just the arrow), so a click lands you on the render view. When it has none — a token (no story ever) or a
// not-yet-documented component/page — the whole chip instead walks the usage graph via `onClick`. Coverage
// stays legible: solid chip + brand ↗ = has a story; dashed, muted chip = the gap the audit surfaces.
export function Chip({ label, onClick, href, dot, swatch, linkable }: { label: string; onClick?: () => void; href?: string | null; dot?: boolean; swatch?: string; linkable?: boolean }): ReactElement {
  const uncovered = linkable && !href
  const marker = swatch ? <Swatch value={swatch} /> : dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: brand, flexShrink: 0 }} /> : null
  const shell: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '2px 8px',
    fontFamily: mono, fontSize: 10.5, whiteSpace: 'nowrap', textDecoration: 'none',
    border: `1px ${uncovered ? 'dashed' : 'solid'} ${uncovered ? dashed : line}`,
    background: uncovered ? 'transparent' : 'color-mix(in oklab, currentColor 3%, transparent)',
    color: uncovered ? dim : ink,
  }

  // Has a story → the entire chip is the link. Click anywhere on the pill to open the render view.
  if (href) {
    return (
      <a href={href} target="_top" title="open story" style={{ ...shell, cursor: 'pointer' }}>
        {marker}
        {label}
        <Icon.external size={11} style={{ color: brand, marginLeft: 1 }} />
      </a>
    )
  }

  // No story → the whole chip walks the usage graph (or is inert when there's nowhere to go).
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      title={uncovered ? 'no story yet — click to see where it’s used' : undefined}
      style={{ ...shell, cursor: onClick ? 'pointer' : 'default' }}>
      {marker}
      {label}
    </button>
  )
}

// `covered` (when set) shows story coverage for a story-able lane: "12" total + "3 / 12 with a story".
export function Lane({ label, count, covered, children }: { label: string; count?: number; covered?: number; children: ReactNode }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderTop: `1px solid ${line}` }}>
      <div style={{ flex: '0 0 108px' }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: dim, opacity: 0.75 }}>{label}{count != null ? ` ${count}` : ''}</div>
        {covered != null && count ? (
          <div style={{ fontSize: 10, color: covered ? brand : dim, marginTop: 3 }} title="components/pages that have a Storybook story">
            {covered} / {count} with a story
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function Header({ eyebrow, title, meta, swatch }: { eyebrow: string; title: string; meta?: string; swatch?: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      {swatch && <Swatch value={swatch} size={34} radius={7} />}
      <div>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: dim }}>{eyebrow}</div>
        <h2 style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: ink, margin: '2px 0 0', wordBreak: 'break-all' }}>{title}</h2>
        {meta && <div style={{ fontSize: 11, color: dim, marginTop: 2 }}>{meta}</div>}
      </div>
    </div>
  )
}

export const Muted = ({ children }: { children: ReactNode }): ReactElement => <span style={{ fontSize: 11, color: dim, fontStyle: 'italic', opacity: 0.7 }}>{children}</span>

// Self-explains the coverage convention so the solid/dashed split needs no caption elsewhere.
export function Legend(): ReactElement {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 14, paddingTop: 10, borderTop: `1px solid ${line}`, fontFamily: mono, fontSize: 10, color: dim }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: `1px solid ${line}`, padding: '0 6px', color: ink, background: 'color-mix(in oklab, currentColor 3%, transparent)' }}>Name <span style={{ display: 'inline-flex', color: brand }}><Icon.external size={10} /></span></span>
        has a story — click to open it
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ borderRadius: 999, border: `1px dashed ${dashed}`, padding: '0 6px', color: dim }}>Name</span>
        no story yet
      </span>
    </div>
  )
}

export const card: CSSProperties = { border: `1px solid ${line}`, borderRadius: 12, background: surface, padding: '16px 18px' }
