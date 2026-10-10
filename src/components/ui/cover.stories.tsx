import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Cover } from './cover';

const meta = {
  title: 'UI/Cover',
  component: Cover,
  args: { tagline: 'Every sheet is a project. Saudi-rooted, built for every club.' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Cover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
