/**
 * resolve-paint — the single source of truth for painting a design token onto a
 * DOM element and reading back its *resolved* color. Storybook-only.
 *
 * Why this exists (SBW-2 + SBW-6): bare-channel tokens (withOklch / shadcn-HSL
 * themes) hold raw channels like `0.95 0.001 234`, or alias to one via `var(--x)`.
 * A bare triplet is NOT a valid CSS color unwrapped, so `background: var(--token)`
 * reads back `rgba(0, 0, 0, 0)`. We paint, and on a transparent read retry wrapping
 * the channels in `oklch()` / `hsl()`, LEAVING the element painted with the wrapper
 * that resolves to a real color (so the visible swatch shows the true color, not
 * just the returned string).
 *
 * Four swatch surfaces need this exact dance — swatches.tsx (`useResolved`),
 * TokensCanvas.tsx (`useResolvedPaint`), usage-stamp.tsx (`Swatch`), and
 * TokenMatrix.tsx (the light/dark batch probe). Extracting it once means a 5th
 * surface can't regress the same way, and the retry order lives in one place.
 */

/** The colors getComputedStyle returns when a value didn't resolve to a real paint. */
export const isTransparent = (c: string): boolean =>
  /^(rgba?\(0,\s*0,\s*0,\s*0\)|transparent)$/.test(c)

/** Normalize a token reference to its bare custom-property name (no leading `--`).
 *  Accepts `accent`, `--accent`, `color-accent`, or a full `var(--accent)` string. */
export function tokenName(ref: string): string {
  return ref
    .replace(/^var\(\s*--/, '') // var(--accent)  → accent)
    .replace(/\s*\)\s*$/, '')   // accent)        → accent
    .replace(/^--/, '')         // --accent       → accent
}

/**
 * Paint `el` with the token and return its resolved `backgroundColor`.
 * On a transparent first read, retries `oklch(var(--name))` then `hsl(var(--name))`
 * and leaves the element painted with the wrapper that worked.
 *
 * @param el     the element to paint (its background is mutated in place)
 * @param ref    a token name or `var(--token)` string (see {@link tokenName})
 * @param restore when true, repaints the plain `var(--name)` probe after a successful
 *   wrapped read — used by batch scanners that re-measure the SAME element in a second
 *   theme pass (TokenMatrix's light → dark read), so the second pass starts clean.
 * @returns the resolved backgroundColor string (possibly transparent if nothing worked)
 */
export function resolvePaint(el: HTMLElement, ref: string, restore = false): string {
  const name = tokenName(ref)
  const probe = `var(--${name})`
  el.style.background = probe
  let v = getComputedStyle(el).backgroundColor
  if (isTransparent(v)) {
    for (const wrap of [`oklch(var(--${name}))`, `hsl(var(--${name}))`]) {
      el.style.background = wrap
      const c = getComputedStyle(el).backgroundColor
      if (!isTransparent(c)) { v = c; break }
    }
    if (restore) el.style.background = probe
  }
  return v
}
