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
import { useMemo, type ComponentType, type CSSProperties, type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { Icon } from './icons'
import { ink, dim, line, mono } from './usage-stamp'

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
}

function analyze(importSource: string, classPx: Record<string, number>, resolve: (n: string) => IconCmp | undefined, exclude: Set<string>): Coverage {
  const importRe = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${escapeRe(importSource)}['"]`, 'gs')
  const imported = new Set<string>()
  const usage: Record<string, number> = {}
  const sizesByIcon: Record<string, Record<number, number>> = {}
  const histogram: Record<number, number> = {}
  let totalSites = 0

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
        for (const c of cls) {
          const px = classPx[c]
          if (px == null) continue
          ;(sizesByIcon[name] ??= {})[px] = (sizesByIcon[name][px] ?? 0) + 1
          histogram[px] = (histogram[px] ?? 0) + 1
        }
      }
    }
  }

  const arr = [...imported]
  const rendered = arr.filter((n) => (usage[n] ?? 0) > 0).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a.localeCompare(b))
  const unrendered = arr.filter((n) => !(usage[n] ?? 0)).sort()
  const missing = arr.filter((n) => !resolve(n)).sort()
  return { imported: arr.sort(), rendered, unrendered, missing, usage, sizesByIcon, histogram, totalSites }
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

export function IconMatrix({ library, resolve, scale = DEFAULT_SCALE, classPx = DEFAULT_CLASS_PX, exclude, fillViewport = true }: IconMatrixProps): ReactElement {
  const importSource = library.importSource ?? library.name
  const excludeKey = (exclude ?? []).join(',')
  const cov = useMemo(() => analyze(importSource, classPx, resolve, new Set(exclude ?? [])), [importSource, classPx, resolve, excludeKey])
  const maxSite = Math.max(1, ...Object.values(cov.usage))
  const maxHist = Math.max(1, ...Object.values(cov.histogram))
  const COLS = Object.keys(cov.histogram).map(Number).sort((a, b) => a - b)

  return (
    <div style={{ background: bg, color: ink, minHeight: fillViewport ? '100dvh' : undefined, fontFamily: mono, padding: '2rem 1.75rem 4rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <ReportIntro
          what={<>Which icons the app actually imports, which it RENDERS (and how often), and at what pixel sizes — the iconography catalog read from <code>src</code>, never a hand-kept list.</>}
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
            Sorted by usage. Each cell shows the glyph at that column's size; solid + <code>×N</code> = rendered N times at that size, faint = unused at that size.
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
