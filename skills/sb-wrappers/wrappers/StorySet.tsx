/**
 * StorySet — Anton's TagGallery, generalized.
 *
 * Pulls stories from the project via import.meta.glob and renders them in
 * one of four layouts:
 *  - grid: cells in a responsive grid (default)
 *  - strip: horizontal scrollable row, ordered
 *  - timeline: vertical list ordered by parameters.flowOrder
 *  - tabs: one panel visible at a time, switch via tab buttons
 *
 * Selection modes (use exactly one):
 *  - tag: '<tag>' — every story carrying this tag
 *  - ids: ['title--export'] — explicit list (use the kebab-case ID Storybook generates)
 *  - filter: (entry) => boolean — predicate over entries
 *
 * IMPORTANT: the default cell renders `<meta.component {...mergedArgs} />`, so select
 * ARG-based stories (those that set `args`). Stories that use a custom `render()` (e.g.
 * a `--states`/`--variants` story that hand-builds its own JSX) carry no args, so they
 * collapse to the bare default component. For those, pass a `renderCell` that mounts the
 * real story, or point at the arg-based stories instead.
 *
 * @example
 * <StorySet tag="empty-state" layout="grid" />
 * <StorySet ids={['pages-onboarding--welcome', ...]} layout="strip" />
 * <StorySet filter={(e) => e.title.startsWith('Explore/Hero')} layout="tabs" />
 *
 * Storybook-only — never imported from app code.
 *
 * IMPORTANT: the glob paths below must match your project's stories
 * directory layout. Edit them after scaffolding into a project.
 */
import { useState, type ComponentType, type ReactNode } from 'react';

export interface StoryEntry {
  /** Storybook story id, e.g. 'components-ui-button--default' */
  id: string;
  /** Meta title, e.g. 'Components/UI/Button' */
  title: string;
  /** Story export name */
  storyName: string;
  /** The component itself, if meta.component is set */
  Component?: ComponentType<Record<string, unknown>>;
  args?: Record<string, unknown>;
  tags: string[];
  /** Parameters from the story (or meta) */
  parameters?: Record<string, unknown>;
}

export interface StorySetProps {
  tag?: string;
  ids?: string[];
  filter?: (entry: StoryEntry) => boolean;
  layout?: 'grid' | 'strip' | 'timeline' | 'tabs';
  /** When true, sort entries by parameters.flowOrder (for ordered flows) */
  ordered?: boolean;
  /** Custom cell renderer */
  renderCell?: (entry: StoryEntry, index: number) => ReactNode;
}

interface StoryModule {
  default?: { title?: string; component?: ComponentType<Record<string, unknown>>; tags?: string[]; args?: Record<string, unknown>; parameters?: Record<string, unknown> };
  [exportName: string]: unknown;
}

const modules = {
  ...(import.meta as { glob: (path: string, opts?: { eager: boolean }) => Record<string, StoryModule> })
    .glob('../../src/**/*.stories.tsx', { eager: true }),
  ...(import.meta as { glob: (path: string, opts?: { eager: boolean }) => Record<string, StoryModule> })
    .glob('../../stories/**/*.stories.tsx', { eager: true }),
};

