import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { IdeaNote } from './idea-note';
import { MissionNote } from './mission-note';
import { MomentScrap } from './moment-scrap';
import { ScrapLabel } from './scrap-label';
import { TicTacToeNote } from './tic-tac-toe-note';

const meta = {
  title: 'UI/Paper desk',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Game: Story = {
  render: () => (
    <TicTacToeNote
      className="w-[220px]"
      labels={{
        heading: { turn: 'YOUR MOVE', win: 'YOU WIN!', lose: 'MY WIN!', draw: 'A DRAW' },
        status: {
          yourTurn: 'دورك الآن',
          thinking: 'أفكّر…',
          win: 'فزت!',
          lose: 'فزتُ هذه المرة',
          draw: 'تعادل',
        },
        play: 'العب بـ',
        restart: 'ابدأ من جديد',
        cell: 'الخانة {n}',
        empty: 'فارغة',
      }}
    />
  ),
};

export const Idea: Story = {
  render: () => (
    <IdeaNote
      className="w-[230px]"
      label="A LITTLE IDEA"
      action="NEW IDEA"
      prompts={['ماذا لو صار لكل لجنة لوحة شرف؟', 'اكتب فكرة مشروع.', 'شكر زميلاً اليوم.']}
    />
  ),
};

export const Mission: Story = {
  render: () => (
    <MissionNote
      className="w-[250px]"
      title="TODAY'S MISSION"
      items={['ارفع نقطة لعضو', 'اقرأ سجل لجنتك', 'رحّب بعضو جديد']}
      done="DONE!"
      progress="{done}/{total}"
      footnote="تجربة فقط، لا يُحفظ شيء."
    />
  ),
};

export const Moment: Story = {
  render: () => (
    <MomentScrap
      className="w-[150px]"
      caption="MOMENT CAPTURED"
      line="إنجاز يستحق التوثيق"
      date="SAMPLE · 2026"
    />
  ),
};

export const Labels: Story = {
  render: () => (
    <div className="flex flex-wrap gap-5 p-4">
      <ScrapLabel text="IDEA #024" tint="teal" torn tape="lilac" />
      <ScrapLabel text="DRAFT 01" tint="peach" fold star />
      <ScrapLabel text="KEEP THIS" tint="lilac" torn tape="teal" />
    </div>
  ),
};
