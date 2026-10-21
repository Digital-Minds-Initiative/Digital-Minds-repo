import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PixelDivider } from './pixel-divider';

const meta = {
  title: 'UI/PixelDivider',
  component: PixelDivider,
  args: { from: 'var(--hero-surface)', to: 'var(--canvas)', cell: 8, position: 'bottom' },
} satisfies Meta<typeof PixelDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bottom: Story = {};

export const Top: Story = {
  args: { position: 'top', from: 'var(--canvas)', to: 'var(--hero-surface)' },
};

export const BetweenTwoSections: Story = {
  render: () => (
    <div>
      <div className="h-24 bg-hero" />
      <PixelDivider from="var(--hero-surface)" to="var(--canvas)" />
      <div className="h-24 bg-canvas" />
    </div>
  ),
};