function toStoryId(title: string, exportName: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}--${exportName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}`;
}

function collectAll(): StoryEntry[] {
  const entries: StoryEntry[] = [];
  for (const [, mod] of Object.entries(modules)) {
    const meta = mod.default;
    if (!meta?.title) continue;
    const metaTags = meta.tags ?? [];

    for (const [exportName, story] of Object.entries(mod)) {
      if (exportName === 'default' || typeof story !== 'object' && typeof story !== 'function') continue;
      const storyObj = story as { tags?: string[]; args?: Record<string, unknown>; parameters?: Record<string, unknown>; name?: string };
      const storyTags = storyObj.tags ?? [];

      entries.push({
        id: toStoryId(meta.title, exportName),
        title: meta.title,
        storyName: storyObj.name ?? exportName,
        Component: meta.component,
        args: { ...(meta.args ?? {}), ...(storyObj.args ?? {}) },
        tags: [...metaTags, ...storyTags],
        parameters: { ...(meta.parameters ?? {}), ...(storyObj.parameters ?? {}) },
      });
    }
  }
  return entries;
}

function selectEntries(props: StorySetProps): StoryEntry[] {
  const all = collectAll();
  let selected: StoryEntry[];
  if (props.tag)            selected = all.filter((e) => e.tags.includes(props.tag!));
  else if (props.ids)       selected = props.ids.map((id) => all.find((e) => e.id === id)).filter((e): e is StoryEntry => Boolean(e));
  else if (props.filter)    selected = all.filter(props.filter);
  else                      selected = all;

  if (props.ordered) {
    selected.sort((a, b) => {
      const ao = (a.parameters?.flowOrder as number | undefined) ?? Number.POSITIVE_INFINITY;
      const bo = (b.parameters?.flowOrder as number | undefined) ?? Number.POSITIVE_INFINITY;
      return ao - bo;
    });
  }
  return selected;
}

function DefaultCell({ entry }: { entry: StoryEntry }): JSX.Element {
  const { Component, args } = entry;
  return (
    <div style={{ background: 'var(--color-surface, #f9fafb)', border: '1px solid var(--color-border-subtle, #e2e0db)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ background: 'var(--color-surface, #f5f4f0)', padding: '0.3rem 0.6rem', fontSize: '0.7rem', color: 'var(--color-muted-foreground, #666)', borderBottom: '1px solid var(--color-border-subtle, #e2e0db)', fontFamily: '"SF Mono", Menlo, monospace' }}>
        {entry.title} — {entry.storyName}
      </div>
      <div style={{ padding: '0.8rem', minHeight: 80 }}>
        {Component ? <Component {...(args ?? {})} /> : <em style={{ color: 'var(--color-muted, #999)' }}>No component on meta — render manually via renderCell</em>}
      </div>
    </div>
  );
}

export function StorySet(props: StorySetProps): JSX.Element {
  const entries = selectEntries(props);
  const layout = props.layout ?? 'grid';
  const renderCell = props.renderCell ?? ((entry: StoryEntry) => <DefaultCell entry={entry} />);

  if (entries.length === 0) {
    return <p style={{ color: 'var(--color-muted, #999)', fontStyle: 'italic' }}>No stories matched.</p>;
  }

  if (layout === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.8rem' }}>
        {entries.map((entry, i) => <div key={entry.id}>{renderCell(entry, i)}</div>)}
      </div>
    );
  }

  if (layout === 'strip') {
    return (
      <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
        {entries.map((entry, i) => (
          <div key={entry.id} style={{ flex: '0 0 280px' }}>{renderCell(entry, i)}</div>
        ))}
      </div>
    );
  }

  if (layout === 'timeline') {
    return (
      <ol style={{ display: 'grid', gap: '1rem', padding: 0, listStyle: 'none' }}>
        {entries.map((entry, i) => (
          <li key={entry.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: '1rem', alignItems: 'start' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-brand-500, #2b5cd9)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              {i + 1}
            </span>
            {renderCell(entry, i)}
          </li>
        ))}
      </ol>
    );
  }

  // tabs
  return <TabsView entries={entries} renderCell={renderCell} />;
}

function TabsView({ entries, renderCell }: { entries: StoryEntry[]; renderCell: (e: StoryEntry, i: number) => ReactNode }): JSX.Element {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', overflowX: 'auto' }}>
        {entries.map((entry, i) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            style={{
              padding: '0.4rem 0.9rem',
              border: '1px solid var(--color-border-subtle, #e2e0db)',
              borderRadius: 4,
              background: i === active ? 'var(--color-brand-500, #2b5cd9)' : 'var(--color-background, white)',
              color: i === active ? 'white' : 'var(--color-foreground, #1a1a1a)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.storyName}
          </button>
        ))}
      </div>
      <div role="tabpanel">{renderCell(entries[active], active)}</div>
    </div>
  );
}
