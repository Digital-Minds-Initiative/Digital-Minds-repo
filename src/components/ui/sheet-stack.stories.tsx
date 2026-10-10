import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SheetStack, type SheetStackCard } from './sheet-stack';

const CARDS: SheetStackCard[] = [
  {
    index: '01 / 03',
    headline: 'اعرض',
    headlineMuted: 'شغلك',
    tags: ['مشاريع', 'فرق', 'روابط', 'صور'],
    body: 'كل مشروع يصير صفحة: اسمه، وش سوّى، ومين سوّاه معه.',
  },
  {
    index: '02 / 03',
    headlineMuted: 'أثرك',
    headline: 'وثّق',
    tags: ['أختام', 'نقاط', 'شهادات'],
    body: 'كل إنجاز له أثر يبقى: نقاط، أختام، وشهادة توثّقه.',
  },
  {
    index: '03 / 03',
    headline: 'كمّل',
    headlineMuted: 'رحلتك',
    tags: ['سبرنت', 'مجموعات', 'لجان'],
    body: 'سبرنتات قصيرة ولجان تكمّل بعضها، خطوة بخطوة.',
  },
];

const meta = {
  title: 'UI/SheetStack',
  component: SheetStack,
  args: { cards: CARDS },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SheetStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
