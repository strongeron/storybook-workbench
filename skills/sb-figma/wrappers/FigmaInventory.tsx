/**
 * FigmaInventory — the root "what did each Figma delivery bring into Storybook?" surface.
 *
 * sb-figma records every delivered feature into `.storybook/figma-inventory.json` (record-figma-delivery.py);
 * this renders it. Two modes over the SAME store:
 *   • index (no `feature` prop) — every delivered feature as a card: name, description, board link, story
 *     count, and a jump into its own overview story. This is the `Figma Inventory/Overview` story.
 *   • one feature (`feature="Hunts"`) — that delivery's board + spec links, description, and the table of
 *     stories/components it introduced (each chip links to the story). One `Figma Inventory/<Feature>` story.
 *
 * Reuses the usage-stamp look (card / Chip / mono / tokens) and the Icon set — never emoji. Storybook-only.
 * Defensive: an unknown feature, or no inventory yet, renders a friendly empty state (not nothing).
 * Spec: docs/specs/2026-06-23-figma-feature-inventory.md.
 */
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from './icons'
import { brand, dim, ink, line, mono, surface, card } from './usage-stamp'

interface StoryRef { title: string; storyId: string | null; kind?: string }
interface FeatureEntry {
  feature: string
  figmaUrl: string
  specUrl: string
  nodeIds: string[]
  description: string
  stories: StoryRef[]
  deliveredAt?: string
}
interface Inventory { generatedAt?: string; features?: Record<string, FeatureEntry> }

const invGlob = (import.meta as { glob: <T>(p: string, o?: { eager: boolean }) => Record<string, T> })
  .glob<Inventory>('../../.storybook/figma-inventory.json', { eager: true })
const INVENTORY: Inventory = Object.values(invGlob)[0] ?? {}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const storyHref = (id: string | null) => (id ? `/?path=/story/${id}` : null)
// Each feature is an export on the single `Figma Inventory` story title → id `figma-inventory--<slug>`.
const overviewHref = (feature: string) => `/?path=/story/figma-inventory--${slug(feature)}`

function ExtLink({ href, children }: { href: string; children: React.ReactNode }): ReactElement {
  return (
    <a href={href} target="_top" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: brand, textDecoration: 'none', fontSize: 11, whiteSpace: 'nowrap' }}>
      {children} <Icon.external size={11} />
    </a>
  )
}

// One story/component chip. When it links to a story the WHOLE chip opens it (label + ↗ are one click
// target, not just the arrow); dashed/muted and inert when there's no story id yet.
function StoryChip({ s }: { s: StoryRef }): ReactElement {
  const href = storyHref(s.storyId)
  const label = s.title.replace(/^.*\//, '')
  const shell: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '2px 8px',
    fontFamily: mono, fontSize: 10.5, whiteSpace: 'nowrap', textDecoration: 'none',
    border: `1px ${href ? 'solid' : 'dashed'} ${href ? line : 'color-mix(in oklab, ' + dim + ' 40%, transparent)'}`,
    background: href ? 'color-mix(in oklab, currentColor 3%, transparent)' : 'transparent',
    color: href ? ink : dim,
  }
  const inner = (
    <>
      {s.kind && s.kind !== 'story' ? <span style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: dim }}>{s.kind}</span> : null}
      {label}
      {href && <Icon.external size={11} style={{ color: brand, marginLeft: 1 }} />}
    </>
  )
  return href
    ? <a href={href} target="_top" title="open story" style={{ ...shell, cursor: 'pointer' }}>{inner}</a>
    : <span title="no story yet" style={shell}>{inner}</span>
}

function Empty({ what }: { what: string }): ReactElement {
  return (
    <section style={{ marginTop: '1rem', fontFamily: mono }}>
      <div style={{ ...card, color: dim, fontSize: 13, lineHeight: 1.55, maxWidth: '70ch' }}>
        {what} Deliver a feature with <strong>sb-figma</strong> — it records the board link + the stories it
        creates into <code>figma-inventory.json</code> (via <code>record-figma-delivery.py</code>), and this
        surface fills in. Source: <code>.storybook/figma-inventory.json</code>.
      </div>
    </section>
  )
}

