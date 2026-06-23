/**
 * Foundations swatch primitives — Storybook-only.
 *
 * Render curated design-system tokens by referencing the real CSS custom
 * properties (`var(--token)`) loaded from theme.css via the preview, and read
 * back the *resolved* value with getComputedStyle so the catalog never drifts
 * from the source of truth.
 *
 * Not a story file (no `.stories` suffix) — imported by the Foundations stories.
 */
import { useEffect, useRef, useState } from "react"
import { resolvePaint } from "./resolve-paint"

// Neutral, themed color roles. Title/body use the app's foreground token (readable in
// light AND dark) — no green brand tint on content. Fallbacks keep these usable if the
// helper is ever rendered without the app tokens loaded.
const ink = "var(--color-foreground, oklch(0.30 0.01 155))"
const dim = "var(--color-muted-foreground, oklch(0.48 0.015 155))"
const line = "var(--color-border-subtle, oklch(0.905 0.008 155))"
const panel = "var(--color-surface, oklch(0.975 0.006 155))"
const mono =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

// ─────────────────────────────────────────────────────────────────────────────
// Live token usage — scan every app source file (Vite, build-time) and tally how
// often each color token is referenced as a Tailwind utility. No hardcoded
// snapshot, so the catalog never drifts. Same approach as Foundations/Icons.
// ─────────────────────────────────────────────────────────────────────────────
const SOURCES = import.meta.glob("/src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

// Tailwind utility prefixes that take a color token.
const COLOR_PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "from", "via", "to",
  "outline", "divide", "decoration", "accent", "caret", "placeholder", "shadow",
]
// Full color-utility class → occurrence count across src (stories excluded).
const CLASS_COUNTS: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  const re = new RegExp(`(?:^|[^\\w-])((?:${COLOR_PREFIXES.join("|")})-[a-z][a-z0-9-]*)`, "g")
  for (const [path, code] of Object.entries(SOURCES)) {
    if (path.includes(".stories.")) continue
    for (const m of code.matchAll(re)) out[m[1]] = (out[m[1]] ?? 0) + 1
  }
  return out
})()

/** Exact-class count, e.g. classUsage("text-muted-foreground"). */
export function classUsage(cls: string): number {
  return CLASS_COUNTS[cls] ?? 0
}

/** All-prefix count for a token fragment (token name minus the `color-` prefix),
 *  e.g. colorUsage("brand-500") sums bg-/text-/border-/… -brand-500. */
export function colorUsage(fragment: string): number {
  let n = CLASS_COUNTS[fragment] ?? 0 // fragment may itself be a full utility (border-default)
  for (const p of COLOR_PREFIXES) n += CLASS_COUNTS[`${p}-${fragment}`] ?? 0
  return n
}

/** Largest single color-utility count — for sizing usage bars consistently. */
export const maxColorUse = Math.max(1, ...Object.values(CLASS_COUNTS))

