#!/usr/bin/env node
/**
 * workbench-settings.mjs — the project's own rules for sb-figma, and the gaps each run finds.
 *
 * Settings: `.storybook/workbench.json` (schema: references/workbench.schema.json). The project owns it, so
 * a skill update never overwrites it; scripts read it, command-line flags still win.
 *   { "figma": { "css": "src/**\/*.css", "darkSelectors": [".dark"], "nameMap": { "fg/error": "--color-error-text" },
 *                "ignore": ["Size/*"], "variantValues": { "status - success": "success" }, "codeConnectLabel": "React" } }
 *
 * Gaps: `.storybook/figma/gaps.json` — what a run couldn't do on its own. Each script owns some kinds and
 * reports them every run; a gap it no longer finds is marked resolved. Unresolved gaps are shown first on
 * the next run, and fixing one usually means adding a setting above.
 *   kinds: missing-token · unmapped-name · weak-match · collision · unsupported-value · unmapped-variant-value · tool-refused
 *
 *   node workbench-settings.mjs --init            # write .storybook/workbench.json + its schema (keeps an existing file)
 *   node workbench-settings.mjs gaps [--all]      # list unresolved gaps (--all: include resolved)
 *   node workbench-settings.mjs add --kind tool-refused --detail "…" [--suggestion "…"] [--skill sb-figma]
 *   node workbench-settings.mjs resolve <gap-id>  # mark one resolved by hand (e.g. after asking the user)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SETTINGS_PATH = '.storybook/workbench.json'
export const GAPS_PATH = '.storybook/figma/gaps.json'
export const GAP_KINDS = ['missing-token', 'unmapped-name', 'weak-match', 'collision', 'unsupported-value', 'unmapped-variant-value', 'tool-refused']
export const DEFAULTS = {
  css: 'src/**/*.css',
  darkSelectors: ['.dark', '[data-theme=dark]', '[data-mode=dark]', 'prefers-color-scheme: dark'],
  nameMap: {},
  ignore: [],
  variantValues: {},
  codeConnectLabel: 'React',
}

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }

/** The gaps log. A missing file is an empty log; a broken one stops the run instead of being reset. */
function readGaps(path) {
  if (!existsSync(path)) return { gaps: [] }
  let log
  try { log = JSON.parse(readFileSync(path, 'utf8')) } catch (e) {
    throw new Error(`${path} is not valid JSON (${e.message}) — fix or delete it; not overwriting`)
  }
  return { ...log, gaps: Array.isArray(log?.gaps) ? log.gaps : [] }
}

/** The figma settings merged over defaults. A broken file is reported, not silently ignored. */
export function loadSettings(path = SETTINGS_PATH) {
  if (!existsSync(path)) return { ...DEFAULTS }
  let raw
  try { raw = JSON.parse(readFileSync(path, 'utf8')) } catch (e) {
    console.error(`workbench-settings: ${path} is not valid JSON (${e.message}) — using defaults`)
    return { ...DEFAULTS }
  }
  return { ...DEFAULTS, ...(raw.figma || {}) }
}

/** `Size/*` style globs (only `*`) → a matcher. */
export function globMatcher(globs = []) {
  const res = globs.map((g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'))
  return (name) => res.some((re) => re.test(name))
}

const gapId = (kind, key) => `${kind}:${key}`

/**
 * Replace this script's gaps with what it found this run. `owner` + `kinds` say which gaps it is
 * responsible for: those not found again are marked resolved (dated), so the log shows progress.
 * found: [{ kind, key, detail, suggestion }]
 */
export function syncGaps(owner, kinds, found, path = GAPS_PATH) {
  const today = new Date().toISOString().slice(0, 10)
  const log = readGaps(path)
  const byId = new Map(log.gaps.map((g) => [g.id, g]))
  const seen = new Set()
  for (const f of found) {
    const id = gapId(f.kind, f.key)
    seen.add(id)
    const prev = byId.get(id)
    byId.set(id, { id, kind: f.kind, owner, detail: f.detail, suggestion: f.suggestion ?? null,
      found: prev?.found ?? today, lastSeen: today, resolved: null })
  }
  for (const g of byId.values()) {
    if (g.owner === owner && kinds.includes(g.kind) && !seen.has(g.id) && !g.resolved) g.resolved = today
  }
  const gaps = [...byId.values()].sort((a, b) => (!!a.resolved - !!b.resolved) || a.id.localeCompare(b.id))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ $comment: 'sb-figma gaps — fix one by adding a rule to .storybook/workbench.json; see workbench-settings.mjs', gaps }, null, 2) + '\n')
  return gaps.filter((g) => !g.resolved)
}

