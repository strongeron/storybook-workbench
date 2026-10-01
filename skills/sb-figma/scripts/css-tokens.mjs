// css-tokens.mjs — read a project's CSS custom properties per theme and resolve them to comparable values.
// Shared by build-token-parity.mjs (Figma → code check) and build-figma-variables.mjs (code → Figma).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── OKLCH → sRGB hex ─────────────────────────────────────────────────────────
// oklch(L C H) with L in [0,1] (or %), C ≥ 0, H in degrees. Standard OKLab matrices; gamut-clamp to sRGB.
export function oklchToHex(L, C, H) {
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  const enc = (x) => {
    x = Math.max(0, Math.min(1, x)) // gamut clamp
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, v)) * 255)
  }
  return `#${h2(enc(r))}${h2(enc(g))}${h2(enc(bl))}`
}

const numPct = (s) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))
const h2 = (n) => Math.round(n).toString(16).padStart(2, '0')
// alpha in [0,1] → "" when opaque, else the 2-digit suffix of #rrggbbaa
const alphaHex = (a) => (a == null || Number.isNaN(a) || a >= 1 ? '' : h2(Math.max(0, a) * 255))
const parseAlpha = (s) => (s == null ? null : numPct(s.trim()))

export function hslToHex(H, S, L) {
  const k = (n) => (n + H / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return '#' + [f(0), f(8), f(4)].map((x) => h2(x * 255)).join('')
}

// Two hexes are "the same colour" if every channel (alpha too; missing = opaque) is within `tol`
// (default 2/255). OKLCH→hex goes through gamut clamp + 8-bit rounding, so a published Figma hex and a
// code-resolved hex routinely differ by ±1 with no real drift. Returns true when they DIVERGE beyond tol.
export function hexDrifts(a, b, tol = 2) {
  const ok = (x) => x && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x)
  if (!ok(a) || !ok(b)) return false
  const full = (x) => (x.length === 7 ? x + 'ff' : x)
  a = full(a); b = full(b)
  for (let i = 1; i < 9; i += 2) {
    if (Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) > tol) return true
  }
  return false
}

// Parse a colour literal (NOT a var()) into hex, or null if not a colour.
export function literalToHex(value) {
  const v = value.trim()
  // hex keeps its alpha (#rrggbbaa) unless opaque, so a translucent Figma colour isn't compared as solid
  const hex = (x) => { x = x.toLowerCase(); return x.length === 9 && x.endsWith('ff') ? x.slice(0, 7) : x }
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return hex(v)
  if (/^#[0-9a-f]{3,4}$/i.test(v)) return hex('#' + v.slice(1).split('').map((c) => c + c).join(''))
  // rgb()/rgba(), comma or space syntax (Tailwind v4 themes): rgb(254, 242, 242) · rgb(254 242 242 / 50%)
  const rgb = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (rgb) {
    const ch = (x) => Math.max(0, Math.min(255, x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)))
    return '#' + [rgb[1], rgb[2], rgb[3]].map((x) => h2(ch(x))).join('') + alphaHex(parseAlpha(rgb[4]))
  }
  const fn = v.match(/^(oklch|hsla?)\(\s*([^)]+)\)$/i)
  const body = fn ? fn[2] : v
  // "A B C" with an optional "/ alpha"; `none` = 0, a trailing `deg` is ignored
  const [chan, alpha] = body.split('/')
  const parts = chan.replace(/,/g, ' ').trim().split(/\s+/).map((x) => x.replace(/deg$/i, '').replace(/^none$/i, '0'))
  if (parts.length !== 3 || !parts.every((x) => /^-?[\d.]+%?$/.test(x))) return null
  if (!fn && !/^[\d.]/.test(v)) return null
  const [p1, p2, p3] = parts
  const a = alphaHex(parseAlpha(alpha))
  // hsl(), or a bare "H S% L%" triplet (shadcn-style themes): the % on saturation/lightness says HSL
  if ((fn && /^hsl/i.test(fn[1])) || (!fn && (p2.endsWith('%') || p3.endsWith('%')))) {
    const S = numPct(p2.endsWith('%') ? p2 : p2 + '%'), L = numPct(p3.endsWith('%') ? p3 : p3 + '%')
    return hslToHex(((parseFloat(p1) % 360) + 360) % 360, S, L) + a
  }
  // oklch(), or a bare "L C H" triplet (the FOX2-10 dialect): 0.56 0.072 234 | 66% 0.21 29
  const L = numPct(p1), C = p2.endsWith('%') ? parseFloat(p2) / 100 * 0.4 : parseFloat(p2), H = parseFloat(p3)
  if (!fn && (L > 1 || C > 0.5)) return null // not plausibly OKLCH — don't guess
  return oklchToHex(L, C, H) + a
}

