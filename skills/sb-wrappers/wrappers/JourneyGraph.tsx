import type { ComponentType, CSSProperties, ReactElement } from "react"
import { ReportIntro } from "./ReportIntro"

/**
 * JourneyGraph — renders ONE CURATED user journey as a vertical journey map for the Flows/* Docs page.
 * A journey is a hand-curated narrative THROUGH the captured app (sb-flows' flows.json holds the route
 * nodes + nav edges; AppFlowGraph draws the whole map, a JourneyGraph traces one persona's path across
 * it). The narrow docs column is ideal for this; the live clickable step-through lives in the Canvas tab.
 * Pure presentation, Storybook-only chrome.
 *
 * Shows: a "what is this?" provenance banner (ReportIntro — OFF by default, reachable on demand via
 * setProvenance() / __SB_WB_PROVENANCE__; `hideIntro` hard-suppresses it even when the global is on)
 * and a collapsed "how to add a flow" authoring hint (suppress with `hideAuthoringHint`) — so a
 * first-time viewer learns what the map is, and a maintainer learns how to add their own.
 *
 * RULES (baked in — keep them):
 *   1. NO EMOJI. Step kinds render via the injectable icon slots below.
 *   2. PERSONALIZED VIEW — pass your project's icons (lucide-react, Phosphor, your own SVGs)
 *      via the `icons` prop so the journey matches the app's visual language. Defaults are
 *      minimal inline SVGs (zero dependency). Example with lucide:
 *        import { Monitor, MousePointerClick, Layers, CheckCircle2, ArrowUpRight } from "lucide-react"
 *        <JourneyGraph journey={j} icons={{ screen: Monitor, action: MousePointerClick,
 *          modal: Layers, end: CheckCircle2, link: ArrowUpRight }} />
 *   3. Click a step with a `storyId` to open that exact documented state in Storybook.
 */

export type JourneyStepKind = "screen" | "action" | "modal" | "end"

export interface JourneyStep {
  label: string
  kind: JourneyStepKind
  /** What we captured at this step: a route, a trigger, an effect, a component/modal. */
  detail?: string
  /** Storybook story id showing this exact documented state — makes the node clickable. */
  storyId?: string
}

export interface Journey {
  title: string
  role: string
  entry: string
  steps: JourneyStep[]
  /** What can be exercised in isolation (the Canvas step-through). */
  testable?: string
}

// ── Icon slots (RULE 2) — inline SVG defaults, override via the `icons` prop ──
export type FlowIcon = ComponentType<{ size?: number; strokeWidth?: number; style?: CSSProperties }>
export interface JourneyIcons {
  screen?: FlowIcon
  action?: FlowIcon
  modal?: FlowIcon
  end?: FlowIcon
  link?: FlowIcon // the "open story" affordance
}
const Svg = (p: { size?: number; strokeWidth?: number; style?: CSSProperties; d: string }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={p.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" style={p.style}>
    <path d={p.d} />
  </svg>
)
const DEFAULT_ICONS: Required<JourneyIcons> = {
  screen: (p) => <Svg {...p} d="M3 4h18v12H3zM8 20h8M12 16v4" />,            // monitor
  action: (p) => <Svg {...p} d="M9 3v12l3-3 2 5 2-1-2-5h4z" />,             // pointer-click
  modal:  (p) => <Svg {...p} d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,        // layers
  end:    (p) => <Svg {...p} d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />, // check-circle
  link:   (p) => <Svg {...p} d="M7 17L17 7M9 7h8v8" />,                     // arrow-up-right
}

const T = {
  surface: "var(--color-surface, oklch(0.99 0.004 155))",
  line: "var(--color-border-subtle, oklch(0.9 0.01 155))",
  textStrong: "var(--color-foreground, oklch(0.28 0.02 155))",
  textMuted: "var(--color-muted-foreground, oklch(0.48 0.022 155))",
  brand: "var(--color-text-brand-primary, oklch(0.45 0.1 152))",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "ui-sans-serif, system-ui, sans-serif",
}

// Each kind = a semantic role from the app's tokens (oklch fallbacks keep it standalone). The icon
// takes its circle's `ink`; the ring is derived from ink→surface by one formula (ringFor). Surfaces must
// be THEME-AWARE: modal/end/action use semantic *-surface tokens the app flips in dark mode; screen has no
// semantic brand-surface token, so it SYNTHESIZES one by mixing themed brand-500 into the themed surface —
// never a fixed palette step like brand-50, which stays light in dark mode (the cream-circle bug).
const KIND_META: Record<JourneyStepKind, { slot: keyof JourneyIcons; label: string; surface: string; ink: string }> = {
  screen: { slot: "screen", label: "screen", surface: "color-mix(in oklab, var(--color-brand-500, oklch(0.56 0.13 116)) 14%, var(--color-surface, oklch(0.985 0.004 155)))", ink: "var(--color-text-brand-primary, oklch(0.45 0.1 152))" },
  action: { slot: "action", label: "action", surface: "var(--color-surface, oklch(0.985 0.004 155))",     ink: "var(--color-muted-foreground, oklch(0.48 0.022 155))" },
  modal:  { slot: "modal",  label: "modal",  surface: "var(--color-warning-surface, oklch(0.96 0.03 85))", ink: "var(--color-warning-text, oklch(0.5 0.1 85))" },
  end:    { slot: "end",    label: "done",   surface: "var(--color-success-surface, oklch(0.95 0.04 152))", ink: "var(--color-success-text, oklch(0.45 0.12 152))" },
}
// Soft ring: the kind's ink mixed into its surface — one formula so every badge ring matches weight.
const ringFor = (m: { ink: string; surface: string }): string => `color-mix(in oklch, ${m.ink} 38%, ${m.surface})`

function goToStory(storyId: string): void {
  const top = window.parent ?? window
  try {
    top.location.href = `${top.location.origin}/?path=/story/${storyId}`
  } catch {
    window.location.href = `/?path=/story/${storyId}`
  }
}

// `wrap` lets a long step detail flow onto multiple lines instead of overflowing the narrow Docs
// column; header chips (role/entry) stay single-line (nowrap, the default).
function Chip({ children, wrap = false }: { children: string; wrap?: boolean }): ReactElement {
  return (
    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, border: `1px solid ${T.line}`, borderRadius: 6, padding: "1px 6px", display: "inline-block", whiteSpace: wrap ? "normal" : "nowrap", lineHeight: wrap ? 1.5 : undefined, overflowWrap: wrap ? "anywhere" : undefined }}>
      {children}
    </span>
  )
}

