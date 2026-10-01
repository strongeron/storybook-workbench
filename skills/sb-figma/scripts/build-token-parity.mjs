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
 * Modes: the CSS is read per theme — `:root`/base rules are the default theme; `.dark`, `[data-theme=dark]`,
 * `[data-mode=dark]` and `@media (prefers-color-scheme: dark)` blocks are the dark theme (default values
 * underneath). Figma's default mode is compared with the default theme; a Figma mode named like "Dark" with
 * the dark theme. Other Figma modes (e.g. "Mobile") are listed in `unmatchedModes`, not compared.
 *
 * Output: { "$meta": {...}, "color": { "--primary": {figmaVar,figmaHex,codeHex,mapsTo,drift} }, "spacing": {...}, "type": {...},
 *           "appOnly": ["--ring", ...], "figmaOnly": ["semantic/x", ...],
 *           "modes": { "Dark": { "color": {...}, "spacing": {...}, "type": {...} } }, "unmatchedModes": [...] }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { hexDrifts, literalToHex, collectCss, resolveLiteral } from './css-tokens.mjs'
import { loadSettings, globMatcher, syncGaps, GAPS_PATH } from './workbench-settings.mjs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

// ── map a Figma variable name → a code custom-property name ──
// semantic/primary → --primary ; Spacing.spacing-2 → --spacing-2 ; wght/medium → --font-weight-medium (best effort)
// Name parts split on `/` and on a `.` that isn't a decimal point (spacing/1.5 keeps "1.5").
const SEP = /\/|(?<!\d)\.|\.(?!\d)/
function codeNameFor(figmaVar, decls) {
  const parts = figmaVar.split(SEP)
  const leaf = parts.at(-1)
  const last2 = parts.slice(-2).join('-')
  // strength 2 = matched on two name parts (red/600 → --color-red-600), 1 = leaf only (a guess).
  const candidates = [
    [`--${last2}`, 2], [`--color-${last2}`, 2], // Tailwind v4 namespaces
    [`--${leaf}`, 1], [`--color-${leaf}`, 1], [`--font-weight-${leaf}`, 1], [`--text-${leaf}`, 1],
    [`--leading-${leaf}`, 1], [`--spacing-${leaf}`, 1],
  ]
  const hit = candidates.find(([c]) => c in decls)
  return hit ? { code: hit[0], strength: hit[1] } : null
}

