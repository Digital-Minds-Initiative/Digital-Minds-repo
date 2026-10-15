import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PixelIcon, type PixelIconName } from './pixel-icon';

const NAMES: PixelIconName[] = [
  'home',
  'grid',
  'people',
  'card',
  'search',
  'plus',
  'trophy',
  'building',
  'shield',
];

const meta = {
  title: 'UI/PixelIcon',
  component: PixelIcon,
  args: { name: 'people' },
} satisfies Meta<typeof PixelIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 text-fg">
      {NAMES.map((name) => (
        <figure key={name} className="m-0 flex flex-col items-center gap-2">
          <PixelIcon name={name} className="size-8" />
          <figcaption className="font-mono text-xs text-fg-muted">{name}</figcaption>
        </figure>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4 text-primary">
      <PixelIcon name="trophy" className="size-4" />
      <PixelIcon name="trophy" className="size-5" />
      <PixelIcon name="trophy" className="size-8" />
      <PixelIcon name="trophy" className="size-12" />
    </div>
  ),
};
