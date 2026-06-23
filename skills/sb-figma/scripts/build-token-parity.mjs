#!/usr/bin/env node
/**
 * build-token-parity.mjs — produce the design↔code parity map the foundation stories read.
 *
 *   node build-token-parity.mjs --variables .storybook/figma-variables.json \
 *        --css "src/styles/**\/*.css" --out .storybook/figma-token-parity.json
 *
 * For each Figma variable it finds the matching CSS custom property (`semantic/primary` → `--primary`,
 * following `var()` alias chains to a literal), resolves BOTH sides to a comparable value, and records
 * drift. Colours resolve to hex (bare-channel OKLCH `L C H`, `oklch(...)`, hex, or `var()` alias all
 * supported — the FOX2-10 dialect); spacing/type compare raw values. App-only code tokens (no Figma var)
 * and Figma-only variables (no code token) are listed as *expected*, not failures.
 *
 * Output: { "$meta": {...}, "color": { "--primary": {figmaVar,figmaHex,codeHex,mapsTo,drift} }, "spacing": {...}, "type": {...},
 *           "appOnly": ["--ring", ...], "figmaOnly": ["semantic/x", ...] }
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

// ── OKLCH → sRGB hex ─────────────────────────────────────────────────────────
// oklch(L C H) with L in [0,1] (or %), C ≥ 0, H in degrees. Standard OKLab matrices; gamut-clamp to sRGB.
function oklchToHex(L, C, H) {
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
  const h2 = (n) => n.toString(16).padStart(2, '0')
  return `#${h2(enc(r))}${h2(enc(g))}${h2(enc(bl))}`
}

const numPct = (s) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))

// Two hexes are "the same colour" if every channel is within `tol` (default 2/255). OKLCH→hex goes
// through gamut clamp + 8-bit rounding, so a published Figma hex and a code-resolved hex routinely differ
// by ±1 with no real drift — only a larger gap is meaningful. Returns true when they DIVERGE beyond tol.
function hexDrifts(a, b, tol = 2) {
  if (!a || !b || !/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return false
  for (let i = 1; i < 7; i += 2) {
    if (Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) > tol) return true
  }
  return false
}

// Parse a colour literal (NOT a var()) into hex, or null if not a colour.
function literalToHex(value) {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  // 8-digit (#rrggbbaa, e.g. Figma "#e4e5e580") → drop alpha for an RGB compare.
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase()
  if (/^#[0-9a-f]{4}$/i.test(v)) return ('#' + v.slice(1, 4).split('').map((c) => c + c).join('')).toLowerCase()
  const ok = v.match(/^oklch\(\s*([^)]+)\)$/i)
  const triplet = ok ? ok[1] : v
  // bare or wrapped "L C H" (slash-alpha tolerated): 0.56 0.072 234  |  66% 0.21 29
  const m = triplet.replace(/\/.*$/, '').trim().match(/^([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)$/)
  if (m && (ok || /^[\d.]/.test(v))) {
    // Heuristic for the FOX2-10 dialect: a bare triplet whose 2nd value is small (<1) is OKLCH chroma.
    const L = numPct(m[1]); const C = parseFloat(m[2]); const H = parseFloat(m[3])
    if (!Number.isNaN(L) && !Number.isNaN(C) && !Number.isNaN(H)) return oklchToHex(L, C, H)
  }
  return null
}

// ── collect CSS custom properties (last declaration wins, like the cascade at :root) ──
function collectCss(globArg) {
  const roots = []
  const base = globArg.replace(/\/\*\*.*$/, '').replace(/\/[^/]*\*.*$/, '') || '.'
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      const p = join(dir, e)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (e !== 'node_modules' && !e.startsWith('.')) walk(p) }
      else if (/\.(css|scss)$/.test(e)) roots.push(p)
    }
  }
  walk(base)
  const decls = {}
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  for (const f of roots) {
    let css = ''
    try { css = readFileSync(f, 'utf8') } catch { continue }
    for (const m of css.matchAll(re)) decls[m[1].trim()] = m[2].trim()
  }
  return decls
}

// follow var() chains to a literal
function resolveLiteral(name, decls, seen = new Set()) {
  if (seen.has(name)) return null
  seen.add(name)
  const v = decls[name]
  if (v == null) return null
  const m = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i)
  if (m) return resolveLiteral(m[1], decls, seen)
  return v
}

// ── map a Figma variable name → a code custom-property name ──
// semantic/primary → --primary ; Spacing.spacing-2 → --spacing-2 ; wght/medium → --font-weight-medium (best effort)
function codeNameFor(figmaVar, decls) {
  const leaf = figmaVar.split(/[/.]/).pop()
  const candidates = [
    `--${leaf}`,
    `--${figmaVar.split(/[/.]/).slice(-2).join('-')}`,
    `--font-weight-${leaf}`,
    `--text-${leaf}`,
    `--leading-${leaf}`,
    `--spacing-${leaf}`,
  ]
  return candidates.find((c) => c in decls) || null
}

const variablesPath = arg('--variables', '.storybook/figma-variables.json')
const cssGlob = arg('--css', 'src/**/*.css')
const out = arg('--out', '.storybook/figma-token-parity.json')

let vars
try { vars = JSON.parse(readFileSync(variablesPath, 'utf8')) }
catch { console.error(`build-token-parity: cannot read ${variablesPath} — run pull-figma-variables.mjs first`); process.exit(2) }

const decls = collectCss(cssGlob)
const result = { $meta: { variables: variablesPath, css: cssGlob, from: vars.$generatedFrom || null }, color: {}, spacing: {}, type: {}, appOnly: [], figmaOnly: [] }
const matchedCode = new Set()

for (const family of ['color', 'spacing', 'type']) {
  for (const [figmaVar, def] of Object.entries(vars[family] || {})) {
    const code = codeNameFor(figmaVar, decls)
    if (!code) { result.figmaOnly.push(figmaVar); continue }
    matchedCode.add(code)
    if (family === 'color') {
      const figmaHex = typeof def.$value === 'string' ? literalToHex(def.$value) : null
      const codeLiteral = resolveLiteral(code, decls)
      const codeHex = codeLiteral ? literalToHex(codeLiteral) : null
      const drift = hexDrifts(figmaHex, codeHex)
      result.color[code] = { figmaVar, figmaHex: figmaHex || String(def.$value), codeHex, mapsTo: codeLiteral, drift }
    } else {
      const figmaVal = String(def.$value)
      const codeVal = resolveLiteral(code, decls)
      result[family][code] = { figmaVar, figmaHex: figmaVal, codeHex: codeVal, drift: codeVal != null && codeVal.replace(/px|rem|\s/g, '') !== figmaVal.replace(/px|rem|\s/g, '') }
    }
  }
}

// app-only = colour/space/type code tokens with no matching Figma var (expected: --ring, --popover, …)
for (const name of Object.keys(decls)) {
  if (matchedCode.has(name)) continue
  const lit = resolveLiteral(name, decls)
  if (lit && literalToHex(lit)) result.appOnly.push(name)
}
result.appOnly.sort(); result.figmaOnly.sort()

writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
const drifted = ['color', 'spacing', 'type'].flatMap((f) => Object.values(result[f])).filter((r) => r.drift).length
console.log(`build-token-parity: ${out} — color ${Object.keys(result.color).length} · spacing ${Object.keys(result.spacing).length} · type ${Object.keys(result.type).length} · drift ${drifted} · appOnly ${result.appOnly.length} · figmaOnly ${result.figmaOnly.length}`)
if (result.figmaOnly.length) console.log(`  figma-only (no code token — add or ignore): ${result.figmaOnly.join(', ')}`)
