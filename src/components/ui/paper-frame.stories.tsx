import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { PaperFrame } from './paper-frame';

const meta = {
  title: 'UI/PaperFrame',
  component: PaperFrame,
} satisfies Meta<typeof PaperFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: null },
  render: () => (
    <div className="flex min-h-[480px] items-center justify-center bg-canvas p-8">
      <PaperFrame>
        <h1 className="mb-8 text-center font-serif text-4xl font-semibold">أهلاً فيك</h1>
        <div className="grid gap-2">
          <Label htmlFor="story-email">البريد الجامعي</Label>
          <Input id="story-email" dir="ltr" defaultValue="name@uqu.edu.sa" />
        </div>
        <Button className="mt-8 w-full bg-teal text-on-teal hover:bg-teal/90">ادخل</Button>
      </PaperFrame>
    </div>
  ),
};
