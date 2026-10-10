import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Use the arrow keys: in RTL the right arrow moves to the previous tab. */
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="members" className="max-w-md">
      <TabsList>
        <TabsTrigger value="members">الأعضاء</TabsTrigger>
        <TabsTrigger value="points">النقاط</TabsTrigger>
        <TabsTrigger value="settings" disabled>
          الإعدادات
        </TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="text-sm text-fg-muted">
        قائمة أعضاء اللجنة وبيانات التواصل.
      </TabsContent>
      <TabsContent value="points" className="text-sm text-fg-muted">
        سجل النقاط حسب تاريخ العمل.
      </TabsContent>
    </Tabs>
  ),
};
