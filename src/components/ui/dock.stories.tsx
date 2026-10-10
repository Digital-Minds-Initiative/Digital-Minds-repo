import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Dock, type DockItem } from './dock';

const ITEMS: DockItem[] = [
  { key: 'home', label: 'الرئيسية', icon: 'home', href: '#', active: true },
  { key: 'grid', label: 'المشاريع', icon: 'grid', href: '#' },
  { key: 'people', label: 'الأعضاء', icon: 'people', href: '#' },
  { key: 'card', label: 'بطاقتي', icon: 'card', href: '#' },
  { key: 'search', label: 'بحث', icon: 'search', href: '#' },
];

const meta = {
  title: 'UI/Dock',
  component: Dock,
  args: {
    items: ITEMS,
    renderLink: (_item, children) => children,
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="relative h-56 bg-surface-sunken">
      <Dock {...args} />
    </div>
  ),
} satisfies Meta<typeof Dock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
