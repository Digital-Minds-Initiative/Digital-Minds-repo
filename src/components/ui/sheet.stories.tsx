import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">فتح اللوحة</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>سجل النقاط</SheetTitle>
          <SheetDescription>تفاصيل عضو دون مغادرة القائمة.</SheetDescription>
        </SheetHeader>
        <p className="text-sm">محتوى اللوحة يظهر هنا.</p>
      </SheetContent>
    </Sheet>
  ),
};
