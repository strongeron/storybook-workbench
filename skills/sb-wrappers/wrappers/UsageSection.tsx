/**
 * UsageSection — a docs block that adds "Real usage in this app" to a component's AUTODOCS page.
 *
 * Instead of a separate page per component, drop this into the global autodocs layout
 * (preview.ts → `parameters.docs.page`) so EVERY component's existing Docs page gains a usage section —
 * no per-component files. From the current story's meta it resolves the component and renders
 * `ComponentContext` — the "Where it's used" map (pages it lands on, what nests it, what it renders, the
 * tokens it pulls), from `component-pages.json`. (The old prop-value table was dropped — it was empty for
 * components whose props are all dynamic, and the graph answers "real usage" better.)
 *
 * Scope: COMPONENTS get the "Where it's used" map; PAGES/* get a provenance band (PageIntro). Foundations
 * render their own self-contained stories (Colors → TokenMatrix, Health → DesignSystemHealth, etc.), so
 * this adds nothing there — the old foundation "Real usage" tables were removed (Health duplicated the
 * DesignSystemHealth story; per-token "where used" doesn't resolve for type/scale tokens).
 *
 * Fully defensive: any lookup miss or blocks-API change renders nothing, so it can never break a Docs page.
 *
 * Usage (preview.ts):
 *   import { Title, Subtitle, Description, Primary, Controls, Stories } from '@storybook/addon-docs/blocks';
 *   import { UsageSection } from './wrappers/UsageSection';
 *   const DocsPage = () => (<><Title/><Subtitle/><UsageSection/><Description/><Primary/><Controls/><Stories/></>);
 *   // parameters.docs.page = DocsPage — order is yours; UsageSection here = top status band, last = bottom.
 */
import { useOf } from '@storybook/addon-docs/blocks';
import usage from '../component-usage.json';
import { ReportIntro, provenanceEnabled } from './ReportIntro';
import { ComponentContext } from './ComponentContext';
import { useStoryLinker } from './usage-index';
import { REPORT, Chip, Lane, line, dim, mono, surface, stripTok, stripPage, type PageRef } from './usage-stamp';

interface PropUsage { count?: number; values?: Record<string, number>; exprCount?: number }
interface CompUsage { callSites?: number; files?: string[]; props?: Record<string, PropUsage>; declaredButUnused?: string[] }

function resolveName(meta: unknown): string | null {
  const comps = ((usage as { components?: Record<string, CompUsage> }).components) ?? {};
  const m = (meta ?? {}) as { component?: { displayName?: string; name?: string }; title?: string };
  const cands = [
    m.component?.displayName,
    m.component?.name,
    (m.title ?? '').split('/').pop()?.replace(/\s+/g, ''),
  ].filter(Boolean) as string[];
  for (const n of cands) if (comps[n]) return n;
  // Fallback: a component story whose component has 0 call sites isn't a key in component-usage. Still
  // return its name (from meta/title) so ComponentContext can render the "0 call sites" band instead of
  // the Docs page showing nothing.
  return cands[0] ?? null;
}

