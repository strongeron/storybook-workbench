/**
 * ComponentContext — the per-component "Where it's used" map, and the ONE real-usage surface on a
 * component's Docs page (UsageSection renders it; the old prop-value table was dropped).
 *
 * For the resolved component it renders the Usage explorer's own stamp (Header + relation lanes +
 * story-coverage chips + legend, from `usage-stamp`) over the SAME store (`component-pages.json`): the
 * pages it renders on, what it's nested in, what it renders, and the tokens it pulls — each chip a click
 * into its story when one exists, plus a deep-link into the full explorer.
 *
 * Collapsed by default for fast scanning: on a component's autodocs page you want the high-level glance
 * (an adaptive meta line — only the counts that are non-zero) at once, and the heavy "where it's used"
 * map (pages, parents, children, tokens — which can be long) only on demand. A compact "where it's used"
 * eyebrow + meta IS the always-visible <summary> (no redundant big <h2> — the Docs title already names
 * the component); the lanes live inside a native <details> that starts closed in autodocs and open on
 * the standalone audit page (same isInAutodocs rule as UsageDisclosure).
 *
 * Page-aware: a component whose own file IS a routed page (build-component-pages emits isPage + route)
 * is mounted by the router as a config value, never as JSX — so "0 call sites · 0 props" is accurate but
 * useless. For a page the meta drops call-sites/props and shows what's TRUE of a page instead: the route
 * it serves, what it renders, the tokens it pulls. Call-sites/props show ONLY for real components, and
 * only when non-zero.
 *
 * Reused, not duplicated: edit the look in `usage-stamp`. Defensive — unknown component → renders nothing.
 * Storybook-only.
 */
import { useEffect, useRef, type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { isInAutodocs, useStoryLinker } from './usage-index'
import {
  brand, dim, ink, mono,
  type PageRef, type CompEntry, REPORT, isColor, stripTok, stripPage,
  Chip, Lane, Legend, Muted, card,
} from './usage-stamp'

export interface ComponentContextProps {
  name: string
  /** story id of the Usage explorer, so "see all →" deep-links pre-focused on this component. */
  usageExplorerStoryId?: string
}

// Right-edge disclosure chevron — the SAME shadcn-style chevron DesignSystemHealth uses (points down
// when closed, rotates 180° on open). Rotation is CSS-driven off `details[open]` (class `.cc-acc`), so
// the native <details> still owns toggling + keyboard; we only replace the default triangle marker.
function Chevron(): ReactElement {
  return (
    <svg className="cc-acc-chevron" width="15" height="15" viewBox="0 0 16 16" aria-hidden
      style={{ transition: 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)', color: 'var(--color-muted-foreground)', flexShrink: 0 }}>
      <path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The compact bar label: a small "where it's used" eyebrow with the adaptive meta on the same line. The
// component name is intentionally NOT repeated — the Docs title above already names it (dropping the old
// redundant <h2> + "COMPONENT / Name" stack). Reused by both the in-graph and not-in-graph branches.
function Eyebrow({ meta }: { meta: string }): ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: dim, whiteSpace: 'nowrap', flexShrink: 0 }}>
        where it’s used
      </span>
      <span style={{ fontSize: 12, color: ink, minWidth: 0 }}>{meta}</span>
    </span>
  )
}

// Adaptive meta: only the counts that are non-zero, so a component reads "5 call sites · 2 props · has a
// story" and a page reads "serves /scheduler · 5 renders · has a story" — never a wall of zeros. Pages
// (mounted by the router as a value, not JSX) drop call-sites/props entirely and lead with the route they
// serve; both kinds always end with story coverage (the audit's point).
function buildMeta(c: CompEntry, hasStory: boolean): string {
  const n = (v: number | undefined, label: string) => (v && v > 0 ? `${v} ${label}` : null)
  const story = hasStory ? 'has a story' : 'no story yet'
  const parts = c.isPage
    ? [c.route ? `serves ${c.route}` : null, n(c.children.length, 'renders'), n(c.tokens?.length, 'tokens'), n(c.pages.length, 'on pages'), story]
    : [n(c.callSites, 'call sites'), n(c.props, 'props'), n(c.pages.length, 'pages'), story]
  return parts.filter(Boolean).join(' · ')
}

