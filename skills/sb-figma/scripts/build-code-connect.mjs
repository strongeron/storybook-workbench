#!/usr/bin/env node
/**
 * build-code-connect.mjs — Job 3 (reverse: code → design).
 *
 * Assemble Code Connect payloads from LOCAL data so the agent can push them via the Figma MCP
 * `send_code_connect_mappings` / `add_code_connect_map`. The skill can't call MCP, so this produces the
 * structured payload + a reverse-parity report from inputs the bundle already has — no new scanners.
 *
 *   node build-code-connect.mjs --components comps.json \
 *        --parity .storybook/figma-token-parity.json [--usage .storybook/component-usage.json] \
 *        --out .storybook/code-connect.json
 *
 * comps.json — what the agent knows about each code component (component + its Figma node + story):
 *   [{ "component":"Button", "codeFile":"src/components/ui/button.tsx", "figmaNode":"295:37592",
 *      "story":"Components/Button", "tokens":["background/gray/600","text/gray/50"],
 *      "props":{"variant":"secondary"}, "variants":["default","secondary"] }]
 *   • figmaNode optional → a component WITHOUT one lands in reverseParity.componentsWithoutNode (map or generate).
 *   • tokens optional → looked up in the parity map and enriched with {figmaVar, value}; misses → unmappedTokens.
 *   • props/variants optional → real values; props fall back to component-usage.json when not given.
 *
 * Output (code-connect.json): { mappings:[…ready for send_code_connect_mappings…], reverseParity:{…} }.
 * The `value`/`figmaVar` on each token + the `props` from real usage are the "context of tokens and proper
 * values" — so the Figma side reflects the code's truth, not a guess.
 */
import { readFileSync, writeFileSync } from 'node:fs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const read = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }

const compsPath = arg('--components')
const parityPath = arg('--parity', '.storybook/figma-token-parity.json')
const usagePath = arg('--usage')
const out = arg('--out', '.storybook/code-connect.json')

if (!compsPath) { console.error('build-code-connect: --components <file.json> required (component → figmaNode → story map)'); process.exit(2) }
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
const componentsWithoutNode = []
const unmappedTokens = new Set()
for (const c of comps) {
  if (!c.figmaNode) { componentsWithoutNode.push(c.component || c.codeFile); continue }
  const figmaNode = String(c.figmaNode).replace(/:/g, '-') // canonical (URL form)
  const tokens = (c.tokens || []).map((name) => {
    const e = tokenIndex[name] || tokenIndex['--' + name]
    if (!e) { unmappedTokens.add(name); return { name, unmapped: true } }
    return { name, figmaVar: e.figmaVar ?? null, value: e.figmaHex ?? e.codeHex ?? null }
  })
  const props = c.props ?? usage[c.component]?.props ?? {}
  mappings.push({ component: c.component, codeFile: c.codeFile ?? null, figmaNode, story: c.story ?? null, props, tokens, variants: c.variants ?? [] })
}

const result = {
  $meta: { components: compsPath, parity: parityPath, usage: usagePath || null },
  mappings,
  reverseParity: {
    componentsWithoutNode: componentsWithoutNode.sort(),
    driftedTokens,
    unmappedTokens: [...unmappedTokens].sort(),
  },
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.log(`build-code-connect: ${out} — ${mappings.length} mapping(s) ready for send_code_connect_mappings · ${componentsWithoutNode.length} without a Figma node · ${driftedTokens.length} drifted · ${unmappedTokens.size} unmapped token(s)`)
if (componentsWithoutNode.length) console.log(`  no Figma node (map via sb-explore/sb-figma deliver, or opt-in generate_figma_design): ${componentsWithoutNode.join(', ')}`)
if (unmappedTokens.size) console.log(`  tokens not in parity map (run Job 1 first?): ${[...unmappedTokens].join(', ')}`)
