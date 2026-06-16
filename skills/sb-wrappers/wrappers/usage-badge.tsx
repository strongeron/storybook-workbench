/**
 * usage-badge — annotate a state/variant cell with how often the audited app ACTUALLY renders it.
 *
 * The state grids show every state a component CAN have. This overlays the real call-site counts
 * from `.storybook/component-usage.json` (extract-component-usage.sh): per component,
 * `props.<prop>.values{value: n}`, `props.<prop>.count`, and `declaredButUnused[]`. A story passes
 * `usage={usageJson.components.<Name>}`; <StateGrid>/<StateMatrix> resolve each cell's varied prop+value
 * to a real ×count and visibly dim what the app never ships — so the catalog shows actual usage, not
 * just declared surface. No hand-maintenance: re-run the extractor and the imported JSON updates.
 */
import type { CSSProperties } from 'react';

export interface ComponentUsage {
  callSites?: number;
  props?: Record<string, { count?: number; values?: Record<string, number>; exprCount?: number }>;
  declaredButUnused?: string[];
}

export interface UsageFact {
  count: number;
  unused: boolean;
  label: string;
}

/**
 * Resolve a cell's merged props to its real usage. Returns the first prop the usage data tracks:
 * a string value → its `values[value]` count (0 + unused if it's a declared-but-unused union value);
 * a `true` flag → the prop's total `count`. Returns null when no prop in this cell is tracked
 * (e.g. a pure pseudo-state cell like Hover that varies no prop).
 */
export function usageForProps(
  usage: ComponentUsage | undefined,
  props: Record<string, unknown> | undefined,
): UsageFact | null {
  if (!usage || !usage.props || !props) return null;
  const unused = new Set(usage.declaredButUnused ?? []);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    const tracked = usage.props[k];
    if (typeof v === 'string') {
      if (tracked && tracked.values) {
        const count = tracked.values[v] ?? 0;
        return { count, unused: unused.has(`${k}=${v}`) || count === 0, label: `${k}=${v}` };
      }
      if (unused.has(`${k}=${v}`)) return { count: 0, unused: true, label: `${k}=${v}` };
    } else if (v === true) {
      if (tracked) return { count: tracked.count ?? 0, unused: unused.has(k), label: k };
      if (unused.has(k)) return { count: 0, unused: true, label: k };
    }
  }
  return null;
}

/**
 * Style for a cell the app never ships (a declared-but-unused variant): dimmed, desaturated, and
 * non-interactive — so the grid reads "this exists but we don't use it" instead of rendering a live,
 * out-of-context button. Pair with the "×0 unused" badge.
 */
export function unusedCellStyle(unused: boolean | undefined): CSSProperties {
  return unused ? { opacity: 0.3, filter: 'grayscale(1)', pointerEvents: 'none' } : {};
}

const badgeBase: CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  padding: '0.05rem 0.32rem',
  borderRadius: '999px',
  marginLeft: '0.4rem',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
  letterSpacing: '0.02em',
};

/** Small inline pill: "×N" for used states, struck-through "×0 unused" for declared-but-unused ones. */
export function UsageBadge({ fact }: { fact: UsageFact | null }): JSX.Element | null {
  if (!fact) return null;
  if (fact.unused) {
    return (
      <span
        style={{ ...badgeBase, background: 'var(--color-muted, #eee)', color: 'var(--color-muted-foreground, #999)', textDecoration: 'line-through' }}
        title={`${fact.label}: never rendered in this app`}
      >
        ×0 unused
      </span>
    );
  }
  return (
    <span
      style={{ ...badgeBase, background: 'color-mix(in oklab, var(--color-primary, #3b82f6) 16%, transparent)', color: 'var(--color-primary, #3b82f6)' }}
      title={`${fact.label}: ${fact.count} call site(s) in this app`}
    >
      ×{fact.count}
    </span>
  );
}
