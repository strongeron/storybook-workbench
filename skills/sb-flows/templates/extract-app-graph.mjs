#!/usr/bin/env node
// extract-app-graph.mjs — REFERENCE TEMPLATE for the provenance-carrying app-graph generator that
// feeds <AppFlowGraph> (app flow) AND <ComponentUsage> (component lists). It is the repo-local
// resolver flow-capture.md tells you to write: the skill ships extract-flows.sh as the generic first
// pass, but the wrappers expect the app-graph.json + component-pages.json shapes this produces.
// Copy to .storybook/scripts/ and ADAPT the marked app-specific parts; everything else is generic.
//
// NOTHING is modeled — every node/edge is read from source with file:line provenance. If an origin
// can't be attributed, it is recorded in unresolvedEdges/dynamicCallSites, NEVER fabricated. That is
// the contract: real edges only. The run SELF-DIAGNOSES (§6b): if the graph looks thin relative to the
// routes + unparsed call sites, it prints an UNDER-EXTRACTION alarm naming the offenders and which ADAPT
// marker to revisit — it won't pass a half-empty graph off as complete. After running, VALIDATE
// (see flow-capture.md → "Validate the graph").
//
// GENERIC — keep; the wrappers depend on these conventions:
//   • EDGE LABELS = the COPY of the action the user CLICKS — the button / link / CTA text ("Cancel",
//     "Save", "Back", "View skillset") — NOT the destination (the arrowhead already names it; repeating
//     it is the #1 first-cut bug). Capture that copy where the idiom exposes it: a `<Link>`'s children,
//     a button's text, an `aria-label`. Fall back to `verb · source` (openPage→"opens", <Link>→"links",
//     form→"submits", nav→"nav") only when no readable label is available.
//   • STRUCTURAL hierarchy edges use kind "subroute" (faint dotted, "sub-route"), NOT "link"/"child route".
//   • DEEP EDGES: a nav fired from a store/service action is traced to its REAL callers (re-export
//     aware — follows barrels), up through the import graph to routed pages. See moduleOrigins below.
//   • parents[]/children[] per component (the nesting graph); role lane = MINIMUM persona that can
//     reach a route; roleVariant marks routes whose CONTENT differs by role.
//
// APP-SPECIFIC — search "ADAPT:" and replace:
//   ADAPT-1  how routes are read (example: nanostores `routePatterns` + `routeDefinitions`).
//   ADAPT-2  the navigation idiom swept for edges (example: `openPage/redirectPage($router,"name")`).
//   ADAPT-3  the role classifier — REPLACE the example tiers with YOUR app's real access gate.
//
// Output: .storybook/app-graph.json + .storybook/component-pages.json  (regenerable; local)
// Run:    node .storybook/scripts/extract-app-graph.mjs
//
// ADAPT-1: the routing source below is nanostores-specific (src/router/index.ts + config.tsx). ──────

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// ── 1. routePatterns (key → path), tolerant of prettier line-wrapping ──
const routerSrc = readFileSync(join(SRC, "router/index.ts"), "utf8");
const patternsBlock = routerSrc.slice(
  routerSrc.indexOf("routePatterns = {"),
  routerSrc.indexOf("} as const"),
);
const routePatterns = {};
for (const m of patternsBlock.matchAll(/["']?([A-Za-z][\w-]*)["']?\s*:\s*["']([^"']+)["']/g)) {
  routePatterns[m[1]] = m[2];
}

// ── 2. routeDefinitions (key → component) + page-component → file map ──
const configSrc = readFileSync(join(SRC, "router/config.tsx"), "utf8");
const compToFile = {}; // PascalComponent → "pages/foo-page"
for (const m of configSrc.matchAll(/import \{ (\w+) \} from "@\/(pages\/[\w-]+)"/g)) {
  compToFile[m[1]] = m[2];
}
const defsBlock = configSrc.slice(
  configSrc.indexOf("routeDefinitions = {"),
  configSrc.indexOf("} as const satisfies"),
);
const routeMeta = {}; // key → { path, component, file, protected, title }
{
  // split into per-route object literals: `key: { ... },`
  const re = /["']?([A-Za-z][\w-]*)["']?\s*:\s*\{([^}]*)\}/g;
  for (const m of defsBlock.matchAll(re)) {
    const key = m[1];
    if (!routePatterns[key]) continue; // skip helper keys
    const body = m[2];
    const comp = body.match(/component:\s*(\w+)/)?.[1];
    const title = body.match(/title:\s*"([^"]*)"/)?.[1] ?? key;
    const isProtected = /protected:\s*true/.test(body);
    routeMeta[key] = {
      path: routePatterns[key],
      component: comp,
      file: compToFile[comp] ?? null,
      protected: isProtected,
      title,
    };
  }
}

const routeKeys = Object.keys(routeMeta);
const pathToKey = {};
const keyToPath = {};
for (const k of routeKeys) {
  pathToKey[routeMeta[k].path] = k;
  keyToPath[k] = routeMeta[k].path;
}

// reverse: page file → [routeKeys it serves]
const fileToRoutes = {};
for (const k of routeKeys) {
  const f = routeMeta[k].file;
  if (!f) continue;
  (fileToRoutes[f] ??= []).push(k);
}

// ── 3. parent (hierarchy) — re-implements config.tsx computeRouteMetadata ──
function parentOf(path) {
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return undefined;
  const parentPath = segs.length === 1 ? "/" : "/" + segs.slice(0, -1).join("/");
  return pathToKey[parentPath];
}
function groupOf(path) {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[0] : "root";
}

// ── 4. scan every nav call site (file:line + target route) ──
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, acc);
    } else if (/\.(tsx?|ts)$/.test(name) && !/\.(spec|test|stories)\./.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

// ADAPT-2: these regexes match the nanostores idiom `openPage($router, "routeName")`. Replace with
// your app's navigation calls (`<Link to=>`, `navigate("/x")`, `router.push("/x")`). If routes exist
// but few edges resolve, read the unmatched call sites and add a pass (flow-capture.md → "When
// extraction under-reports"). The DEEP-EDGE tracer below is idiom-agnostic and need not change.
const NAV_RE = /(openPage|redirectPage|replacePage)\s*\(\s*\$?router\s*,\s*["']([\w-]+)["']/;
const NAV_OPEN_RE = /\$?router\.(open|replace)\s*\(\s*["']([\w-]+)["']/;
// any nav-call head (used to detect dynamic/unresolvable call sites)
const NAV_ANY_HEAD = /(openPage|redirectPage|replacePage)\s*\(|\$?router\.(open|replace)\s*\(/;
// multi-line: `openPage(` with the route on a following line
const NAV_MULTILINE_HEAD = /(openPage|redirectPage|replacePage)\s*\(\s*$/;
// the indirection layer itself — definitions, not navigation edges
const HELPER_MODULE = /router\/helpers\.tsx?$/;

// IMPERATIVE BACK navigation — a call with NO destination string ("go to the previous screen"). These
// are invisible to the forward-edge matchers above (nothing to resolve a `to` from), so back/return
// transitions are dropped unless we look for them. Framework-standard, so idiom-agnostic (no ADAPT):
// router.back() · $router.back() · router.go(-1) · history.back() · navigate(-1) · goBack().
const BACK_CALL_RE = /\$?router\.back\s*\(|\$?router\.go\s*\(\s*-1\s*\)|history\.back\s*\(|\bnavigate\s*\(\s*-1\s*\)|\bgoBack\s*\(/;

// BACK by INTENT — a link/CTA WITH a destination, but the action is "go back/return". The destination
// alone can't tell you (a "Back to skillset" button and an "Open skillset" button hit the same route);
// the LABEL/handler does. We read the call's nearby context (link text, button label, handler name) for
// a return word. `\bback\b` won't fire inside callback/background/feedback (no word boundary). Idiom-free.
const BACK_INTENT_RE = /\b(?:back|return|cancel|close|previous|goback|dismiss)\b|←|↩|‹|⟵/i;
// Look for a return-word ONLY inside a LABEL position — a string literal (a prop/aria-label) or JSX text
// (`>Back<`) — never bare code, so a JS `return null;` can't masquerade as a "return" CTA.
const backHintAt = (lines, i) => {
  const win = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
  const labels = [...win.matchAll(/["'`]([^"'`{}]{1,40})["'`]|>\s*([^<>{}\n]{1,40}?)\s*</g)]
    .map((m) => m[1] || m[2] || "").join(" | ");
  return BACK_INTENT_RE.test(labels);
};

// CTA COPY — read the human label of the control that fires this nav (the button/link TEXT, an
// aria-label/title, or a `label=`/`children=` prop) so an edge reads "Cancel" / "Back" — the actual copy
// the user clicks — instead of the `verb · source` fallback. Best-effort over a tight window; returns
// undefined when nothing clean matches (→ fallback, never a guess). The arrowhead already names the
// destination, so we deliberately ignore route-shaped strings. ADAPT: tune patterns to your component lib
// (e.g. <Button label="…">, <IconButton aria-label="…">, an i18n `t("…")`).
const NON_LABEL = /^(?:true|false|null|undefined|function|return|async|await|const|let|var|className|onClick|href|to)$/i;
function ctaLabelAt(lines, i) {
  const win = lines.slice(Math.max(0, i - 1), i + 3).join("\n");
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const ok = (s) => s && /[A-Za-z]/.test(s) && !/[/{}<>]/.test(s) && s.length >= 2 && s.length <= 28 && !NON_LABEL.test(s.trim());
  let m =
    win.match(/(?:aria-label|title|label)\s*=\s*["'`]([^"'`{}]{2,28})["'`]/) ||                       // aria-label / title / label="…"
    win.match(/>\s*([A-Za-z][^<>{}\n]{1,27}?)\s*<\/(?:button|a|Link|NavLink|Button|MenuItem|span)\b/) || // JSX text: >Cancel</button>
    win.match(/(?:children\s*=|>\s*\{?\s*t\()\s*["'`]([^"'`{}]{2,28})["'`]/);                          // children="…" / t("…")
  return m && ok(m[1]) ? clean(m[1]) : undefined;
}

const callSites = []; // { file, line, target, fn, back } — `back` = a return-intent label near the call
const backSites = []; // imperative back calls: { file, line } — destination inferred as the parent route
const dynamicSites = []; // nav calls whose target is a runtime variable (not statically resolvable)
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  const rel = relative(ROOT, file);
  const isHelper = HELPER_MODULE.test(rel);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // imperative browser-back — no destination to match; recorded for parent-inference below.
    if (BACK_CALL_RE.test(line) && !isHelper) backSites.push({ file: rel, line: i + 1, fn: "back", cta: ctaLabelAt(lines, i) });
    let m = line.match(NAV_RE);
    if (m && routeMeta[m[2]]) {
      callSites.push({ file: rel, line: i + 1, target: m[2], fn: m[1], back: backHintAt(lines, i), cta: ctaLabelAt(lines, i) });
      continue;
    }
    m = line.match(NAV_OPEN_RE);
    if (m && routeMeta[m[2]]) {
      callSites.push({ file: rel, line: i + 1, target: m[2], fn: "router." + m[1], back: backHintAt(lines, i), cta: ctaLabelAt(lines, i) });
      continue;
    }
    // multi-line head: scan next 4 lines for the first quoted route key
    if (NAV_MULTILINE_HEAD.test(line)) {
      const fn = line.match(NAV_MULTILINE_HEAD)[1];
      let resolved = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const q = lines[j].match(/["']([\w-]+)["']/);
        if (q && routeMeta[q[1]]) {
          callSites.push({ file: rel, line: i + 1, target: q[1], fn, back: backHintAt(lines, i), cta: ctaLabelAt(lines, i) });
          resolved = true;
          break;
        }
      }
      if (resolved) continue;
    }
    // a nav-call head we could NOT resolve to a literal route, and it isn't the helper layer
    if (NAV_ANY_HEAD.test(line) && !NAV_RE.test(line) && !NAV_OPEN_RE.test(line) && !isHelper) {
      dynamicSites.push({ file: rel, line: i + 1, snippet: line.trim() });
    }
  }
}

// ── 5. attribute each call site's ORIGIN ──
// page file       → that page's route(s)                       (attribution: "page")
// persistent nav  → global nav, anchored at authed entry       (attribution: "persistent-nav")
// feature comp    → page(s) that import it (one-hop)           (attribution: "component-host")
// store/service   → best-effort area, provenance kept          (attribution: "module")
const NAV_COMPONENTS = /(app-sidebar|nav-main|user-menu|header|sidebar|breadcrumb)/;

// host resolution (up to 2 hops): which page route(s) ultimately render a component.
// hop 1: pages that import the component directly.
// hop 2: pages that import a component which imports the target component.
const pageFiles = walk(join(SRC, "pages")).map((p) => relative(ROOT, p)).filter((p) => !/\.(spec|test)\./.test(p));
const compFiles = walk(join(SRC, "components")).map((p) => relative(ROOT, p)).filter((p) => !/\.(spec|test|stories)\./.test(p));
const fileText = new Map();
const readRel = (rel) => (fileText.has(rel) ? fileText.get(rel) : (fileText.set(rel, readFileSync(join(ROOT, rel), "utf8")), fileText.get(rel)));
const importToken = (rel) => rel.replace(/^src\//, "@/").replace(/\.tsx?$/, "");

function pagesImporting(componentRel, depth = 6, seen = new Set()) {
  const token = importToken(componentRel);
  const hosts = [];
  for (const pf of pageFiles) {
    if (readRel(pf).includes(token)) {
      hosts.push(...(fileToRoutes[pf.replace(/^src\//, "").replace(/\.tsx?$/, "")] ?? []));
    }
  }
  if (hosts.length === 0 && depth > 1) {
    // hop 2: components that import this one, then pages importing those
    for (const cf of compFiles) {
      if (cf === componentRel || seen.has(cf)) continue;
      if (readRel(cf).includes(token)) {
        seen.add(cf);
        hosts.push(...pagesImporting(cf, depth - 1, seen));
      }
    }
  }
  return [...new Set(hosts)];
}

// The connector LABEL is the ACTION the user triggers, not the destination (the node already names
// that). Verb comes from the navigation mechanism; source is the component/page that fires it — so an
// edge reads "Departments —opens · departments-table→ Edit department". Structural URL-hierarchy edges
// (kind "subroute") are not user actions and carry no verb.
const ACTION_VERB = { router: "opens", redirect: "redirects", nav: "nav", link: "links", form: "submits" };
const fileBase = (f) => f.replace(/^.*\//, "").replace(/\.tsx?$/, "");
const edgeMap = new Map(); // `${from}→${to}→${kind}` → edge with provenance[]
function addEdge(from, to, kind, attribution, site) {
  if (!from || !to || from === to) return;
  const id = `${from}→${to}→${kind}`;
  if (!edgeMap.has(id)) {
    const verb = ACTION_VERB[kind] ?? kind;
    const source = fileBase(site.file);
    edgeMap.set(id, { from, to, kind, verb, source, cta: site.cta || undefined, attribution, backHint: !!site.back, provenance: [] });
  } else {
    const e = edgeMap.get(id);
    if (site.back) e.backHint = true;      // any contributing call site with a return-intent label marks it
    if (!e.cta && site.cta) e.cta = site.cta; // keep the first real CTA copy found across sites
  }
  edgeMap.get(id).provenance.push(`${site.file}:${site.line} (${site.fn})`);
}

const authedEntry = "home";

// ── DEEP-EDGE TRACING ──────────────────────────────────────────────────────────────────────────
// A nav fired from a store/service action has no screen of its own — the real origin is WHOEVER calls
// that action. We resolve it by reading the source, not by guessing: find the exported function whose
// body contains the nav line, find the files that import+call that export, and resolve each up to a
// routed page (page → its route; nav chrome → entry; component → pagesImporting; another store/service
// → recurse, cycle-guarded). Every origin is a REAL call site with provenance. If nothing resolves we
// keep the edge unresolved — never fabricate a `from`.
const allSrcFiles = walk(SRC).map((p) => relative(ROOT, p)).filter((p) => !/\.(spec|test|stories)\./.test(p) && /\.tsx?$/.test(p));
// the exported symbol whose body encloses `line` (scan upward to the nearest export)
function enclosingExport(moduleRel, line) {
  const lines = readRel(moduleRel).split("\n");
  for (let i = Math.min(line - 1, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/);
    if (m) return m[1];
  }
  return null;
}
// Re-export-aware: a store/service action is often re-exported through a barrel/store
// (e.g. switch-to-hotel.ts → re-exported by stores/org.ts → consumed from "@/stores/org"). Collect
// every import token through which `symbol` is reachable — the defining module plus any module that
// re-exports it — so we find the REAL callers, not just direct importers of the source file.
function reexportTokens(moduleRel, symbol) {
  const tokens = new Set([importToken(moduleRel)]);
  const importsSym = new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b`);
  const reExportsSym = new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b`);
  for (let pass = 0; pass < 4; pass++) { // fixpoint over re-export hops (barrels of barrels)
    for (const f of allSrcFiles) {
      const t = importToken(f);
      if (tokens.has(t)) continue;
      const txt = readRel(f);
      if (!reExportsSym.test(txt)) continue;
      const pullsFromSet = [...tokens].some((tok) => txt.includes(`"${tok}"`) || txt.includes(`'${tok}'`));
      if (pullsFromSet && (importsSym.test(txt) || /export\s*\{[^}]*\}\s*from/.test(txt))) tokens.add(t);
    }
  }
  return tokens;
}
// files that import `symbol` (via any of its reachable tokens) AND actually call it — real callers
function callersOf(moduleRel, symbol) {
  const tokens = reexportTokens(moduleRel, symbol);
  const callRe = new RegExp(`\\b${symbol}\\s*\\(`);
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b`);
  return allSrcFiles.filter((f) => {
    if (f === moduleRel) return false;
    const txt = readRel(f);
    return callRe.test(txt) && importRe.test(txt) && [...tokens].some((tok) => txt.includes(`"${tok}"`) || txt.includes(`'${tok}'`));
  });
}
const firstLineOf = (rel, symbol) => {
  const lines = readRel(rel).split("\n");
  const i = lines.findIndex((l) => new RegExp(`\\b${symbol}\\s*\\(`).test(l));
  return i < 0 ? 1 : i + 1;
};
// origin route-keys (+ a provenance chain) for a nav fired from a store/service module
function moduleOrigins(moduleRel, line, seen = new Set()) {
  if (seen.has(moduleRel)) return { routes: [], chain: [] };
  seen.add(moduleRel);
  const sym = enclosingExport(moduleRel, line);
  if (!sym) return { routes: [], chain: [] };
  const routes = new Set(), chain = new Set();
  for (const caller of callersOf(moduleRel, sym)) {
    const cf = caller.replace(/^src\//, "").replace(/\.tsx?$/, "");
    if (fileToRoutes[cf]) { for (const r of fileToRoutes[cf]) routes.add(r); chain.add(`${sym}←${fileBase(caller)}`); }
    else if (NAV_COMPONENTS.test(caller)) { routes.add(authedEntry); chain.add(`${sym}←${fileBase(caller)}(nav)`); }
    else if (caller.startsWith("src/components/")) { const hs = pagesImporting(caller); for (const r of hs) routes.add(r); if (hs.length) chain.add(`${sym}←${fileBase(caller)}`); }
    else if (caller.startsWith("src/stores/") || caller.startsWith("src/services/")) {
      const sub = moduleOrigins(caller, firstLineOf(caller, sym), seen);
      for (const r of sub.routes) routes.add(r); for (const c of sub.chain) chain.add(`${sym}←${c}`);
    }
  }
  return { routes: [...routes], chain: [...chain] };
}

const unresolvedEdges = []; // nav calls whose originating SCREEN isn't statically attributable
for (const site of callSites) {
  const f = site.file.replace(/^src\//, "").replace(/\.tsx?$/, "");
  const kind = site.fn.startsWith("redirect") || site.fn === "router.replace" ? "redirect" : "router";
  if (fileToRoutes[f]) {
    for (const from of fileToRoutes[f]) addEdge(from, site.target, kind, "page", site);
  } else if (NAV_COMPONENTS.test(site.file)) {
    // persistent nav chrome (sidebar/header/user-menu) is present on every authed
    // screen — the "nav" kind anchored at the authed entry is the AppFlowGraph convention.
    addEdge(authedEntry, site.target, "nav", "persistent-nav", site);
  } else if (site.file.startsWith("src/components/")) {
    const hosts = pagesImporting(site.file);
    if (hosts.length) for (const from of hosts) addEdge(from, site.target, kind, "component-host", site);
    // No routed host within the import trace — the call lives in a sub-page/feature component not
    // bound to a route. Record it honestly instead of fabricating a `from`.
    else unresolvedEdges.push({ to: keyToPath[site.target] ?? site.target, fn: site.fn, provenance: `${site.file}:${site.line}`, reason: "origin screen not statically attributable (feature component with no routed host in the import graph)" });
  } else if (site.file.startsWith("src/stores/") || site.file.startsWith("src/services/")) {
    // Deep edge: the nav fires from a store/service action. Trace its real callers up to routed pages.
    const { routes, chain } = moduleOrigins(site.file, site.line);
    if (routes.length) {
      const tracedSite = { ...site, fn: `${site.fn}${chain.length ? ` ⟵ ${chain.slice(0, 3).join(", ")}` : ""}` };
      for (const from of routes) addEdge(from, site.target, kind, "module-trace", tracedSite);
    } else {
      unresolvedEdges.push({ to: keyToPath[site.target] ?? site.target, fn: site.fn, provenance: `${site.file}:${site.line}`, reason: "fired from a store/service action with no statically resolvable caller (dynamic dispatch)" });
    }
  } else if (site.file.startsWith("src/pages/")) {
    // a page file that maps to no routePattern (e.g. a catch-all 404) — honest, not a store action
    unresolvedEdges.push({ to: keyToPath[site.target] ?? site.target, fn: site.fn, provenance: `${site.file}:${site.line}`, reason: "page component not bound to a routePattern (e.g. catch-all/404)" });
  } else {
    unresolvedEdges.push({ to: keyToPath[site.target] ?? site.target, fn: site.fn, provenance: `${site.file}:${site.line}`, reason: "origin not statically attributable" });
  }
}

// ── 5b. imperative back calls → a back-edge from the firing screen to its PARENT route ──
// router.back()/navigate(-1) carry no destination, so the target is inferred as the parent route (the
// common case for "go back"). Honest: marked attribution "imperative-back" (the wrapper renders it as a
// back edge, inferred). Origin is attributed the SAME way as a forward call (page / nav / component / module).
function attributeOrigins(site) {
  const f = site.file.replace(/^src\//, "").replace(/\.tsx?$/, "");
  if (fileToRoutes[f]) return fileToRoutes[f];
  if (NAV_COMPONENTS.test(site.file)) return [authedEntry];
  if (site.file.startsWith("src/components/")) return pagesImporting(site.file);
  if (site.file.startsWith("src/stores/") || site.file.startsWith("src/services/")) return moduleOrigins(site.file, site.line).routes;
  return [];
}
const unresolvedBack = [];
for (const site of backSites) {
  const origins = attributeOrigins(site);
  if (!origins.length) {
    unresolvedBack.push({ fn: "back", provenance: `${site.file}:${site.line}`, reason: "back call's origin screen not statically attributable" });
    continue;
  }
  for (const from of origins) {
    const parentKey = parentOf(routeMeta[from]?.path);
    if (parentKey && parentKey !== from) addEdge(from, parentKey, "link", "imperative-back", site);
    else unresolvedBack.push({ from: keyToPath[from] ?? from, fn: "back", provenance: `${site.file}:${site.line}`, reason: "top-level screen — no parent route to return to" });
  }
}

// ── 6. build nodes (with parent hierarchy edges) ──
const ENTRY = new Set(["auth-sign-in", "auth-sign-up", "acceptInvite", "home"]);
// ADAPT-3: role lanes. The EXAMPLE below mirrors one app's real access gate
// (route-access-service.ts + role-resolution-service.ts) — each route sits in the lane of the
// MINIMUM persona that can reach it (cumulative: higher tiers also reach lower-tier routes).
// REPLACE these sets with YOUR app's gate (read its route-access service). With no gate to read,
// delete this block and fall back to the path heuristic:
//     const roleOf = (meta) => !meta.protected ? "public"
//       : /^\/admin\b/.test(meta.path) ? "admin" : "user";
// roleVariant marks routes whose CONTENT differs by role (same route, not separate routes).
const PUBLIC_ROUTES = new Set([
  "acceptInvite", "auth-request-password-reset", "auth-reset-password",
  "auth-sign-in", "auth-sign-up", "auth-verify-email",
]);
// any signed-in member (no admin role needed): personal screens + always-accessible property screens
const MEMBER_ROUTES = new Set([
  "home", "personalOrganizations", "personalProfile", "personalSchedule",
  "propertyMySchedule", "propertyPublishedSchedule",
]);
// property routes gated by a NavigationPermission → the lowest tier that the permission resolves to
// (canView*/canManageSchedule → departmentAdmin; canManageHotel/Users/Departments/Positions → propertyAdmin)
const PROPERTY_ROUTE_TIER = {
  propertyDepartmentCreate: "propertyAdmin",            // canManageHotel
  propertyDepartmentDetails: "departmentAdmin",         // canViewDepartments
  propertyDepartmentMembers: "propertyAdmin",           // canManageUsers
  propertyDepartmentPositionDetails: "departmentAdmin", // canViewPositions
  propertyDepartmentPositionMembers: "departmentAdmin", // canViewPositions
  propertyDepartmentPositions: "departmentAdmin",       // canViewPositions
  propertyDepartments: "departmentAdmin",               // canViewDepartments
  propertyDetails: "propertyAdmin",                     // canManageHotel
  propertyMemberProfile: "departmentAdmin",             // canManageSchedule
  propertyMembers: "propertyAdmin",                     // canManageUsers
  propertyScheduler: "departmentAdmin",                 // canManageSchedule
};
// Same route, different content by role (accessGate.canEdit / isAdmin in the page) — not separate routes.
const ROLE_VARIANT = {
  propertyMySchedule: { member: "read-only", admin: "editable" },
  propertyMemberProfile: { member: "view only", admin: "edit UI" },
  orgMemberProfile: { member: "view only", admin: "edit UI" },
};
function roleOf(meta, key) {
  if (!meta.protected || PUBLIC_ROUTES.has(key)) return "public";
  if (MEMBER_ROUTES.has(key)) return "departmentMember";
  if ((meta.path || "").startsWith("/org")) return "corporate"; // ORG_ROUTES require orgRole === "owner"
  return PROPERTY_ROUTE_TIER[key] ?? "departmentMember";
}
const nodes = routeKeys.map((k, idx) => {
  const meta = routeMeta[k];
  return {
    id: meta.path,
    key: k,
    label: meta.title,
    role: roleOf(meta, k),
    roleVariant: ROLE_VARIANT[k],
    page: meta.component,
    storyId: null,
    coverage: "none",
    parent: parentOf(meta.path) ? routeMeta[parentOf(meta.path)].path : undefined,
    group: groupOf(meta.path),
    order: idx,
    entry: ENTRY.has(k) || undefined,
  };
});

// hierarchy edges (extracted from the app's own parent-by-path computation)
for (const n of nodes) {
  if (n.parent) {
    const id = `${n.parent}→${n.id}→hierarchy`;
    if (!edgeMap.has(id)) {
      edgeMap.set(id, {
        from: n.parent,
        to: n.id,
        kind: "subroute",
        label: "sub-route",
        attribution: "route-hierarchy",
        provenance: ["src/router/config.tsx computeRouteMetadata()"],
      });
    }
  }
}

// resolve edge from/to route-keys → paths (nodes are keyed by path)
const edges = [...edgeMap.values()].map((e) => {
  const from = keyToPath[e.from] ?? e.from;
  const to = keyToPath[e.to] ?? e.to;
  // A back edge is a RETURN ACTION — not merely a link whose destination is an ancestor (a sidebar/hub
  // jump goes "up" too, and marking those is noise). Two honest signals: INTENT (a return-word label near
  // the call — a "Back"/"Cancel"/"Close" CTA) and IMPERATIVE (router.back()/navigate(-1), target inferred
  // as the parent). backVia records which fired; inferred flags the imperative guess.
  const imperative = e.attribution === "imperative-back";
  const back = imperative || !!e.backHint;
  // Label = the action's COPY (the CTA we read) when we have it; else a pre-set structural label (subroute),
  // else a plain "Back" for a return or `verb · source` for a forward edge. labelVia records which, so a
  // fallback is honest, not silent.
  const label = e.cta || e.label || (back ? "Back" : (e.source ? `${e.verb} · ${e.source}` : e.verb));
  return {
    from,
    to,
    kind: e.kind,
    label,
    labelVia: e.cta ? "cta" : "fallback",
    verb: e.verb,
    back: back || undefined,
    backVia: back ? (imperative ? "imperative" : "intent") : undefined,
    inferred: imperative || undefined,
    source: e.source,
    attribution: e.attribution,
    count: e.provenance.length,
    provenance: e.provenance,
  };
});

const graph = {
  generatedAt: new Date().toISOString(),
  extractor: ".storybook/scripts/extract-app-graph.mjs",
  lanes: ["public", "departmentMember", "departmentAdmin", "propertyAdmin", "corporate"],
  stats: {
    routes: nodes.length,
    navCallSites: callSites.length,
    navEdges: edges.filter((e) => e.attribution !== "route-hierarchy").length,
    hierarchyEdges: edges.filter((e) => e.attribution === "route-hierarchy").length,
    backEdges: edges.filter((e) => e.back).length,
    backByVia: edges.filter((e) => e.back).reduce((a, e) => ((a[e.backVia] = (a[e.backVia] || 0) + 1), a), {}),
    backCallSites: backSites.length,
    ctaLabels: edges.filter((e) => e.labelVia === "cta").length, // edges whose label is the real action copy
    labelFallbacks: edges.filter((e) => e.labelVia === "fallback").length, // …vs the verb·source fallback
    dynamicCallSites: dynamicSites.length,
    unresolvedEdges: unresolvedEdges.length,
    unresolvedBack: unresolvedBack.length,
    byAttribution: edges.reduce((a, e) => ((a[e.attribution] = (a[e.attribution] || 0) + 1), a), {}),
  },
  nodes,
  edges,
  // nav calls whose target route is computed at runtime — NOT statically resolvable.
  // Listed for full transparency rather than dropped or guessed.
  dynamicCallSites: dynamicSites,
  // nav calls with a known TARGET but no statically-attributable origin screen
  // (sub-page/feature components not bound to a route, or store/service actions).
  // Recorded with provenance instead of drawing a fabricated `from` edge.
  unresolvedEdges,
  // imperative back calls whose origin screen (or parent route) couldn't be resolved —
  // listed honestly rather than drawn as a guessed back-edge.
  unresolvedBack,
};

writeFileSync(join(ROOT, ".storybook/app-graph.json"), JSON.stringify(graph, null, 2) + "\n");
console.log(JSON.stringify(graph.stats, null, 2));
console.log(`\nWrote .storybook/app-graph.json — ${nodes.length} nodes, ${edges.length} edges`);

// ── 6b. self-diagnosis — never present a thin graph as complete ─────────────────────────────────
// A pattern-matcher silently under-reports when the app's nav idiom isn't in its menu — the DEFAULT
// failure mode of any extractor, and it exits 0 on a half-empty graph. So score the result against
// what we couldn't parse and, when it looks thin, name the offenders + WHICH ADAPT marker to revisit
// (the framework/codebase-specific parts). Mirrors extract-flows.sh's UNDER-EXTRACTION alarm for the
// richer app-graph; stays quiet when the graph is healthy. The fix loop is flow-capture.md.
const navEdgeCount = edges.filter((e) => e.attribution !== "route-hierarchy").length;
const unresolvedTotal = unresolvedEdges.length + unresolvedBack.length;
const thin =
  navEdgeCount < nodes.length ||            // fewer real edges than screens — almost always under-extraction
  dynamicSites.length > navEdgeCount ||     // more unparsed nav-shaped calls than captured edges
  unresolvedTotal > navEdgeCount / 2;       // half the captured volume again is unattributable
if (thin) {
  console.error(`\n⚠ LIKELY UNDER-EXTRACTION: ${nodes.length} route(s) but only ${navEdgeCount} navigation edge(s) — ` +
    `${dynamicSites.length} nav-shaped call site(s) unparsed, ${unresolvedEdges.length} unresolved, ${unresolvedBack.length} unresolved back.`);
  console.error(`  This graph is a DRAFT, not ground truth. Likely causes, in order — fix against the codebase, do not lower the bar:`);
  console.error(`  1. ADAPT-2 — your navigation idiom isn't swept. Read the unparsed call sites below, confirm they navigate, add a pass.`);
  console.error(`  2. ADAPT-1 — routes read from the wrong source (check src/router/*). A suspiciously low route count is the tell.`);
  console.error(`  3. Genuinely dynamic nav (navigate(computedPath), goToStep(n)) — keep it in dynamicCallSites; record, never guess.`);
  for (const s of dynamicSites.slice(0, 8)) console.error(`     ${s.file}:${s.line}  ${s.snippet}`);
  if (dynamicSites.length > 8) console.error(`     … +${dynamicSites.length - 8} more in app-graph.json → dynamicCallSites`);
  console.error(`  Fix loop: flow-capture.md → "When extraction under-reports". If the idiom is general, fold it upstream into extract-flows.sh.`);
} else {
  console.log(`✓ extraction healthy — ${navEdgeCount} edges over ${nodes.length} routes (${edges.filter((e) => e.back).length} back), ` +
    `${dynamicSites.length} dynamic, ${unresolvedTotal} unresolved (all recorded with provenance, none invented).`);
}

// ── 7. component → pages worklist (transitive) ──
// For each component in component-usage.json, resolve the routes/pages it ends up rendered on:
// every call-site file is mapped to its hosting route(s) — directly if it IS a routed page, else
// transitively (component → host → … → routed page) via the same import-graph walk used for edges.
// Output: .storybook/component-pages.json, consumed by the ComponentUsage wrapper.
function resolveFileToRoutes(fileRel) {
  const norm = fileRel.replace(/^src\//, "").replace(/\.tsx?$/, "");
  if (fileToRoutes[norm]) return fileToRoutes[norm]; // the call-site file IS a routed page
  if (fileRel.startsWith("src/")) return pagesImporting(fileRel, 4); // transitive host pages
  return [];
}
let usageComponents = {};
try {
  usageComponents = JSON.parse(readFileSync(join(ROOT, ".storybook/component-usage.json"), "utf8")).components ?? {};
} catch { usageComponents = {}; }

// a routed page COMPONENT is "on" its own route (SignInPage → /auth/sign-in), not used on others
const compToRoutes = {};
for (const k of routeKeys) {
  const cmp = routeMeta[k].component;
  if (cmp) (compToRoutes[cmp] ??= []).push(k);
}

// genuinely app-wide shell — matched by EXACT basename, never substring (so a table cell
// like `schedule-staff-member-header` is NOT mistaken for the app header / nav chrome).
const NAV_SHELL = new Set([
  "app-sidebar", "app-layout", "nav-main", "user-menu", "header", "footer",
  "sidebar", "topbar", "app-header", "site-header", "main-nav", "navbar",
]);
const baseOf = (f) => f.replace(/^.*\//, "").replace(/\.tsx?$/, "");

// Component hierarchy: each call-site file is a HOST component (the parent that renders this one).
// Map a component's def file (convention: src/components/<kebab(name)>.tsx) back to its name, so a
// call site in `published-schedule-day-cell.tsx` resolves to the parent `PublishedScheduleDayCell`.
// One component per file (project rule) makes this a clean inverse; children are the transposed graph.
const toKebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
const defFileToName = {};
for (const nm of Object.keys(usageComponents)) defFileToName[`src/components/${toKebab(nm)}.tsx`] = nm;

const componentPages = {};
for (const [name, v] of Object.entries(usageComponents)) {
  const routeSet = new Set(compToRoutes[name] ?? []); // seed with own route(s) if it's a page
  const hostFiles = []; // call-site files that did NOT resolve to a routed page
  const parentSet = new Set(); // host COMPONENTS that render this one (it is nested inside them)
  let globalNav = false;
  for (const f of v.files ?? []) {
    if (/\.(spec|test|stories)\./.test(f)) continue;
    if (NAV_SHELL.has(baseOf(f))) globalNav = true;
    const parent = defFileToName[f];
    if (parent && parent !== name) parentSet.add(parent);
    const routes = resolveFileToRoutes(f);
    if (routes.length) for (const rk of routes) routeSet.add(rk);
    else hostFiles.push(f);
  }
  const pages = [...routeSet]
    .map((rk) => ({ path: keyToPath[rk], title: routeMeta[rk]?.title ?? rk, role: roleOf(routeMeta[rk], rk), storyId: null }))
    .sort((a, b) => a.path.localeCompare(b.path));
  // When nothing resolved to a page and it's not app-wide chrome, surface the immediate host
  // component(s) — honest about what we DO know ("via X") instead of a vague "global".
  const hosts = pages.length === 0 && !globalNav
    ? [...new Set(hostFiles.filter((f) => f.startsWith("src/components/")).map(baseOf))].slice(0, 6)
    : [];
  componentPages[name] = {
    callSites: v.callSites ?? 0,
    props: v.props ? Object.keys(v.props).length : 0,
    declaredButUnused: (v.declaredButUnused ?? []).length,
    globalNav: pages.length === 0 && globalNav,
    parents: [...parentSet].sort(),
    children: [], // filled by the inverse pass below
    pages,
    hosts,
  };
}
// children = transpose of parents: X is a child of P ⟺ P is a parent of X.
for (const [name, entry] of Object.entries(componentPages)) {
  for (const parent of entry.parents) {
    if (componentPages[parent]) componentPages[parent].children.push(name);
  }
}
for (const entry of Object.values(componentPages)) entry.children.sort();
const resolvedCount = Object.values(componentPages).filter((c) => c.pages.length > 0).length;

// ── token ⇄ component/page edges (the UsageExplorer contract) ──────────────────────────────────────
// This richer resolver writes the SAME file as the generic build-component-pages.py, so it must be a
// SUPERSET — emit the token projection too, or it silently wipes UsageExplorer's token data. Mirrors the
// py: read project-inventory.json's token map, resolve each token's files → component + pages, both ways.
let tokenMap = [];
try { tokenMap = JSON.parse(readFileSync(join(ROOT, ".storybook/project-inventory.json"), "utf8")).tokens?.map ?? []; } catch { tokenMap = []; }
const deriveName = (p) => p.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "").split(/[-_.]/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join("");
const allFiles = new Set();
for (const v of Object.values(usageComponents)) for (const f of v.files ?? []) allFiles.add(f);
for (const r of tokenMap) for (const f of r.files ?? []) allFiles.add(f);
const fileIndex = {};
for (const f of allFiles) {
  const nm = defFileToName[f] || deriveName(f);
  if (componentPages[nm]) fileIndex[f] = { component: nm, kind: "component", pages: componentPages[nm].pages };
}
const tokens = {};
const compTokens = {};
for (const r of tokenMap) {
  if (!r.token) continue;
  const comps = new Set(), byPath = {};
  for (const f of r.files ?? []) {
    const e = fileIndex[f];
    if (!e) continue;
    if (e.component) { comps.add(e.component); (compTokens[e.component] ??= new Set()).add(r.token); }
    for (const p of e.pages) byPath[p.path] = p;
  }
  if (comps.size || Object.keys(byPath).length)
    tokens[r.token] = { category: r.category ?? null, count: r.count ?? 0, components: [...comps].sort(), pages: Object.values(byPath).sort((a, b) => a.path.localeCompare(b.path)) };
}
for (const [nm, entry] of Object.entries(componentPages)) { const t = compTokens[nm]; if (t) entry.tokens = [...t].sort(); }

writeFileSync(
  join(ROOT, ".storybook/component-pages.json"),
  JSON.stringify({ generatedAt: graph.generatedAt, extractor: graph.extractor, appMapStoryId: "flows-app-map--all", components: componentPages, tokens, fileIndex }, null, 2) + "\n",
);
console.log(`Wrote .storybook/component-pages.json — ${Object.keys(componentPages).length} components, ${resolvedCount} resolved to ≥1 page, ${Object.keys(tokens).length} tokens mapped`);
