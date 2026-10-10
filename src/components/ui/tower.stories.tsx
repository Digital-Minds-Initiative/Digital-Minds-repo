import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Tower } from './tower';

const meta = {
  title: 'UI/Tower',
  component: Tower,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tower>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HeroSize: Story = {
  args: { height: 520, cardWidth: 300, cardHeight: 190 },
};