// Sizes compare in px (Figma floats are px; 1rem = 16px); anything else compares as normalised text.
const toPx = (v) => { const m = String(v).trim().match(/^(-?[\d.]+)(px|rem)?$/i); return m ? parseFloat(m[1]) * (m[2]?.toLowerCase() === 'rem' ? 16 : 1) : null }
function sizeDrifts(a, b) {
  const pa = toPx(a), pb = toPx(b)
  if (pa != null && pb != null) return Math.abs(pa - pb) > 0.01
  const n = (x) => String(x).replace(/["'\s]/g, '').toLowerCase()
  return n(a) !== n(b)
}

const settings = loadSettings()
const variablesPath = arg('--variables', '.storybook/figma-variables.json')
const cssGlob = arg('--css', settings.css)
const ignored = globMatcher(settings.ignore)
const out = arg('--out', '.storybook/figma-token-parity.json')

let vars
try { vars = JSON.parse(readFileSync(variablesPath, 'utf8')) }
catch { console.error(`build-token-parity: cannot read ${variablesPath} — run pull-figma-variables.mjs first`); process.exit(2) }

const themes = collectCss(cssGlob, settings.darkSelectors)
const decls = themes.default
const result = { $meta: { variables: variablesPath, css: cssGlob, from: vars.$generatedFrom || null }, color: {}, spacing: {}, type: {}, appOnly: [], figmaOnly: [], ambiguous: {}, modes: {}, unmatchedModes: [] }
const matchedCode = new Set()
const badMaps = [] // nameMap entries pointing at a token the CSS doesn't declare

// Compare one Figma mode's families with one CSS theme. `track` collects figmaOnly/matched for the default.
function parity(families, themeDecls, track) {
  const res = { color: {}, spacing: {}, type: {} }
  const strengthOf = {}
  for (const family of ['color', 'spacing', 'type']) {
    for (const [figmaVar, def] of Object.entries(families[family] || {})) {
      if (ignored(figmaVar)) continue
      // the project's own mapping (workbench.json figma.nameMap) beats every guess
      const mapped = settings.nameMap[figmaVar]
      const hit = mapped ? (mapped in themeDecls ? { code: mapped, strength: 3 } : null) : codeNameFor(figmaVar, themeDecls)
      if (mapped && !hit && track) badMaps.push({ map: `${figmaVar} → ${mapped}`, darkOnly: mapped in themes.dark })
      if (!hit) { if (track) result.figmaOnly.push(figmaVar); continue }
      const code = hit.code
      // Several Figma variables can land on one code token (bg/muted, fg/muted → --color-muted). Keep the
      // stronger match (first wins on a tie) and report the rest instead of silently overwriting.
      if (code in strengthOf) {
        if (track) (result.ambiguous[code] ??= [res[family][code]?.figmaVar].filter(Boolean)).push(figmaVar)
        if (hit.strength <= strengthOf[code]) continue
      }
      strengthOf[code] = hit.strength
      if (track) matchedCode.add(code)
      if (family === 'color') {
        const figmaHex = typeof def.$value === 'string' ? literalToHex(def.$value) : null
        const codeLiteral = resolveLiteral(code, themeDecls)
        const codeHex = codeLiteral ? literalToHex(codeLiteral) : null
        res.color[code] = { figmaVar, figmaHex: figmaHex || String(def.$value), codeHex, mapsTo: codeLiteral, drift: hexDrifts(figmaHex, codeHex), ...(hit.strength < 2 ? { guess: true } : {}) }
      } else {
        const figmaVal = String(def.$value)
        const codeVal = resolveLiteral(code, themeDecls)
        res[family][code] = { figmaVar, figmaHex: figmaVal, codeHex: codeVal, drift: codeVal != null && sizeDrifts(figmaVal, codeVal), ...(hit.strength < 2 ? { guess: true } : {}) }
      }
    }
  }
  return res
}

Object.assign(result, parity(vars, decls, true))
for (const [mode, families] of Object.entries(vars.modes || {})) {
  if (/dark/i.test(mode)) result.modes[mode] = parity(families, themes.dark, false)
  else result.unmatchedModes.push(mode)
}

// app-only = colour/space/type code tokens with no matching Figma var (expected: --ring, --popover, …)
for (const name of Object.keys(decls)) {
  if (matchedCode.has(name)) continue
  const lit = resolveLiteral(name, decls)
  if (lit && literalToHex(lit)) result.appOnly.push(name)
}
result.appOnly.sort(); result.figmaOnly.sort()

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
const driftIn = (r) => ['color', 'spacing', 'type'].flatMap((f) => Object.values(r[f])).filter((x) => x.drift).length
const modeNote = Object.entries(result.modes).map(([m, r]) => ` · ${m} drift ${driftIn(r)}`).join('')
console.log(`build-token-parity: ${out} — color ${Object.keys(result.color).length} · spacing ${Object.keys(result.spacing).length} · type ${Object.keys(result.type).length} · drift ${driftIn(result)}${modeNote} · appOnly ${result.appOnly.length} · figmaOnly ${result.figmaOnly.length}`)
if (!Object.keys(vars.modes || {}).length) console.log('  one Figma mode only — dark mode not compared (read the variables with use_figma + read-figma-variables.js to include every mode)')
// ── gaps this run found (owned kinds; ones not found again are marked resolved) ──
const found = []
for (const [code, figmaVars] of Object.entries(result.ambiguous))
  found.push({ kind: 'collision', key: code, detail: `${code} ← ${figmaVars.join(', ')}`,
    suggestion: `map each one in workbench.json figma.nameMap, or add the ones that don't belong to figma.ignore` })
for (const fam of ['color', 'spacing', 'type']) for (const [code, e] of Object.entries(result[fam])) {
  if (e.guess) found.push({ kind: 'weak-match', key: e.figmaVar, detail: `${e.figmaVar} → ${code} (matched on the last word only)`,
    suggestion: `confirm it: "${e.figmaVar}": "${code}" in figma.nameMap (or map it to the right token)` })
  if (fam === 'color' && (!e.codeHex || !/^#/.test(e.figmaHex))) found.push({ kind: 'unsupported-value', key: code,
    detail: `${code}: can't compare ${e.codeHex ? '' : `code value "${e.mapsTo}"`}${!e.codeHex && !/^#/.test(e.figmaHex) ? ' and ' : ''}${/^#/.test(e.figmaHex) ? '' : `Figma value "${e.figmaHex}"`}`,
    suggestion: 'unsupported colour syntax — report it (report-issue.sh --gaps) or ignore the token' })
}
if (result.figmaOnly.length) found.push({ kind: 'unmapped-name', key: 'figma-only', detail: `${result.figmaOnly.length} Figma variable(s) have no code token: ${result.figmaOnly.slice(0, 12).join(', ')}${result.figmaOnly.length > 12 ? ' …' : ''}`,
  suggestion: 'add figma.nameMap entries for the ones that should match; figma.ignore the rest' })
for (const m of badMaps) found.push({ kind: 'unmapped-name', key: `nameMap:${m.map}`,
  detail: m.darkOnly ? `figma.nameMap ${m.map}: declared only in the dark theme — no light value` : `figma.nameMap ${m.map}: the CSS has no such token`,
  suggestion: m.darkOnly ? 'give the token a light value in :root (or map the default mode elsewhere)' : 'fix the token name in workbench.json' })
const gapsPath = arg('--gaps', GAPS_PATH)
const open = syncGaps('build-token-parity', ['collision', 'weak-match', 'unsupported-value', 'unmapped-name'], found, gapsPath)
const amb = Object.entries(result.ambiguous)
if (amb.length) console.log(`  ${amb.length} code token(s) matched by several Figma variables (kept the closest name, rest listed in ambiguous): ${amb.slice(0, 5).map(([c, v]) => `${c} ← ${v.join(' | ')}`).join('; ')}${amb.length > 5 ? ' …' : ''}`)
if (open.length) console.log(`  ${open.length} open gap(s) in ${gapsPath} — list them: node scripts/workbench-settings.mjs gaps`)
if (result.unmatchedModes.length) console.log(`  Figma modes with no CSS theme to compare against: ${result.unmatchedModes.join(', ')}`)
if (result.figmaOnly.length) console.log(`  figma-only (no code token — add or ignore): ${result.figmaOnly.join(', ')}`)
