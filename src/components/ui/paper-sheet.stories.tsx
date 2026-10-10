import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PaperSheet } from './paper-sheet';

const meta = {
  title: 'UI/PaperSheet',
  component: PaperSheet,
  args: {
    code: 'A3',
    titleAr: 'مصنّف العناكب',
    titleEn: 'Spider Web Classifier',
    tags: ['تعلّم آلة', 'بايثون'],
  },
} satisfies Meta<typeof PaperSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tints: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 bg-slab p-8">
      <PaperSheet
        tint="cream"
        code="A1"
        titleAr="مساعد الجدول الدراسي"
        titleEn="Schedule Assistant"
        tags={['تطبيق', 'منشور']}
        tiltDeg={-2}
      />
      <PaperSheet
        tint="teal"
        code="A2"
        titleAr="خريطة القاعات"
        titleEn="Campus Rooms Map"
        tags={['ويب', 'مراجعة']}
        tiltDeg={1.5}
      />
      <PaperSheet
        tint="peach"
        code="A3"
        titleAr="مصنّف العناكب"
        titleEn="Spider Web Classifier"
        tags={['تعلّم آلة', 'بايثون']}
        tiltDeg={-1}
      />
      <PaperSheet
        tint="lilac"
        code="B1"
        titleAr="بطاقة العضوية"
        titleEn="Membership Card"
        tags={['تصميم']}
        tiltDeg={3}
      />
    </div>
  ),
};
