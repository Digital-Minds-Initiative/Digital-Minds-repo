// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { PublicShell } from '../public-shell';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeEach(() => {
  // jsdom has no matchMedia; reduced motion keeps the reveals static.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

describe('PublicShell', () => {
  it('offers sign-in and sign-up when self sign-up is on', () => {
    renderWithProviders(<PublicShell selfSignup>content</PublicShell>);
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'إنشاء حساب' }).getAttribute('href')).toBe('/register');
  });

  it('offers only sign-in when sign-up is off (invite-only, ADR 0027)', () => {
    renderWithProviders(<PublicShell selfSignup={false}>content</PublicShell>);
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'إنشاء حساب' })).toBeNull();
    expect(document.querySelector('a[href="/register"]')).toBeNull();
  });
});
