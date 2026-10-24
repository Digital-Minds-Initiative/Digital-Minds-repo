import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    variant: { control: 'inline-radio', options: ['outline', 'elevated', 'subtle'] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="max-w-sm">
      <CardHeader>
        <CardTitle>لجنة البرمجة</CardTitle>
        <CardDescription>نادي الحاسبات · 24 عضواً</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Badge variant="info">مسؤول اللجنة: محمد العتيبي</Badge>
      </CardContent>
      <CardFooter>
        <Button size="sm" variant="outline">
          عرض الأعضاء
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
      {(['outline', 'elevated', 'subtle'] as const).map((variant) => (
        <Card key={variant} variant={variant}>
          <CardTitle>{variant}</CardTitle>
          <CardDescription>بطاقة بنمط {variant}</CardDescription>
        </Card>
      ))}
    </div>
  ),
};
