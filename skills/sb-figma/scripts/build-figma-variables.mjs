#!/usr/bin/env node
/**
 * build-figma-variables.mjs — code → Figma: turn the project's CSS tokens into a Figma variables payload.
 *
 *   node build-figma-variables.mjs --css "src/**\/*.css" [--prefix --color-bg,--color-text-] [--collection "Code tokens"] \
 *        --out .storybook/figma-variables-push.json
 *
 * Reads custom properties per theme (`:root` → Light, `.dark` / `[data-theme=dark]` / dark `@media` → Dark),
 * resolves `var()` chains and keeps what Figma can hold: colours (hex, rgb(), oklch() / bare OKLCH triplets →
 * COLOR) and lengths (px, rem → FLOAT in px). Names map `--color-em-green` → `color/em-green`, which
 * build-token-parity maps straight back, so a pushed token round-trips.
 *
 * Output is the same shape references/read-figma-variables.js returns:
 *   [{ collection, modes: ["Light","Dark"], variables: [{ name, type, values: { Light, Dark } }] }]
 * Paste it as PAYLOAD into references/write-figma-variables.js and run that with use_figma (DRY first).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { collectCss, literalToHex, resolveLiteral } from './css-tokens.mjs'
import { loadSettings } from './workbench-settings.mjs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const settings = loadSettings()
const cssGlob = arg('--css', settings.css)
const prefixes = arg('--prefix', '--').split(',').map((p) => p.trim()).filter(Boolean)
const collection = arg('--collection', 'Code tokens')
const out = arg('--out', '.storybook/figma-variables-push.json')

// a CSS token name → a Figma variable name: first dash-group becomes the folder (--color-em-green → color/em-green)
const figmaName = (css) => css.replace(/^--/, '').replace('-', '/')
const toPx = (v) => {
  const m = String(v).trim().match(/^(-?[\d.]+)(px|rem)?$/)
  return m ? parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) : null
}

const themes = collectCss(cssGlob, settings.darkSelectors)
const variables = []
const skipped = []
for (const name of Object.keys(themes.default).sort()) {
  if (!prefixes.some((p) => name.startsWith(p))) continue
  const light = resolveLiteral(name, themes.default)
  const dark = resolveLiteral(name, themes.dark) ?? light
  if (light == null) { skipped.push(name); continue }
  const lh = literalToHex(light)
  if (lh) { variables.push({ name: figmaName(name), type: 'COLOR', values: { Light: lh, Dark: literalToHex(dark) ?? lh } }); continue }
  const lp = toPx(light)
  if (lp != null) { variables.push({ name: figmaName(name), type: 'FLOAT', values: { Light: lp, Dark: toPx(dark) ?? lp } }); continue }
  skipped.push(name) // fonts, shadows, calc(), gradients — not a single Figma variable value
}

const payload = [{ collection, modes: ['Light', 'Dark'], variables }]
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
const withDark = variables.filter((v) => v.values.Dark !== v.values.Light).length
console.log(`build-figma-variables: ${out} — ${variables.length} variable(s) for "${collection}" (${variables.filter((v) => v.type === 'COLOR').length} colour · ${variables.filter((v) => v.type === 'FLOAT').length} size · ${withDark} differ in Dark) · ${skipped.length} skipped (not a colour or length)`)
