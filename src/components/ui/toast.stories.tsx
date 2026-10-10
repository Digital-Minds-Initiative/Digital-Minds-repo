import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import { toast, Toaster } from './toaster';

const meta = {
  title: 'UI/Toast',
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Toasts are triggered imperatively; the preview already renders <Toaster />. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => toast('تم تحديث القائمة')}>
        عادي
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.success('تمت إضافة النقاط', { description: '+10 نقاط لسارة القحطاني' })
        }
      >
        نجاح
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.error('تعذّر الحفظ', { description: 'حدث خطأ في الخادم. حاول مرة أخرى.' })
        }
      >
        خطأ
      </Button>
    </div>
  ),
};
