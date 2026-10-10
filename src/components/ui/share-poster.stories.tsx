import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SharePoster } from './share-poster';

const meta = {
  title: 'UI/SharePoster',
  component: SharePoster,
  args: {
    headline: 'شغلك يتكلم',
    caption: 'زياد · مصنّف العناكب',
    specDate: '1448.04.18 16:00',
    specProjectCode: 'PROJECT A3',
    specClub: '2026.09.29 · UQU',
  },
} satisfies Meta<typeof SharePoster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
