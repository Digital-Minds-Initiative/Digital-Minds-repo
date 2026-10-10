import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import { PixelEmptyState } from './pixel-empty-state';

const meta = {
  title: 'UI/PixelEmptyState',
  component: PixelEmptyState,
  args: {
    title: 'ما فيه مشاريع للحين',
    description: 'ابدأ بأول واحد. اكتب اسمه وسطرين عنه، والباقي يجي بعدين.',
    action: <Button>أضف مشروعك</Button>,
  },
} satisfies Meta<typeof PixelEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