export interface TokenUsage {
  /** total references: exact Tailwind utility classes + var(--token) refs */
  count: number
  /** distinct source files (relative to src/) that reference the token */
  files: string[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Full reference scan for ONE semantic token across real source — counts both
 * `var(--token)` (CSS/inline-style consumers) AND the token's exact Tailwind
 * utility classes, and returns WHERE (the files). This is the truthful adoption
 * signal: a token consumed only via var() (e.g. --color-background) no longer
 * reads as 0. Stories are excluded so the catalog doesn't count itself.
 */
export function tokenUsage(token: string, utilities: string[] = []): TokenUsage {
  const parts = [`var\\(\\s*--${escapeRe(token)}(?![\\w-])`]
  for (const u of utilities) parts.push(`(?:^|[^\\w-])${escapeRe(u)}(?![\\w-])`)
  const re = new RegExp(parts.join("|"), "g")
  let count = 0
  const files: string[] = []
  for (const [path, code] of Object.entries(SOURCES)) {
    if (path.includes(".stories.") || /theme\.(css|em\.css)$/.test(path)) continue
    const hits = code.match(re)
    if (hits && hits.length) {
      count += hits.length
      files.push(path.replace(/^\/?src\//, ""))
    }
  }
  files.sort()
  return { count, files }
}

function useResolved(varName: string, prop: "backgroundColor" | "color") {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState("")
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // For backgroundColor, resolvePaint paints + retries bare-channel tokens (see resolve-paint.ts)
    // and leaves the swatch showing the real color. `color` isn't a painted probe — read it directly.
    setValue(prop === "backgroundColor" ? resolvePaint(el, varName) : getComputedStyle(el).color)
  }, [prop, varName])
  return { ref, value }
}

// Copy icon (inline SVG — icons.tsx has no copy glyph).
function CopyIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** The `--token` name as a click-to-copy button (copies `--token`) with a copy icon + brief feedback. */
export function CopyName({ token, size = 11.5 }: { token: string; size?: number }) {
  const [copied, setCopied] = useState(false)
  const text = `--${token}`
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  return (
    <button type="button" onClick={copy} title={`Copy ${text}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", padding: 0, border: 0, background: "none", cursor: "pointer", fontFamily: mono, fontSize: size, fontWeight: 600, color: ink }}>
      <code style={{ fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</code>
      <span style={{ color: copied ? "var(--color-success, oklch(0.6 0.16 150))" : dim, display: "inline-flex" }}>
        {copied ? "✓" : <CopyIcon size={Math.round(size)} />}
      </span>
    </button>
  )
}

/** Expandable "N files" disclosure — shows the using files inline (at table level), not on hover. */
export function FilesDisclosure({ files }: { files: string[] }) {
  const [open, setOpen] = useState(false)
  if (!files.length) return null
  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ padding: 0, border: 0, background: "none", cursor: "pointer", fontFamily: mono, fontSize: 10.5, color: dim }}>
        {open ? "▾" : "▸"} {files.length} file{files.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {files.map((f) => <li key={f} style={{ fontFamily: mono, fontSize: 10, color: dim, wordBreak: "break-all" }}>{f}</li>)}
        </ul>
      )}
    </div>
  )
}

export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  // No underline here — the first row's borderTop is the single separator,
  // so titles above row-lists don't get a doubled hairline.
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontFamily: mono,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: dim,
          margin: "0 0 6px",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Grid({
  min = 200,
  children,
}: {
  min?: number
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: 12,
      }}
    >
      {children}
    </div>
  )
}

export function ColorSwatch({ token }: { token: string }) {
  // Chip (the ref'd element) holds only the token color, so getComputedStyle
  // reads it reliably. The checker sits behind it so translucent tokens show alpha.
  const { ref, value } = useResolved(token, "backgroundColor")
  // tokenUsage returns BOTH count and the files — so the swatch can list pages using the token
  // (inline, expandable) instead of only a hover count. Cover var(--token) + every colour utility.
  const fragment = token.replace(/^color-/, "")
  const { count: uses, files } = tokenUsage(token, COLOR_PREFIXES.map((p) => `${p}-${fragment}`))
  return (
    <div
      style={{
        border: `1px solid ${line}`,
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--color-surface, oklch(0.994 0.003 155))",
      }}
    >
      <div
        style={{
          height: 64,
          backgroundImage:
            "linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%),linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 6px 6px",
        }}
      >
        <div ref={ref} style={{ height: "100%", background: `var(--${token})` }} />
      </div>
      <div style={{ padding: "8px 10px" }}>
        <CopyName token={token} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 2 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: dim }}>{value || "—"}</span>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: uses ? dim : line }} title="var() + Tailwind utility uses across src">
            {uses} use{uses === 1 ? "" : "s"}
          </span>
        </div>
        <FilesDisclosure files={files} />
      </div>
    </div>
  )
}

export function Field({
  token,
  children,
}: {
  token: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 16,
        alignItems: "center",
        padding: "14px 0",
        borderTop: `1px solid ${line}`,
      }}
    >
      <code style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 600, color: ink }}>
        --{token}
      </code>
      <div>{children}</div>
    </div>
  )
}

export function TokenRow({
  token,
  utility,
  role,
  uses,
}: {
  token: string
  utility: string
  role: string
  uses?: number
}) {
  const { ref, value } = useResolved(token, "backgroundColor")
  const dead = value === "rgba(0, 0, 0, 0)"
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(240px,1.2fr) 1fr auto",
        gap: 16,
        alignItems: "center",
        padding: "10px 0",
        borderTop: `1px solid ${line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          ref={ref}
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 6,
            background: `var(--${token})`,
            border: `1px solid ${line}`,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <code style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: ink }}>
            --{token}
          </code>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: dead ? "var(--color-error, oklch(0.55 0.18 25))" : dim, marginTop: 2 }}>
            {role} · {dead ? "unresolved (transparent)" : value || "—"}
          </div>
        </div>
      </div>
      <code style={{ fontFamily: mono, fontSize: 11.5, color: dim }}>
        .{utility}
      </code>
      <span
        style={{
          fontFamily: mono,
          fontSize: 11,
          color: dim,
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {uses != null ? `${uses} uses` : "—"}
      </span>
    </div>
  )
}

export function Page({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 32 }}>
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: dim,
          }}
        >
          {eyebrow}
        </div>
        <h1
          style={{
            fontFamily: mono,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: ink,
            margin: "4px 0 0",
          }}
        >
          {title}
        </h1>
      </header>
      {children}
    </div>
  )
}

export { ink, dim, line, panel, mono }
