import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { MembersLedger, type MembersLedgerRow } from './members-ledger';

const ROWS: MembersLedgerRow[] = [
  {
    id: 'TWQ-0001',
    name: 'زياد',
    college: 'رئيس النادي · القيادة',
    membershipType: 'فعّال',
    committee: 'القيادة',
    points: 1280,
    stampsEarned: 6,
    joined: '1446.01.12',
    selected: true,
  },
  {
    id: 'TWQ-0014',
    name: 'ريم',
    college: 'كلية الحاسبات',
    membershipType: 'فعّال',
    committee: 'التصميم',
    points: 640,
    stampsEarned: 3,
    joined: '1446.05.02',
  },
  {
    id: 'TWQ-0027',
    name: 'فيصل',
    college: 'كلية الحاسبات',
    membershipType: 'مستفيد',
    committee: '—',
    points: 120,
    stampsEarned: 1,
    joined: '1447.02.20',
  },
  {
    id: 'TWQ-0033',
    name: 'نورة',
    college: 'كلية الهندسة',
    membershipType: 'فعّال',
    committee: 'البرمجة',
    points: 860,
    stampsEarned: 4,
    joined: '1446.09.14',
  },
];

const meta = {
  title: 'UI/MembersLedger',
  component: MembersLedger,
  args: {
    searchPlaceholder: 'ابحث بالاسم أو الرقم',
    filters: [
      { key: 'all', label: 'الكل', active: true },
      { key: 'active', label: 'عضو فعّال' },
      { key: 'committees', label: 'اللجان' },
    ],
    rows: ROWS,
    importLabel: 'استيراد CSV',
    addLabel: 'أضف عضو',
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MembersLedger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
