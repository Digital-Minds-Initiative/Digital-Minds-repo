import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Fragments, type FragmentPiece } from './fragments';

const PIECES: FragmentPiece[] = [
  {
    key: 'lib',
    kind: 'lib',
    tiltDeg: -3,
    top: 60,
    left: 80,
    content: (
      <div className="flex h-full flex-col gap-2 text-on-paper">
        <strong className="font-serif text-lg">مصنّف العناكب</strong>
        <ul className="m-0 list-none space-y-1 p-0 text-sm text-on-paper-muted">
          <li>بدء المشروع</li>
          <li>أول نموذج</li>
          <li>مراجعة المشرف</li>
          <li>النشر</li>
        </ul>
      </div>
    ),
  },
  {
    key: 'chart',
    kind: 'chart',
    tiltDeg: 2,
    top: 120,
    left: 340,
    content: <strong className="font-serif text-lg text-on-paper">دقّة النموذج</strong>,
  },
  {
    key: 'note',
    kind: 'note',
    tiltDeg: -4,
    top: 360,
    left: 160,
    content: (
      <p className="m-0 text-sm text-on-paper">
        النموذج ممتاز. أضيفوا صفحة تشرح كيف تدرّبتوا عليه.
      </p>
    ),
  },
];

const meta = {
  title: 'UI/Fragments',
  component: Fragments,
  args: {
    pieces: PIECES,
    header: (
      <div>
        <h2 className="m-0 font-serif text-[64px] leading-[76px] font-medium">أرشيف الأعمال</h2>
        <span className="font-mono text-xs tracking-[0.08em] text-on-deep-muted uppercase">
          ARCHIVE / TERM 1 / 1448
        </span>
      </div>
    ),
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Fragments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
