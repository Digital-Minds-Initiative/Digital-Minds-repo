import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PointsLedger } from './points-ledger';

const meta = {
  title: 'UI/PointsLedger',
  component: PointsLedger,
  args: {
    rows: [
      { id: 'a', date: '2026-10-02', reason: 'حضور ورشة التصميم', points: 20 },
      { id: 'b', date: '2026-09-28', reason: 'تغطية الفعالية', points: 35 },
      { id: 'c', date: '2026-09-25', reason: 'إدخال مكرر', points: 20, voided: true },
      { id: 'd', date: '2026-09-20', reason: 'تأخر عن موعد التسليم', points: -10 },
    ],
    labels: {
      balance: 'BALANCE · الرصيد',
      date: 'تاريخ العمل',
      reason: 'السبب',
      points: 'النقاط',
      cancelled: 'VOID',
    },
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PointsLedger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
