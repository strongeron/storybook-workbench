/**
 * IconMatrix — a live icon-coverage audit for an icon LIBRARY (lucide-react, phosphor, heroicons, …).
 *
 * The question it answers: which icons does this app actually import, which does it RENDER (and how
 * often), at what pixel sizes, and WHERE — the precise components & pages each icon lands on — so the
 * iconography catalog can never drift from the code the way a hand-kept icon list does. It reads every
 * `/src/**` file raw at build time (Vite `import.meta.glob`), parses the icon-library imports, counts JSX
 * render sites per icon, maps Tailwind `h-*`/`size-*` classes to px (size histogram + per-icon matrix), and
 * resolves each render-site file → component + pages through the SAME usage graph the token views read
 * (`component-pages.json` fileIndex, via `resolveUsage`) — so "where is this icon used?" reads as clickable
 * component/page names, degrading to file names when the usage graph hasn't been generated.
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
import { useMemo, type ComponentType, type CSSProperties, type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { Icon } from './icons'
import { ink, dim, line, mono, Chip, stripPage, type PageRef } from './usage-stamp'
import { resolveUsage, useStoryLinker } from './usage-index'

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
   * className) — recovering the size grid, which a bare string scan can't. Without this, a project that
   * mandates an `<Icon>` wrapper reports near-zero coverage (the library components are never imported).
   */
  iconWrapper?: { tag: string; nameProp: string }
  /**
   * Object-property names that hold an icon by string in config/data (e.g. `{ icon: "Archive" }` rendered
   * later via `<Icon name={item.icon} />`). Discovers icons referenced only through data — no static size.
   * Matches `prop: "Name"` (colon form, PascalCase). Example: `["icon"]`.
   */
  iconConfigProps?: string[]
  /**
   * Names that resolve via a CUSTOM icon map (not the library itself) — e.g. an app's own
   * `{ Knowledge: KnowledgeIcon }`. Excluded from the `missing` bucket so they aren't false-flagged
   * as "not in this version". The story's `resolve` should still return their component so they render.
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

interface Coverage {
  imported: string[]
  rendered: string[]
  unrendered: string[]
  missing: string[]
  usage: Record<string, number>
  sizesByIcon: Record<string, Record<number, number>>
  histogram: Record<number, number>
  totalSites: number
  /** per icon → the src files it's rendered in, with render-site count per file ("where is it used"). */
  filesByIcon: Record<string, Record<string, number>>
}

