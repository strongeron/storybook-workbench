// Controlled-component story template — uses useArgs to keep the Controls panel
// in sync when the component fires onChange. Use this template (not component-story.tsx)
// for: Switch, Toggle, Checkbox, Radio, Tabs, Accordion, Select, anything where the
// component owns internal state but exposes value + onChange as a controlled API.
//
// See references/without-mcp.md §5 for the pattern explanation.

import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, expect } from 'storybook/test';
import { useArgs } from 'storybook/preview-api';

// Adapt the import path to your project:
import { Switch } from './Switch';

const meta = {
  title: 'Components/Form/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: {
    checked: false,
    onChange: fn(),
  },
  // Wire the Controls panel — the react-vite default (react-docgen) does NOT infer
  // TS unions into selects, so declare them. Group with table.category; hide what a
  // panel can't drive (onChange callback, className escape hatch). See without-mcp.md §13.
  argTypes: {
    checked: { control: 'boolean', table: { category: 'State' } },
    disabled: { control: 'boolean', table: { category: 'State' } },
    size: { control: 'inline-radio', options: ['small', 'medium', 'large'], table: { category: 'Appearance' } },
    label: { control: 'text', table: { category: 'Content' } },
    onChange: { control: false, table: { category: 'Events' } },
    className: { table: { disable: true } },
  },
  // render bridges component state ↔ Controls panel
  render: function Render(args) {
    const [{ checked }, updateArgs] = useArgs();
    return (
      <Switch
        {...args}
        checked={checked as boolean}
        onChange={(next: boolean) => {
          args.onChange?.(next);
          updateArgs({ checked: next });
        }}
      />
    );
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  args: { checked: false, label: 'Email notifications' },
};

export const On: Story = {
  args: { checked: true, label: 'Email notifications' },
};

export const Disabled: Story = {
  args: { checked: false, label: 'Pro feature', disabled: true },
};

export const DisabledOn: Story = {
  args: { checked: true, label: 'Pro feature', disabled: true },
};

export const Small: Story = {
  args: { checked: true, label: 'Compact', size: 'small' },
};

export const Large: Story = {
  args: { checked: true, label: 'Spacious', size: 'large' },
};

// Interactive — exercises the toggle.
// Note role='switch' query (not 'checkbox') — see references/without-mcp.md §2.
export const Toggled: Story = {
  args: { checked: false, label: 'Toggle me' },
  play: async ({ args, canvas, userEvent }) => {
    const sw = canvas.getByRole('switch');
    await userEvent.click(sw);
    await expect(args.onChange).toHaveBeenCalledWith(true);
    await userEvent.click(sw);
    await expect(args.onChange).toHaveBeenLastCalledWith(false);
  },
};
