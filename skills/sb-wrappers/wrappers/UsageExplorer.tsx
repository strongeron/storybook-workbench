/**
 * UsageExplorer — the one "where is this used?" surface. Pick a token, a component, or a page and see its
 * FULL bidirectional context (no cap): a token → the components & pages that consume it; a component → the
 * tokens it uses, the pages it renders on, and its parents/children; a page → its components and the tokens
 * they pull in. Every related entity is a chip you can click to jump to it — so you walk the graph
 * (token → component → its other tokens → another component) without leaving the view.
 *
 * Reads ONE store: `.storybook/component-pages.json` (build-component-pages.py), which now carries both
 * directions — `tokens[<tok>] = {components[], pages[]}` and `components[<name>].tokens[]`. Token VALUES
 * are read live off the themed <html> (project-inventory has none) so colors/shadows/scalars show their
 * actual computed value + a preview, in the list and the detail. No re-scan, no join.
 *
 * Storybook-only — never imported from app code.
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { useStoryLinker } from './usage-index'
import {
  ink, dim, line, surface, brand, mono,
  type PageRef, type CompEntry, type TokenEntry,
  REPORT, TOKEN_META, isColor, stripTok, stripPage, tokenCategory,
  Chip, Lane, Header, Legend, Muted, card,
  useTokenValues, TokenPreview,
} from './usage-stamp'

type Kind = 'token' | 'component' | 'page'
interface Sel { kind: Kind; id: string }

// ── derived page index: path → {title, role, components, tokens} (page→tokens is derived here, not stored) ──
function buildPages(): Record<string, { title: string; role?: string | null; components: string[]; tokens: string[] }> {
  const m: Record<string, { title: string; role?: string | null; components: Set<string>; tokens: Set<string> }> = {}
  for (const [name, c] of Object.entries(REPORT.components ?? {})) {
    for (const p of c.pages ?? []) {
      const e = (m[p.path] ??= { title: p.title, role: p.role, components: new Set(), tokens: new Set() })
      e.components.add(name)
      for (const t of c.tokens ?? []) e.tokens.add(t)
    }
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { title: v.title, role: v.role, components: [...v.components].sort(), tokens: [...v.tokens].sort() }]))
}

export interface UsageExplorerProps {
  fillViewport?: boolean
  /** open focused on a specific entity (e.g. a TokenMatrix "see all →" link passes a token). */
  initialKind?: Kind
  initialId?: string
}