// One icon's "where used", resolved through the SAME usage graph the token/component views read
// (component-pages.json fileIndex, via resolveUsage): the components whose files render it (with the
// render-site count summed per component) and the pages those components land on. plainFiles are the
// raw src paths that didn't resolve to a tracked component (no component-pages.json, or an untracked file).
interface IconWhere { components: { name: string; count: number }[]; pages: PageRef[]; plainFiles: string[] }
function iconWhere(files: Record<string, number>): IconWhere {
  const compCount = new Map<string, number>()
  const pages = new Map<string, PageRef>()
  const plain = new Set<string>()
  for (const [path, count] of Object.entries(files)) {
    const r = resolveUsage([path])
    if (r.components.length) {
      for (const c of r.components) compCount.set(c.name, (compCount.get(c.name) ?? 0) + count)
      for (const p of r.pages) if (!pages.has(p.path)) pages.set(p.path, p)
    } else {
      for (const f of r.plainFiles) plain.add(f)
    }
  }
  return {
    components: [...compCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    pages: [...pages.values()].sort((a, b) => a.title.localeCompare(b.title)),
    plainFiles: [...plain],
  }
}

function analyze(importSource: string, classPx: Record<string, number>, resolve: (n: string) => IconCmp | undefined, exclude: Set<string>, iconWrapper: { tag: string; nameProp: string } | undefined, iconConfigProps: string[], customNames: Set<string>): Coverage {
  const importRe = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${escapeRe(importSource)}['"]`, 'gs')
  // Indirection wrapper. Two reference shapes in an `<Icon name="X" size={N}>`-style codebase:
  //  (a) JSX render sites — `<Icon name="X" size={16} className="size-4">` — carry the SIZE; scanned per element.
  //  (b) config objects — `icon: "X"` in a data array, rendered later via `<Icon name={item.icon}>` (dynamic,
  //      no static size). Discovery only. Names are PascalCase; uppercase-start avoids lowercase slug keys.
  const elRe = iconWrapper ? new RegExp(`<${escapeRe(iconWrapper.tag)}\\b([^>]*?)/?>`, 'g') : null
  const nameInElRe = iconWrapper ? new RegExp(`(?<![\\w-])${escapeRe(iconWrapper.nameProp)}\\s*=\\s*\\{?\\s*["']([A-Z][A-Za-z0-9]*)["']`, 'g') : null
  const cfgRes = iconConfigProps.map((p) => new RegExp(`(?<![\\w-])${escapeRe(p)}\\s*:\\s*["']([A-Z][A-Za-z0-9]*)["']`, 'g'))
  const imported = new Set<string>()
  const usage: Record<string, number> = {}
  const sizesByIcon: Record<string, Record<number, number>> = {}
  const histogram: Record<number, number> = {}
  const filesByIcon: Record<string, Record<string, number>> = {}
  let totalSites = 0

  for (const [rawPath, code] of Object.entries(SOURCES)) {
    if (rawPath.includes('.stories.')) continue // catalogs aren't app usage
    // The glob key is absolute ("/src/…"); the usage graph's fileIndex is keyed "src/…". Strip the leading
    // slash so resolveUsage resolves it directly (it also falls back to basename when there's no graph).
    const path = rawPath.replace(/^\//, '')
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
        ;(filesByIcon[name] ??= {})[path] = (filesByIcon[name][path] ?? 0) + 1
        const cls = (t[1] ?? '').match(/(?:size-|h-)[\d.]+/g) ?? []
        for (const c of cls) {
          const px = classPx[c]
          if (px == null) continue
          ;(sizesByIcon[name] ??= {})[px] = (sizesByIcon[name][px] ?? 0) + 1
          histogram[px] = (histogram[px] ?? 0) + 1
        }
      }
    }
    if (elRe && nameInElRe) {
      for (const el of code.matchAll(elRe)) {
        const attrs = el[1] ?? ''
        const elNames = [...attrs.matchAll(nameInElRe)].map((m) => m[1]).filter((n) => !exclude.has(n))
        if (!elNames.length) continue // dynamic name={var} / ternary-of-vars — unresolvable, skip
        const px = new Set<number>()
        const sizeM = attrs.match(/\bsize\s*=\s*\{(\d+(?:\.\d+)?)\}/)
        if (sizeM) px.add(Math.round(Number(sizeM[1])))
        const clsM = attrs.match(/className\s*=\s*["']([^"']*)["']/)
        if (clsM) for (const c of clsM[1].match(/(?:size-|h-)[\d.]+/g) ?? []) { const v = classPx[c]; if (v != null) px.add(v) }
        for (const name of elNames) {
          imported.add(name); usage[name] = (usage[name] ?? 0) + 1; totalSites += 1
          ;(filesByIcon[name] ??= {})[path] = (filesByIcon[name][path] ?? 0) + 1
          for (const p of px) { (sizesByIcon[name] ??= {})[p] = (sizesByIcon[name][p] ?? 0) + 1; histogram[p] = (histogram[p] ?? 0) + 1 }
        }
      }
    }
    for (const cfg of cfgRes) {
      for (const m of code.matchAll(cfg)) {
        const name = m[1]
        if (exclude.has(name)) continue
        imported.add(name)
        usage[name] = (usage[name] ?? 0) + 1
        totalSites += 1
        ;(filesByIcon[name] ??= {})[path] = (filesByIcon[name][path] ?? 0) + 1
      }
    }
  }

  const arr = [...imported]
  const rendered = arr.filter((n) => (usage[n] ?? 0) > 0).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a.localeCompare(b))
  const unrendered = arr.filter((n) => !(usage[n] ?? 0)).sort()
  // `missing` = referenced but not resolvable in this library — a real broken icon (typo / removed
  // glyph). Custom-map names are valid, just not from the library, so they're excluded.
  const missing = arr.filter((n) => !resolve(n) && !customNames.has(n)).sort()
  return { imported: arr.sort(), rendered, unrendered, missing, usage, sizesByIcon, histogram, totalSites, filesByIcon }
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

export function IconMatrix({ library, resolve, scale = DEFAULT_SCALE, classPx = DEFAULT_CLASS_PX, exclude, iconWrapper, iconConfigProps, customNames, fillViewport = true }: IconMatrixProps): ReactElement {
  const importSource = library.importSource ?? library.name
  const excludeKey = (exclude ?? []).join(',')
  const customKey = (customNames ?? []).join(',')
  const wrapperKey = iconWrapper ? `${iconWrapper.tag}.${iconWrapper.nameProp}` : ''
  const configKey = (iconConfigProps ?? []).join(',')
  const cov = useMemo(() => analyze(importSource, classPx, resolve, new Set(exclude ?? []), iconWrapper, iconConfigProps ?? [], new Set(customNames ?? [])), [importSource, classPx, resolve, excludeKey, wrapperKey, configKey, customKey])
  const linkFor = useStoryLinker()
  // Resolve "where is each rendered icon used" once: file render-sites → components (with counts) + pages.
  const whereByIcon = useMemo(
    () => Object.fromEntries(cov.rendered.map((n) => [n, iconWhere(cov.filesByIcon[n] ?? {})])),
    [cov],
  )
  const maxSite = Math.max(1, ...Object.values(cov.usage))
  const maxHist = Math.max(1, ...Object.values(cov.histogram))
  const COLS = Object.keys(cov.histogram).map(Number).sort((a, b) => a - b)

  return (
    <div style={{ background: bg, color: ink, minHeight: fillViewport ? '100dvh' : undefined, fontFamily: mono, padding: '2rem 1.75rem 4rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <ReportIntro
          what={<>Which icons the app actually imports, which it RENDERS (how often, at what pixel sizes), and <strong>where</strong> — the precise components &amp; pages each icon lands on — the iconography catalog read from <code>src</code>, never a hand-kept list.</>}
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
          {library.version && <> <span style={{ color: line }}>v{library.version}</span></>}
          {library.npm && <> · <a href={library.npm} target="_blank" rel="noreferrer" style={linkS}>npm</a></>}
          . Single-stroke, <code>currentColor</code> — inherits text color and size.
        </p>
        <p style={{ fontFamily: mono, fontSize: 12.5, color: dim, maxWidth: 820, margin: '4px 0 0', lineHeight: 1.6 }}>
          Coverage (scanned live from <code>src</code>):{' '}
          <strong style={{ color: ink }}>{cov.imported.length}</strong> icons {iconWrapper || (iconConfigProps?.length ?? 0) ? 'referenced' : 'imported'} ·{' '}
          <strong style={{ color: ink }}>{cov.rendered.length}</strong> rendered across{' '}
          <strong style={{ color: ink }}>{cov.totalSites}</strong> sites
          {cov.missing.length > 0 && <> · <span style={{ color: DANGER }}>{cov.missing.length} not in {library.version ? `v${library.version}` : 'this version'}</span></>}
          {iconWrapper && <> · <span style={{ color: dim }}>via <code>&lt;{iconWrapper.tag} {iconWrapper.nameProp}=&quot;…&quot;&gt;</code></span></>}.
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
            Sorted by usage. Each cell shows the glyph at that column&apos;s size; solid + <code>×N</code> = rendered N times at that size, faint = unused at that size.
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
                  const sites = cov.usage[name] ?? 0
                  const sizes = cov.sizesByIcon[name] ?? {}
                  return (
                    <tr key={name}>
                      <th scope="row" style={rowHead}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{Cmp && <Cmp size={18} strokeWidth={2} />}{name}</span>
                      </th>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 72, background: line, borderRadius: 3, height: 8, overflow: 'hidden', display: 'inline-block' }}>
                            <span style={{ display: 'block', width: `${(sites / maxSite) * 100}%`, height: '100%', background: ACCENT }} />
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>{sites}</span>
                        </span>
                      </td>
                      {COLS.map((px) => {
                        const n = sizes[px] ?? 0
                        return (
                          <td key={px} style={td}>
                            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: ink, opacity: n ? 1 : 0.16 }}>
                              {Cmp && <Cmp size={px} strokeWidth={2} />}
                              <span style={{ fontFamily: mono, fontSize: 10, color: dim, visibility: n ? 'visible' : 'hidden' }}>×{n}</span>
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Where each icon is used — components & pages (${cov.rendered.length})`}>
          <p style={{ fontFamily: mono, fontSize: 11, color: dim, margin: '0 0 4px', maxWidth: 820, lineHeight: 1.6 }}>
            Resolved from the usage graph (<code>component-pages.json</code>): the components whose files render each
            icon (<code>×N</code> = render sites there) and the pages those land on — each chip clicks into its story.
            Run <code>sb-inventory</code>&apos;s usage step (<code>build-component-pages.py</code>) if a row shows only file names.
          </p>
          <div style={{ display: 'grid', gap: 8, paddingTop: 12 }}>
            {cov.rendered.map((name) => {
              const Cmp = resolve(name)
              const w = whereByIcon[name] ?? { components: [], pages: [], plainFiles: [] }
              const CAP = 14
              const comps = w.components.slice(0, CAP)
              const moreComps = w.components.length - comps.length
              const empty = !comps.length && !w.pages.length && !w.plainFiles.length
              return (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 210px) 1fr', gap: 12, alignItems: 'baseline', borderTop: `1px solid ${line}`, padding: '8px 0' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: mono, fontSize: 11.5, color: ink }}>{Cmp && <Cmp size={16} strokeWidth={2} />}{name}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {empty && <span style={{ fontFamily: mono, fontSize: 11, color: dim, fontStyle: 'italic' }}>no resolved location</span>}
                    {comps.map((c) => <Chip key={c.name} label={`${c.name} ×${c.count}`} href={linkFor(c.name)} linkable />)}
                    {moreComps > 0 && <span style={{ fontFamily: mono, fontSize: 10.5, color: dim }}>+{moreComps} more</span>}
                    {w.pages.slice(0, CAP).map((p) => <Chip key={p.path} label={stripPage(p.title)} href={linkFor(p.title)} dot linkable />)}
                    {!comps.length && w.plainFiles.slice(0, CAP).map((f) => (
                      <span key={f} title={f} style={{ fontFamily: mono, fontSize: 10.5, color: dim, border: `1px dashed ${line}`, borderRadius: 999, padding: '2px 8px' }}>{f.split('/').pop()}</span>
                    ))}
                  </div>
                </div>
              )
            })}
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
                    {Cmp && <Cmp size={13} strokeWidth={2} />}{name}{dead && <span style={{ display: 'inline-flex' }} title={`absent in ${library.name}${library.version ? ` v${library.version}` : ''}`}><Icon.warning size={11} /></span>}
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
