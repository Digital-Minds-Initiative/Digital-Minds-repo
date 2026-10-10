import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

const meta = {
  title: 'UI/Select',
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select defaultValue="programming">
      <SelectTrigger className="w-64" aria-label="اللجنة">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>نادي الحاسبات</SelectLabel>
          <SelectItem value="programming">لجنة البرمجة</SelectItem>
          <SelectItem value="design">لجنة التصميم</SelectItem>
          <SelectItem value="events">لجنة الفعاليات</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>نادي طويق</SelectLabel>
          <SelectItem value="development">لجنة التطوير</SelectItem>
          <SelectItem value="content" disabled>
            لجنة المحتوى (مؤرشفة)
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Placeholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-64" aria-label="نوع العضوية">
        <SelectValue placeholder="اختر نوع العضوية" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="beneficiary">مستفيد</SelectItem>
        <SelectItem value="active">عضو فعال</SelectItem>
      </SelectContent>
    </Select>
  ),
};