function FeatureCard({ entry }: { entry: FeatureEntry }): ReactElement {
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <a href={overviewHref(entry.feature)} target="_top"
          style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: ink, textDecoration: 'none' }}>{entry.feature}</a>
        <span style={{ fontSize: 10.5, color: dim }}>{entry.stories.length} {entry.stories.length === 1 ? 'story' : 'stories'}</span>
      </div>
      {entry.description && <p style={{ fontSize: 12.5, color: dim, lineHeight: 1.5, margin: 0, maxWidth: '70ch' }}>{entry.description}</p>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <ExtLink href={entry.figmaUrl}>Figma board</ExtLink>
        {entry.specUrl && entry.specUrl !== entry.figmaUrl && <ExtLink href={entry.specUrl}>spec</ExtLink>}
        <a href={overviewHref(entry.feature)} target="_top" style={{ fontFamily: mono, fontSize: 11, color: brand, textDecoration: 'none' }}>overview →</a>
      </div>
    </div>
  )
}

export interface FigmaInventoryProps {
  /** Render ONE feature's overview. Omit for the index of all features. */
  feature?: string
}

export function FigmaInventory({ feature }: FigmaInventoryProps): ReactElement {
  const features = INVENTORY.features ?? {}
  const list = Object.values(features).sort((a, b) => a.feature.localeCompare(b.feature))

  // ── One feature ──
  if (feature) {
    const entry = list.find((e) => e.feature === feature || slug(e.feature) === slug(feature))
    if (!entry) return <Empty what={`No delivery recorded for "${feature}" yet.`} />
    return (
      <section style={{ fontFamily: mono, maxWidth: 920 }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: dim }}>Figma delivery</div>
        <h2 style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: ink, margin: '2px 0 8px' }}>{entry.feature}</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <ExtLink href={entry.figmaUrl}>Figma board</ExtLink>
          {entry.specUrl && entry.specUrl !== entry.figmaUrl && <ExtLink href={entry.specUrl}>spec node</ExtLink>}
          {entry.nodeIds.length > 0 && <span style={{ fontSize: 10.5, color: dim }}>nodes: {entry.nodeIds.join(', ')}</span>}
        </div>
        {entry.description && <p style={{ fontSize: 13.5, color: ink, lineHeight: 1.6, maxWidth: '70ch' }}>{entry.description}</p>}
        <div style={{ marginTop: 14, padding: '12px 0 0', borderTop: `1px solid ${line}` }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: dim, marginBottom: 8 }}>
            Brought into Storybook — {entry.stories.length} {entry.stories.length === 1 ? 'story' : 'stories'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {entry.stories.length ? entry.stories.map((s, i) => <StoryChip key={s.storyId ?? `${s.title}-${i}`} s={s} />)
              : <span style={{ fontSize: 11, color: dim, fontStyle: 'italic' }}>no stories recorded</span>}
          </div>
        </div>
      </section>
    )
  }

  // ── Index of all features ──
  if (!list.length) return <Empty what="No Figma deliveries recorded yet." />
  return (
    <section style={{ fontFamily: mono, maxWidth: 920 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: dim }}>Figma Inventory</div>
      <h2 style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: ink, margin: '2px 0 4px' }}>Delivered from Figma</h2>
      <p style={{ fontSize: 12.5, color: dim, lineHeight: 1.5, margin: '0 0 14px', maxWidth: '70ch' }}>
        Every feature sb-figma delivered into this Storybook — the board it came from and the stories it
        brought in. Click a feature for its overview. Source: <code>figma-inventory.json</code>.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {list.map((e) => <FeatureCard key={slug(e.feature)} entry={e} />)}
      </div>
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${line}`, fontSize: 10, color: dim, background: surface }}>
        {list.length} {list.length === 1 ? 'feature' : 'features'} · generated {INVENTORY.generatedAt ?? 'n/a'}
      </div>
    </section>
  )
}
