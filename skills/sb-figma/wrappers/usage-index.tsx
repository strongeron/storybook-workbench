/**
 * usage-index — turn a token/size's raw `src/...` usage paths into the COMPONENTS and PAGES that
 * actually consume it, each a click-through into its story when one exists.
 *
 * Single source: build-component-pages.py emits `fileIndex` (path → {component, kind, pages[]}) by
 * projecting the same import graph the ComponentUsage worklist renders. This module only LOOKS UP that
 * index — no scanning, no second join — so "used in" can never drift from the graph.
 *
 * Linking is best-effort ("link where possible"): we read Storybook's own /index.json and link a
 * component/page to its story only when a real entry matches. No match → plain name, path on hover.
 *
 * <UsageDisclosure> collapses by default inside autodocs/MDX (where the detail is reference material)
 * and stays open on the standalone audit pages (where it's the point). Override with `defaultOpen`.
 *
 * Storybook-only — never imported from app code.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

const ink = 'var(--color-foreground, oklch(0.30 0.03 155))'
const dim = 'var(--color-muted-foreground, oklch(0.48 0.022 155))'
const line = 'var(--color-border-subtle, oklch(0.905 0.008 155))'
const brand = 'var(--color-brand-500, var(--color-primary, oklch(0.55 0.16 250)))'
const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

interface PageRef { path: string; title: string; role?: string | null; storyId?: string | null }
interface FileEntry { component: string | null; kind: string; pages: PageRef[] }
interface ComponentPagesReport { fileIndex?: Record<string, FileEntry> }

const reportFiles = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<ComponentPagesReport>('../../.storybook/component-pages.json', { eager: true })
const FILE_INDEX: Record<string, FileEntry> = Object.values(reportFiles)[0]?.fileIndex ?? {}
// Secondary index by basename, so a path that differs only by prefix (a scanner that drops `src/`) still
// resolves. Exact path wins; basename is the fallback.
const BY_BASE: Record<string, FileEntry> = {}
for (const [p, e] of Object.entries(FILE_INDEX)) {
  const base = p.split('/').pop()
  if (base && !(base in BY_BASE)) BY_BASE[base] = e
}
const lookup = (f: string): FileEntry | undefined => FILE_INDEX[f] ?? FILE_INDEX[`src/${f}`] ?? BY_BASE[f.split('/').pop() ?? f]

export interface CompRef { name: string; file: string; kind: string }
export interface ResolvedUsage {
  components: CompRef[]
  pages: PageRef[]
  plainFiles: string[]
}

/** Resolve a token/size's raw usage paths to the components they define and the pages those land on. */
export function resolveUsage(files: string[] = []): ResolvedUsage {
  const comps = new Map<string, CompRef>()
  const pages = new Map<string, PageRef>()
  const plain: string[] = []
  for (const f of files) {
    const e = lookup(f)
    if (!e) { plain.push(f); continue }
    if (e.component && !comps.has(e.component)) comps.set(e.component, { name: e.component, file: f, kind: e.kind })
    for (const p of e.pages ?? []) if (!pages.has(p.path)) pages.set(p.path, p)
  }
  return { components: [...comps.values()], pages: [...pages.values()], plainFiles: plain }
}

