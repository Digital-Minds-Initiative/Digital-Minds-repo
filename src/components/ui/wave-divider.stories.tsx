import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { WaveDivider } from './wave-divider';

const meta = {
  title: 'UI/WaveDivider',
  component: WaveDivider,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WaveDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
