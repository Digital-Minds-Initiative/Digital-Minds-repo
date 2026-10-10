import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { MembershipCard } from './membership-card';

const meta = {
  title: 'UI/MembershipCard',
  component: MembershipCard,
} satisfies Meta<typeof MembershipCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tech: Story = {
  args: {
    mood: 'tech',
    memberId: 'TWQ-0001',
    name: 'زياد',
    role: 'رئيس النادي · القيادة',
    academicYear: '1448 · 2026—27',
    points: 1280,
    stampsEarned: 6,
  },
};

export const Gem: Story = {
  args: {
    mood: 'gem',
    memberId: 'UQC-0118',
    name: 'ريم',
    role: 'عضو · لجنة التصميم',
    academicYear: '1448 · 2026—27',
    points: 640,
    stampsEarned: 3,
  },
};
