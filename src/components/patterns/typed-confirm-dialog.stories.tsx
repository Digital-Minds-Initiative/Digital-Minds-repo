import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';

import { TypedConfirmDialog } from './typed-confirm-dialog';

function TypedConfirmDemo({ email = false }: { email?: boolean }) {
  const [open, setOpen] = useState(false);
  const expected = email ? 's442000001@st.uqu.edu.sa' : 'لجنة التقنية';
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {email ? 'حذف بيانات الشخص نهائياً' : 'حذف اللجنة'}
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={email ? 'حذف بيانات سارة أحمد نهائياً؟' : 'حذف «لجنة التقنية» نهائياً؟'}
        description="سيتم حذف 23 عضوية و340 حركة نقاط نهائياً. لا يمكن التراجع عن ذلك."
        expected={expected}
        normalize={email ? (value) => value.trim().toLowerCase() : undefined}
        inputDir={email ? 'ltr' : undefined}
        inputLabel={
          email ? `اكتب البريد الجامعي ${expected} للتأكيد` : `اكتب «${expected}» للتأكيد`
        }
        confirmLabel="حذف نهائياً"
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 800));
          toast.success('تم الحذف');
        }}
      />
    </>
  );
}

const meta = {
  title: 'Patterns/TypedConfirmDialog',
  component: TypedConfirmDemo,
} satisfies Meta<typeof TypedConfirmDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The delete button opens only once the committee's name is typed exactly. */
export const CommitteeName: Story = {};

/** An email is typed left to right and compared without regard to case. */
export const Email: Story = { args: { email: true } };
