/**
 * IconMatrix — a live icon-coverage audit for an icon LIBRARY (lucide-react, phosphor, heroicons, …).
 *
 * The question it answers: which icons does this app actually import, which does it RENDER (and how
 * often), and at what pixel sizes — so the iconography catalog can never drift from the code the way a
 * hand-kept icon list does. It reads every `/src/**` file raw at build time (Vite `import.meta.glob`),
 * parses the icon-library imports, counts JSX render sites per icon, and maps Tailwind `h-*`/`size-*`
 * classes to px to build a size histogram + a per-icon size matrix.
 *
 * Library-agnostic by design: it does NOT import any icon package itself (that would couple the wrapper
 * to one library and ship it to every project). The consuming story passes:
 *   • `library`  — name/version/links + the import source to scan for (defaults to `library.name`)
 *   • `resolve`  — `(name) => IconComponent | undefined`, e.g. `(n) => (Lucide as Record<string, unknown>)[n]`
 *
 *   import * as Lucide from 'lucide-react'
 *   <IconMatrix library={{ name: 'lucide-react', version: '0.552.0', site: '…', npm: '…' }}
 *              resolve={(n) => (Lucide as Record<string, unknown>)[n] as IconCmp} />
 *
 * Storybook-only — never imported from app code.
 */
