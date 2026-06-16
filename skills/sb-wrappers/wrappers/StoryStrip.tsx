/**
 * StoryStrip — ordered sequence of specific stories, rendered horizontally
 * (or vertically) with optional step numbers and synced scrolling.
 *
 * Lighter than StorySet — for when you know exactly which stories to show
 * and in what order (typical flow walkthroughs).
 *
 * @example
 * <StoryStrip ids={[
 *   'pages-onboarding--welcome',
 *   'pages-onboarding--profile',
 *   'pages-onboarding--verify',
 *   'pages-onboarding--complete',
 * ]} direction="row" numbered />
 *
 * Storybook-only — never imported from app code.
 */
import { StorySet } from './StorySet';
import type { StoryEntry } from './StorySet';

export interface StoryStripProps {
  ids: string[];
  direction?: 'row' | 'column';
  /** Show 1-based step numbers per cell */
  numbered?: boolean;
  /** Width of each step (row) / row gap (column) */
  size?: number;
}

export function StoryStrip({ ids, direction = 'row', numbered = false, size }: StoryStripProps): JSX.Element {
  return (
    <StorySet
      ids={ids}
      layout={direction === 'row' ? 'strip' : 'timeline'}
      renderCell={(entry: StoryEntry, i: number) => (
        <div
          style={{
            background: 'var(--color-surface, #f9fafb)',
            border: '1px solid var(--color-border-subtle, #e2e0db)',
            borderRadius: 6,
            padding: '0.8rem',
            position: 'relative',
            width: direction === 'row' && size ? size : undefined,
          }}
        >
          {numbered && (
            <span
              style={{
                background: 'var(--color-brand-500, #2b5cd9)',
                color: 'white',
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
              }}
            >
              {i + 1}
            </span>
          )}
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.3rem' }}>{entry.storyName}</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground, #666)', margin: 0 }}>{entry.title}</p>
          {entry.Component && (
            <div style={{ marginTop: '0.6rem' }}>
              <entry.Component {...(entry.args ?? {})} />
            </div>
          )}
        </div>
      )}
    />
  );
}