export function ComponentContext({ name, usageExplorerStoryId }: ComponentContextProps): ReactElement | null {
  const linkFor = useStoryLinker()
  // The heavy usage map collapses by default inside autodocs (scan components fast) and opens on the
  // standalone audit page (the map is the point). Native <details> owns toggling + keyboard; we only set
  // the autodocs default once, after mount.
  const detailsRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const el = detailsRef.current
    if (el) el.open = !isInAutodocs(el)
  }, [])
  const c = REPORT.components?.[name]
  // Not in the usage graph = 0 call sites: the component is never referenced by another component or a
  // routed page. Say so plainly (a real audit signal — standalone/demo surface or dead) instead of
  // rendering nothing, so every component's Docs answers "where is this used?".
  if (!c) {
    return (
      <section style={{ marginTop: '2.5rem', fontFamily: mono }}>
        <div style={card}>
          <Eyebrow meta={linkFor(name) ? 'has a story' : 'no story yet'} />
          <p style={{ fontSize: 13, color: dim, lineHeight: 1.55, margin: '10px 0 0', maxWidth: '70ch' }}>
            Not referenced by any other component or routed page in this app — <strong>0 call sites</strong>.
            It’s rendered on its own (a standalone or demo surface) or not yet wired in, so there’s no usage
            graph to map. Source: <code>component-pages.json</code> (sb-inventory).
          </p>
        </div>
      </section>
    )
  }

  const compChip = (n: string) => <Chip key={n} label={n} href={linkFor(n)} onClick={undefined} linkable />
  const pageChip = (p: PageRef) => <Chip key={p.path} label={stripPage(p.title)} href={linkFor(p.title)} dot linkable />
  const tokenChip = (t: string) => <Chip key={t} label={stripTok(t)} swatch={isColor(t) ? `var(${t})` : undefined} />
  const covComps = (names: string[]) => names.filter((n) => !!linkFor(n)).length
  const covPages = (ps: PageRef[]) => ps.filter((p) => !!linkFor(p.title)).length
  const toks = c.tokens ?? []
  const seeAll = usageExplorerStoryId
    ? `/?path=/story/${usageExplorerStoryId}&args=focusKind:component;focus:${name}`
    : null

  const metaLine = buildMeta(c, !!linkFor(name))

  return (
    <section style={{ marginTop: '2.5rem', fontFamily: mono }}>
      {/* Collapsed by default: the <summary> eyebrow + adaptive meta is the high-level glance; the lanes
          (which can be a long wall on a heavily-used component) expand only on demand. No redundant big
          <h2> — the Docs title already names the component. Native <details> = free toggle + keyboard;
          the autodocs default is set in the effect above. The default triangle marker is hidden and
          replaced by a right-edge chevron (DesignSystemHealth's pattern), rotated via CSS. */}
      <style>{`
        .cc-acc-summary { list-style: none; }
        .cc-acc-summary::-webkit-details-marker { display: none; }
        .cc-acc-summary:hover .cc-acc-chevron { color: var(--color-foreground); }
        .cc-acc[open] .cc-acc-chevron { transform: rotate(180deg); }
        @media (prefers-reduced-motion: reduce) { .cc-acc-chevron { transition: none !important; } }
      `}</style>
      <details ref={detailsRef} className="cc-acc" style={{ ...card, padding: 0 }}>
        <summary
          className="cc-acc-summary"
          title="Show where this component is used"
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow meta={metaLine} />
          </span>
          <Chevron />
        </summary>
        <div style={{ padding: '0 18px 16px' }}>
          <ReportIntro
            what={<>The real <code>{name}</code> component from this app's <code>src/</code>, rendered in isolation — the stories below are its documented states. This band shows where it's actually <strong>used</strong>: the pages it renders on, what nests it, what it renders, and the design tokens it pulls (the same graph the Usage explorer reads).</>}
            source={{ file: 'component-pages.json', skill: 'sb-inventory' }}
            refresh="refresh-usage.sh"
            pipeline={[
              { skill: 'sb-inventory', role: 'usage graph' },
              { skill: 'sb-flows', role: 'routes → pages' },
              { skill: 'sb-wrappers', role: 'this block' },
            ]}
            generatedAt={REPORT.generatedAt}
          />
          <p style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.5, maxWidth: '70ch', margin: '0 0 12px' }}>
            The Usage explorer’s map, focused on <code>{name}</code>. A solid chip with ↗ has a story; a dashed
            one is a coverage gap.
          </p>
          <Lane label="pages" count={c.pages.length} covered={covPages(c.pages)}>
            {c.pages.length ? c.pages.map(pageChip) : <Muted>no routed page</Muted>}
          </Lane>
          {c.parents.length > 0 && (
            <Lane label="nested in" count={c.parents.length} covered={covComps(c.parents)}>{c.parents.map(compChip)}</Lane>
          )}
          {c.children.length > 0 && (
            <Lane label="renders" count={c.children.length} covered={covComps(c.children)}>{c.children.map(compChip)}</Lane>
          )}
          <Lane label="tokens" count={toks.length}>{toks.length ? toks.map(tokenChip) : <Muted>none resolved</Muted>}</Lane>
          {/* Legend and the deep-link share one row: the convention key on the left, "see all →" on the right. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <Legend />
            {seeAll && (
              <a href={seeAll} target="_top"
                style={{ marginTop: 14, fontFamily: mono, fontSize: 11, color: brand, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                see all in the Usage explorer →
              </a>
            )}
          </div>
        </div>
      </details>
    </section>
  )
}
