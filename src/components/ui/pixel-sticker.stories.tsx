import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PixelSticker, type PixelStickerName } from './pixel-sticker';

const NAMES: PixelStickerName[] = [
  'khatam',
  'plus',
  'briefcase',
  'sparkle',
  'heart',
  'trophy',
  'bolt',
  'bulb',
  'arrow',
  'flag',
  'diamond',
  'cross',
];

const meta = {
  title: 'UI/PixelSticker',
  component: PixelSticker,
  args: { name: 'trophy', className: 'w-24' },
} satisfies Meta<typeof PixelSticker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sheet: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-8 rounded-card bg-hero p-8">
      {NAMES.map((name) => (
        <figure key={name} className="m-0 flex w-20 flex-col items-center gap-2">
          <PixelSticker name={name} />
          <figcaption className="font-mono text-xs text-on-hero-muted">{name}</figcaption>
        </figure>
      ))}
    </div>
  ),
};
