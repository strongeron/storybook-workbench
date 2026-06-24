import type { Meta, StoryObj } from '@storybook/react-vite'
import { FigmaInventory } from '../wrappers/FigmaInventory'

/**
 * Figma Inventory — the root surface for "what did each sb-figma delivery bring into Storybook?"
 * Reads `.storybook/figma-inventory.json` (written by record-figma-delivery.py on each delivery).
 * Spec: docs/specs/2026-06-23-figma-feature-inventory.md.
 *
 * Pin it to the TOP of the sidebar — in `.storybook/preview.(ts|tsx)`:
 *   export const parameters = { options: { storySort: { order: ['Figma Inventory', '*'] } } }
 *
 * Adjust the import path if your stories don't live next to `wrappers/` (default `.storybook/`).
 */
const meta = {
  title: 'Figma Inventory',
  component: FigmaInventory,
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta<typeof FigmaInventory>
export default meta

type Story = StoryObj<typeof meta>

// The index of every delivered feature → story id `figma-inventory--overview`.
export const Overview: Story = { args: {} }

// ── One export per delivered feature ──
// sb-figma adds these as it delivers (right after running record-figma-delivery.py). The export NAME
// becomes the story id `figma-inventory--<name>`, which the index cards link to — so keep the export
// name matching the feature name passed in `args.feature`.
export const Hunts: Story = { args: { feature: 'Hunts' } }
// export const Detections: Story = { args: { feature: 'Detections' } }
