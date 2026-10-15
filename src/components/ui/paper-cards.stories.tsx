import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PaperCards } from './paper-cards';

const meta = {
  title: 'UI/PaperCards',
  component: PaperCards,
  args: {
    cards: [
      {
        key: 'members',
        headline: 'كل عقل يصنع فرقًا.',
        lines: ['أعضاء يصنعون الأثر', 'فرق تجمع المواهب', 'أفكار تبدأ من هنا'],
        spec: '→ 01 · MEMBERS',
        tint: 'lilac',
      },
      {
        key: 'points',
        headline: 'كل جهد له أثر.',
        lines: ['+ إنجاز يُحتسب', '+ عطاء لا يُنسى', '↗ صدارة هذا الشهر'],
        spec: '→ 02 · POINTS',
        tint: 'peach',
      },
      {
        key: 'roles',
        headline: 'لكل دور أثر.',
        lines: ['◆ يشرف · المسؤول العام', '◆ يقود · مدير النادي', '◆ ينجز · قائد اللجنة'],
        spec: '→ 03 · ROLES',
        tint: 'teal',
      },
      {
        key: 'showcase',
        headline: 'من الفكرة إلى الأثر.',
        lines: ['↗ أعمال تستحق أن تُرى', '↗ إنجازات تستحق أن تُروى', '↗ رابط يجمع الحكاية'],
        spec: '→ 04 · SHOWCASE',
        tint: 'cream',
      },
    ],
  },
  parameters: { layout: 'padded', backgrounds: { default: 'deep' } },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-xl bg-deep p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PaperCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
