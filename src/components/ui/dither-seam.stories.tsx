import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DitherSeam } from './dither-seam';

const meta = {
  title: 'UI/DitherSeam',
  component: DitherSeam,
  args: { from: 'var(--brand)', to: 'var(--deep)', cell: 8, cols: 60, rows: 4 },
} satisfies Meta<typeof DitherSeam>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pairs: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <DitherSeam from="var(--brand)" to="var(--deep)" cell={8} cols={60} rows={4} />
      <DitherSeam
        from="var(--uqu-teal-blue)"
        to="var(--uqu-dark-cyan)"
        cell={8}
        cols={60}
        rows={4}
      />
      <DitherSeam from="var(--canvas)" to="var(--deep)" cell={8} cols={60} rows={4} />
      <DitherSeam from="var(--brand)" to="var(--teal)" cell={16} cols={30} rows={2} />
    </div>
  ),
};

export const Vertical: Story = {
  args: { direction: 'v', cols: 4, rows: 20 },
  render: (args) => (
    <div className="h-48 w-16">
      <DitherSeam {...args} className="h-full w-auto" />
    </div>
  ),
};
