import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { placeholder: 'الاسم الكامل' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="name">الاسم الكامل</Label>
      <Input id="name" {...args} />
    </div>
  ),
};

/** Emails and phone numbers stay left-to-right inside an RTL form. */
export const LeftToRightValue: Story = {
  args: { type: 'email', dir: 'ltr', defaultValue: 's443001102@st.uqu.edu.sa' },
};

export const Invalid: Story = { args: { 'aria-invalid': true, defaultValue: 'خطأ' } };

export const Disabled: Story = { args: { disabled: true, defaultValue: 'غير قابل للتعديل' } };
