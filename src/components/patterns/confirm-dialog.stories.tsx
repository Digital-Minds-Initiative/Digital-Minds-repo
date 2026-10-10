import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';

import { ConfirmDialog } from './confirm-dialog';

function ConfirmDemo({ variant = 'danger' }: { variant?: 'default' | 'danger' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={() => setOpen(true)}>
        إلغاء العملية
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant={variant}
        title="إلغاء عملية النقاط؟"
        description="ستبقى العملية في السجل بحالة «ملغاة» ولن تُحتسب في الرصيد. لا يمكن التراجع."
        confirmLabel="نعم، ألغِ العملية"
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 800));
          toast.success('أُلغيت العملية');
        }}
      />
    </>
  );
}

const meta = {
  title: 'Patterns/ConfirmDialog',
  component: ConfirmDemo,
} satisfies Meta<typeof ConfirmDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The confirm button shows a spinner while the async action runs. */
export const Danger: Story = {};

export const Default: Story = { args: { variant: 'default' } };
