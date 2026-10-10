import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';

import { Button } from './button';
import { DirectionalIcon } from './directional-icon';

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'حفظ التغييرات' },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'icon', 'icon-sm'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>أساسي</Button>
      <Button variant="secondary">ثانوي</Button>
      <Button variant="outline">محدد</Button>
      <Button variant="ghost">شفاف</Button>
      <Button variant="danger">
        <Trash2 aria-hidden />
        حذف
      </Button>
      <Button variant="link">رابط</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">صغير</Button>
      <Button size="md">متوسط</Button>
      <Button size="lg">كبير</Button>
      <Button size="icon" aria-label="إضافة">
        <Plus aria-hidden />
      </Button>
    </div>
  ),
};

/** Direction icons mirror in RTL: "forward" points left in Arabic. */
export const WithDirectionalIcon: Story = {
  render: () => (
    <Button>
      متابعة
      <DirectionalIcon icon={ArrowRight} />
    </Button>
  ),
};

export const Loading: Story = { args: { loading: true, children: 'جارٍ الحفظ' } };

export const Disabled: Story = { args: { disabled: true } };
