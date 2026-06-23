/**
 * Storybook-only wrapper library — barrel export.
 *
 * Tier 1 (CORE): ABCanvas, StateGrid, StateMatrix
 * Tier 2 (EXTENDED): StorySet, StoryStrip, TrackedDecision, DecisionsDashboard
 * Tier 3 (ADVANCED): ShaderCanvas, R3FCanvas, MotionStage
 * Flow (FLOW mode): AppFlowGraph, JourneyGraph — dependency-free SVG route map + journey map
 *
 * Import:
 *   import { ABCanvas, TrackedDecision } from '../../.storybook/wrappers';
 *
 * After scaffolding via scripts/scaffold-wrapper.sh, these files live at
 * .storybook/wrappers/ in the target project.
 */

// Tier 1 — CORE
export { ABCanvas } from './ABCanvas';
export type { ABCanvasProps, ABVariant } from './ABCanvas';

export { StateGrid } from './StateGrid';
export type { StateGridProps, StateEntry } from './StateGrid';

export { StateMatrix } from './StateMatrix';
export type { StateMatrixProps, MatrixAxis } from './StateMatrix';

// Real-usage overlay for the state grids (reads component-usage.json). Pass `usage=` to StateGrid/StateMatrix.
export { usageForProps, UsageBadge } from './usage-badge';
export type { ComponentUsage, UsageFact } from './usage-badge';

// Token real-usage grid — every declared colour/type token rendered + badged (reads project-inventory.json tokens.map).
export { TokenUsageGrid } from './TokenUsageGrid';
export type { TokenUsageGridProps, TokenUsageRow } from './TokenUsageGrid';

// Autodocs usage block — adds "Real usage in this app" to every component's Docs page (preview.ts docs.page).
// Renders ComponentContext (the per-component "Where it's used" map) as the component's sole real-usage
// surface (the old prop-value table was dropped); Foundations/Pages get their own provenance bands.
export { UsageSection } from './UsageSection';

// Per-component "Where it's used" — the Usage explorer's component view, dropped on a component's Docs
// page (used by UsageSection). Reuses the shared usage-stamp primitives. Reads component-pages.json.
export { ComponentContext } from './ComponentContext';
export type { ComponentContextProps } from './ComponentContext';

// Top-of-page orientation — provenance banner for derived-report surfaces (OFF by default; flip on
// with setProvenance() when someone asks "where is this from"), status banner for experiments.
export { ReportIntro, ExperimentBanner, setProvenance, provenanceEnabled } from './ReportIntro';
export type { ReportIntroProps, ReportSource, ExperimentBannerProps } from './ReportIntro';

// Tier 2 — EXTENDED
export { StorySet } from './StorySet';
export type { StorySetProps, StoryEntry } from './StorySet';

export { StoryStrip } from './StoryStrip';
export type { StoryStripProps } from './StoryStrip';

// Decision-tracking pair (opt-in workflow) — annotate one story, aggregate the board.
export { TrackedDecision } from './TrackedDecision';
export type { TrackedDecisionProps, DecisionStatus } from './TrackedDecision';

export { DecisionsDashboard } from './DecisionsDashboard';

// Tier 3 — ADVANCED
export { ShaderCanvas } from './ShaderCanvas';
export type { ShaderCanvasProps, Uniform } from './ShaderCanvas';

export { R3FCanvas } from './R3FCanvas';
export type { R3FCanvasProps } from './R3FCanvas';

export { MotionStage } from './MotionStage';
export type { MotionStageProps, Keyframe } from './MotionStage';

// Tier 4 — DESIGN-SYSTEM
export { TokensCanvas, discoverTokens } from './TokensCanvas';
export type { Token, TokenBag } from './TokensCanvas';

export { DesignSystemHealth } from './DesignSystemHealth';
export type { HealthFinding, HealthReport, FindingSeverity, FindingKind } from './DesignSystemHealth';

export { ProjectInventory } from './ProjectInventory';
export type { ProjectInventoryReport } from './ProjectInventory';

// Semantic/color token audit — values · usage · health (reads design-system-health.json).
export { TokenMatrix } from './TokenMatrix';
export type { TokenMatrixProps, TokenMatrixGroup, TokenMatrixRow } from './TokenMatrix';

// Icon coverage audit — which icons the app imports/renders and at what px sizes (live scan of src/).
// Library-agnostic: pass `library` + `resolve` (e.g. (n) => Lucide[n]); it never imports an icon package.
export { IconMatrix } from './IconMatrix';
export type { IconMatrixProps, IconLibrary, IconCmp } from './IconMatrix';

// Usage resolution — turn a token/size's raw `src/...` paths into the components & pages that consume it,
// each clickable into its story. Reads component-pages.json `fileIndex` (build-component-pages.py).
export { resolveUsage, usageSummary, UsageDetail, UsageDisclosure, useStoryLinker } from './usage-index';
export type { ResolvedUsage, CompRef, UsageDisclosureProps } from './usage-index';

// Usage explorer — the one "where is this used?" surface. Pick a token / component / page → full
// bidirectional context, every related entity clickable to navigate the graph. Reads the usage graph
// (component-pages.json: tokens[] + components[].tokens + pages).
export { UsageExplorer } from './UsageExplorer';

// Flow — FLOW mode (see references/flow-capture.md). Dependency-free SVG; icons injectable.
export { AppFlowGraph } from './AppFlowGraph';
export type { AppGraph, AppNode, AppEdge, Role, EdgeKind, Coverage, FlowIcons } from './AppFlowGraph';

export { JourneyGraph } from './JourneyGraph';
export type { Journey, JourneyStep, JourneyStepKind, JourneyIcons } from './JourneyGraph';
