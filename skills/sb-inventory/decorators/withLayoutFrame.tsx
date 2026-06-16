/**
 * withLayoutFrame — a layout-aware global decorator for Storybook.
 *
 * THE BUG IT FIXES: a global decorator that blanket-applies `minHeight: 100vh` to
 * every story forces primitives (Badge, Button) to sit alone in a viewport-tall box
 * — large dead whitespace, and autodocs reads poorly. The frame should follow the
 * story's own `layout` parameter, not override it.
 *
 * TWO-LAYER MODEL (pairs with the canvas-root theming in preview-head.html — see
 * sb-setup install-wizard item 9):
 *   1. Per-story: `parameters: { layout: 'centered' }` for primitives, `'fullscreen'`
 *      for pages/reports, `'padded'` (the default) for everything else.
 *   2. Global (this decorator): fill the viewport ONLY when the story wants it —
 *      `layout: 'fullscreen'` OR an explicit `parameters: { fillViewport: true }`.
 *      centered/padded stories shrink-wrap to content; the theme background still
 *      shows because it is painted on the canvas ROOT (preview-head.html), not here.
 *      So this decorator never paints a background for the shrink-wrap case — that is
 *      exactly what causes the "dark sliver in a white field" bug (item 9).
 *
 * Register this LAST in `.storybook/preview.tsx` `decorators: [...]` so it frames the
 * already-provider-wrapped story:
 *   import { withLayoutFrame } from './decorators/withLayoutFrame';
 *   const preview = { decorators: [withThemeProviders, withLayoutFrame], ... };
 *
 * Storybook-only — never imported from app code. Uses the automatic JSX runtime, so
 * no explicit React import is needed (matches the wrappers).
 */
import type { ReactElement, ReactNode } from 'react';

type StoryContext = { parameters?: { layout?: string; fillViewport?: boolean } };
type StoryFn = () => ReactElement;

export function withLayoutFrame(Story: StoryFn, context: StoryContext): ReactNode {
  const layout = context.parameters?.layout ?? 'padded';
  // fullscreen always fills; any layout can opt in via `parameters: { fillViewport: true }`.
  const fillViewport = context.parameters?.fillViewport ?? layout === 'fullscreen';

  // centered / padded: shrink-wrap. Do NOT wrap in a sized/painted div — the canvas
  // root (preview-head.html) supplies the theme background for every layout.
  if (!fillViewport) return <Story />;

  // fullscreen / opt-in: give page- and report-style stories a viewport-tall frame so
  // short content still fills. `100dvh` (not `100vh`) so mobile browser chrome is handled.
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--color-background)',
        color: 'var(--color-foreground)',
      }}
    >
      <Story />
    </div>
  );
}
