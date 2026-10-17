import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Label } from './label';
import { Switch } from './switch';

const meta = {
  title: 'UI/Switch',
  component: Switch,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="archived" {...args} />
      <Label htmlFor="archived">إظهار المؤرشف</Label>
    </div>
  ),
};

export const On: Story = { args: { defaultChecked: true } };

export const Disabled: Story = { args: { disabled: true } };
