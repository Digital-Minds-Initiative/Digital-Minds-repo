import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Stat } from './stat';

const meta = {
  title: 'UI/Stat',
  component: Stat,
  args: {
    items: [
      { value: 24, label: 'مشروع منشور هذا الفصل' },
      { value: 6, label: 'أندية على المنصة' },
      { value: 380, label: 'عضو مسجّل' },
      { value: 12, label: 'سبرنت مكتمل' },
    ],
  },
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
