/**
 * StateMatrix — render a component across TWO axes at once: variants × states.
 *
 * Where <StateGrid> is a flat 1-D list of named cells, StateMatrix is the 2-D
 * design-system table: rows = variants (primary / secondary / ghost …),
 * columns = states (default / hover / focus / active / disabled / loading).
 * Every cell is the component with baseProps + that row's variant props + that
 * column's state props merged. This is the "all variants × all states" catalog
 * view — one scan tells you every variant behaves correctly in every state.
 *
 * Pseudo-state columns (hover / focus / active / visited / focus-visible) are
 * delegated to `@storybook/addon-pseudo-states` — we DON'T reinvent the CSS
 * forcing. Each pseudo cell wraps the component in a `pseudo-<state>-all` span
 * (the addon's documented per-element className; `-all` forces the state on the
 * element AND its descendants, so the component's own `:hover` rules fire).
 * Install the addon for these columns to render; without it they show the
 * resting state. Prop-based states (disabled, loading, size, …) always render.
 *
 * @example
 * <StateMatrix
 *   component={Button}
 *   baseProps={{ children: 'Button' }}
 *   variants={[
 *     { label: 'Primary',   props: { variant: 'primary' } },
 *     { label: 'Secondary', props: { variant: 'secondary' } },
 *     { label: 'Ghost',     props: { variant: 'ghost' } },
 *   ]}
 *   states={[
 *     { label: 'Default'  },
 *     { label: 'Hover',    pseudo: { hover: true } },
 *     { label: 'Disabled', props: { disabled: true } },
 *     { label: 'Loading',  props: { loading: true } },
 *   ]}
 * />
 *
 * Storybook-only — never imported from app code.
 */
import { createElement, type ComponentType } from 'react';
import { usageForProps, UsageBadge, unusedCellStyle, type ComponentUsage } from './usage-badge';

export interface MatrixAxis<P> {
  label: string;
  /** Props this axis contributes to each cell (e.g. { variant: 'primary' } or { disabled: true }). */
  props?: Partial<P>;
  /** Pseudo-class for this axis cell (hover / focus / active / visited) — needs the pseudo-states addon. */
  pseudo?: Record<string, boolean>;
}

export interface StateMatrixProps<P> {
  component: ComponentType<P>;
  /** Rows. */
  variants: MatrixAxis<P>[];
  /** Columns. */
  states: MatrixAxis<P>[];
  /** Props shared by every cell (e.g. { children: 'Button' }). */
  baseProps?: Partial<P>;
  /**
   * Optional real-usage data for THIS component from `.storybook/component-usage.json`
   * (`usageJson.components.<Name>`). When present, each variant row is badged with the call-site
   * ×count the audited app actually renders, and declared-but-unused variants are struck through —
   * turning the "all variants" catalog into "all variants, with what's really shipped marked".
   */
  usage?: ComponentUsage;
}

/** Convert a {hover:true, focus:true} map into addon-pseudo-states classNames
 *  ("pseudo-hover-all pseudo-focus-all"). `-all` forces the state on descendants
 *  too, so the rendered component's own pseudo rules apply. Empty → no class. */
function pseudoClassName(pseudo?: Record<string, boolean>): string | undefined {
  if (!pseudo) return undefined;
  const cls = Object.keys(pseudo)
    .filter((k) => pseudo[k])
    .map((k) => `pseudo-${k}-all`)
    .join(' ');
  return cls || undefined;
}

const headCell: React.CSSProperties = {
  fontSize: '0.68rem',
  color: 'var(--color-muted-foreground, #666)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  padding: '0.5rem 0.9rem',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

export function StateMatrix<P>({
  component: Component,
  variants,
  states,
  baseProps,
  usage,
}: StateMatrixProps<P>): JSX.Element {
  return (
    <table
      className="state-matrix"
      style={{ borderCollapse: 'separate', borderSpacing: '0.75rem' }}
    >
      <thead>
        <tr>
          <th style={{ ...headCell, textAlign: 'left' }} />
          {states.map((s) => (
            <th key={s.label} style={headCell}>{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => {
          const rowFact = usage ? usageForProps(usage, v.props as Record<string, unknown>) : null;
          const dim = unusedCellStyle(rowFact?.unused);
          return (
          <tr key={v.label}>
            <th scope="row" style={{ ...headCell, textAlign: 'left' }}>
              {v.label}
              {usage && <UsageBadge fact={rowFact} />}
            </th>
            {states.map((s) => {
              // props precedence: base → variant (row) → state (column)
              const props = { ...(baseProps ?? {}), ...(v.props ?? {}), ...(s.props ?? {}) } as P;
              // pseudo-states delegated to @storybook/addon-pseudo-states via its className convention
              const pseudoCls = pseudoClassName({ ...(v.pseudo ?? {}), ...(s.pseudo ?? {}) });
              // createElement (not <Component {...props} />) sidesteps the generic-spread overload
              // error TS flags on ComponentType<P> — same pattern StateGrid uses.
              const rendered = createElement(Component as ComponentType<Record<string, unknown>>, props as Record<string, unknown>);
              return (
                <td
                  key={s.label}
                  className="matrix-cell"
                  // Bare cell — no surface card. Matches the reference variants grid
                  // (StateGrid's matrix mode) so the component reads as itself, not boxed.
                  style={{
                    padding: '0.75rem 0.5rem',
                    textAlign: 'center',
                    verticalAlign: 'middle',
                  }}
                >
                  <span style={dim}>{pseudoCls ? <span className={pseudoCls}>{rendered}</span> : rendered}</span>
                </td>
              );
            })}
          </tr>
        );})}
      </tbody>
    </table>
  );
}
