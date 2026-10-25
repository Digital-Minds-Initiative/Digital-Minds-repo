// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { AccountOverview } from '../account-overview';

const actor = vi.hoisted(() => ({ email: '' }));
// MSW does not read `document.cookie` in Node, so the persona goes out as a Cookie header instead.
vi.mock('@/client/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof ApiClientModule>();
  return {
    ...original,
    apiClient: {
      request: (...args: Parameters<typeof original.apiClient.request>) =>
        original
          .createApiClient({ headers: { cookie: `dm-dev-actor=${actor.email}` } })
          .request(...args),
    },
  };
});
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const ADMIN = 'demo-staff-01@uqu.edu.sa';
const OFFICER = 's000000001@st.uqu.edu.sa';
const LEAD = 's000000004@st.uqu.edu.sa';
/** A registered member with no role. */
const MEMBER = 's000000011@st.uqu.edu.sa';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function hrefs(email: string) {
  actor.email = email;
  renderWithProviders(<AccountOverview />);
  const nav = await screen
    .findByRole('navigation', { name: 'أقسام لوحة التحكم' }, { timeout: 8000 })
    .catch(() => null);
  return nav ? [...nav.querySelectorAll('a')].map((link) => link.getAttribute('href')) : [];
}

describe('AccountOverview — a way into every section', { timeout: 20_000 }, () => {
  it('links a full admin to every section, permissions included', async () => {
    expect(await hrefs(ADMIN)).toEqual([
      '/dashboard/members',
      '/dashboard/points',
      '/dashboard/clubs',
      '/dashboard/permissions',
    ]);
  });

  it('links a club officer to every section too: they manage their club', async () => {
    expect(await hrefs(OFFICER)).toContain('/dashboard/permissions');
  });

  it('leaves permissions out for a committee lead', async () => {
    expect(await hrefs(LEAD)).toEqual([
      '/dashboard/members',
      '/dashboard/points',
      '/dashboard/clubs',
    ]);
  });

  it('offers a member with no role nothing to open', async () => {
    expect(await hrefs(MEMBER)).toEqual([]);
  });
});

describe('AccountOverview — a member with no role', { timeout: 20_000 }, () => {
  it('greets them and lists their own clubs and committees', async () => {
    actor.email = MEMBER;
    renderWithProviders(<AccountOverview />);
    expect(await screen.findByText(/^أهلاً /, undefined, { timeout: 8000 })).toBeTruthy();
    const clubs = await screen.findByRole('region', { name: 'عضوياتي' });
    expect(clubs.querySelectorAll('h3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('عضو فعّال').length).toBeGreaterThan(0);
    // Their own page: no management cards, no way into the management screens.
    expect(screen.queryByText('نطاق صلاحياتك')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'أقسام لوحة التحكم' })).toBeNull();
  });
});
