import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ThemeToggle } from './theme-toggle';

const meta = {
  title: 'Shell/ThemeToggle',
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Shows the current theme's icon (sun or moon) and switches between light and dark on click.
 * The choice is saved in the `dm-theme` cookie; without one the app follows the device.
 * The toolbar's theme switch sets the same `data-theme` attribute, so the icon follows it too.
 */
export const Default: Story = {};