// Foundations/Typography & Scales: "Where it's used" for the tokens this app references DIRECTLY via
// var(--…). Type tokens are mostly consumed through Tailwind utilities (no var() reference) and won't
// appear — that's honest; the scale display above is the catalog, this band is the real graph usage.
function FoundationWhereUsed({ prefixes, label }: { prefixes: string[]; label: string }): JSX.Element | null {
  const linkFor = useStoryLinker();
  const tokens = REPORT.tokens ?? {};
  const used = Object.keys(tokens)
    .filter((t) => prefixes.some((p) => t.startsWith(p)))
    .filter((t) => tokens[t].components.length || tokens[t].pages.length)
    .sort((a, b) => (tokens[b].count || 0) - (tokens[a].count || 0));
  if (!used.length) return null;
  const compChip = (n: string) => <Chip key={n} label={n} href={linkFor(n)} linkable />;
  const pageChip = (p: PageRef) => <Chip key={p.path} label={stripPage(p.title)} href={linkFor(p.title)} dot linkable />;
  return (
    <section style={{ marginTop: '2.5rem', fontFamily: mono }}>
      <ReportIntro
        what={<>Where this app references the {label} tokens directly via <code>var(--…)</code> — the components and pages that pull each one (the same graph the Usage explorer reads).</>}
        source={{ file: 'component-pages.json', skill: 'sb-inventory' }}
        refresh="refresh-usage.sh"
        pipeline={[
          { skill: 'sb-inventory', role: 'token usage' },
          { skill: 'sb-flows', role: 'routes → pages' },
          { skill: 'sb-wrappers', role: 'this band' },
        ]}
      />
      <h2 style={{ fontFamily: 'inherit' }}>Where it’s used</h2>
      <p style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.5, maxWidth: '72ch' }}>
        The {label} tokens referenced directly via <code>var(--…)</code>. Tokens consumed through Tailwind
        utilities (e.g. <code>text-xl</code>, <code>font-display</code>) have no direct var() reference, so
        they don’t appear here — the scale above is their catalog.
      </p>
      <div style={{ border: `1px solid ${line}`, borderRadius: 12, background: surface }}>
        {used.map((t) => {
          const e = tokens[t];
          return (
            <div key={t} style={{ padding: '12px 16px', borderTop: `1px solid ${line}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <code style={{ fontSize: 12.5 }}>{stripTok(t)}</code>
                <span style={{ fontSize: 11, color: dim }}>{e.count} uses · {e.components.length} components · {e.pages.length} pages</span>
              </div>
              {e.components.length > 0 && <Lane label="components" count={e.components.length}>{e.components.map(compChip)}</Lane>}
              {e.pages.length > 0 && <Lane label="pages" count={e.pages.length}>{e.pages.map(pageChip)}</Lane>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Pages/* get a "what is this?" provenance band: a Page story is the REAL app page rendered in isolation
// through the provider/Inertia mocks — say so, and where it comes from, since there's no prop/usage table.
// Provenance is OFF by default (demo-only), and this section is nothing BUT the band — so when it's off,
// contribute nothing rather than an empty spacer <section>. The page story still renders via autodocs.
function PageIntro({ title }: { title: string }): JSX.Element | null {
  if (!provenanceEnabled()) return null;
  const name = title.split('/').pop() ?? title;
  return (
    <section style={{ marginTop: '2.5rem' }}>
      <ReportIntro
        what={<>The real <strong>{name}</strong> page from this app's <code>src/</code>, rendered in Storybook through the provider / Inertia mocks (<code>.storybook/mocks</code>) — the actual page, not a mockup. Flip the Theme / Viewport toolbars to exercise its real responsive + theming behavior.</>}
        source={{ file: 'src/**/pages (rendered via .storybook/mocks)', skill: 'sb-setup' }}
        pipeline={[
          { skill: 'sb-setup', role: 'provider / Inertia mocks' },
          { skill: 'sb-stories', role: 'this page story' },
        ]}
      />
    </section>
  );
}

export function UsageSection(): JSX.Element | null {
  let resolved: unknown = null;
  try {
    resolved = useOf('meta');
  } catch {
    return null; // not in a docs context — render nothing
  }
  const meta = (resolved as { preparedMeta?: unknown; meta?: unknown })?.preparedMeta
    ?? (resolved as { meta?: unknown })?.meta
    ?? resolved;
  const title = ((meta ?? {}) as { title?: string }).title ?? '';
  const lt = title.toLowerCase();
  // Foundations: Typography/Scales get a "Where it's used" band of the tokens referenced directly via
  // var(--…) (real graph data; utility-consumed tokens honestly don't appear). Colors/Health/Icons are
  // self-contained stories (TokenMatrix / DesignSystemHealth / IconMatrix) — no extra band, and the old
  // duplicate Health/declared-vs-used tables stay removed.
  if (lt.startsWith('foundations/typography')) return <FoundationWhereUsed prefixes={['--font', '--text', '--leading', '--tracking']} label="type" />;
  if (lt.startsWith('foundations/scales')) return <FoundationWhereUsed prefixes={['--radius', '--spacing', '--space', '--shadow', '--duration', '--z']} label="scale" />;
  if (lt.startsWith('foundations/')) return null;
  // Pages/* — the real app page in isolation. Show its "Where it's used" map (page-aware ComponentContext:
  // the route it serves, what it renders, the tokens it pulls — a page has 0 call sites by construction, so
  // the block reads "serves /route · N renders", not a misleading "0"). The PageIntro provenance band ("what
  // is this + where it's from") sits above it but stays OFF by default. A page docs page used to show
  // NOTHING when provenance was off — the gap this closes (session drift: "I don't see Where it's used on
  // Pages"). Resolve the page's own component from meta/title (it's a key in component-pages with isPage/route).
  if (lt.startsWith('pages/')) {
    const pageName = resolveName(meta);
    return (
      <>
        <PageIntro title={title} />
        {pageName && <ComponentContext name={pageName} usageExplorerStoryId="skill-audit--usage" />}
      </>
    );
  }

  // The component's real usage is now ONE surface: the "Where it's used" map (pages it lands on, what
  // nests it, what it renders, the tokens it pulls). The old prop-value table was dropped — it was empty
  // for components whose props are all passed dynamically, and the graph answers "real usage" better.
  const name = resolveName(meta);
  if (!name) return null;
  return <ComponentContext name={name} usageExplorerStoryId="skill-audit--usage" />;
}