export function openGaps(path = GAPS_PATH) {
  return readGaps(path).gaps.filter((g) => !g.resolved)
}

// ── CLI ──
// realpath both sides: installed skills are reached through symlinks
const real = (p) => { try { return realpathSync(p) } catch { return p } }
const isMain = !!process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])
if (isMain) {
  const args = process.argv.slice(2)
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
  if (args.includes('--init')) {
    mkdirSync('.storybook', { recursive: true })
    const schemaSrc = join(HERE, '..', 'references', 'workbench.schema.json')
    if (existsSync(schemaSrc)) copyFileSync(schemaSrc, '.storybook/workbench.schema.json')
    if (existsSync(SETTINGS_PATH)) console.log(`${SETTINGS_PATH} exists — kept; schema refreshed`)
    else {
      writeFileSync(SETTINGS_PATH, JSON.stringify({ $schema: './workbench.schema.json', figma: DEFAULTS }, null, 2) + '\n')
      console.log(`wrote ${SETTINGS_PATH} + .storybook/workbench.schema.json — edit the figma section to fit this project`)
    }
  } else if (args[0] === 'gaps') {
    const all = readGaps(GAPS_PATH).gaps.filter((g) => args.includes('--all') || !g.resolved)
    if (!all.length) console.log('no open gaps')
    for (const g of all) console.log(`${g.resolved ? '✓' : '•'} [${g.kind}] ${g.detail}${g.suggestion ? `\n    → ${g.suggestion}` : ''}${g.resolved ? `  (resolved ${g.resolved})` : ''}`)
  } else if (args[0] === 'add') {
    const kind = opt('--kind'), detail = opt('--detail')
    if (!GAP_KINDS.includes(kind) || !detail) { console.error(`add needs --kind (${GAP_KINDS.join(' | ')}) and --detail`); process.exit(2) }
    const log = readGaps(GAPS_PATH)
    const id = gapId(kind, detail)
    const today = new Date().toISOString().slice(0, 10)
    log.gaps = log.gaps.filter((g) => g.id !== id).concat({ id, kind, owner: opt('--skill') || 'agent', detail, suggestion: opt('--suggestion'), found: today, lastSeen: today, resolved: null })
    mkdirSync(dirname(GAPS_PATH), { recursive: true })
    writeFileSync(GAPS_PATH, JSON.stringify(log, null, 2) + '\n')
    console.log(`recorded ${id}`)
  } else if (args[0] === 'resolve' && args[1]) {
    const log = readGaps(GAPS_PATH)
    const g = log.gaps.find((x) => x.id === args[1])
    if (!g) { console.error(`no gap ${args[1]}`); process.exit(2) }
    g.resolved = new Date().toISOString().slice(0, 10)
    writeFileSync(GAPS_PATH, JSON.stringify(log, null, 2) + '\n')
    console.log(`resolved ${args[1]}`)
  } else {
    console.log('usage: workbench-settings.mjs --init | gaps [--all] | add --kind K --detail D [--suggestion S] | resolve <id>')
    if (!args.includes('-h') && !args.includes('--help') && args.length) process.exit(2)
  }
}
