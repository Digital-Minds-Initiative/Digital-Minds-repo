// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { InteractiveLogo } from '../interactive-logo';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NAME = 'Digital Minds';

describe('InteractiveLogo', () => {
  it('moves to the next colour on every press, with the name following, and wraps round', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InteractiveLogo />);
    const button = screen.getByRole('button', { name: 'تغيير لون الشعار' });
    const mark = () => button.querySelector('span');
    const name = () => screen.getByRole('link', { name: NAME });

    const seen: string[] = [];
    for (let press = 0; press < 5; press++) {
      seen.push(
        `${mark()?.className.match(/bg-[\w-]+/)?.[0]} ${name().className.match(/text-(fg|tuwaiq-indigo|teal|orange)/)?.[0]}`,
      );
      await user.click(button);
    }
    expect(seen).toEqual([
      'bg-brand text-fg',
      'bg-tuwaiq-lilac text-tuwaiq-indigo',
      'bg-teal text-teal',
      'bg-orange text-orange',
      'bg-brand text-fg',
    ]);
  });

  it('can be pressed from the keyboard, and the name still links home', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InteractiveLogo />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'تغيير لون الشعار' }));
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: 'تغيير لون الشعار' }).querySelector('span')?.className,
    ).toContain('bg-tuwaiq-lilac');
    expect(screen.getByRole('link', { name: NAME }).getAttribute('href')).toBe('/');
  });
});
