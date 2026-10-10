import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { UsersRound } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { EmptyState } from './empty-state';

const meta = {
  title: 'Patterns/EmptyState',
  component: EmptyState,
  args: {
    icon: UsersRound,
    title: 'لا يوجد أعضاء',
    description: 'لا يوجد أعضاء يطابقون البحث أو عوامل التصفية.',
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Framed: Story = {
  args: { action: <Button variant="outline">مسح عوامل التصفية</Button> },
};

export const Plain: Story = { args: { variant: 'plain' } };
