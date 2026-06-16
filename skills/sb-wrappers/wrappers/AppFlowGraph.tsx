import { useEffect, useMemo, useRef, useState } from "react"
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react"
import { ReportIntro } from "./ReportIntro"

// AppFlowGraph — interactive, dependency-free SVG route map for a whole app.
// Storybook-only chrome (lives in .storybook/wrappers/, never bundles to the app).
//
// Two views:
//   · Map   — every screen in role lanes, the overview.
//   · Focus — click a screen and it re-lays-out as a wide ego graph: the screen centered,
//             everything that links INTO it fanned left, everything it links OUT to fanned
//             right. Click a neighbour to walk.
//
// RULES (baked in — keep them):
//   1. NO EMOJI anywhere. Use the injectable icon slots below.
//   2. PERSONALIZED VIEW — pass your project's icons (lucide-react, Phosphor, your own SVGs)
//      via the `icons` prop so the map matches the app's visual language. Defaults are
//      minimal inline SVGs (zero dependency) so the wrapper renders standalone in any project.
//   3. DEPENDENCY-FREE — pure SVG + React. Do NOT pull React Flow / a layout engine into the
//      app repo for Storybook-only chrome; a role-laned app lays out deterministically.
//
// Feed it an `AppGraph` you derive from `.storybook/flows.json` (routes + edges + navSources).
// Reconcile `storyId` / `coverage` against Storybook's index.json so clicks open the real story.

export type Role = "public" | "user" | "admin" | "system" | string
// `nav` = persistent navigation (sidebar / header / footer) present on every page in an area.
export type EdgeKind = "link" | "router" | "form" | "redirect" | "nav" | "subroute"
/** story = a Pages/* story exists; flow = also walked by a built Flows/* story; none = neither. */
export type Coverage = "flow" | "story" | "partial" | "none"

export type AppNode = {
  id: string // canonical route path
  label: string
  role: Role
  page?: string // page/component target (informational)
  storyId: string | null // Storybook story to open on click
  coverage: Coverage
  modals?: string[] // in-page modal states this screen can open
  order: number // vertical order within its role lane
  entry?: boolean // a natural entry point into the app
  /** same route, different content by role (e.g. {member: "read-only", admin: "editable"}) */
  roleVariant?: { member?: string; admin?: string }
}

export type AppEdge = {
  from: string
  to: string
  kind: EdgeKind
  label: string
  /** true when this transition is already walkable in a built Flows/* story. */
  inFlow?: boolean
  /** a RETURN/up transition (back-link, "Cancel"/"Back" CTA, or imperative router.back()). Rendered
   *  distinctly so the graph shows the full round-trip, not just forward navigation. */
  back?: boolean
  /** which signal flagged it back: "hierarchy" (to is an ancestor) · "intent" (a return-word label) ·
   *  "imperative" (router.back()/navigate(-1), destination inferred as the parent). */
  backVia?: "hierarchy" | "intent" | "imperative"
  /** the imperative case infers the parent as the destination — flagged so it reads as a best guess. */
  inferred?: boolean
}

export type AppGraph = { nodes: AppNode[]; edges: AppEdge[]; lanes?: Role[] }

