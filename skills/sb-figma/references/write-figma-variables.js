// write-figma-variables.js — use_figma script: create or update one variable collection from code tokens.
//
// WRITES to the Figma file. Load the figma-use skill first (skillNames: "figma-use"), run with DRY = true to
// see what would change, show that to the user, and only then run again with DRY = false.
// PAYLOAD is one entry of build-figma-variables.mjs output (same shape read-figma-variables.js returns).
// Updates in place: a collection or variable with the same name is reused, its values overwritten for the
// payload's modes; nothing is deleted. A collection whose only mode is Figma's default "Mode 1" gets it renamed.
// Variables that are aliases in Figma, or of another type, are left alone and listed (keptAliases, typeMismatch).
// Returns counts plus created/updated variable ids.
const DRY = true
const PAYLOAD = { collection: 'Code tokens', modes: ['Light', 'Dark'], variables: [] }

const rgb = (hex) => {
  const h = hex.replace('#', '')
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255
  return h.length === 8 ? { r: n(0), g: n(2), b: n(4), a: n(6) } : { r: n(0), g: n(2), b: n(4), a: 1 }
}
// explicit scopes (figma-use rule 16): colours for fills/strokes, sizes by name
const scopesFor = (v) => v.type === 'COLOR'
  ? ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR']
  : /radius|radii|rounded/i.test(v.name) ? ['CORNER_RADIUS']
  : /spac|gap|padding|inset/i.test(v.name) ? ['GAP']
  : ['WIDTH_HEIGHT', 'GAP']

const cols = await figma.variables.getLocalVariableCollectionsAsync()
let col = cols.find((c) => c.name === PAYLOAD.collection)
const plan = { collection: PAYLOAD.collection, collectionExists: !!col, renameMode: null, createModes: [], create: [], update: [], unchanged: 0,
  keptAliases: [], typeMismatch: [] }
const modeIds = {}
if (col) for (const m of col.modes) modeIds[m.name] = m.modeId
if (!col) plan.renameMode = { from: 'Mode 1', to: PAYLOAD.modes[0] }
// an existing collection with one mode none of ours (Figma's default "Mode 1"): rename it, don't add beside it
else if (col.modes.length === 1 && !PAYLOAD.modes.some((m) => modeIds[m])) plan.renameMode = { from: col.modes[0].name, to: PAYLOAD.modes[0] }
for (const m of PAYLOAD.modes) if (!modeIds[m] && m !== plan.renameMode?.to) plan.createModes.push(m)

const existing = {}
if (col) for (const id of col.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); if (v) existing[v.name] = v }
// compare as Figma stores them: colours to 8-bit channels, floats to 1/1000
const to8 = (c) => [c.r, c.g, c.b, c.a ?? 1].map((x) => Math.round(x * 255)).join()
const same = (cur, v, m) => cur != null && (v.type === 'COLOR' ? typeof cur === 'object' && to8(cur) === to8(rgb(v.values[m])) : Math.abs(cur - v.values[m]) < 0.001)
const isAlias = (x) => x && typeof x === 'object' && x.type === 'VARIABLE_ALIAS'
const skip = new Set()
for (const v of PAYLOAD.variables) {
  const cur = existing[v.name]
  if (!cur) { plan.create.push(v.name); continue }
  // a variable of another type can't take these values; one that points at another variable stays an alias
  if (cur.resolvedType !== v.type) { plan.typeMismatch.push(`${v.name}: ${cur.resolvedType} in Figma, ${v.type} in code`); skip.add(v.name); continue }
  if (Object.values(cur.valuesByMode).some(isAlias)) { plan.keptAliases.push(v.name); skip.add(v.name); continue }
  const changed = PAYLOAD.modes.some((m) => !modeIds[m] || !same(cur.valuesByMode[modeIds[m]], v, m))
  if (changed) plan.update.push(v.name); else plan.unchanged++
}
if (DRY) return { dryRun: true, ...plan, createCount: plan.create.length, updateCount: plan.update.length }

if (!col) col = figma.variables.createVariableCollection(PAYLOAD.collection)
if (plan.renameMode) {
  col.renameMode(col.modes[0].modeId, plan.renameMode.to)
  modeIds[plan.renameMode.to] = col.modes[0].modeId
}
for (const m of plan.createModes) modeIds[m] = col.addMode(m)
const created = []
const updated = []
for (const v of PAYLOAD.variables) {
  if (skip.has(v.name)) continue
  let variable = existing[v.name]
  if (!variable) { variable = figma.variables.createVariable(v.name, col, v.type); variable.scopes = scopesFor(v); created.push(variable.id) }
  else if (plan.update.includes(v.name)) updated.push(variable.id)
  else continue
  for (const m of PAYLOAD.modes) variable.setValueForMode(modeIds[m], v.type === 'COLOR' ? rgb(v.values[m]) : v.values[m])
}
return { dryRun: false, collectionId: col.id, modes: modeIds, createdVariableIds: created, updatedVariableIds: updated, created: created.length, updated: updated.length,
  keptAliases: plan.keptAliases, typeMismatch: plan.typeMismatch }
