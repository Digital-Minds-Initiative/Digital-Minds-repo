import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Marquee } from './marquee';

const meta = {
  title: 'UI/Marquee',
  component: Marquee,
  args: {
    chips: [
      { name: 'نادي طويق' },
      { name: 'نادي حاسبات جامعة أم القرى' },
      { name: 'نادي الحاسبات' },
      { name: 'نادي الذكاء الاصطناعي' },
      { name: 'ملتقى المطورين' },
      { name: 'نادي الأمن السيبراني' },
    ],
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Marquee>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
