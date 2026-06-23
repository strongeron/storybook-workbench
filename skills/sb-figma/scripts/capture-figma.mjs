#!/usr/bin/env node
/**
 * capture-figma.mjs — the universal store for Figma MCP outputs.
 *
 * Scripts can't call the Figma MCP, so the agent runs ANY MCP tool and pipes its output here to
 * PERSIST it. Once on disk, every downstream step (token parity, component delivery, drift, a later
 * session) reads from the store instead of re-calling MCP — which may be unavailable headless, costs
 * round-trips, and (worse) returns a moved target as the Figma file evolves. Storing = reproducible +
 * iterable. This is the "be ready for the output of every MCP call" layer.
 *
 *   # JSON-returning tools (get_variable_defs / get_design_context / get_metadata / get_code_connect_map …):
 *   <mcp tool output> | node capture-figma.mjs --tool get_design_context --file <FILE> --node <NODE> --from-mcp -
 *
 *   # get_screenshot (image): the agent saves the image, then registers it:
 *   node capture-figma.mjs --tool get_screenshot --file <FILE> --node <NODE> --image /tmp/frame.png
 *
 *   # inspect what's captured (degrade / iterate):
 *   node capture-figma.mjs --list
 *
 * Layout (default --dir .storybook/figma):
 *   .storybook/figma/manifest.json                  index: [{tool,node,file,path,label,bytes,capturedAt}]
 *   .storybook/figma/<tool>/<node>.json             one file per (tool,node); re-capture overwrites
 *   .storybook/figma/get_screenshot/<node>.<ext>    images copied in
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(name)

const dir = arg('--dir', '.storybook/figma')
const manifestPath = join(dir, 'manifest.json')

function loadManifest() {
  try { return JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return { $version: 1, captures: [] } }
}
function saveManifest(m) {
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n')
}

// ── list / degrade: show what's already captured so iteration knows the inventory ──
if (has('--list')) {
  const m = loadManifest()
  if (!m.captures.length) { console.log(`capture-figma: store empty at ${dir} (run the MCP tools and pipe to --from-mcp -)`); process.exit(0) }
  console.log(`capture-figma: ${m.captures.length} captures in ${dir}`)
  for (const c of m.captures) console.log(`  ${String(c.tool).padEnd(22)} ${String(c.node ?? '-').padEnd(16)} ${c.path}${c.label ? `  · ${c.label}` : ''}`)
  process.exit(0)
}

const tool = arg('--tool')
if (!tool) { console.error('capture-figma: --tool <name> required (or --list). e.g. get_variable_defs, get_design_context, get_screenshot'); process.exit(2) }
// Node-id ambiguity (real friction): the Figma URL uses `1-6965`, the API/MCP uses `1:6965`. Canonicalize
// to dash form so a capture is found whichever way the agent passes it next time.
const node = ((arg('--node', null) || '').replace(/:/g, '-')) || null
const file = arg('--file', null)
const label = arg('--label', null)
const image = arg('--image', null)
const fromMcp = arg('--from-mcp', null)

const safe = (s) => String(s ?? 'all').replace(/[^A-Za-z0-9._-]+/g, '-')
const toolDir = join(dir, safe(tool))
mkdirSync(toolDir, { recursive: true })

let storedPath
if (image) {
  // get_screenshot etc. — copy the image into the store, keep its extension.
  if (!existsSync(image)) { console.error(`capture-figma: --image not found: ${image}`); process.exit(2) }
  storedPath = join(toolDir, `${safe(node)}${extname(image) || '.png'}`)
  copyFileSync(image, storedPath)
} else {
  // Native tools return different formats: get_variable_defs → JSON, get_design_context → React/code TEXT,
  // get_metadata → XML. Store JSON pretty when parseable; otherwise persist the raw text (.xml if it looks
  // like markup, else .txt) — design-context code and metadata XML are NOT JSON and must not be rejected.
  const src = fromMcp || '-'
  let text
  try { text = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8') } catch { text = '' }
  if (!text.trim()) { console.error(`capture-figma: no input for ${tool} (pipe the MCP output with --from-mcp -, or pass --image for a screenshot)`); process.exit(2) }
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* not JSON — store raw below */ }
  if (parsed !== null && typeof parsed === 'object') {
    storedPath = join(toolDir, `${safe(node)}.json`)
    writeFileSync(storedPath, JSON.stringify(parsed, null, 2) + '\n')
  } else {
    storedPath = join(toolDir, `${safe(node)}${/^\s*</.test(text) ? '.xml' : '.txt'}`)
    writeFileSync(storedPath, text)
  }
}

// Record in the manifest (one entry per tool+node — re-capture replaces, so the store never duplicates).
const m = loadManifest()
m.captures = m.captures.filter((c) => !(c.tool === tool && String(c.node) === String(node)))
m.captures.push({
  tool, node, file, label,
  path: storedPath,
  bytes: statSync(storedPath).size,
  capturedAt: new Date().toISOString(),
})
m.captures.sort((a, b) => (a.tool + a.node).localeCompare(b.tool + b.node))
saveManifest(m)

console.log(`capture-figma: stored ${tool}${node ? ` @ ${node}` : ''} → ${storedPath} (${statSync(storedPath).size} B). Manifest: ${m.captures.length} captures.`)
