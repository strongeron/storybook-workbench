// Wrapper view-design — the ONE icon language shared by every Storybook wrapper.
//
// RULE (see CONTEXT.md §wrapper-view-design): wrappers NEVER hardcode emoji.
// They render an icon from this set, or accept an `icons` prop to override with the
// project's own set (lucide-react, Phosphor, custom SVGs) so the wrapper matches the
// app's visual language. Defaults below are dependency-free inline SVG: 24×24 viewBox,
// `currentColor` stroke, 1.6 stroke-width — so they inherit text color and size.
//
// This file is always scaffolded alongside the wrappers (scaffold-wrapper.sh force-copies
// it like the barrel) so a wrapper copied alone never loses its icons.
import type { ComponentType, CSSProperties, ReactNode } from 'react'

export type WrapperIcon = ComponentType<{ size?: number; style?: CSSProperties }>

const svg = (path: ReactNode): WrapperIcon =>
  function I({ size = 15, style }: { size?: number; style?: CSSProperties }) {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, verticalAlign: 'text-bottom', ...style }}
        aria-hidden
      >
        {path}
      </svg>
    )
  }

// Semantic slots used across the design-system / inventory / decision wrappers.
export const Icon = {
  // 🎨 → palette (design system, colors)
  palette: svg(<>
    <circle cx="13.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.4-.4-.4-.6-.9-.6-1.4 0-1.1.9-2 2-2h2.4A4.8 4.8 0 0 0 22 10.4 10 10 0 0 0 12 2Z" />
  </>),
  // ⚠ → warning / mixed
  warning: svg(<>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </>),
  // 🎯 → tokens
  tokens: svg(<>
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </>),
  // 🚨 → alert (orphans, drift)
  alert: svg(<>
    <path d="M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6Z" />
    <path d="M10.3 21a2 2 0 0 0 3.4 0" />
  </>),
  // ⭐ → star (top / featured)
  star: svg(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />),
  // ✓ → check (pass / used)
  check: svg(<path d="M20 6 9 17l-5-5" />),
  // ● → dot (status, generic marker)
  dot: svg(<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />),
  // ℹ → info
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>),
  // ✗ → close / rejected / error
  x: svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  // ⏳ → clock / pending
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  // 📚 → box / stack (libraries, layers)
  box: svg(<><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>),
  // ↗ → open / jump out (open a story, follow a link) — replaces the raw ↗ glyph
  external: svg(<><path d="M8 7h9v9" /><path d="m8 16 9-9" /></>),
} satisfies Record<string, WrapperIcon>

export type WrapperIcons = Partial<typeof Icon>

/** Merge project overrides over the defaults. `const ic = mergeIcons(icons)` then `<ic.palette />`. */
export function mergeIcons(overrides?: WrapperIcons): typeof Icon {
  return { ...Icon, ...overrides }
}