import { Fragment, useMemo, useState, type ComponentType, type CSSProperties, type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { Icon } from './icons'
import { ink, dim, line, mono, surface, Chip } from './usage-stamp'
import { useStoryLinker, resolveUsage } from './usage-index'

export type IconCmp = ComponentType<{ size?: number; strokeWidth?: number }>

export interface IconLibrary {
  name: string
  version?: string
  site?: string
  npm?: string
  /** the module specifier to scan imports from. Defaults to `name` (e.g. 'lucide-react'). */
  importSource?: string
}

export interface IconMatrixProps {
  library: IconLibrary
  /** resolve an imported name to its icon component (and to test it still exists in this version). */
  resolve: (name: string) => IconCmp | undefined
  /** px sizes to show as histogram rows. Default: the common Tailwind icon scale. */
  scale?: number[]
  /** Tailwind sizing utility → px. Default covers `h-*` and `size-*` from h-3 (12) to size-16 (64). */
  classPx?: Record<string, number>
  /** named exports to ignore (e.g. a library's icon TYPE like lucide's `LucideIcon`, not a glyph). */
  exclude?: string[]
  /**
   * If the app renders icons through an indirection wrapper element (e.g. `<Icon name="Plus" size={16} />`)
   * instead of the library component, describe it here: `{ tag: "Icon", nameProp: "name" }`. The scan
   * then parses each `<Icon …>` element for the icon name AND its size (`size={N}` or a `size-/h-N`
   * className). Without this, a project that mandates an `<Icon>` wrapper reports near-zero coverage.
   */
  iconWrapper?: { tag: string; nameProp: string }
  /**
   * Object-property names that hold an icon by string in config/data (e.g. `{ icon: "Archive" }` rendered
   * later via `<Icon name={item.icon} />`). Discovers icons referenced only through data — no static size.
   */
  iconConfigProps?: string[]
  /**
   * Names that resolve via a CUSTOM icon map (not the library itself) — excluded from `missing` so they
   * aren't flagged as "not in this version". The story's `resolve` should still return their component.
   */
  customNames?: string[]
  fillViewport?: boolean
}

const ACCENT = 'var(--color-success, oklch(0.62 0.12 155))'
const DANGER = 'oklch(0.55 0.18 25)'
const bg = 'var(--color-background, oklch(0.994 0.003 155))'

const DEFAULT_SCALE = [12, 14, 16, 20, 24, 32, 40, 48, 64]
const DEFAULT_CLASS_PX: Record<string, number> = {
  'h-3': 12, 'size-3': 12, 'h-3.5': 14, 'size-3.5': 14, 'h-4': 16, 'size-4': 16,
  'h-5': 20, 'size-5': 20, 'h-6': 24, 'size-6': 24, 'h-7': 28, 'size-7': 28,
  'h-8': 32, 'size-8': 32, 'h-9': 36, 'h-10': 40, 'size-10': 40, 'h-11': 44,
  'h-12': 48, 'size-12': 48, 'h-14': 56, 'h-16': 64, 'size-16': 64,
}

// Read every app source file raw at build time. Absolute `/src` glob → works wherever this wrapper lives.
const SOURCES = (import.meta as { glob: <T>(p: string, o: Record<string, unknown>) => Record<string, T> })
  .glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** one JSX render site of an icon: where it lives, the size it renders at, and the extracted JSX tag. */
interface IconSite {
  file: string
  line: number
  px: number | null
  snippet: string
}

interface Coverage {
  imported: string[]
  rendered: string[]
  unrendered: string[]
  missing: string[]
  usage: Record<string, number>
  sizesByIcon: Record<string, Record<number, number>>
  histogram: Record<number, number>
  totalSites: number
  /** every render site per icon — powers the click-to-expand "where is it used" list. */
  sites: Record<string, IconSite[]>
}

function analyze(importSource: string, classPx: Record<string, number>, resolve: (n: string) => IconCmp | undefined, exclude: Set<string>, iconWrapper: { tag: string; nameProp: string } | undefined, iconConfigProps: string[], customNames: Set<string>): Coverage {
  const importRe = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${escapeRe(importSource)}['"]`, 'gs')
  // Indirection wrapper: (a) JSX sites `<Icon name="X" size={16}>` carry the size; (b) config objects
  // `icon: "X"` rendered later via `<Icon name={item.icon}>` are discovery only (no static size).
  const elRe = iconWrapper ? new RegExp(`<${escapeRe(iconWrapper.tag)}\\b([^>]*?)/?>`, 'g') : null
  const nameInElRe = iconWrapper ? new RegExp(`(?<![\\w-])${escapeRe(iconWrapper.nameProp)}\\s*=\\s*\\{?\\s*["']([A-Z][A-Za-z0-9]*)["']`, 'g') : null
  const cfgRes = iconConfigProps.map((p) => new RegExp(`(?<![\\w-])${escapeRe(p)}\\s*:\\s*["']([A-Z][A-Za-z0-9]*)["']`, 'g'))
  const imported = new Set<string>()
  const usage: Record<string, number> = {}
  const sizesByIcon: Record<string, Record<number, number>> = {}
  const histogram: Record<number, number> = {}
  const sites: Record<string, IconSite[]> = {}
  let totalSites = 0
  const addSite = (name: string, path: string, code: string, index: number | undefined, px: number | null, match: string) => {
    const ln = index != null ? code.slice(0, index).split('\n').length : 0
    ;(sites[name] ??= []).push({ file: path.replace(/^\//, ''), line: ln, px, snippet: match.replace(/\s+/g, ' ').trim() })
  }

  for (const [path, code] of Object.entries(SOURCES)) {
    if (path.includes('.stories.')) continue // catalogs aren't app usage
    const names = new Set<string>()
    for (const m of code.matchAll(importRe)) {
      for (const raw of m[1].split(',')) {
        const part = raw.trim()
        if (!part || part.startsWith('type ')) continue
        const name = part.split(/\s+as\s+/).pop()!.trim()
        if (/^[A-Z][A-Za-z0-9]*$/.test(name) && !exclude.has(name)) { names.add(name); imported.add(name) }
      }
    }
    for (const name of names) {
      const tagRe = new RegExp(`<${name}(\\s[^>]*?)?/?>`, 'g')
      for (const t of code.matchAll(tagRe)) {
        usage[name] = (usage[name] ?? 0) + 1
        totalSites += 1
        const cls = (t[1] ?? '').match(/(?:size-|h-)[\d.]+/g) ?? []
        let firstPx: number | null = null
        for (const c of cls) {
          const px = classPx[c]
          if (px == null) continue
          if (firstPx == null) firstPx = px
          ;(sizesByIcon[name] ??= {})[px] = (sizesByIcon[name][px] ?? 0) + 1
          histogram[px] = (histogram[px] ?? 0) + 1
        }
        addSite(name, path, code, t.index, firstPx, t[0])
      }
    }
    if (elRe && nameInElRe) {
      for (const el of code.matchAll(elRe)) {
        const attrs = el[1] ?? ''
        const elNames = [...attrs.matchAll(nameInElRe)].map((m) => m[1]).filter((n) => !exclude.has(n))
        if (!elNames.length) continue // dynamic name={var} — unresolvable, skip
        const px = new Set<number>()
        const sizeM = attrs.match(/\bsize\s*=\s*\{(\d+(?:\.\d+)?)\}/)
        if (sizeM) px.add(Math.round(Number(sizeM[1])))
        const clsM = attrs.match(/className\s*=\s*["']([^"']*)["']/)
        if (clsM) for (const c of clsM[1].match(/(?:size-|h-)[\d.]+/g) ?? []) { const v = classPx[c]; if (v != null) px.add(v) }
        for (const name of elNames) {
          imported.add(name); usage[name] = (usage[name] ?? 0) + 1; totalSites += 1
          for (const p of px) { (sizesByIcon[name] ??= {})[p] = (sizesByIcon[name][p] ?? 0) + 1; histogram[p] = (histogram[p] ?? 0) + 1 }
          addSite(name, path, code, el.index, [...px][0] ?? null, el[0])
        }
      }
    }
    for (const cfg of cfgRes) {
      for (const m of code.matchAll(cfg)) {
        const name = m[1]
        if (exclude.has(name)) continue
        imported.add(name); usage[name] = (usage[name] ?? 0) + 1; totalSites += 1
        addSite(name, path, code, m.index, null, m[0])
      }
    }
  }

  const arr = [...imported]
  const rendered = arr.filter((n) => (usage[n] ?? 0) > 0).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a.localeCompare(b))
  const unrendered = arr.filter((n) => !(usage[n] ?? 0)).sort()
  // `missing` = referenced but not in this library (typo / removed glyph); custom-map names are valid
  const missing = arr.filter((n) => !resolve(n) && !customNames.has(n)).sort()
  return { imported: arr.sort(), rendered, unrendered, missing, usage, sizesByIcon, histogram, totalSites, sites }
}

const colHead: CSSProperties = { fontFamily: mono, fontSize: 10, fontWeight: 600, color: dim, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', padding: '0 12px 10px', borderBottom: `1px solid ${line}`, whiteSpace: 'nowrap' }
const rowHead: CSSProperties = { fontFamily: mono, fontSize: 11.5, fontWeight: 600, color: ink, textAlign: 'left', whiteSpace: 'nowrap', padding: '10px 16px 10px 0', position: 'sticky', left: 0, background: bg, borderBottom: `1px solid ${line}` }
const td: CSSProperties = { textAlign: 'center', verticalAlign: 'middle', color: ink, padding: '10px 12px', borderBottom: `1px solid ${line}` }
const linkS: CSSProperties = { fontFamily: mono, fontWeight: 600, color: 'oklch(0.45 0.12 155)', textDecoration: 'none', borderBottom: '1px solid currentColor' }

function Section({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>{title}</h2>
      {children}
    </section>
  )
}

// Chip label: the last two path segments + line (e.g. `skillsets/show.tsx:42`) — readable inline, the
// matrix row above already carries the glyph.
const shortFile = (f: string): string => f.split('/').slice(-2).join('/')

/** The expand panel for one icon: usage grouped per SIZE, each call site shown as a visible code EXTRACT
 *  (the matched JSX tag) next to its file:line, grep-style. `only` narrows to one size (a size cell was
 *  clicked); 'all' shows every size the icon renders at. */
function IconUsageDetail({ sites, only }: { sites: IconSite[]; only: number | 'all' }): ReactElement {
  const linkFor = useStoryLinker() // call-site file → component → its story href (null when no story exists)
  const bySize = useMemo(() => {
    const m = new Map<number | null, IconSite[]>()
    for (const s of sites) {
      const arr = m.get(s.px)
      if (arr) arr.push(s)
      else m.set(s.px, [s])
    }
    return [...m.entries()].sort((a, b) => (a[0] ?? 1e9) - (b[0] ?? 1e9)) // px asc, "no size class" last
  }, [sites])
  const shown = only === 'all' ? bySize : bySize.filter(([px]) => px === only)
  // The components those sites belong to (usage graph), ×N render sites each — the "where" at a glance
  // before the file:line list. Pages are left out on purpose: a shared layout component lands on every
  // route, so page chips would repeat the whole route list for most icons.
  const components = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [, list] of shown)
      for (const s of list) {
        const name = resolveUsage([s.file]).components[0]?.name
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [shown])

  return (
    <div style={{ padding: '8px 18px 14px 24px', display: 'grid', gap: 14 }}>
      {components.length > 0 && (
        <div>
          <div style={{ fontFamily: mono, fontSize: 9.5, fontWeight: 600, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
            in {components.length} component{components.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {components.map(([name, n]) => <Chip key={name} label={`${name} ×${n}`} href={linkFor(name)} linkable />)}
          </div>
        </div>
      )}
      {shown.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 11, color: dim }}>No call sites at this size.</div>
      ) : (
        shown.map(([px, list]) => (
          <div key={String(px)}>
            <div style={{ fontFamily: mono, fontSize: 9.5, fontWeight: 600, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
              {px == null ? 'no size class' : `${px}px`} · {list.length} site{list.length === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {[...list]
                .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
                .map((s, i) => {
                  // The component defined in this file → its story link, so the pill jumps you to where the
                  // icon actually renders. No story → a dashed pill (the coverage gap), same as the lists.
                  const comp = resolveUsage([s.file]).components[0]
                  const href = comp ? linkFor(comp.name) : null
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 248px) 1fr', gap: 12, alignItems: 'baseline' }}>
                      <span title={`${s.file}:${s.line}${comp ? ` — ${comp.name}` : ''}`}>
                        <Chip label={`${shortFile(s.file)}:${s.line}`} href={href} linkable />
                      </span>
                      <code style={{ fontFamily: mono, fontSize: 11, color: ink, background: surface, border: `1px solid ${line}`, borderRadius: 5, padding: '2px 7px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {s.snippet}
                      </code>
                    </div>
                  )
                })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export function IconMatrix({ library, resolve, scale = DEFAULT_SCALE, classPx = DEFAULT_CLASS_PX, exclude, iconWrapper, iconConfigProps, customNames, fillViewport = true }: IconMatrixProps): ReactElement {
  const importSource = library.importSource ?? library.name
  const excludeKey = (exclude ?? []).join(',')
  const wrapperKey = iconWrapper ? `${iconWrapper.tag}:${iconWrapper.nameProp}` : ''
  const cfgKey = (iconConfigProps ?? []).join(',')
  const customKey = (customNames ?? []).join(',')
  const cov = useMemo(
    () => analyze(importSource, classPx, resolve, new Set(exclude ?? []), iconWrapper, iconConfigProps ?? [], new Set(customNames ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- array/object props are keyed by content
    [importSource, classPx, resolve, excludeKey, wrapperKey, cfgKey, customKey],
  )
  // Which icon's call sites are expanded, and at which size: 'all' (row clicked) or one px (size cell clicked).
  const [open, setOpen] = useState<{ name: string; px: number | 'all' } | null>(null)
  const maxSite = Math.max(1, ...Object.values(cov.usage))
  const maxHist = Math.max(1, ...Object.values(cov.histogram))
  const COLS = Object.keys(cov.histogram).map(Number).sort((a, b) => a - b)
  // A barely-there inset tint for the open row + its detail panel — built from surface, NOT the theme's
  // `--color-muted` (which is a mid-gray here and read as a heavy slab).
  const inset = `color-mix(in oklab, ${ink} 3%, ${surface})`

  return (
    <div style={{ background: bg, color: ink, minHeight: fillViewport ? '100dvh' : undefined, fontFamily: mono, padding: '2rem 1.75rem 4rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <ReportIntro
          title="Icons"
          what={<>Which icons the app actually imports, which it RENDERS (how often, at what pixel sizes), and <strong>where</strong> — click a row for the components it lands in and every call site — the iconography catalog read from <code>src</code>, never a hand-kept list.</>}
          source={{ file: 'src/**/*.{ts,tsx} (live scan)', skill: 'sb-inventory' }}
          freshness="Re-read from src on every Storybook build — no snapshot to drift."
          pipeline={[
            { skill: 'sb-inventory', role: 'icon library + scale' },
            { skill: 'sb-wrappers', role: 'this matrix' },
          ]}
        />

        <p style={{ fontFamily: mono, fontSize: 12.5, color: dim, maxWidth: 820, lineHeight: 1.6 }}>
          Library:{' '}
          {library.site
            ? <a href={library.site} target="_blank" rel="noreferrer" style={linkS}>{library.name}</a>
            : <strong style={{ color: ink }}>{library.name}</strong>}
          {library.version && <> <span style={{ color: dim }}>v{library.version}</span></>}
          {library.npm && <> · <a href={library.npm} target="_blank" rel="noreferrer" style={linkS}>npm</a></>}
          . Single-stroke, <code>currentColor</code> — inherits text color and size.
        </p>
        <p style={{ fontFamily: mono, fontSize: 12.5, color: dim, maxWidth: 820, margin: '4px 0 0', lineHeight: 1.6 }}>
          Coverage (scanned live from <code>src</code>):{' '}
          <strong style={{ color: ink }}>{cov.imported.length}</strong> icons imported ·{' '}
          <strong style={{ color: ink }}>{cov.rendered.length}</strong> rendered across{' '}
          <strong style={{ color: ink }}>{cov.totalSites}</strong> sites
          {cov.missing.length > 0 && <> · <span style={{ color: DANGER }}>{cov.missing.length} not in {library.version ? `v${library.version}` : 'this version'}</span></>}.
        </p>

        <Section title="Size usage across the app (render sites per size)">
          <div style={{ display: 'grid', gap: 6, paddingTop: 14, maxWidth: 640 }}>
            {scale.map((px) => {
              const n = cov.histogram[px] ?? 0
              return (
                <div key={px} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 56px', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: ink }}>{px}px</span>
                  <div style={{ background: line, borderRadius: 4, height: 18, overflow: 'hidden' }}>
                    <div style={{ width: `${(n / maxHist) * 100}%`, height: '100%', background: ACCENT, borderRadius: 4, minWidth: n ? 2 : 0 }} />
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 11, color: dim, textAlign: 'right' }}>{n}</span>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title={`Coverage by icon — usage & sizes, aligned to the size grid (${cov.rendered.length})`}>
          <p style={{ fontFamily: mono, fontSize: 11, color: dim, margin: '0 0 4px' }}>
            Sorted by usage. Each cell shows the glyph at that column's size; solid + <code>×N</code> = rendered N times at that size, faint = unused at that size. <strong style={{ color: ink }}>Click a row</strong> to break usage out by size, or <strong style={{ color: ink }}>click a size cell</strong> for just that size. Each <code>file:line</code> pill links to the story where the icon renders (dashed = that file has no story yet); the code shows the exact usage.
          </p>
          <div style={{ overflowX: 'auto', paddingTop: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...colHead, textAlign: 'left', position: 'sticky', left: 0, top: 0, background: bg, zIndex: 2 }}>icon</th>
                  <th style={{ ...colHead, textAlign: 'left', width: 150, position: 'sticky', top: 0, background: bg, zIndex: 1 }}>sites</th>
                  {COLS.map((px) => <th key={px} style={{ ...colHead, position: 'sticky', top: 0, background: bg, zIndex: 1 }}>{px}px</th>)}
                </tr>
              </thead>
              <tbody>
                {cov.rendered.map((name) => {
                  const Cmp = resolve(name)
                  const siteCount = cov.usage[name] ?? 0
                  const sizes = cov.sizesByIcon[name] ?? {}
                  const anyOpen = open?.name === name           // this row has a panel open (all sizes or one)
                  const siteList = cov.sites[name] ?? []
                  return (
                    <Fragment key={name}>
                      <tr>
                        <th scope="row" style={{ ...rowHead, background: anyOpen ? inset : bg }}>
                          <button
                            type="button"
                            onClick={() => setOpen(anyOpen ? null : { name, px: 'all' })}
                            aria-expanded={anyOpen}
                            title={`Show ${name}'s ${siteCount} call site${siteCount === 1 ? '' : 's'} grouped by size`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                          >
                            <span style={{ width: 9, color: dim, fontSize: 9 }}>{anyOpen ? '▾' : '▸'}</span>
                            {Cmp && <Cmp size={18} strokeWidth={2} />}
                            <span style={{ borderBottom: `1px dotted ${line}` }}>{name}</span>
                          </button>
                        </th>
                        <td style={{ ...td, textAlign: 'left' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 72, background: line, borderRadius: 3, height: 8, overflow: 'hidden', display: 'inline-block' }}>
                              <span style={{ display: 'block', width: `${(siteCount / maxSite) * 100}%`, height: '100%', background: ACCENT }} />
                            </span>
                            <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>{siteCount}</span>
                          </span>
                        </td>
                        {COLS.map((px) => {
                          const n = sizes[px] ?? 0
                          const cellOpen = anyOpen && open!.px === px
                          const glyph = (
                            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: ink, opacity: n ? 1 : 0.16 }}>
                              {Cmp && <Cmp size={px} strokeWidth={2} />}
                              <span style={{ fontFamily: mono, fontSize: 10, color: dim, visibility: n ? 'visible' : 'hidden' }}>×{n}</span>
                            </span>
                          )
                          return (
                            <td key={px} style={{ ...td, background: cellOpen ? inset : undefined }}>
                              {n ? (
                                <button
                                  type="button"
                                  onClick={() => setOpen(cellOpen ? null : { name, px })}
                                  aria-expanded={cellOpen}
                                  title={`${name} at ${px}px — ${n} call site${n === 1 ? '' : 's'}`}
                                  style={{ background: 'none', border: 'none', padding: 4, margin: -4, cursor: 'pointer', borderRadius: 8, outline: cellOpen ? `1.5px solid ${ACCENT}` : 'none', outlineOffset: 1 }}
                                >
                                  {glyph}
                                </button>
                              ) : glyph}
                            </td>
                          )
                        })}
                      </tr>
                      {anyOpen && (
                        <tr>
                          <td colSpan={2 + COLS.length} style={{ padding: 0, borderBottom: `1px solid ${line}`, borderLeft: `2px solid ${ACCENT}`, background: inset }}>
                            <IconUsageDetail sites={siteList} only={open!.px} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {cov.unrendered.length > 0 && (
          <Section title={`Imported but not rendered directly (${cov.unrendered.length})`}>
            <p style={{ fontFamily: mono, fontSize: 11, color: dim, margin: '0 0 12px' }}>
              Passed as a prop (<code>icon=&#123;Check&#125;</code>), referenced dynamically, or dead imports — no direct JSX render site.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cov.unrendered.map((name) => {
                const Cmp = resolve(name)
                const dead = !Cmp
                return (
                  <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', border: `1px solid ${line}`, borderRadius: 999, fontFamily: mono, fontSize: 11, color: dead ? DANGER : dim }}>
                    {Cmp && <Cmp size={13} strokeWidth={2} />}{name}{dead && <span title={`absent in ${library.name}${library.version ? ` v${library.version}` : ''}`}><Icon.warning size={12} /></span>}
                  </span>
                )
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
