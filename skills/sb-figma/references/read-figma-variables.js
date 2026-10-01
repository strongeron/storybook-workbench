// read-figma-variables.js — read-only use_figma script: every local variable collection, every mode.
//
// Pass this file's contents as the `code` of a use_figma call (after loading the figma-use skill;
// skillNames: "figma-use"). It changes nothing in the file. It returns:
//   [{ collection, modes: [modeName…], variables: [{ name, type, values: { <modeName>: value } }] }]
// Colors come back as hex (#rrggbb, or #rrggbbaa when alpha < 1); numbers and strings as-is; aliases
// resolved to the final value in the same mode (or the target collection's default mode), including aliases
// into a library's variables. An alias that still can't be resolved comes back null and is named in
// `unresolved`, so a gap is visible instead of silently empty.
// Output limit is ~20 kB: for a big system set ONLY to one collection name and call once per collection.
const ONLY = null // e.g. 'Semantic'

const hex = ({ r, g, b, a = 1 }) => {
  const h = (x) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a) : ''}`
}
const cache = new Map()
const getVar = async (id) => {
  if (!cache.has(id)) cache.set(id, await figma.variables.getVariableByIdAsync(id))
  return cache.get(id)
}
const colById = new Map()
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) colById.set(c.id, c)
const local = [...colById.values()]
// alias targets can live in a library collection that isn't local — look those up on demand
const colFor = async (id) => {
  if (!colById.has(id)) colById.set(id, await figma.variables.getVariableCollectionByIdAsync(id).catch(() => null))
  return colById.get(id)
}

async function resolve(value, modeName, depth = 0) {
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    if (depth > 10) return null
    const target = await getVar(value.id)
    if (!target) return null
    const col = await colFor(target.variableCollectionId)
    const mode = col?.modes.find((m) => m.name === modeName) ?? col?.modes.find((m) => m.modeId === col.defaultModeId)
    return resolve(target.valuesByMode[mode?.modeId], modeName, depth + 1)
  }
  if (value && typeof value === 'object' && 'r' in value) return hex(value)
  return value ?? null
}

const out = []
for (const c of local) {
  if (ONLY && c.name !== ONLY) continue
  const variables = []
  const unresolved = []
  for (const id of c.variableIds) {
    const v = await getVar(id)
    if (!v || v.resolvedType === 'BOOLEAN') continue
    const values = {}
    for (const m of c.modes) values[m.name] = await resolve(v.valuesByMode[m.modeId], m.name)
    if (Object.values(values).some((x) => x == null)) unresolved.push(v.name)
    variables.push({ name: v.name, type: v.resolvedType, values })
  }
  out.push({ collection: c.name, modes: c.modes.map((m) => m.name), variables, unresolved })
}
return out