// Collapsed "how do I add one of these?" teaching block — always available, never in the way.
function AuthoringHint(): ReactElement {
  const code: CSSProperties = { fontFamily: T.mono, fontSize: 11, color: T.textStrong, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 5, padding: "0.05rem 0.3rem" }
  const li: CSSProperties = { marginBottom: 6, lineHeight: 1.55 }
  return (
    <details style={{ fontFamily: T.sans, fontSize: 12.5, color: T.textMuted, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: "10px 14px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, color: T.textStrong }}>How to add a flow like this</summary>
      <ol style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        <li style={li}><strong>Capture</strong> the app: <code style={code}>scaffold-wrapper.sh --flow</code> (sb-flows writes <code style={code}>flows.json</code> — route nodes + nav edges).</li>
        <li style={li}><strong>Curate</strong> one journey: a typed <code style={code}>Journey</code> {"{ title, role, entry, steps[] }"} — one persona's path across the captured map.</li>
        <li style={li}>Each step is <code style={code}>{"{ label, kind, detail, storyId }"}</code>; <code style={code}>kind</code> ∈ <code style={code}>screen · action · modal · end</code>. Point <code style={code}>storyId</code> at that step's full-width state story (sb-stories) so the map deep-links to the exact state.</li>
        <li style={{ ...li, marginBottom: 0 }}>Render it in a <code style={code}>Flows/*.mdx</code>: <code style={code}>{"<JourneyGraph journey={myJourney} />"}</code>. Pass <code style={code}>icons={"{…}"}</code> to match your app's icon set.</li>
      </ol>
    </details>
  )
}

export function JourneyGraph(
  { journey, icons, hideIntro = false, hideAuthoringHint = false }:
  { journey: Journey; icons?: JourneyIcons; hideIntro?: boolean; hideAuthoringHint?: boolean },
): ReactElement {
  const ic = { ...DEFAULT_ICONS, ...icons }
  const Link = ic.link
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {!hideIntro && (
      <ReportIntro
        what={<>A user journey through the app — each numbered step is the <strong>real</strong> page, component, or modal for that state (not a mockup), in the order a <code>{journey.role}</code> walks them. Click an underlined step to open that exact state in Storybook.</>}
        source={{ file: "curated from flows.json", skill: "sb-flows" }}
        freshness="Curated per flow from the captured route graph — keep the journey's steps 1:1 with the Flows sidebar."
        refresh="extract-flows.sh"
        pipeline={[
          { skill: "sb-flows", role: "captured routes + edges" },
          { skill: "sb-wrappers", role: "this journey map" },
          { skill: "sb-stories", role: "each step's state story" },
        ]}
      />
    )}
    <div style={{ fontFamily: T.sans, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 20, color: T.textStrong }}>
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{journey.title}</span>
        <Chip>{`role: ${journey.role}`}</Chip>
        <Chip>{`entry: ${journey.entry}`}</Chip>
        <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
          {journey.steps.length} steps captured
        </span>
      </div>

      {/* Hint */}
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14, display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: T.brand, display: "inline-flex" }}><Link size={13} strokeWidth={2.5} /></span>
        <span>Click any underlined step to open that exact state in Storybook.</span>
      </div>

      {/* Vertical journey */}
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {journey.steps.map((s, i) => {
          const meta = KIND_META[s.kind]
          const Icon = ic[meta.slot]
          const last = i === journey.steps.length - 1
          return (
            <li key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14 }}>
              {/* Rail */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: "50%", background: meta.surface, border: `1.5px solid ${ringFor(meta)}`, color: meta.ink, flexShrink: 0 }}>
                  <Icon size={16} strokeWidth={2} />
                </span>
                {!last && <span style={{ width: 2, flex: 1, minHeight: 22, background: T.line }} />}
              </div>

              {/* Card */}
              <div style={{ paddingBottom: last ? 0 : 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  {s.storyId ? (
                    <button type="button" onClick={() => goToStory(s.storyId!)} title="Open this state in Storybook"
                      style={{ all: "unset", cursor: "pointer", fontWeight: 600, fontSize: 14, color: T.brand, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>
                      {s.label}
                      <Link size={13} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <span style={{ fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>{s.label}</span>
                  )}
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{meta.label}</span>
                </div>
                {s.detail && <div style={{ marginTop: 4 }}><Chip wrap>{s.detail}</Chip></div>}
              </div>
            </li>
          )
        })}
      </ol>

      {/* Footer */}
      {journey.testable && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.line}`, display: "flex", gap: 8, alignItems: "center", color: T.textMuted, fontSize: 12 }}>
          <span><strong style={{ color: T.textStrong, fontWeight: 600 }}>Notes:</strong> {journey.testable}</span>
        </div>
      )}
    </div>
    {!hideAuthoringHint && <AuthoringHint />}
    </div>
  )
}
