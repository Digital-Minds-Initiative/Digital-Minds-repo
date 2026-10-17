import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Avatar } from './avatar';

const meta = {
  title: 'UI/Avatar',
  component: Avatar,
  args: { name: 'بندر عادل الزهراني' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="سارة القحطاني" size="sm" />
      <Avatar name="سارة القحطاني" size="md" />
      <Avatar name="سارة القحطاني" size="lg" />
      <Avatar name="سارة القحطاني" tone="neutral" />
    </div>
  ),
};

export const SingleWord: Story = { args: { name: 'عبدالله' } };
