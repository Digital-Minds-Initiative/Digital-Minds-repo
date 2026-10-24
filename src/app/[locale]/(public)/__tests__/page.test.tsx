// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { renderWithProviders } from '@tests/utils/render';

import LandingPage from '../page';

/*
 * The landing page is a server component that reads AUTH_SELF_SIGNUP while it renders. Rendered
 * here as the server would: its translations from the Arabic messages, its links as plain anchors.
 */
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => {},
  getTranslations: (namespace: string) =>
    Promise.resolve(
      createTranslator({ locale: 'ar', messages: messages.ar, namespace: namespace as 'landing' }),
    ),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeEach(() => {
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
afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderLanding() {
  const page = (await LandingPage({
    params: Promise.resolve({ locale: 'ar' }),
  } as Parameters<typeof LandingPage>[0])) as ReactElement;
  renderWithProviders(page);
}

describe('the landing page', () => {
  it('offers creating an account when self sign-up is on', async () => {
    vi.stubEnv('AUTH_SELF_SIGNUP', 'true');
    await renderLanding();
    expect(document.querySelector('a[href="/register"]')).not.toBeNull();
  });

  it('offers only «تسجيل الدخول» when sign-up is off (ADR 0027)', async () => {
    vi.stubEnv('AUTH_SELF_SIGNUP', 'false');
    await renderLanding();
    expect(document.querySelector('a[href="/register"]')).toBeNull();
    expect(screen.queryByText('إنشاء حساب')).toBeNull();
    expect(document.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
