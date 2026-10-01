#!/usr/bin/env node
/**
 * build-code-connect.mjs — Job 3 (reverse: code → design).
 *
 * Assemble the payload for the Figma MCP tool `send_code_connect_mappings` from LOCAL data, plus the
 * context an agent needs to review it. The skill can't call MCP, so this writes the exact tool input; the
 * agent confirms it with the user and sends it.
 *
 *   node build-code-connect.mjs --components comps.json --file <FILE_KEY> [--node <NODE_ID>] \
 *        --parity .storybook/figma-token-parity.json [--usage .storybook/component-usage.json] \
 *        --out .storybook/code-connect.json
 *
 * comps.json — what the agent knows about each code component (fill it from get_code_connect_suggestions
 * and get_context_for_code_connect, not by hand-reading get_metadata):
 *   [{ "component":"Button", "codeFile":"src/components/ui/button.tsx", "figmaNode":"295:37592",
 *      "componentName":"Button",                  // optional: the name Figma shows, e.g. "Button/Primary"
 *      "label":"React",                           // optional, default React; must be a Code Connect label
 *      "story":"Components/Button", "tokens":["background/gray/600"], "props":{"variant":"secondary"},
 *      "variantProperties":{"type":["root","nest-1"]}, "modes":["Light","Dark"], "propAliases":{"type":"depth"},
 *      "valueMap":{"nest-1":"1"} }]                  // optional; else workbench.json figma.variantValues
 *
 * Output (code-connect.json):
 *   send          — the exact send_code_connect_mappings input: { fileKey, nodeId, mappings:[{ nodeId,
 *                   componentName, source, label }] }. Pass it as-is after the user approves.
 *   context       — per component: tokens (with figmaVar + value), real props, variant properties → code
 *                   props, modes. Use it to review the mapping or to write a Code Connect template.
 *   reverseParity — components with no Figma node or no source file, unsupported labels, drifted tokens,
 *                   tokens missing from the parity map.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadSettings, syncGaps, GAPS_PATH } from './workbench-settings.mjs'

// The label enum of send_code_connect_mappings (Figma MCP tool schema, checked 2026-10-01).
export const CODE_CONNECT_LABELS = ['React', 'Web Components', 'Vue', 'Svelte', 'Storybook', 'Javascript', 'Swift',
  'Swift UIKit', 'Objective-C UIKit', 'SwiftUI', 'Compose', 'Java', 'Kotlin', 'Android XML Layout', 'Flutter', 'Markdown']
const NODE_RE = /^\d+[:-]\d+$/
const FILE_KEY_RE = /^[0-9a-zA-Z]{22,128}$/

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const read = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }
// Figma's own examples use the colon form (URL node-id=1-2 → 1:2); the tool accepts either.
const toApiNode = (n) => String(n).trim().replace('-', ':')

const settings = loadSettings()
const compsPath = arg('--components')
const fileKey = arg('--file')
const parityPath = arg('--parity', '.storybook/figma-token-parity.json')
const usagePath = arg('--usage')
const out = arg('--out', '.storybook/code-connect.json')

if (!compsPath) { console.error('build-code-connect: --components <file.json> required (component → figmaNode → codeFile map)'); process.exit(2) }
if (!fileKey || !FILE_KEY_RE.test(fileKey)) { console.error('build-code-connect: --file <FILE_KEY> required (the key from figma.com/design/<FILE_KEY>/…)'); process.exit(2) }
const comps = read(compsPath, null)
if (!Array.isArray(comps)) { console.error(`build-code-connect: ${compsPath} must be a JSON array of components`); process.exit(2) }
const parity = read(parityPath, {})
const usage = usagePath ? read(usagePath, {}) : {}

// Index parity tokens by code name (--x), bare name (x), and figmaVar (a/b/c) so a comps token reference
// resolves however it's written. Collect drifted tokens (reverse direction of Job-1 drift).
const tokenIndex = {}
const driftedTokens = []
for (const fam of ['color', 'spacing', 'type']) {
  for (const [code, e] of Object.entries(parity[fam] || {})) {
    tokenIndex[code] = e
    tokenIndex[code.replace(/^--/, '')] = e
    if (e.figmaVar) tokenIndex[e.figmaVar] = e
    if (e.drift) driftedTokens.push({ token: code, figmaVar: e.figmaVar, figmaHex: e.figmaHex, codeHex: e.codeHex })
  }
}

const mappings = []
const context = []
const componentsWithoutNode = []
const componentsWithoutSource = []
const badLabels = []
const badNodes = []
const unmappedTokens = new Set()
const unmappedValues = []
for (const c of comps) {
  const name = c.component || c.codeFile
  if (!c.figmaNode) { componentsWithoutNode.push(name); continue }
  if (!NODE_RE.test(String(c.figmaNode).trim())) { badNodes.push(`${name}: ${c.figmaNode}`); continue }
  if (!c.codeFile) { componentsWithoutSource.push(name); continue }
  const label = c.label ?? settings.codeConnectLabel
  if (!CODE_CONNECT_LABELS.includes(label)) { badLabels.push(`${name}: ${label}`); continue }
  const nodeId = toApiNode(c.figmaNode)
  mappings.push({ nodeId, componentName: c.componentName ?? c.component, source: c.codeFile, label })

  const tokens = (c.tokens || []).map((t) => {
    const e = tokenIndex[t] || tokenIndex['--' + t]
    if (!e) { unmappedTokens.add(t); return { name: t, unmapped: true } }
    return { name: t, figmaVar: e.figmaVar ?? null, value: e.figmaHex ?? e.codeHex ?? null }
  })
  // Figma variant properties (e.g. {type:["root","nest-1"]}) → code props with the value enum; Figma modes
  // (e.g. ["Light","Dark"]) → the code's theme dimension. Needed only when writing a Code Connect template.
  const variantProperties = c.variantProperties ?? {}
  context.push({
    component: c.component, nodeId, story: c.story ?? null,
    props: c.props ?? usage[c.component]?.props ?? {}, tokens, variants: c.variants ?? [],
    variantProperties, modes: c.modes ?? [],
    // each Figma variant value → its code value, from comps.json `valueMap` or workbench.json figma.variantValues
    propMappings: Object.entries(variantProperties).map(([figmaProp, values]) => ({
      figmaProp, codeProp: c.propAliases?.[figmaProp] ?? figmaProp,
      values: (Array.isArray(values) ? values : []).map((v) => {
        const code = c.valueMap?.[v] ?? settings.variantValues[v] ?? null
        if (code == null) unmappedValues.push({ component: c.component, figmaProp, value: v })
        return { figma: v, code }
      }),
    })),
  })
}

const topNode = arg('--node') ? toApiNode(arg('--node')) : mappings[0]?.nodeId ?? null
const result = {
  $meta: { components: compsPath, parity: parityPath, usage: usagePath || null },
  send: { fileKey, nodeId: topNode, mappings },
  context,
  reverseParity: {
    componentsWithoutNode: componentsWithoutNode.sort(),
    componentsWithoutSource: componentsWithoutSource.sort(),
    unsupportedLabels: badLabels,
    invalidNodeIds: badNodes,
    driftedTokens,
    unmappedTokens: [...unmappedTokens].sort(),
    unmappedVariantValues: unmappedValues,
  },
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
const gapsPath = arg('--gaps', GAPS_PATH)
const open = syncGaps('build-code-connect', ['unmapped-variant-value'], unmappedValues.map((u) => ({
  kind: 'unmapped-variant-value', key: `${u.component}.${u.figmaProp}=${u.value}`,
  detail: `${u.component}: Figma ${u.figmaProp} = "${u.value}" has no code value`,
  suggestion: `add "${u.value}": "<code value>" to workbench.json figma.variantValues (or valueMap in comps.json)`,
})), gapsPath)
console.log(`build-code-connect: ${out} — ${mappings.length} mapping(s) ready for send_code_connect_mappings · ${componentsWithoutNode.length} without a Figma node · ${componentsWithoutSource.length} without a source file · ${driftedTokens.length} drifted · ${unmappedTokens.size} unmapped token(s)`)
if (componentsWithoutNode.length) console.log(`  no Figma node (deliver via sb-figma Job 2, or opt-in generate): ${componentsWithoutNode.join(', ')}`)
if (componentsWithoutSource.length) console.log(`  no codeFile (Code Connect needs the source path): ${componentsWithoutSource.join(', ')}`)
if (badLabels.length) console.log(`  unsupported label (use one of ${CODE_CONNECT_LABELS.join(', ')}): ${badLabels.join('; ')}`)
if (badNodes.length) console.log(`  invalid node id (expected 123:456 or 123-456): ${badNodes.join('; ')}`)
if (unmappedTokens.size) console.log(`  tokens not in parity map (run Job 1 first?): ${[...unmappedTokens].join(', ')}`)
if (unmappedValues.length) console.log(`  ${unmappedValues.length} variant value(s) with no code value — gaps recorded in ${gapsPath}`)
