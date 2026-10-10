import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="grid gap-3">
      <Label>
        <Checkbox />
        غير محدد
      </Label>
      <Label>
        <Checkbox defaultChecked />
        محدد
      </Label>
      <Label>
        <Checkbox checked="indeterminate" />
        محدد جزئياً (تحديد الكل)
      </Label>
      <Label>
        <Checkbox disabled />
        معطّل
      </Label>
    </div>
  ),
};
