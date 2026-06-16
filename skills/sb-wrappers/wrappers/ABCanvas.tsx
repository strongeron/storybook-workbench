/**
 * ABCanvas — A/B/N comparison wrapper.
 *
 * Renders 2+ variants side-by-side (or stacked / tabbed) with labeled headers.
 * Replaces hand-rolled `<div className="grid grid-cols-2">` markup in
 * comparison stories. Reads decisionId to coordinate with TrackedDecision.
 *
 * @example
 * <ABCanvas variants={[
 *   { label: 'V1 (current)',  node: <Hero />,   note: 'Button-driven' },
 *   { label: 'V2 (candidate)', node: <HeroV2 />, note: 'Inline CTA' },
 * ]} />
 *
 * Storybook-only — never imported from app code.
 */
import type { ReactNode } from 'react';
import { ExperimentBanner, type ExperimentBannerProps } from './ReportIntro';

export interface ABVariant {
  label: string;
  node: ReactNode;
  note?: string;
}

export interface ABCanvasProps {
  variants: ABVariant[];
  layout?: 'side-by-side' | 'stacked' | 'tabs';
  /** Decision id for coordination with TrackedDecision (optional) */
  decisionId?: string;
  /**
   * Show the "this is an experiment, not shipped" lifecycle banner at the top.
   * `true` uses the defaults; pass an object to set skill / status / note / target.
   */
  experiment?: boolean | ExperimentBannerProps;
}

export function ABCanvas({ variants, layout = 'side-by-side', experiment }: ABCanvasProps): JSX.Element {
  const banner = experiment ? <ExperimentBanner {...(experiment === true ? {} : experiment)} /> : null;
  if (layout === 'tabs') {
    return <>{banner}<TabsLayout variants={variants} /></>;
  }
  const cols = layout === 'side-by-side' ? variants.length : 1;
  return (
    <>
    {banner}
    <div className={`abc-canvas abc-canvas--${layout}`} style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {variants.map(({ label, node, note }) => (
        <section key={label} className="abc-variant">
          <header style={{ background: 'var(--color-surface, #f3f4f6)', padding: '0.5rem 0.8rem', marginBottom: '0.6rem', borderRadius: 4 }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{label}</h4>
            {note && <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground, #666)', marginTop: '0.1rem' }}>{note}</div>}
          </header>
          {node}
        </section>
      ))}
    </div>
    </>
  );
}

function TabsLayout({ variants }: { variants: ABVariant[] }): JSX.Element {
  const initialId = variants[0]?.label ?? '';
  return (
    <div className="abc-tabs">
      <div role="tablist" style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        {variants.map(({ label }, i) => (
          <button
            key={label}
            role="tab"
            data-tab={label}
            aria-selected={label === initialId}
            style={{
              padding: '0.4rem 0.9rem',
              border: '1px solid var(--color-border-subtle, #e2e0db)',
              borderRadius: 4,
              background: label === initialId ? 'var(--color-brand-500, #2b5cd9)' : 'var(--color-surface, #fff)',
              color: label === initialId ? 'white' : 'var(--color-foreground, #1a1a1a)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {variants.map(({ label, node, note }, i) => (
        <div
          key={label}
          role="tabpanel"
          hidden={i !== 0}
        >
          {note && <p style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground, #666)', marginTop: 0 }}>{note}</p>}
          {node}
        </div>
      ))}
    </div>
  );
}
