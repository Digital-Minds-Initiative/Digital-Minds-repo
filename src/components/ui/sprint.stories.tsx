import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Sprint } from './sprint';

const meta = {
  title: 'UI/Sprint',
  component: Sprint,
  args: {
    sprintIndex: '04',
    dateRange: '1448.04.18 → 1448.05.03',
    weeksDone: 3,
    sentence: 'أربعة أعضاء التزموا بهذا السبرنت. كمّل اللي بدأته، وخلّ زملاءك يشوفون تقدمك.',
    actionLabel: 'انضم للسبرنت',
  },
} satisfies Meta<typeof Sprint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
