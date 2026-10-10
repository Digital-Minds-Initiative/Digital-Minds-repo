import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { PageHeader } from './page-header';

const meta = {
  title: 'Patterns/PageHeader',
  component: PageHeader,
  args: {
    title: 'الأعضاء',
    description: 'أعضاء الأندية واللجان ضمن نطاق صلاحياتك.',
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button variant="outline">
          <Upload aria-hidden />
          استيراد CSV
        </Button>
        <Button>
          <Plus aria-hidden />
          إضافة عضو
        </Button>
      </>
    ),
  },
};
