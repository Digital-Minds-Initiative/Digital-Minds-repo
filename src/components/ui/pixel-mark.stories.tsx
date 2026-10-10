import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PixelMark } from './pixel-mark';

const meta = {
  title: 'UI/PixelMark',
  component: PixelMark,
  args: { glyph: 'plus', size: 10 },
} satisfies Meta<typeof PixelMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Glyphs: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-6">
      {(['plus', 'diamond', 'spark', 'khatam'] as const).map((glyph) => (
        <div key={glyph} className="flex flex-col gap-2">
          <div className="flex h-24 items-center justify-center border border-line bg-surface">
            <PixelMark glyph={glyph} size={10} />
          </div>
          <span className="font-mono text-xs text-muted">{glyph}</span>
        </div>
      ))}
    </div>
  ),
};

export const OnDeep: Story = {
  render: () => (
    <div className="flex h-24 items-center justify-center bg-deep">
      <PixelMark glyph="diamond" size={10} tone="deep" finish="perforated" />
    </div>
  ),
};
