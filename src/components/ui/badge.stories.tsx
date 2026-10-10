import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Crown } from 'lucide-react';

import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'عضو فعال' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="neutral">مستفيد</Badge>
      <Badge variant="primary">مدير شؤون</Badge>
      <Badge variant="info">
        <Crown aria-hidden />
        لجنة البرمجة
      </Badge>
      <Badge variant="success">مسجّل</Badge>
      <Badge variant="warning">لم يسجّل بعد</Badge>
      <Badge variant="danger">مُزال</Badge>
      <Badge variant="outline">عضو فعال</Badge>
    </div>
  ),
};