export function UsageExplorer({ fillViewport = true, initialKind, initialId }: UsageExplorerProps = {}): ReactElement {
  const tokens = REPORT.tokens ?? {}
  const components = REPORT.components ?? {}
  const pages = useMemo(buildPages, [])
  const linkFor = useStoryLinker()

  const tokenIds = useMemo(() => Object.keys(tokens).sort(), [tokens])
  const tokenValues = useTokenValues(tokenIds)
  const compIds = useMemo(() => Object.keys(components).sort((a, b) => (components[b].callSites ?? 0) - (components[a].callSites ?? 0)), [components])
  const pageIds = useMemo(() => Object.keys(pages).sort((a, b) => pages[b].components.length - pages[a].components.length), [pages])

  // A caller can deep-link to one entity; otherwise open on the first token.
  const initialSel: Sel | null = initialId
    ? { kind: initialKind ?? 'token', id: initialId }
    : tokenIds[0] ? { kind: 'token', id: tokenIds[0] } : null
  const [kind, setKind] = useState<Kind>(initialSel?.kind ?? 'token')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Sel | null>(initialSel)

  const go = (s: Sel) => { setKind(s.kind); setSel(s); setQ('') }

  const ids = kind === 'token' ? tokenIds : kind === 'component' ? compIds : pageIds
  const labelOf = (k: Kind, id: string) => (k === 'token' ? id.replace(/^--/, '') : k === 'page' ? stripPage(pages[id]?.title ?? id) : id)
  const filtered = q.trim() ? ids.filter((id) => labelOf(kind, id).toLowerCase().includes(q.toLowerCase())) : ids

  const empty = !tokenIds.length && !compIds.length
  return (
    <div style={{ background: 'var(--color-background)', color: ink, minHeight: fillViewport ? '100dvh' : undefined, fontFamily: mono, padding: '2rem 1.75rem 4rem' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <ReportIntro
          what="One place to answer 'where did I use this?'. Pick a token, component, or page and see its full context — what uses it and what it uses. Every related name is clickable, so you walk the graph (token → component → its other tokens) without leaving."
          source={{ file: 'component-pages.json', skill: 'sb-inventory' }}
          pipeline={[
            { skill: 'sb-inventory', role: 'tokens · component usage' },
            { skill: 'sb-flows', role: 'routes → the pages' },
            { skill: 'sb-wrappers', role: 'this explorer' },
          ]}
          refresh="refresh-usage.sh"
          generatedAt={REPORT.generatedAt}
        />
        {empty ? (
          <p style={{ color: dim, maxWidth: '64ch', lineHeight: 1.6 }}>
            No usage graph yet. Run <code>refresh-usage.sh</code> (or <code>build-component-pages.py</code> after the
            inventory/usage/flows extractors) — it writes <code>.storybook/component-pages.json</code> with the
            token⇄component⇄page edges this view reads.
          </p>
        ) : (
          <>
            <Tabs kind={kind} setKind={(k) => { setKind(k); setQ('') }} counts={{ token: tokenIds.length, component: compIds.length, page: pageIds.length }} />
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 14 }}>
              <div style={{ flex: '0 0 280px', minWidth: 240 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${kind}s…`}
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 8, border: `1px solid ${line}`, background: surface, color: ink, marginBottom: 8 }} />
                <List ids={filtered} kind={kind} sel={sel} labelOf={labelOf} onPick={(id) => setSel({ kind, id })} tokenValues={tokenValues} />
              </div>
              <div style={{ flex: '1 1 480px', minWidth: 320 }}>
                {sel ? <Detail sel={sel} components={components} tokens={tokens} pages={pages} go={go} linkFor={linkFor} /> : <Hint />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const tabBtn = (active: boolean): CSSProperties => ({
  fontFamily: mono, fontSize: 11.5, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${active ? brand : line}`, color: active ? ink : dim,
  background: active ? 'color-mix(in oklab, currentColor 6%, transparent)' : 'transparent', fontWeight: active ? 700 : 400,
})
function Tabs({ kind, setKind, counts }: { kind: Kind; setKind: (k: Kind) => void; counts: Record<Kind, number> }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {(['token', 'component', 'page'] as Kind[]).map((k) => (
        <button key={k} type="button" onClick={() => setKind(k)} style={tabBtn(k === kind)}>
          {k}s <span style={{ opacity: 0.6 }}>{counts[k]}</span>
        </button>
      ))}
    </div>
  )
}

function List({ ids, kind, sel, labelOf, onPick, tokenValues }: { ids: string[]; kind: Kind; sel: Sel | null; labelOf: (k: Kind, id: string) => string; onPick: (id: string) => void; tokenValues: Record<string, string> }): ReactElement {
  return (
    <div style={{ border: `1px solid ${line}`, borderRadius: 10, background: surface, maxHeight: '70vh', overflow: 'auto' }}>
      {ids.length === 0 ? <div style={{ padding: '10px 12px', color: dim, fontSize: 12 }}>no match</div> : ids.map((id) => {
        const active = sel?.kind === kind && sel.id === id
        const val = kind === 'token' ? tokenValues[id] : undefined
        return (
          <button key={id} type="button" onClick={() => onPick(id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 11px', border: 0, borderBottom: `1px solid ${line}`, cursor: 'pointer', fontFamily: mono, fontSize: 11.5, background: active ? 'color-mix(in oklab, currentColor 7%, transparent)' : 'transparent', color: active ? ink : dim, fontWeight: active ? 700 : 400 }}>
            {kind === 'token' && <TokenPreview token={id} size={13} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(kind, id)}</span>
            {val && <span title={val} style={{ marginLeft: 'auto', flexShrink: 0, maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: dim, opacity: 0.85 }}>{val}</span>}
          </button>
        )
      })}
    </div>
  )
}

const Hint = (): ReactElement => <div style={{ color: dim, fontSize: 12, padding: '8px 2px' }}>Pick something on the left.</div>

function Detail({ sel, components, tokens, pages, go, linkFor }: {
  sel: Sel; components: Record<string, CompEntry>; tokens: Record<string, TokenEntry>
  pages: Record<string, { title: string; role?: string | null; components: string[]; tokens: string[] }>
  go: (s: Sel) => void; linkFor: (name: string) => string | null
}): ReactElement {
  // live value of the selected token (project-inventory has none) — drives the value row + header.
  const liveVals = useTokenValues(sel.kind === 'token' ? [sel.id] : [])
  const tokenChip = (t: string) => <Chip key={t} label={stripTok(t)} onClick={() => go({ kind: 'token', id: t })} swatch={isColor(t) ? `var(${t})` : undefined} />
  const compChip = (n: string) => <Chip key={n} label={n} onClick={() => go({ kind: 'component', id: n })} href={linkFor(n)} linkable />
  const pageChip = (p: PageRef) => <Chip key={p.path} label={stripPage(p.title)} onClick={() => go({ kind: 'page', id: p.path })} href={linkFor(p.title)} dot linkable />
  const covComps = (names: string[]) => names.filter((n) => !!linkFor(n)).length
  const covPages = (ps: PageRef[]) => ps.filter((p) => !!linkFor(p.title)).length

  if (sel.kind === 'token') {
    const t = tokens[sel.id]
    const meta = TOKEN_META[sel.id]
    if (!t) return <div style={card}><Header eyebrow="token" title={sel.id} meta="not in the usage graph (0 references resolved)" /></div>
    const liveVal = liveVals[sel.id]
    return (
      <div style={card}>
        <Header eyebrow={`token · ${tokenCategory(sel.id)}`} title={sel.id}
          meta={`${t.count} references${meta?.mapsTo ? ` · maps to ${stripTok(meta.mapsTo)}` : ''}`}
          swatch={isColor(sel.id) ? `var(${sel.id})` : undefined} />
        {/* The token's actual computed value (+ preview), read live off the themed <html>. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${line}` }}>
          <div style={{ flex: '0 0 108px', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: dim, opacity: 0.75 }}>value</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <TokenPreview token={sel.id} size={18} />
            <code style={{ fontFamily: mono, fontSize: 12, color: ink, wordBreak: 'break-all' }}>{liveVal || <span style={{ color: dim, fontStyle: 'italic' }}>not resolved on :root</span>}</code>
          </div>
        </div>
        <Lane label="components" count={t.components.length} covered={covComps(t.components)}>{t.components.length ? t.components.map(compChip) : <Muted>none resolved</Muted>}</Lane>
        <Lane label="pages" count={t.pages.length} covered={covPages(t.pages)}>{t.pages.length ? t.pages.map(pageChip) : <Muted>none resolved</Muted>}</Lane>
        <Legend />
      </div>
    )
  }
  if (sel.kind === 'component') {
    const c = components[sel.id]
    if (!c) return <div style={card}><Header eyebrow="component" title={sel.id} meta="not in the graph" /></div>
    const toks = c.tokens ?? []
    return (
      <div style={card}>
        <Header eyebrow="component" title={sel.id} meta={`${c.callSites} call sites · ${c.props} props · ${linkFor(sel.id) ? 'has a story' : 'no story yet'}`} />
        <Lane label="tokens" count={toks.length}>{toks.length ? toks.map(tokenChip) : <Muted>none resolved</Muted>}</Lane>
        <Lane label="pages" count={c.pages.length} covered={covPages(c.pages)}>{c.pages.length ? c.pages.map(pageChip) : <Muted>no routed page</Muted>}</Lane>
        {c.parents.length > 0 && <Lane label="nested in" count={c.parents.length} covered={covComps(c.parents)}>{c.parents.map(compChip)}</Lane>}
        {c.children.length > 0 && <Lane label="renders" count={c.children.length} covered={covComps(c.children)}>{c.children.map(compChip)}</Lane>}
        <Legend />
      </div>
    )
  }
  const p = pages[sel.id]
  if (!p) return <div style={card}><Header eyebrow="page" title={sel.id} meta="not in the graph" /></div>
  return (
    <div style={card}>
      <Header eyebrow={`page${p.role ? ` · ${p.role}` : ''}`} title={stripPage(p.title)} meta={sel.id} />
      <Lane label="components" count={p.components.length} covered={covComps(p.components)}>{p.components.length ? p.components.map(compChip) : <Muted>none</Muted>}</Lane>
      <Lane label="tokens" count={p.tokens.length}>{p.tokens.length ? p.tokens.map(tokenChip) : <Muted>none resolved</Muted>}</Lane>
      <Legend />
    </div>
  )
}
