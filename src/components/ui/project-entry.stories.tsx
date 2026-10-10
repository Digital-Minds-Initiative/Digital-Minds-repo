import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ProjectEntryList, type ProjectEntryRow } from './project-entry';

const ROWS: ProjectEntryRow[] = [
  {
    code: 'A1',
    titleAr: 'مساعد الجدول الدراسي',
    descriptionAr: 'يرتب محاضراتك ويذكرك قبلها.',
    titleEn: 'Schedule Assistant',
    team: 'ريم، فيصل',
    status: { label: 'منشور', tone: 'success', filled: 4 },
    date: '1448.03.02',
  },
  {
    code: 'A2',
    titleAr: 'خريطة القاعات',
    descriptionAr: 'يحدد لك القاعة الصح بأسرع طريق.',
    titleEn: 'Campus Rooms Map',
    team: 'نورة',
    status: { label: 'مراجعة', tone: 'info', filled: 3 },
    date: '1448.03.09',
  },
  {
    code: 'A3',
    titleAr: 'مصنّف العناكب',
    descriptionAr: 'يتعرف على نوع العنكبوت من صورته.',
    titleEn: 'Spider Web Classifier',
    team: 'زياد',
    status: { label: 'قيد البناء', tone: 'warning', filled: 2 },
    date: '1448.03.16',
  },
];

const meta = {
  title: 'UI/ProjectEntry',
  component: ProjectEntryList,
  args: { groupLabel: 'SAMPLE DATA · TERM 1 · 1448', rows: ROWS },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ProjectEntryList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
