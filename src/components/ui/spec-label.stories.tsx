import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SpecBlock, SpecLabel } from './spec-label';

const meta = {
  title: 'UI/SpecLabel',
  component: SpecLabel,
} satisfies Meta<typeof SpecLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lines: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <SpecLabel arrow="→" index="01">
        PROJECT A1 · SHIPPED
      </SpecLabel>
      <SpecLabel arrow="↓" index="02">
        1448.04.18 · 2026.09.29 · 16:00
      </SpecLabel>
      <SpecLabel arrow="↗" index="03">
        ID 0042 · TUWAIQ CLUB · UQU
      </SpecLabel>
      <SpecLabel arrow="·" index="04">
        V4 · DESIGN RECORD
      </SpecLabel>
    </div>
  ),
};

export const Block: Story = {
  render: () => (
    <SpecBlock>
      <div className="font-mono text-[15px] tracking-[0.04em] text-on-deep" dir="ltr">
        1448.04.18 · 16:00
      </div>
      <div className="mt-2 text-end text-[22px] font-bold text-on-deep">شغلك يتكلم</div>
    </SpecBlock>
  ),
};