/** One-line summary: "6 components · 5 pages" (or "N files" when nothing resolves to a name). */
export function usageSummary(r: ResolvedUsage): string {
  const parts: string[] = []
  if (r.components.length) parts.push(`${r.components.length} component${r.components.length === 1 ? '' : 's'}`)
  if (r.pages.length) parts.push(`${r.pages.length} page${r.pages.length === 1 ? '' : 's'}`)
  if (!parts.length && r.plainFiles.length) parts.push(`${r.plainFiles.length} file${r.plainFiles.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

// ── Story-index linking — read Storybook's own /index.json, link only entries that actually exist ──
interface IndexEntry { id: string; title: string; name: string; type?: string }
let indexPromise: Promise<IndexEntry[]> | null = null
function loadIndex(): Promise<IndexEntry[]> {
  return (indexPromise ??= fetch('/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d): IndexEntry[] => (d?.entries ? (Object.values(d.entries) as IndexEntry[]) : []))
    .catch((): IndexEntry[] => []))
}
function useStoryIndex(): IndexEntry[] {
  const [idx, setIdx] = useState<IndexEntry[]>([])
  useEffect(() => { let on = true; loadIndex().then((e) => { if (on) setIdx(e) }); return () => { on = false } }, [])
  return idx
}
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '')
const lastSeg = (t: string) => slug(t.split('/').pop() ?? t)
// Match a component/page name to a story id by its title's last segment; prefer the docs entry.
function hrefFor(idx: IndexEntry[], name: string): string | null {
  const key = slug(name)
  let story: IndexEntry | undefined
  for (const e of idx) {
    if (lastSeg(e.title) !== key) continue
    if (e.type === 'docs') return `/?path=/docs/${e.id}`
    story = story ?? e
  }
  return story ? `/?path=/story/${story.id}` : null
}

/** Hook → `(name) => storyHref | null`. Resolves a component/page name to its story link if one exists.
 *  Shared so every usage surface links the same way (TokenMatrix chips, the Usage explorer). */
export function useStoryLinker(): (name: string) => string | null {
  const idx = useStoryIndex()
  return (name: string) => hrefFor(idx, name)
}

/** True when an element renders inside an autodocs/MDX docs block. Heavy usage detail collapses there
 *  (the page is scanned fast, the detail is reference material) and stays open on a standalone audit
 *  page (where the map is the point). Shared so every collapsing surface decides the same way. */
export function isInAutodocs(el: Element | null | undefined): boolean {
  return !!el?.closest('.docs-story, .sbdocs, .sb-anchor')
}

// ── Rendering ──────────────────────────────────────────────────────────────────
const relLabel: CSSProperties = { fontFamily: mono, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: dim, minWidth: 64, flexShrink: 0, opacity: 0.7 }
function chipStyle(clickable: boolean): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: mono, fontSize: 10.5, lineHeight: 1.5,
    padding: '1px 8px', borderRadius: 999, border: `1px solid ${line}`, color: ink, textDecoration: 'none',
    whiteSpace: 'nowrap', cursor: clickable ? 'pointer' : 'default', background: clickable ? 'color-mix(in oklab, currentColor 4%, transparent)' : 'transparent' }
}
function Chip({ label, href, title, dot }: { label: string; href: string | null; title?: string; dot?: boolean }): ReactElement {
  const inner = (
    <>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: brand, flexShrink: 0 }} /> : null}
      {label}
    </>
  )
  return href
    ? <a href={href} target="_top" title={title ? `${title} — open story` : 'open story'} style={chipStyle(true)}>{inner}</a>
    : <span title={title} style={chipStyle(false)}>{inner}</span>
}

// A heavily-used semantic token resolves to dozens of components — enumerating all of them is a wall,
// not a jump target. Cap each lane (alphabetized for scanning) and let the summary count carry the total.
const COMP_CAP = 24
const PAGE_CAP = 18
function Lane({ label, items, cap }: { label: string; items: ReactElement[]; cap: number }): ReactElement {
  const shown = items.slice(0, cap)
  const extra = items.length - shown.length
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'baseline' }}>
      <span style={relLabel}>{label}</span>
      {shown}
      {extra > 0 && <span style={{ fontFamily: mono, fontSize: 10.5, color: dim, alignSelf: 'center' }}>+{extra} more</span>}
    </div>
  )
}

/** The resolved detail: component chips, page chips, and any unresolved paths. Clickable where a story exists.
 *  `seeAllHref` (optional) appends a link to the full, uncapped list in the Usage explorer. */
export function UsageDetail({ files, seeAllHref }: { files?: string[]; seeAllHref?: string }): ReactElement | null {
  const r = resolveUsage(files)
  const idx = useStoryIndex()
  if (!r.components.length && !r.pages.length && !r.plainFiles.length) return null
  const comps = [...r.components].sort((a, b) => a.name.localeCompare(b.name))
  const pages = [...r.pages].sort((a, b) => a.title.localeCompare(b.title))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {comps.length > 0 && (
        <Lane label="components" cap={COMP_CAP}
          items={comps.map((c) => <Chip key={c.name} label={c.name} href={hrefFor(idx, c.name)} title={c.file} />)} />
      )}
      {pages.length > 0 && (
        <Lane label="pages" cap={PAGE_CAP}
          items={pages.map((p) => <Chip key={p.path} label={p.title.replace(/^Pages\//, '')} href={hrefFor(idx, p.title)} title={p.path} dot />)} />
      )}
      {r.plainFiles.length > 0 && comps.length === 0 && pages.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
          <span style={relLabel}>files</span>
          {r.plainFiles.slice(0, 12).map((f) => <code key={f} style={{ fontFamily: mono, fontSize: 10, color: dim, wordBreak: 'break-all' }}>{f}</code>)}
          {r.plainFiles.length > 12 && <span style={{ fontFamily: mono, fontSize: 10.5, color: dim }}>+{r.plainFiles.length - 12} more</span>}
        </div>
      )}
      {seeAllHref && (
        <a href={seeAllHref} target="_top" style={{ display: 'inline-block', marginTop: 2, fontFamily: mono, fontSize: 10.5, color: brand, textDecoration: 'none' }}>
          see all in the Usage explorer →
        </a>
      )}
    </div>
  )
}

export interface UsageDisclosureProps {
  files?: string[]
  /** count shown before the summary, e.g. the live reference count. Omit to show only the resolved summary. */
  uses?: number
  /** force open/closed. Default: open everywhere EXCEPT inside an autodocs/MDX docs block, where it collapses. */
  defaultOpen?: boolean
}

/** Self-contained "where is this used" disclosure: a one-line summary that expands to the resolved
 *  component/page chips. Collapsed by default in docs, open on standalone audit pages. */
export function UsageDisclosure({ files, uses, defaultOpen }: UsageDisclosureProps): ReactElement | null {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<boolean>(defaultOpen ?? true)
  const [decided, setDecided] = useState(defaultOpen !== undefined)
  useEffect(() => {
    if (decided || !root.current) return
    // Inside autodocs the story renders within a `.docs-story` / `.sbdocs` block — collapse there.
    setOpen(!isInAutodocs(root.current))
    setDecided(true)
  }, [decided])

  const r = resolveUsage(files)
  const summary = usageSummary(r)
  if (uses === 0 || (!summary && !r.plainFiles.length)) {
    return <span ref={root as never} style={{ fontFamily: mono, fontSize: 11, color: line }}>{uses === 0 ? '0 uses' : '—'}</span>
  }
  return (
    <div ref={root} style={{ fontFamily: mono, fontSize: 11 }}>
      <button type="button" onClick={() => { setOpen((v) => !v); setDecided(true) }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', fontFamily: mono, fontSize: 11, color: dim }}>
        <span style={{ color: dim }}>{open ? '▾' : '▸'}</span>
        {uses != null && <><span style={{ color: ink, fontWeight: 700 }}>{uses}</span> uses ·</>}
        <span>used in {summary}</span>
      </button>
      {open && <div style={{ marginTop: 8 }}><UsageDetail files={files} /></div>}
    </div>
  )
}
