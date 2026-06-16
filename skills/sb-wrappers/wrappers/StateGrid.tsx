/**
 * StateGrid — render every state of one component on one canvas.
 *
 * Each cell shows a labeled state. Pseudo-classes (hover / focus / active) per
 * cell are delegated to `@storybook/addon-pseudo-states` via its `pseudo-<state>-all`
 * className convention (we don't reinvent the CSS forcing). Install the addon for
 * pseudo cells to render; prop-based states (disabled, loading) always render.
 * For a 2-D variants × states table, use <StateMatrix> instead.
 *
 * Layout:
 *   cols > 1  → labeled CELLS, name on top, centered (the variants grid).
 *   cols === 1 → labeled ROWS, name left-aligned beside the component, so the
 *                state names form a single scannable column (field-requested:
 *                centered names in a 1-col list are hard for a human to scan).
 *
 * @example
 * <StateGrid component={Button} cols={4} states={[
 *   { label: 'Default',  props: { children: 'Click me' } },
 *   { label: 'Hover',    props: { children: 'Click me' }, pseudo: { hover: true } },
 *   { label: 'Disabled', props: { children: 'Click me', disabled: true } },
 * ]} />
 *
 * Storybook-only — never imported from app code.
 */
import { createElement, type ComponentType } from 'react';
import { usageForProps, UsageBadge, unusedCellStyle, type ComponentUsage } from './usage-badge';

export interface StateEntry<P> {
  label: string;
  props: P;
  /** Pseudo-class state for this cell (hover / focus / active / visited) */
  pseudo?: Record<string, boolean>;
}

export interface StateGridProps<P> {
  component: ComponentType<P>;
  states?: StateEntry<P>[];
  cols?: number;
  rows?: number | StateEntry<Partial<P>>[];
  interactions?: Array<{ label: string; props?: Partial<P>; pseudo?: Record<string, boolean> }>;
  eyebrow?: string;
  title?: string;
  /**
   * Optional real-usage data for THIS component from `.storybook/component-usage.json`
   * (`usageJson.components.<Name>`). When present, each state whose varied prop is tracked is badged
   * with the call-site ×count the audited app renders; declared-but-unused states are struck through.
   */
  usage?: ComponentUsage;
}

export function StateGrid<P>({ component: Component, states, cols, rows, interactions, eyebrow, title, usage }: StateGridProps<P>): JSX.Element {
  const ComponentForCreate = Component as ComponentType<Record<string, unknown>>;
  const matrixRows = Array.isArray(rows) ? rows : undefined;
  const matrixCols = interactions;

  if (matrixRows && matrixCols) {
    const matrix = (
      <table style={{ borderCollapse: 'separate', borderSpacing: '0.75rem', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontSize: '0.7rem', color: 'var(--color-muted-foreground, #666)' }} />
            {matrixCols.map((col) => (
              <th key={col.label} style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--color-muted-foreground, #666)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixRows.map((row) => {
            const rowFact = usage ? usageForProps(usage, row.props as Record<string, unknown>) : null;
            const dim = unusedCellStyle(rowFact?.unused);
            return (
            <tr key={row.label}>
              <th scope="row" style={{ textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-muted-foreground, #666)', width: 160 }}>
                {row.label}
                {usage && <UsageBadge fact={rowFact} />}
              </th>
              {matrixCols.map((col) => {
                const props = { ...(row.props ?? {}), ...(col.props ?? {}) } as P;
                const pseudoCls = col.pseudo
                  ? Object.keys(col.pseudo).filter((k) => col.pseudo?.[k]).map((k) => `pseudo-${k}-all`).join(' ') || undefined
                  : undefined;
                const rendered = createElement(ComponentForCreate, props as Record<string, unknown>);
                return (
                  <td key={col.label} style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <span style={dim}>{pseudoCls ? <span className={pseudoCls}>{rendered}</span> : rendered}</span>
                  </td>
                );
              })}
            </tr>
          );})}
        </tbody>
      </table>
    );

    if (!eyebrow && !title) return matrix;
    return (
      <section>
        {eyebrow && (
          <div style={{ color: 'var(--color-muted-foreground, #666)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
            {eyebrow}
          </div>
        )}
        {title && <h3 style={{ fontSize: '1rem', margin: '0 0 0.8rem' }}>{title}</h3>}
        {matrix}
      </section>
    );
  }

  const columnCount = cols ?? (typeof rows === 'number' ? rows : undefined) ?? 4;
  const rowMode = columnCount === 1; // single column → scannable left-aligned rows
  const grid = (
    <div
      className="state-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
        gap: rowMode ? '0.5rem' : '1rem',
      }}
    >
      {(states ?? []).map(({ label, props, pseudo }) => {
        const pseudoCls = pseudo
          ? Object.keys(pseudo).filter((k) => pseudo[k]).map((k) => `pseudo-${k}-all`).join(' ') || undefined
          : undefined;
        const fact = usage ? usageForProps(usage, props as Record<string, unknown>) : null;
        const rendered = pseudoCls
          ? <span className={pseudoCls}>{createElement(ComponentForCreate, props as Record<string, unknown>)}</span>
          : createElement(ComponentForCreate, props as Record<string, unknown>);
        const labelStyle = {
          fontSize: '0.7rem',
          color: 'var(--color-muted-foreground, #666)',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
          fontWeight: 600,
        };
        return (
          <div
            key={label}
            className="state-cell"
            style={{
              padding: rowMode ? '0.35rem 0' : '0.75rem 0.5rem',
              // rowMode: label left, component right, aligned in one scannable column.
              ...(rowMode
                ? { display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: '1rem', textAlign: 'left' as const }
                : { textAlign: 'center' as const }),
            }}
          >
            <div className="state-label" style={rowMode ? labelStyle : { ...labelStyle, marginBottom: '0.6rem' }}>
              {label}
              {usage && <UsageBadge fact={fact} />}
            </div>
            <span style={unusedCellStyle(fact?.unused)}>{rendered}</span>
          </div>
        );
      })}
    </div>
  );

  if (!eyebrow && !title) return grid;

  return (
    <section>
      {eyebrow && (
        <div style={{ color: 'var(--color-muted-foreground, #666)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
          {eyebrow}
        </div>
      )}
      {title && <h3 style={{ fontSize: '1rem', margin: '0 0 0.8rem' }}>{title}</h3>}
      {grid}
    </section>
  );
}
