import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Info } from 'lucide-react';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
  title: 'UI/Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="p-12">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="معلومات">
            <Info aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>الرصيد = مجموع العمليات النشطة فقط</TooltipContent>
      </Tooltip>
    </div>
  ),
};
