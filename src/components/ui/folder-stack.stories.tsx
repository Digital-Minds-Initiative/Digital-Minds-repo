import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { FolderStack } from './folder-stack';

const meta = {
  title: 'UI/FolderStack',
  component: FolderStack,
  args: {
    items: [
      { key: 'ideas', title: 'أفكار', label: 'Ideas', tone: 'indigo' },
      { key: 'teams', title: 'فرق', label: 'Teams', tone: 'lilac' },
      { key: 'wins', title: 'إنجازات', label: 'Wins', tone: 'orange' },
    ],
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-lg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FolderStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="mx-auto w-[280px]">
        <Story />
      </div>
    ),
  ],
};
