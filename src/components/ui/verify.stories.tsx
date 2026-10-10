import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Verify, type VerifyRecord } from './verify';

const DB: Record<string, VerifyRecord> = {
  'TWQ-0001': { name: 'زياد', role: 'رئيس النادي', club: 'نادي طويق', since: '1447.02.10' },
};

const meta = {
  title: 'UI/Verify',
  component: Verify,
  args: {
    lookup: (id: string) => DB[id] ?? null,
    checkedAt: '1448.04.18 · 16:00',
    notFoundMessage: 'ما لقينا هذا الرقم. تأكد منه، أو اطلبه من النادي.',
  },
} satisfies Meta<typeof Verify>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