// ── collect CSS custom properties (last declaration wins, like the cascade at :root) ──
// Text that marks a dark-theme block in its selector or @media prelude (quotes and spaces ignored).
export const DEFAULT_DARK = ['.dark', '[data-theme=dark]', '[data-mode=dark]', 'prefers-color-scheme: dark']
const norm = (s) => s.replace(/["'\s]/g, '').toLowerCase()
function darkMatcher(selectors) {
  const keys = selectors.map(norm)
  // a class selector must end there: `.dark` matches `.dark .x`, not `.darker`
  return (prelude) => { const p = norm(prelude); return keys.some((k) => {
    for (let i = p.indexOf(k); i >= 0; i = p.indexOf(k, i + 1)) if (!/[\w-]/.test(p[i + k.length] ?? '')) return true
    return false
  }) }
}

// One selector/at-rule prelude → which theme its declarations belong to: 'dark', 'base' or 'both'
// (`:root, .dark { … }` feeds both). `:not(…)` is dropped first, so `:root:not(.dark)` is not dark.
function themeOf(prelude, isDark) {
  if (/^@media/i.test(prelude)) return isDark(prelude) ? 'dark' : 'base'
  const parts = prelude.replace(/:not\([^)]*\)/gi, '').split(',')
  const dark = parts.filter((p) => isDark(p)).length
  return dark === 0 ? 'base' : dark === parts.length ? 'dark' : 'both'
}

// A glob like src/**/*.css, src/*.css or a plain file path → the matching files.
function filesFor(globArg) {
  let isDir = false
  if (!/\*/.test(globArg)) {
    try { const st = statSync(globArg); if (st.isFile()) return [globArg]; isDir = st.isDirectory() } catch {}
  }
  const deep = isDir || globArg.includes('**')
  const base = isDir ? globArg : globArg.replace(/\/\*\*.*$/, '').replace(/\/[^/]*\*.*$/, '') || '.'
  const leaf = /\*/.test(globArg) ? globArg.split('/').pop() : '*.{css,scss}'
  const alts = leaf.replace(/^.*\{(.*)\}.*$/, '$1') !== leaf ? leaf.replace(/^(.*)\{(.*)\}(.*)$/, (_, a, b, c) => b.split(',').map((x) => a + x + c).join('\n')).split('\n') : [leaf]
  const res = alts.map((g) => new RegExp('^' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'))
  const roots = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      const p = join(dir, e)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (deep && e !== 'node_modules' && !e.startsWith('.')) walk(p) }
      else if (res.some((re) => re.test(e))) roots.push(p)
    }
  }
  walk(base)
  return roots
}

export function collectCss(globArg, darkSelectors = DEFAULT_DARK) {
  const roots = filesFor(globArg)
  if (!roots.length) console.error(`css-tokens: no CSS files match ${globArg}`)
  // Walk each file's blocks with their full selector context (so an `@media (…dark)` wrapper counts),
  // and split custom properties into the default theme and dark-only overrides (last one wins, per theme).
  const baseDecls = {}
  const darkOnly = {}
  const isDark = darkMatcher(darkSelectors)
  // the last declaration of a block may have no `;`; `--spacing-1\.5` is stored as --spacing-1.5
  const re = /(--(?:[a-z0-9_-]|\\.)+)\s*:\s*([^;{}]+?)\s*(?:;|$)/gi
  for (const f of roots) {
    let css = ''
    try { css = readFileSync(f, 'utf8') } catch { continue }
    css = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const stack = []
    const take = (text) => {
      const themes = stack.length ? stack : ['base']
      const where = themes.includes('dark') ? 'dark' : themes.includes('both') ? 'both' : 'base'
      for (const m of text.matchAll(re)) {
        const name = m[1].replace(/\\/g, '')
        if (where !== 'dark') baseDecls[name] = m[2]
        if (where !== 'base') darkOnly[name] = m[2]
      }
    }
    let start = 0
    for (let i = 0; i < css.length; i++) {
      const ch = css[i]
      if (ch !== '{' && ch !== '}') continue
      const chunk = css.slice(start, i)
      if (ch === '{') {
        // declarations of the enclosing block written before this nested one
        const cut = chunk.lastIndexOf(';') + 1
        if (stack.length) take(chunk.slice(0, cut))
        stack.push(themeOf(chunk.slice(cut).trim(), isDark))
      } else {
        if (stack.length) take(chunk)
        stack.pop()
      }
      start = i + 1
    }
  }
  return { default: baseDecls, dark: { ...baseDecls, ...darkOnly } }
}

// follow var() chains to a literal
export function resolveLiteral(name, decls, seen = new Set()) {
  if (seen.has(name)) return null
  seen.add(name)
  const v = decls[name]
  if (v == null) return null
  return resolveValue(v, decls, seen)
}

// a value that may be var(--x[, fallback]) → its literal; the fallback is used when --x isn't declared
function resolveValue(v, decls, seen) {
  const m = v.match(/^var\(\s*(--(?:[a-z0-9_-]|\\.)+)\s*(?:,\s*(.*))?\)$/is)
  if (!m) return v
  const ref = m[1].replace(/\\/g, '')
  if (ref in decls) return resolveLiteral(ref, decls, seen)
  return m[2] != null ? resolveValue(m[2].trim(), decls, seen) : null
}

