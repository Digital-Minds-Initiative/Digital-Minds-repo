import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StatusTag } from './status-tag';

const meta = {
  title: 'UI/StatusTag',
  component: StatusTag,
  args: { label: 'منشور', tone: 'success', filled: 4 },
} satisfies Meta<typeof StatusTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusTag label="فكرة" tone="muted" filled={0} />
      <StatusTag label="نستقطب أعضاء" tone="info" filled={1} />
      <StatusTag label="قيد البناء" tone="warning" filled={2} />
      <StatusTag label="مراجعة" tone="info" filled={3} />
      <StatusTag label="منشور" tone="success" filled={4} />
      <StatusTag label="مؤرشف" tone="muted" filled={0} archived />
    </div>
  ),
};