// ── Icon slots (RULE 2) — inline SVG defaults, override via the `icons` prop ──
export type FlowIcon = ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>
export interface FlowIcons {
  back?: FlowIcon       // back to Map
  zoomIn?: FlowIcon     // +
  zoomOut?: FlowIcon    // −
  entry?: FlowIcon      // entry-point marker
  modal?: FlowIcon      // modal-state marker
  openStory?: FlowIcon  // open the screen's story
}
const Svg = (p: { size?: number; strokeWidth?: number; style?: CSSProperties; d: string; fill?: boolean }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill={p.fill ? "currentColor" : "none"}
    stroke="currentColor" strokeWidth={p.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" style={p.style}>
    <path d={p.d} />
  </svg>
)
const DEFAULT_ICONS: Required<FlowIcons> = {
  back:      (p) => <Svg {...p} d="M19 12H5M12 19l-7-7 7-7" />,
  zoomIn:    (p) => <Svg {...p} d="M12 5v14M5 12h14" />,
  zoomOut:   (p) => <Svg {...p} d="M5 12h14" />,
  entry:     (p) => <Svg {...p} fill d="M8 5v14l11-7z" />,
  modal:     (p) => <Svg {...p} d="M3 5h18v14H3zM3 9h18" />,
  openStory: (p) => <Svg {...p} d="M7 17L17 7M9 7h8v8" />,
}

const LANE_LABEL: Record<string, string> = {
  public: "Public", user: "User", admin: "Admin", system: "System",
  departmentMember: "Dept Member", departmentAdmin: "Dept Admin", propertyAdmin: "Property Admin", corporate: "Corporate",
}
const laneLabel = (r: Role) => LANE_LABEL[r] ?? (r.charAt(0).toUpperCase() + r.slice(1))

const NODE_W = 216
const NODE_H = 56
const LANE_W = 300
const LANE_PITCH_MAX = 660
const ROW_H = 80
const HEADER_Y = 60
const MARGIN_X = 28
const RIGHT_PAD = 112

const F_W = 212
const F_NH = 62
const F_GAP = 22
const F_COL = 168
const HUE = 152 // default brand hue (forest green) — change to re-tint the whole chrome

const COVERAGE_COLOR: Record<Coverage, string> = {
  flow: `var(--color-success, oklch(0.6 0.14 ${HUE}))`,
  story: "oklch(0.6 0.11 245)",
  partial: `var(--color-warning, oklch(0.74 0.14 78))`,
  none: `var(--color-muted, oklch(0.62 0.015 ${HUE}))`,
}
const COVERAGE_LABEL: Record<Coverage, string> = {
  flow: "In a built flow", story: "Has a story", partial: "Partial story", none: "No story",
}
const EDGE_COLOR: Record<EdgeKind, string> = {
  link: `oklch(0.56 0.015 ${HUE})`,
  router: "oklch(0.55 0.12 258)",
  form: `var(--color-warning, oklch(0.66 0.14 72))`,
  redirect: `oklch(0.58 0.14 ${HUE})`,
  nav: "oklch(0.62 0.06 300)",
  subroute: `oklch(0.8 0.008 ${HUE})`, // structure, not an action — faint
}
// Back/return edges read as one flavour regardless of their mechanism kind: a distinct violet + a fine
// dash, so a round-trip (forward action out, return back) is legible at a glance.
const BACK_COLOR = "oklch(0.58 0.13 300)"
const BACK_DASH = "2 4"
const edgeColor = (e: AppEdge) => (e.back ? BACK_COLOR : EDGE_COLOR[e.kind])
const edgeDashOf = (e: AppEdge) => (e.back ? BACK_DASH : dashFor(e.kind))
// Labels read as the ACTION the user triggers (what fires the navigation), not the framework call.
const EDGE_LABEL: Record<EdgeKind, string> = { router: "Opens", redirect: "Redirect", link: "Link", nav: "Nav", form: "Form submit", subroute: "Sub-route" }
// "back" is a filter FACET alongside the kinds — a back edge is governed by it, not its mechanism kind —
// so the legend toggle behaves exactly like the others. These lookups extend the kind maps with it.
type Facet = EdgeKind | "back"
const FACET_LABEL: Record<Facet, string> = { ...EDGE_LABEL, back: "Back" }
const facetColor = (f: Facet) => (f === "back" ? BACK_COLOR : EDGE_COLOR[f])
const facetDashed = (f: Facet) => (f === "back" ? true : dashed(f))
const dashed = (k: EdgeKind) => k === "router" || k === "form" || k === "nav" || k === "subroute"
// dotted (fine) for structural sub-routes, dashed for click/nav/form, solid for link/redirect
const dashFor = (k: EdgeKind) => (k === "subroute" ? "1 6" : k === "router" || k === "form" || k === "nav" ? "5 4" : undefined)
const edgeWidth = (k: EdgeKind, inFlow?: boolean, hi = 2.2, lo = 1.3) => (k === "subroute" ? 1 : inFlow ? hi : lo)
const edgeOpacity = (k: EdgeKind, inFlow?: boolean, hi = 0.88, lo = 0.32) => (k === "subroute" ? 0.22 : inFlow ? hi : lo)

type LNode = { id: string; x: number; y: number; w: number; h: number; kind: "screen" | "center" | "neighbor"; node: AppNode; dim?: boolean }
type LEdge = { key: string; d: string; color: string; kind: EdgeKind; width: number; opacity: number; dash?: string; label?: string; lx?: number; ly?: number }
type LaneMeta = { role: Role; x: number; count: number }
type Layout = { width: number; height: number; nodes: LNode[]; edges: LEdge[]; lanes?: LaneMeta[]; participating?: Set<string>; signature: string }

function activeLanes(nodes: AppNode[], declared?: Role[]): Role[] {
  const order = declared && declared.length ? declared : ["public", "user", "admin", "system"]
  const present = Array.from(new Set(nodes.map((n) => n.role)))
  // declared lanes that are present, then any extra roles the data has
  return [...order.filter((r) => present.includes(r)), ...present.filter((r) => !order.includes(r))]
}

type Side = "L" | "R"
type Pin = { e: AppEdge; a: LNode; b: LNode; self: boolean; sSide: Side; tSide: Side }

function mapLayout(graph: AppGraph, lanes: Role[], kinds: Record<EdgeKind | "back", boolean>, pitch: number): Layout {
  const lane = new Map<string, number>()
  const nodes: LNode[] = []
  // Pack each lane from the top: row = position WITHIN the lane, not the global route index.
  // (n.order is a global sort key; using it directly as the row left huge vertical gaps once
  // routes were spread across 5 lanes.) Sort by order so lane sequence stays intentional.
  const laneRow = new Map<number, number>()
  const ordered = [...graph.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const n of ordered) {
    const li = Math.max(0, lanes.indexOf(n.role))
    const row = laneRow.get(li) ?? 0
    laneRow.set(li, row + 1)
    lane.set(n.id, li)
    nodes.push({ id: n.id, x: MARGIN_X + li * pitch, y: HEADER_Y + row * ROW_H, w: NODE_W, h: NODE_H, kind: "screen", node: n })
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const pins: Pin[] = []
  const participating = new Set<string>()
  for (const e of graph.edges) {
    if (!kinds[e.back ? "back" : e.kind]) continue
    const a = byId.get(e.from), b = byId.get(e.to)
    if (!a || !b) continue
    participating.add(e.from)
    participating.add(e.to)
    if (a.id === b.id) { pins.push({ e, a, b, self: true, sSide: "R", tSide: "R" }); continue }
    const al = lane.get(a.id)!, bl = lane.get(b.id)!
    if (al === bl) pins.push({ e, a, b, self: false, sSide: "R", tSide: "R" })
    else if (bl > al) pins.push({ e, a, b, self: false, sSide: "R", tSide: "L" })
    else pins.push({ e, a, b, self: false, sSide: "L", tSide: "R" })
  }

  const akey = (id: string, s: Side) => `${id}|${s}`
  const total = new Map<string, number>()
  for (const p of pins) {
    if (p.self) continue
    total.set(akey(p.a.id, p.sSide), (total.get(akey(p.a.id, p.sSide)) ?? 0) + 1)
    total.set(akey(p.b.id, p.tSide), (total.get(akey(p.b.id, p.tSide)) ?? 0) + 1)
  }
  const used = new Map<string, number>()
  const slotY = (node: LNode, key: string) => {
    const t = total.get(key) ?? 1
    const i = used.get(key) ?? 0
    used.set(key, i + 1)
    return node.y + (node.h * (i + 1)) / (t + 1)
  }
  const sideX = (node: LNode, s: Side) => (s === "R" ? node.x + node.w : node.x)

  const edges: LEdge[] = pins.map((p, i) => {
    if (p.self) {
      const x = p.a.x + p.a.w, cy = p.a.y + p.a.h / 2
      return { key: `${i}`, d: `M ${x - 8} ${cy - 12} C ${x + 46} ${cy - 30}, ${x + 46} ${cy + 30}, ${x - 8} ${cy + 12}`, color: edgeColor(p.e), kind: p.e.kind, width: 1.6, opacity: 0.75, dash: edgeDashOf(p.e), label: p.e.label, lx: x + 34, ly: cy }
    }
    const sx = sideX(p.a, p.sSide), tx = sideX(p.b, p.tSide)
    const sy = slotY(p.a, akey(p.a.id, p.sSide)), ty = slotY(p.b, akey(p.b.id, p.tSide))
    let d: string
    if (p.sSide === "R" && p.tSide === "R") {
      const bow = Math.max(sx, tx) + 52
      d = `M ${sx} ${sy} C ${bow} ${sy}, ${bow} ${ty}, ${tx} ${ty}`
    } else {
      const c = Math.max(48, Math.abs(tx - sx) / 2)
      const c1 = p.sSide === "R" ? sx + c : sx - c
      const c2 = p.tSide === "L" ? tx - c : tx + c
      d = `M ${sx} ${sy} C ${c1} ${sy}, ${c2} ${ty}, ${tx} ${ty}`
    }
    return { key: `${i}`, d, color: edgeColor(p.e), kind: p.e.kind, width: edgeWidth(p.e.kind, p.e.inFlow), opacity: edgeOpacity(p.e.kind, p.e.inFlow), dash: edgeDashOf(p.e), label: p.e.label, lx: (sx + tx) / 2, ly: (sy + ty) / 2 }
  })

  const counts = lanes.map((r) => graph.nodes.filter((n) => n.role === r).length)
  return {
    width: MARGIN_X * 2 + (lanes.length - 1) * pitch + NODE_W + RIGHT_PAD,
    height: HEADER_Y + Math.max(1, ...counts) * ROW_H + 24,
    nodes, edges,
    lanes: lanes.map((role, i) => ({ role, x: MARGIN_X + i * pitch, count: counts[i] })),
    participating,
    signature: `map:${lanes.join(",")}:${pitch}:${Object.values(kinds).join("")}`,
  }
}

function centerCardHeight(n: AppNode): number {
  const base = 104
  const modals = n.modals?.length ? n.modals.length * 28 + 12 : 0
  const story = n.storyId ? 40 : 0
  return base + modals + story
}

// Collapse parallel edges to the SAME neighbor into one card. Two `Home → My Schedule` call sites
// are two edges but ONE structural connection — rendering them as two "Home" cards reads as a bug.
// Keep a representative edge, count the parallels, and merge distinct labels so nothing is lost.
type EgoGroup = { e: AppEdge; count: number; label?: string }
function groupByNeighbor(edges: AppEdge[], endpoint: "from" | "to"): EgoGroup[] {
  const map = new Map<string, EgoGroup>()
  for (const e of edges) {
    const g = map.get(e[endpoint])
    if (g) {
      g.count++
      if (e.label && g.label && !g.label.includes(e.label)) g.label = `${g.label} · ${e.label}`
    } else {
      map.set(e[endpoint], { e, count: 1, label: e.label })
    }
  }
  return [...map.values()]
}
const egoLabel = (g: EgoGroup) => (g.count > 1 ? `${g.label ?? ""} ×${g.count}`.trim() : g.label)

function egoLayout(graph: AppGraph, selId: string, kinds: Record<EdgeKind | "back", boolean>, col: number): Layout {
  const byNode = new Map(graph.nodes.map((n) => [n.id, n]))
  const sel = byNode.get(selId)!
  const inc = groupByNeighbor(graph.edges.filter((e) => e.to === selId && e.from !== selId && kinds[e.back ? "back" : e.kind]), "from")
  const out = groupByNeighbor(graph.edges.filter((e) => e.from === selId && e.to !== selId && kinds[e.back ? "back" : e.kind]), "to")
  const self = graph.edges.filter((e) => e.from === selId && e.to === selId && kinds[e.back ? "back" : e.kind])

  const centerH = centerCardHeight(sel)
  const leftStack = inc.length * F_NH + Math.max(0, inc.length - 1) * F_GAP
  const rightStack = out.length * F_NH + Math.max(0, out.length - 1) * F_GAP
  const contentH = Math.max(leftStack, rightStack, centerH) + 96
  const cx0 = 40 + F_W + col
  const cy = contentH / 2
  const center: LNode = { id: sel.id, x: cx0, y: cy - centerH / 2, w: F_W, h: centerH, kind: "center", node: sel }
  const nodes: LNode[] = [center]
  const edges: LEdge[] = []

  const cLeft = { x: center.x, y: cy }
  const cRight = { x: center.x + center.w, y: cy }

  inc.forEach((g, i) => {
    const e = g.e
    const ny = cy - leftStack / 2 + i * (F_NH + F_GAP) + F_NH / 2
    const nx = center.x - col - F_W
    nodes.push({ id: `in:${e.from}:${i}`, x: nx, y: ny - F_NH / 2, w: F_W, h: F_NH, kind: "neighbor", node: byNode.get(e.from)! })
    const sx = nx + F_W, sy = ny
    const c = (cLeft.x - sx) / 2
    edges.push({ key: `in${i}`, d: `M ${sx} ${sy} C ${sx + c} ${sy}, ${cLeft.x - c} ${cLeft.y}, ${cLeft.x} ${cLeft.y}`, color: edgeColor(e), kind: e.kind, width: edgeWidth(e.kind, e.inFlow, 2.6, 1.8), opacity: edgeOpacity(e.kind, true, 0.9, 0.9), dash: edgeDashOf(e), label: egoLabel(g), lx: (sx + cLeft.x) / 2, ly: (sy + cLeft.y) / 2 })
  })
  out.forEach((g, i) => {
    const e = g.e
    const ny = cy - rightStack / 2 + i * (F_NH + F_GAP) + F_NH / 2
    const nx = center.x + center.w + col
    nodes.push({ id: `out:${e.to}:${i}`, x: nx, y: ny - F_NH / 2, w: F_W, h: F_NH, kind: "neighbor", node: byNode.get(e.to)! })
    const tx = nx, ty = ny
    const c = (tx - cRight.x) / 2
    edges.push({ key: `out${i}`, d: `M ${cRight.x} ${cRight.y} C ${cRight.x + c} ${cRight.y}, ${tx - c} ${ty}, ${tx} ${ty}`, color: edgeColor(e), kind: e.kind, width: edgeWidth(e.kind, e.inFlow, 2.6, 1.8), opacity: edgeOpacity(e.kind, true, 0.9, 0.9), dash: edgeDashOf(e), label: egoLabel(g), lx: (cRight.x + tx) / 2, ly: (cRight.y + ty) / 2 })
  })
  self.forEach((e, i) => {
    const x = center.x + center.w / 2, top = center.y
    edges.push({ key: `self${i}`, d: `M ${x - 18} ${top} C ${x - 30} ${top - 46}, ${x + 30} ${top - 46}, ${x + 18} ${top}`, color: edgeColor(e), kind: e.kind, width: 1.8, opacity: 0.9, dash: edgeDashOf(e), label: e.label, lx: x, ly: top - 40 })
  })

  return {
    width: center.x + center.w + col + F_W + 40,
    height: contentH,
    nodes, edges,
    signature: `ego:${selId}:${col}:${Object.values(kinds).join("")}`,
  }
}

function goToStory(storyId: string): void {
  const top = window.parent ?? window
  try {
    top.location.href = `${top.location.origin}/?path=/story/${storyId}`
  } catch {
    window.location.href = `/?path=/story/${storyId}`
  }
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
const panel: CSSProperties = {
  position: "absolute", background: `var(--color-surface, oklch(0.99 0.004 ${HUE}))`, border: `1px solid var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))`,
  borderRadius: 10, padding: "9px 11px", fontSize: 12, color: `var(--color-foreground, oklch(0.3 0.02 ${HUE}))`,
  boxShadow: `0 6px 22px oklch(0.4 0.03 ${HUE} / 0.12)`,
}
const btn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", fontSize: 11.5,
  borderRadius: 7, border: `1px solid var(--color-border-subtle, oklch(0.88 0.012 ${HUE}))`, background: `var(--color-surface, oklch(0.99 0.004 ${HUE}))`,
  color: `var(--color-foreground, oklch(0.38 0.02 ${HUE}))`, cursor: "pointer", fontFamily: "inherit",
}
const chip: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", borderRadius: 999,
  border: `1px solid var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))`, fontSize: 11, background: `var(--color-surface, oklch(0.985 0.005 ${HUE}))`,
}

export function AppFlowGraph({ graph, icons, generatedAt, hideIntro }: { graph: AppGraph; icons?: FlowIcons; generatedAt?: string; hideIntro?: boolean }) {
  const ic = { ...DEFAULT_ICONS, ...icons }
  const lanes = useMemo(() => activeLanes(graph.nodes, graph.lanes), [graph])
  const [mode, setMode] = useState<"map" | "focus">("map")
  const [sel, setSel] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Record<EdgeKind | "back", boolean>>({ link: true, router: true, form: true, redirect: true, nav: true, subroute: true, back: true })
  const [covFilter, setCovFilter] = useState<Record<Coverage, boolean>>({ flow: true, story: true, partial: true, none: true })
  const [view, setView] = useState({ k: 0.8, tx: 16, ty: 16 })
  const [cw, setCw] = useState(1200)
  const wrapRef = useRef<HTMLDivElement>(null)
  const size = useRef({ w: 1000, h: 600 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const pitch = useMemo(
    () => Math.max(LANE_W, Math.min(LANE_PITCH_MAX, Math.floor((cw - 2 * MARGIN_X - NODE_W - RIGHT_PAD) / Math.max(1, lanes.length - 1)))),
    [cw, lanes.length],
  )
  const focusCol = useMemo(() => Math.max(F_COL, Math.min(460, Math.floor((cw - 80 - 3 * F_W) / 2))), [cw])

  const layout = useMemo<Layout>(
    () => (mode === "focus" && sel ? egoLayout(graph, sel, kinds, focusCol) : mapLayout(graph, lanes, kinds, pitch)),
    [mode, sel, graph, lanes, kinds, pitch, focusCol],
  )

  function fitFor(l: Layout, focus: boolean) {
    const { w, h } = size.current
    if (focus) {
      const k = Math.min(1.15, Math.max(0.32, Math.min((w - 32) / l.width, (h - 32) / l.height)))
      setView({ k, tx: (w - l.width * k) / 2, ty: Math.max(12, (h - l.height * k) / 2) })
    } else {
      const k = Math.min(1.2, Math.max(0.34, (w - 24) / l.width))
      setView({ k, tx: (w - l.width * k) / 2, ty: 14 })
    }
  }
  useEffect(() => { fitFor(layout, mode === "focus") /* eslint-disable-next-line */ }, [layout.signature])
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight }
      setCw(el.clientWidth)
    })
    ro.observe(el)
    size.current = { w: el.clientWidth, h: el.clientHeight }
    setCw(el.clientWidth)
    fitFor(layout, mode === "focus")
    return () => ro.disconnect()
    // eslint-disable-next-line
  }, [])

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setView((v) => {
      const k = Math.min(2.4, Math.max(0.25, v.k * factor))
      const wx = (px - v.tx) / v.k, wy = (py - v.ty) / v.k
      return { k, tx: px - wx * k, ty: py - wy * k }
    })
  }
  function onPointerDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest("[data-node]")) return
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (!drag.current) return
    setView((v) => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }))
  }
  function onPointerUp() { drag.current = null }
  function zoom(f: number) { setView((v) => ({ ...v, k: Math.min(2.4, Math.max(0.25, v.k * f)) })) }

  function openNode(id: string) { setSel(id); setMode("focus") }
  function backToMap() { setMode("map") }

  const cov = (c: Coverage) => graph.nodes.filter((n) => n.coverage === c).length
  const selNode = sel ? graph.nodes.find((n) => n.id === sel) : null

  const isFocus = mode === "focus" && !!sel
  const allActive = Object.values(kinds).every(Boolean)
  const spotlight = !isFocus && !allActive
  const showEdgeLabels = isFocus || layout.edges.length <= 12
  const activeKindNames = (Object.keys(kinds) as Facet[]).filter((k) => kinds[k])

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", color: `var(--color-foreground, oklch(0.28 0.02 ${HUE}))`, display: "flex", flexDirection: "column", height: "100dvh", minHeight: 480 }}>
      {!hideIntro && (
        <ReportIntro
          what="Every screen in the app and how they connect — links, redirects, forms, and the persistent nav chrome — not just a flat list of pages. Click a screen to walk its incoming and outgoing edges."
          source={{ file: "flows.json", skill: "sb-flows" }}
          pipeline={[{ skill: "sb-flows", role: "the route map" }, { skill: "sb-wrappers", role: "this view" }]}
          refresh="extract-flows.sh"
          generatedAt={generatedAt}
        />
      )}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>App route map</div>
          <div style={{ fontSize: 12.5, color: `var(--color-muted-foreground, oklch(0.5 0.02 ${HUE}))`, marginTop: 2 }}>
            {isFocus
              ? "Connections for one screen · click a neighbour to walk, drag to pan, scroll to zoom"
              : spotlight
                ? `${activeKindNames.map((k) => FACET_LABEL[k]).join(" + ")} · ${layout.participating?.size ?? 0} of ${graph.nodes.length} screens · click one to expand`
                : `${graph.nodes.length} screens · ${graph.edges.length} transitions · click a screen to expand, or filter an edge type to spotlight its screens`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: `var(--color-muted-foreground, oklch(0.55 0.02 ${HUE}))` }}>Coverage:</span>
          {(["flow", "story", "partial", "none"] as Coverage[]).map((c) => (
            <button
              key={c}
              onClick={() => setCovFilter((s) => ({ ...s, [c]: !s[c] }))}
              style={{ ...btn, opacity: covFilter[c] ? 1 : 0.4 }}
              title={covFilter[c] ? `Dim ${COVERAGE_LABEL[c].toLowerCase()}` : `Highlight ${COVERAGE_LABEL[c].toLowerCase()}`}
            >
              <span style={{ width: 9, height: 9, borderRadius: 999, background: COVERAGE_COLOR[c] }} />
              {cov(c)} {COVERAGE_LABEL[c].toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {mode === "focus" && (
          <>
            <button onClick={backToMap} style={{ ...btn, fontWeight: 600 }}><ic.back size={13} /> Map</button>
            <span style={{ ...chip, gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: COVERAGE_COLOR[selNode?.coverage ?? "none"] }} />
              <strong style={{ fontWeight: 600 }}>{selNode?.label}</strong>
            </span>
            <span style={{ width: 1, height: 18, background: `var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))` }} />
          </>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => zoom(1.15)} style={btn} title="Zoom in"><ic.zoomIn size={14} /></button>
          <button onClick={() => zoom(1 / 1.15)} style={btn} title="Zoom out"><ic.zoomOut size={14} /></button>
          <button onClick={() => fitFor(layout, true)} style={btn} title="Zoom to fit everything">Fit all</button>
          <button onClick={() => fitFor(layout, false)} style={btn} title="Fill width">Width</button>
        </div>
        <span style={{ width: 1, height: 18, background: `var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))` }} />
        <span style={{ fontSize: 11.5, color: `var(--color-muted-foreground, oklch(0.55 0.02 ${HUE}))` }}>Edges:</span>
        {/* One filter per facet — the kinds plus "Back" (a back-link, a Cancel/Back CTA, or router.back()),
            all the same toggle style. A back edge is governed by Back, not its mechanism kind. */}
        {(Object.keys(FACET_LABEL) as Facet[]).map((k) => (
          <button key={k} onClick={() => setKinds((s) => ({ ...s, [k]: !s[k] }))} style={{ ...btn, opacity: kinds[k] ? 1 : 0.4, borderColor: facetColor(k), color: facetColor(k) }}
            title={k === "back" ? "Return / up navigation: a back-link, a Cancel/Back CTA, or imperative router.back()/navigate(-1)" : undefined}>
            <span style={{ width: 14, borderTop: `2px ${facetDashed(k) ? "dashed" : "solid"} ${facetColor(k)}`, display: "inline-block", marginRight: 5, verticalAlign: "middle" }} />
            {FACET_LABEL[k]}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "relative", flex: 1, minHeight: 0, overflow: "hidden", cursor: drag.current ? "grabbing" : "grab",
          border: `1px solid var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))`, borderRadius: 12, background: `var(--color-background, oklch(0.992 0.003 ${HUE}))`,
          backgroundImage: `radial-gradient(var(--color-border-subtle, oklch(0.9 0.012 ${HUE})) 0.8px, transparent 0.8px)`, backgroundSize: "22px 22px", touchAction: "none",
        }}
      >
        <svg width={layout.width} height={layout.height} style={{ overflow: "visible", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, transformOrigin: "0 0", transition: drag.current ? "none" : `transform 0.42s ${EASE}` }}>
          <defs>
            {(Object.keys(EDGE_COLOR) as EdgeKind[]).map((k) => (
              <marker key={k} id={`arr-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={EDGE_COLOR[k]} />
              </marker>
            ))}
            {/* Back edges get an OPEN return-chevron (vs the solid forward triangle) so a back action
                reads as a distinct arrow, not just a violet forward one. Direction stays honest. */}
            <marker id="arr-back" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M2,1.5 L8,5 L2,8.5" fill="none" stroke={BACK_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>

          {layout.lanes?.map((lm, i) => (
            <g key={lm.role}>
              <rect x={lm.x - 12} y={26} width={NODE_W + 24} height={layout.height - 38} rx={12} fill={i % 2 ? `var(--color-surface, oklch(0.985 0.007 ${HUE}))` : `var(--color-surface, oklch(0.978 0.009 ${HUE}))`} stroke={`var(--color-border-subtle, oklch(0.93 0.012 ${HUE}))`} />
              <text x={lm.x + NODE_W / 2} y={18} textAnchor="middle" fontSize={12.5} fontWeight={650} fill={`var(--color-muted-foreground, oklch(0.5 0.03 ${HUE}))`} letterSpacing="0.04em">
                {laneLabel(lm.role).toUpperCase()} · {lm.count}
              </text>
            </g>
          ))}

          {layout.edges.map((e) => {
            const isBack = e.color === BACK_COLOR
            const lbl = e.label
            // A back edge's arrowhead sits at the SOURCE end (where the back-button lives) and points BACK
            // (markerStart + the marker's auto-start-reverse orient), so the LINE itself reads as a return —
            // forward edges arrow toward the destination, back edges arrow back toward the screen.
            return (
            <g key={e.key} style={{ transition: `opacity 0.3s ${EASE}` }}>
              <path d={e.d} fill="none" stroke={e.color} strokeWidth={e.width} strokeDasharray={e.dash} opacity={e.opacity}
                markerStart={isBack ? "url(#arr-back)" : undefined}
                markerEnd={isBack ? undefined : `url(#arr-${e.kind})`} />
              {showEdgeLabels && lbl && e.lx != null && e.ly != null && (
                <g transform={`translate(${e.lx}, ${e.ly})`}>
                  <rect x={-(lbl.length * 3.2 + 8)} y={-9} width={lbl.length * 6.4 + 16} height={18} rx={9} fill={`var(--color-surface, oklch(0.995 0.003 ${HUE}))`} stroke={isBack ? BACK_COLOR : `var(--color-border-subtle, oklch(0.9 0.012 ${HUE}))`} />
                  <text textAnchor="middle" y={4} fontSize={10.5} fill={isBack ? BACK_COLOR : `var(--color-muted-foreground, oklch(0.42 0.04 ${HUE}))`}>{lbl}</text>
                </g>
              )}
            </g>
          )})}

          {layout.nodes.map((ln) => {
            const dim = (spotlight && !!layout.participating && !layout.participating.has(ln.id)) || !covFilter[ln.node.coverage]
            return (
              <g key={ln.id} transform={`translate(${ln.x}, ${ln.y})`} style={{ transition: drag.current ? "none" : `transform 0.42s ${EASE}, opacity 0.3s ${EASE}`, opacity: dim ? 0.2 : 1 }}>
                <foreignObject width={ln.w} height={ln.h} style={{ overflow: "visible" }}>
                  {ln.kind === "center" ? <CenterCard n={ln.node} ic={ic} /> : <ScreenCard n={ln.node} w={ln.w} h={ln.h} ic={ic} onOpen={() => openNode(ln.node.id)} />}
                </foreignObject>
              </g>
            )
          })}
        </svg>

        {/* Legend */}
        <div style={{ ...panel, right: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: `var(--color-muted-foreground, oklch(0.45 0.02 ${HUE}))` }}>Coverage</div>
          {(["flow", "story", "partial", "none"] as Coverage[]).map((c) => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: COVERAGE_COLOR[c] }} />
              <span style={{ fontSize: 11 }}>{COVERAGE_LABEL[c]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ScreenCard({ n, w, h, ic, onOpen }: { n: AppNode; w: number; h: number; ic: Required<FlowIcons>; onOpen: () => void }) {
  return (
    <div
      data-node={n.id}
      onClick={onOpen}
      style={{
        boxSizing: "border-box", height: h, width: w, padding: "7px 9px", borderRadius: 10, cursor: "pointer",
        background: `var(--color-surface, oklch(0.995 0.003 ${HUE}))`, border: `1.5px solid var(--color-border-subtle, oklch(0.88 0.012 ${HUE}))`,
        boxShadow: `0 1px 2px oklch(0.4 0.03 ${HUE} / 0.06)`, display: "flex", flexDirection: "column", gap: 2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: COVERAGE_COLOR[n.coverage], flex: "0 0 auto" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.1, color: `var(--color-foreground, oklch(0.26 0.02 ${HUE}))`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
        {n.entry && <span title="Entry point" style={{ marginLeft: "auto", color: `var(--color-muted-foreground, oklch(0.6 0.03 ${HUE}))`, display: "inline-flex" }}><ic.entry size={11} /></span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: `var(--color-muted-foreground, oklch(0.55 0.02 ${HUE}))`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{n.id}</span>
        {n.roleVariant ? <span title={`Same route, content differs by role (NOT role-restricted) — member: ${n.roleVariant.member ?? "—"} · admin: ${n.roleVariant.admin ?? "—"}`} style={{ flex: "0 0 auto", fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", color: "oklch(0.5 0.13 245)", border: "1px solid oklch(0.5 0.13 245 / 0.35)", borderRadius: 999, padding: "0 5px", display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}><span style={{ width: 5, height: 5, borderRadius: 999, background: "oklch(0.5 0.13 245)" }} /> VARIES BY ROLE</span> : null}
        {n.modals?.length ? <span title={`Opens ${n.modals.length} modal(s): ${n.modals.join(", ")} · close returns to this screen`} style={{ marginLeft: "auto", fontSize: 9.5, color: "oklch(0.55 0.1 300)", flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 3 }}><ic.modal size={11} /> {n.modals.length}</span> : null}
      </div>
    </div>
  )
}

function CenterCard({ n, ic }: { n: AppNode; ic: Required<FlowIcons> }) {
  return (
    <div
      data-node={n.id}
      style={{
        boxSizing: "border-box", width: F_W, padding: "12px 13px", borderRadius: 13,
        background: `var(--color-surface, oklch(0.995 0.003 ${HUE}))`, border: `2px solid ${COVERAGE_COLOR[n.coverage]}`,
        boxShadow: `0 8px 26px oklch(0.4 0.04 ${HUE} / 0.16)`, display: "flex", flexDirection: "column", gap: 7,
      }}
    >
      <div style={{ fontSize: 14.5, fontWeight: 650, lineHeight: 1.15, color: `var(--color-foreground, oklch(0.22 0.02 ${HUE}))` }}>{n.label}</div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, lineHeight: 1.35, color: `var(--color-muted-foreground, oklch(0.5 0.02 ${HUE}))`, wordBreak: "break-all" }}>{n.id}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <span style={{ ...chip, gap: 5, fontSize: 10.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: COVERAGE_COLOR[n.coverage] }} />
          {COVERAGE_LABEL[n.coverage]}
        </span>
        {n.entry && <span style={{ ...chip, fontSize: 10.5, color: `var(--color-muted-foreground, oklch(0.45 0.04 ${HUE}))`, gap: 4 }}><ic.entry size={11} /> Entry</span>}
      </div>
      {n.modals?.length ? (
        // Modals are in-page states, not routes: each opens OVER this screen and CLOSES back to it.
        // The "close ↩ returns here" header makes that round-trip explicit without a route edge.
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.55 0.09 300)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ic.modal size={10} /> Opens · close ↩ returns here
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {n.modals.map((m) => <span key={m} style={{ ...chip, fontSize: 10, color: "oklch(0.5 0.1 300)" }}>{m}</span>)}
          </div>
        </div>
      ) : null}
      {n.storyId && (
        <button onClick={() => goToStory(n.storyId!)} style={{ ...btn, width: "100%", justifyContent: "center", color: "oklch(0.4 0.1 245)", borderColor: "oklch(0.8 0.05 245)", marginTop: 1, gap: 5 }}>Open story <ic.openStory size={12} /></button>
      )}
    </div>
  )
}
