// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { getMockDb, resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { listMembersQuerySchema } from '@/shared/contracts/members';
import { renderWithProviders } from '@tests/utils/render';

import { MembersToolbar } from '../members-toolbar';

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
  usePathname: () => '/dashboard/members',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

/** Officer of نادي الحاسبات, the only club they see. */
const OFFICER = 's443001102@st.uqu.edu.sa';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  // Radix measures its popper content; jsdom has no ResizeObserver or pointer capture.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => resetMockDb());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderToolbar(onChange: (patch: unknown) => void) {
  actor.email = OFFICER;
  const club = [...getMockDb().clubs].find((candidate) => candidate.name === 'نادي الحاسبات');
  if (!club) throw new Error('demo club missing');
  renderWithProviders(
    <MembersToolbar
      query={listMembersQuerySchema.parse({})}
      onChange={onChange}
      access={{
        canAccessDashboard: true,
        canManageClubs: false,
        clubs: [{ id: club.id, name: club.name, slug: club.slug, canManage: true }],
        committees: [],
      }}
    />,
  );
  return userEvent.setup();
}

describe('MembersToolbar — every filter the API offers', { timeout: 20_000 }, () => {
  it('filters by membership type once the club is known', async () => {
    const onChange = vi.fn();
    const user = renderToolbar(onChange);
    await user.click(await screen.findByRole('combobox', { name: 'نوع العضوية' }));
    await user.click(await screen.findByRole('option', { name: 'مستفيد' }));
    const [patch] = onChange.mock.calls.at(-1) ?? [];
    expect(patch).toEqual({ membershipTypeId: [expect.any(String)] });
  });

  it('filters by role', async () => {
    const onChange = vi.fn();
    const user = renderToolbar(onChange);
    await user.click(await screen.findByRole('combobox', { name: 'الصلاحية' }));
    await user.click(await screen.findByRole('option', { name: 'مدراء الشؤون' }));
    expect(onChange).toHaveBeenLastCalledWith({ role: 'CLUB_OFFICER' });
  });

  it('filters by whether the person has registered', async () => {
    const onChange = vi.fn();
    const user = renderToolbar(onChange);
    await user.click(await screen.findByRole('combobox', { name: 'التسجيل' }));
    await user.click(await screen.findByRole('option', { name: 'لم يسجّلوا بعد' }));
    expect(onChange).toHaveBeenLastCalledWith({ registered: false });
  });
});
