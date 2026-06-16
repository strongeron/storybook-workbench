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
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Icon } from './icons'

export const ink = 'var(--color-foreground, oklch(0.30 0.03 155))'
export const dim = 'var(--color-muted-foreground, oklch(0.48 0.022 155))'
export const line = 'var(--color-border-subtle, oklch(0.905 0.008 155))'
export const surface = 'var(--color-surface, oklch(0.99 0.003 155))'
export const brand = 'var(--color-brand-500, var(--color-primary, oklch(0.55 0.16 250)))'
export const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
export const dashed = `color-mix(in oklab, ${dim} 40%, transparent)`

export interface PageRef { path: string; title: string; role?: string | null }
export interface CompEntry { callSites: number; props: number; parents: string[]; children: string[]; pages: PageRef[]; tokens?: string[] }
export interface TokenEntry { category?: string | null; count: number; components: string[]; pages: PageRef[] }
export interface Report { generatedAt?: string; components?: Record<string, CompEntry>; tokens?: Record<string, TokenEntry> }

const cpGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<Report>('../../.storybook/component-pages.json', { eager: true })
export const REPORT: Report = Object.values(cpGlob)[0] ?? {}

interface InvDoc { tokens?: { map?: { token: string; value?: string; category?: string; status?: string; mapsTo?: string; count?: number }[] } }
const invGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<InvDoc>('../../.storybook/project-inventory.json', { eager: true })
export const TOKEN_META: Record<string, { value?: string; category?: string; status?: string; mapsTo?: string }> = {}
for (const r of Object.values(invGlob)[0]?.tokens?.map ?? []) TOKEN_META[r.token] = r

export const isColor = (tok: string) => (TOKEN_META[tok]?.category ?? (tok.includes('color') ? 'color' : '')) === 'color'
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
    return <span style={{ width: size, height: size, borderRadius: 3, flexShrink: 0, border: `1px solid ${line}`, background: `var(${token})` }} />
  }
  if (kind === 'shadow') {
    return <span style={{ width: size + 5, height: size, borderRadius: 3, flexShrink: 0, background: surface, border: `1px solid ${line}`, boxShadow: `var(${token})` }} />
  }
  return null
}

// One related entity — clickable to navigate the graph. For a STORY-ABLE entity (a component or page),
// coverage is the whole point: a solid chip with a brand ↗ = it has a story; a dashed, muted chip = it
// has none yet (the gap the audit surfaces). `linkable` marks those; tokens (no story) render plain.
export function Chip({ label, onClick, href, dot, swatch, linkable }: { label: string; onClick?: () => void; href?: string | null; dot?: boolean; swatch?: string; linkable?: boolean }): ReactElement {
  const uncovered = linkable && !href
  return (
    <span title={uncovered ? 'no story yet' : undefined}
      style={{ display: 'inline-flex', alignItems: 'stretch', borderRadius: 999, overflow: 'hidden',
        border: `1px ${uncovered ? 'dashed' : 'solid'} ${uncovered ? dashed : line}`,
        background: uncovered ? 'transparent' : 'color-mix(in oklab, currentColor 3%, transparent)' }}>
      <button type="button" onClick={onClick} disabled={!onClick}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', border: 0, background: 'none', cursor: onClick ? 'pointer' : 'default', fontFamily: mono, fontSize: 10.5, color: uncovered ? dim : ink, whiteSpace: 'nowrap' }}>
        {swatch ? <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, border: `1px solid ${line}`, background: swatch }} /> : dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: brand, flexShrink: 0 }} /> : null}
        {label}
      </button>
      {href && (
        <a href={href} target="_top" title="open story"
          style={{ display: 'inline-flex', alignItems: 'center', padding: '0 7px', color: brand, textDecoration: 'none', borderLeft: `1px solid ${line}` }}>
          <Icon.external size={11} />
        </a>
      )}
    </span>
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
      {swatch && <span style={{ width: 34, height: 34, borderRadius: 7, flexShrink: 0, border: `1px solid ${line}`, background: swatch }} />}
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
