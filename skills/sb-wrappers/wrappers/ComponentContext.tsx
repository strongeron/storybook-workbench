/**
 * ComponentContext — the per-component "Where it's used" map, and the ONE real-usage surface on a
 * component's Docs page (UsageSection renders it; the old prop-value table was dropped).
 *
 * For the resolved component it renders the Usage explorer's own stamp (Header + relation lanes +
 * story-coverage chips + legend, from `usage-stamp`) over the SAME store (`component-pages.json`): the
 * pages it renders on, what it's nested in, what it renders, and the tokens it pulls — each chip a click
 * into its story when one exists, plus a deep-link into the full explorer.
 *
 * Reused, not duplicated: edit the look in `usage-stamp`. Defensive — unknown component → renders nothing.
 * Storybook-only.
 */
import { type ReactElement } from 'react'
import { ReportIntro } from './ReportIntro'
import { useStoryLinker } from './usage-index'
import {
  brand, dim, mono,
  type PageRef, REPORT, isColor, stripTok, stripPage,
  Chip, Lane, Header, Legend, Muted, card,
} from './usage-stamp'

export interface ComponentContextProps {
  name: string
  /** story id of the Usage explorer, so "see all →" deep-links pre-focused on this component. */
  usageExplorerStoryId?: string
}

export function ComponentContext({ name, usageExplorerStoryId }: ComponentContextProps): ReactElement | null {
  const linkFor = useStoryLinker()
  const c = REPORT.components?.[name]
  // Not in the usage graph = 0 call sites: the component is never referenced by another component or a
  // routed page. Say so plainly (a real audit signal — standalone/demo surface or dead) instead of
  // rendering nothing, so every component's Docs answers "where is this used?".
  if (!c) {
    return (
      <section style={{ marginTop: '2.5rem', fontFamily: mono }}>
        <h2 style={{ fontFamily: 'inherit' }}>Where it’s used</h2>
        <div style={card}>
          <Header eyebrow="component" title={name} meta={linkFor(name) ? 'has a story' : 'no story yet'} />
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

  return (
    <section style={{ marginTop: '2.5rem', fontFamily: mono }}>
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
      <h2 style={{ fontFamily: 'inherit' }}>Where it’s used</h2>
      <p style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.5, maxWidth: '70ch' }}>
        The Usage explorer’s map, focused on <code>{name}</code>. A solid chip with ↗ has a story; a dashed
        one is a coverage gap.
      </p>
      <div style={card}>
        <Header eyebrow="component" title={name}
          meta={`${c.callSites} call sites · ${c.props} props · ${linkFor(name) ? 'has a story' : 'no story yet'}`} />
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
        {seeAll && (
          <a href={seeAll} target="_top"
            style={{ display: 'inline-block', marginTop: 12, fontFamily: mono, fontSize: 11, color: brand, textDecoration: 'none' }}>
            see all in the Usage explorer →
          </a>
        )}
        <Legend />
      </div>
    </section>
  )
}
