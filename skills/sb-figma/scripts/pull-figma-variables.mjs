#!/usr/bin/env node
/**
 * pull-figma-variables.mjs — normalize Figma published variables into a stable DTCG-ish cache.
 *
 * Scripts can't call the Figma MCP directly, so the flow is: the AGENT runs the MCP tool
 * `get_variable_defs` (file id + variables node id), then pipes that JSON to this script on stdin:
 *
 *   <mcp get_variable_defs output> | node pull-figma-variables.mjs --from-mcp - --out .storybook/figma-variables.json
 *
 * Headless / no MCP: omit --from-mcp and the script just validates+reprints the existing --out cache so the
 * rest of the pipeline (build-token-parity) still runs against the last good pull. This is the degrade path.
 *
 * Output shape (families kept separate so spacing/type aren't forced through colour resolution):
 *   { "$generatedFrom": {file,node}, "color": {<var>:{$value,$type,ref?}}, "spacing": {...}, "type": {...} }
 */
import { readFileSync, writeFileSync } from 'node:fs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

const fromMcp = arg('--from-mcp')
const out = arg('--out', '.storybook/figma-variables.json')
const file = arg('--file', '')
const node = arg('--node', '')

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

// The MCP get_variable_defs payload varies by server version: it may be a flat list of
// {name,resolvedType,valuesByMode|value} or a nested DTCG tree. Normalize both into family buckets.
// The LIVE remote MCP returns a FLAT { "name": "value" } map where the value is already resolved and its
// KIND names the family (verified against the Detections file 2026-06-22):
//   "#fbfcfc" / "#e4e5e580" → color · "20" / "650" → spacing|type (by name) · "Font(…)" → type ·
//   "Effect(…)" → effect. So classify by VALUE first (the live shape carries no $type), then fall back
//   to the name namespace (for unresolved alias refs like "{Colors.primitive.x}").
function classify(name, value) {
  const v = String(value ?? '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return 'color'
  if (/^effect\(/i.test(v)) return 'effect'                 // shadows / inner-shadows
  if (/^font\(/i.test(v)) return 'type'                     // font descriptors
  if (/^-?\d*\.?\d+$/.test(v)) {                            // bare number — spacing vs type by name
    if (/spac|gap|inset|margin|padding/i.test(name)) return 'spacing'
    if (/size|text|wght|weight|leading|line|icon|tracking|letter/i.test(name)) return 'type'
    return 'spacing' // length scalars (spacing, radii, border-width) bucket here consistently
  }
  if (/colou?r|background|foreground|border|accent|primary|secondary|muted|destructive|success|warning|card|popover|input|ring|sidebar|chart|shadow-color/i.test(name)) return 'color'
  if (/font|text|leading|wght|weight|^size|spec|tabular|form|modules|type/i.test(name)) return 'type'
  if (/spac|gap|radius/i.test(name)) return 'spacing'
  return 'other'
}

function firstModeValue(v) {
  if (v == null) return v
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('$value' in v) return v.$value
    // valuesByMode / {Desktop,Mobile} — take the first concrete mode deterministically (sorted key).
    const keys = Object.keys(v).sort()
    if (keys.length) return v[keys[0]]
  }
  return v
}

// The live MCP returns typography as opaque `Font(family: "X", style: Y, size: N, weight: W, lineHeight: L,
// letterSpacing: S)` strings (real-session finding). Parse to a structured object so downstream type parity
// + Code Connect can read fields instead of regex-ing a string. `size`/`weight`/`lineHeight` may themselves
// be var-name refs (e.g. `size/text-lg`) — kept verbatim for the resolver to follow.
function parseFont(v) {
  if (typeof v !== 'string' || !/^font\(/i.test(v)) return null
  const body = v.replace(/^font\(\s*/i, '').replace(/\)\s*$/, '')
  const out = {}
  for (const part of body.split(/,\s*(?=[a-zA-Z]+\s*:)/)) {
    const m = part.match(/^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return Object.keys(out).length ? out : null
}

function normalize(raw) {
  const families = { color: {}, spacing: {}, type: {}, effect: {} }
  const visit = (name, value, type) => {
    const resolved = firstModeValue(value)
    const fam = classify(name, resolved)
    if (fam === 'other') return
    const ref = typeof resolved === 'string' && /^\{.*\}$/.test(resolved) ? resolved : undefined
    const font = fam === 'type' ? parseFont(resolved) : null
    families[fam][name] = { $value: resolved, $type: type || null, ...(font ? { font } : {}), ...(ref ? { ref } : {}) }
  }
  // Array list form: [{name,resolvedType,value|valuesByMode}].
  if (Array.isArray(raw)) {
    for (const v of raw) visit(v.name || v.id, v.value ?? v.valuesByMode ?? v.$value, v.resolvedType || v.$type)
    return families
  }
  // Object form — the FLAT live map { "name": <primitive> } OR a nested DTCG tree { k: {$value} }.
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const name = [...path, k].join('/')
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$value' in v) visit(name, v.$value, v.$type)   // DTCG leaf
        else walk(v, [...path, k])                          // nested group → recurse
      } else {
        visit(name, v, null)                                // flat live map: primitive value
      }
    }
  }
  walk(raw, [])
  return families
}

let payload
if (fromMcp) {
  const text = fromMcp === '-' ? readStdin() : readFileSync(fromMcp, 'utf8')
  if (!text.trim()) { console.error('pull-figma-variables: no MCP input on stdin/file'); process.exit(2) }
  let raw
  try { raw = JSON.parse(text) } catch (e) { console.error('pull-figma-variables: MCP input is not JSON —', e.message); process.exit(2) }
  payload = { $generatedFrom: { file, node }, ...normalize(raw) }
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
  const n = ['color', 'spacing', 'type'].reduce((s, f) => s + Object.keys(payload[f]).length, 0)
  console.log(`pull-figma-variables: wrote ${n} variables → ${out} (color ${Object.keys(payload.color).length} · spacing ${Object.keys(payload.spacing).length} · type ${Object.keys(payload.type).length})`)
} else {
  // Degrade: validate + reprint the existing cache so the pipeline keeps working without MCP.
  try {
    payload = JSON.parse(readFileSync(out, 'utf8'))
    console.log(`pull-figma-variables: no --from-mcp; reusing cached ${out} (MCP-degrade path)`)
  } catch {
    console.error(`pull-figma-variables: no MCP input and no cache at ${out}. Run the Figma MCP get_variable_defs and pipe it with --from-mcp -`)
    process.exit(2)
  }
}
