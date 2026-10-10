import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import { Hero } from './hero';

const meta = {
  title: 'UI/Hero',
  component: Hero,
  args: {
    specLine: 'DIGITAL MINDS · 1448 · SAMPLE',
    headline: 'شغلك',
    headlineMuted: 'يتكلم',
    body: '٢٤ مشروع منشور هذا الفصل. كل واحد منها بيد طالب، وكل واحد تقدر تفتحه وتشوف من سوّاه.',
    primaryAction: <Button>انشر مشروعك</Button>,
    secondaryLink: (
      <a href="#" className="text-[15px] font-semibold text-brand underline underline-offset-4">
        شوف المشاريع
      </a>
    ),
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
