import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>إضافة لجنة</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة لجنة جديدة</DialogTitle>
          <DialogDescription>
            ستظهر اللجنة لمسؤول النادي ويمكن تعيين مسؤول لها لاحقاً.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="committee-name">اسم اللجنة</Label>
          <Input id="committee-name" placeholder="لجنة الذكاء الاصطناعي" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">إلغاء</Button>
          </DialogClose>
          <Button>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
