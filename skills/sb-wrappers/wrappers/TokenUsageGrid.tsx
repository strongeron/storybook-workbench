/**
 * TokenUsageGrid — every DECLARED design token, rendered, with its REAL usage.
 *
 * The colours/type counterpart to StateGrid's component badges. Pass the categorized token map from
 * `.storybook/project-inventory.json` (`tokens.map`, written by inventory-project.sh) and a category;
 * it renders each token as a swatch (colours) or a type sample (typography), badged with how many times
 * the app references it — and the declared-but-never-used ones struck through "×0 unused". The grid makes
 * "what's in the system vs. what we actually ship" visible. Auto-updates via `refresh-usage.sh`.
 */
import type { CSSProperties } from 'react';
import { UsageBadge } from './usage-badge';

export interface TokenUsageRow {
  token: string;
  category: string;
  status: 'used' | 'orphan';
  count: number;
}

export interface TokenUsageGridProps {
  /** The `tokens.map` array from project-inventory.json. */
  tokens: TokenUsageRow[];
  /** Render only this category (e.g. 'color' | 'typography'); omit to show all. */
  category?: string;
  /** How to render each cell: a colour swatch or a type sample. Default inferred from `category`. */
  kind?: 'color' | 'type';
  title?: string;
}

// Pick the CSS property a type token most likely drives, from its name.
function typeStyle(token: string): CSSProperties {
  const t = token.replace(/^-+/, '');
  if (t.startsWith('font-family') || t.startsWith('font-')) return { fontFamily: `var(${token})` };
  if (t.startsWith('text-') || t.startsWith('font-size')) return { fontSize: `var(${token})` };
  if (t.startsWith('line-height') || t.startsWith('leading-')) return { lineHeight: `var(${token})` };
  if (t.startsWith('tracking-') || t.startsWith('letter-spacing')) return { letterSpacing: `var(${token})` };
  if (t.startsWith('font-weight')) return { fontWeight: `var(${token})` as unknown as number };
  return { fontFamily: `var(${token})` };
}

const cell: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.35rem',
  padding: '0.6rem', border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '0.5rem',
};
const nameStyle: CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem',
  color: 'var(--color-muted-foreground, #666)', display: 'flex', alignItems: 'center',
};

export function TokenUsageGrid({ tokens, category, kind, title }: TokenUsageGridProps): JSX.Element {
  const rows = tokens.filter((r) => !category || r.category === category);
  const render = kind ?? (category === 'typography' ? 'type' : 'color');
  const grid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
      {rows.map((r) => (
        <div key={r.token} style={{ ...cell, opacity: r.status === 'orphan' ? 0.55 : 1 }}>
          {render === 'color' ? (
            <div style={{ height: 40, borderRadius: '0.375rem', border: '1px solid rgba(0,0,0,0.08)',
              // TW v4 value lives at --color-<name>; bare --<name> may not resolve, so fall back.
              background: r.token.startsWith('--color-') ? `var(${r.token})` : `var(${r.token}, var(--color-${r.token.slice(2)}))` }} />
          ) : (
            <div style={{ ...typeStyle(r.token), fontSize: typeStyle(r.token).fontSize ?? '1.05rem' }}>Ag — the quick brown fox</div>
          )}
          <div style={nameStyle}>
            <code>{r.token}</code>
            <UsageBadge fact={{ count: r.count, unused: r.status === 'orphan', label: r.token }} />
          </div>
        </div>
      ))}
    </div>
  );
  if (!title) return grid;
  return (
    <section>
      <h3 style={{ fontSize: '1rem', margin: '0 0 0.8rem' }}>{title}</h3>
      {grid}
    </section>
  );
}
