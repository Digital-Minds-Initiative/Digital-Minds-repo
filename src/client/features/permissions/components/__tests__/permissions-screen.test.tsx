// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { PermissionsScreen } from '../permissions-screen';

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
// The auth feature (imported for `useMe`) uses the locale-aware navigation, which needs Next's router.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const ADMIN = 'aalghamdi@uqu.edu.sa';
/** Officer of نادي الحاسبات. */
const OFFICER = 's443001102@st.uqu.edu.sa';
/** Leads لجنة البرمجة in نادي الحاسبات. */
const LEAD = 's444001205@st.uqu.edu.sa';

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

async function renderPage(email: string) {
  actor.email = email;
  const user = userEvent.setup();
  renderWithProviders(
    <PermissionsScreen title="الصلاحيات" description="إدارة أدوار النادي وقادة اللجان" />,
  );
  return user;
}

/** Opens a "pick a member" dialog's first selectable result and returns its name. */
async function pickFirstCandidate(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  const group = await within(dialog).findByRole('group', { name: 'نتائج البحث' });
  const choice = await waitFor(
    () => {
      const enabled = within(group)
        .getAllByRole('button')
        .filter((button) => !(button as HTMLButtonElement).disabled);
      if (enabled.length === 0) throw new Error('no selectable member yet');
      return enabled[0] as HTMLElement;
    },
    { timeout: 5000 },
  );
  const name = choice.querySelector('span span')?.textContent ?? '';
  await user.click(choice);
  return { dialog, name };
}

describe('PermissionsScreen — who is offered what', { timeout: 20_000 }, () => {
  it('lets a full admin pick any club and appoint officers and leads', async () => {
    await renderPage(ADMIN);
    expect(
      await screen.findByRole('button', { name: 'تعيين مدير شؤون' }, { timeout: 15_000 }),
    ).toBeTruthy();
    // Everything below renders from separate requests, so each is waited for on a busy machine.
    await waitFor(
      () => {
        expect(screen.getByRole('combobox', { name: 'النادي' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /^تعيين قائد لـ/ }).length).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
  });

  it('lets a club officer appoint leads in their club but not officers, and shows only their club', async () => {
    await renderPage(OFFICER);
    expect(
      await screen.findAllByRole('button', { name: /^تعيين قائد لـ/ }, { timeout: 15_000 }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'تعيين مدير شؤون' })).toBeNull();
    expect(screen.getByText('يُعيّنون بواسطة المسؤول العام')).toBeTruthy();
    // One club only: nothing to choose from.
    expect(screen.queryByRole('combobox', { name: 'النادي' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^إزالة صلاحية مدير الشؤون/ })).toBeNull();
  });

  it('tells a committee lead the page is for club management, without an error', async () => {
    await renderPage(LEAD);
    expect(await screen.findByText('الصلاحيات لإدارة النادي فقط')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('PermissionsScreen — appointing and removing', { timeout: 30_000 }, () => {
  it('lets an officer appoint a lead, and records it in the history', async () => {
    const user = await renderPage(OFFICER);
    await user.click(await screen.findByRole('button', { name: 'تعيين قائد لـ لجنة التصميم' }));
    const { dialog, name } = await pickFirstCandidate(user);
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^تعيين ${name}`) }));

    // The committee now shows the new lead, and no longer says it has none.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
    await waitFor(
      () => {
        const design = screen.getByRole('heading', { name: 'لجنة التصميم' }).closest('li');
        expect(within(design as HTMLElement).getByText(name)).toBeTruthy();
      },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole('tab', { name: 'سجل التغييرات' }));
    // The guide above is a table too, so the history is found by its region.
    const table = await screen.findByRole(
      'region',
      { name: 'سجل تغييرات الصلاحيات' },
      { timeout: 5000 },
    );
    expect(within(table).getByText(name)).toBeTruthy();
    expect(within(table).getByText(/بدون صلاحية ← قائد لجنة/)).toBeTruthy();
    expect(within(table).getByText('في لجنة التصميم')).toBeTruthy();
  });

  it('removes a lead after a confirmation, and the history shows the removal', async () => {
    const user = await renderPage(OFFICER);
    // لجنة البرمجة has محمد as its lead in the demo data.
    const [remove] = await screen.findAllByRole('button', {
      name: /^إزالة قيادة .* من لجنة البرمجة$/,
    });
    if (!remove) throw new Error('no lead to remove');
    const before = screen.getAllByRole('button', {
      name: /^إزالة قيادة .* من لجنة البرمجة$/,
    }).length;
    await user.click(remove);
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'إزالة الصلاحية' }));
    await waitFor(
      () =>
        expect(
          screen.queryAllByRole('button', { name: /^إزالة قيادة .* من لجنة البرمجة$/ }),
        ).toHaveLength(before - 1),
      { timeout: 5000 },
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5000 });
    await user.click(screen.getByRole('tab', { name: 'سجل التغييرات' }));
    expect(
      await screen.findByText(/قائد لجنة ← بدون صلاحية/, undefined, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('lets a full admin appoint an officer, who is then listed', async () => {
    const user = await renderPage(ADMIN);
    await user.click(await screen.findByRole('button', { name: 'تعيين مدير شؤون' }));
    const { dialog, name } = await pickFirstCandidate(user);
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^تعيين ${name}`) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 });
    const officers = await screen.findByRole('region', { name: 'مدراء شؤون النادي' });
    expect(await within(officers).findByText(name, undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe('PermissionsScreen — the lighter layout', { timeout: 30_000 }, () => {
  it('puts the tabs under the title and a lead count and initials on each committee', async () => {
    await renderPage(OFFICER);
    const design = (
      await screen.findByRole('heading', { name: 'لجنة التصميم' }, { timeout: 15_000 })
    ).closest('li');
    if (!design) throw new Error('no committee card');
    expect(within(design).getByText(/^(بدون قائد|قائد|قائدان|\d+ قادة?)/)).toBeTruthy();
    const title = screen.getByRole('heading', { level: 1, name: 'الصلاحيات' });
    const tabs = screen.getByRole('tab', { name: 'أصحاب الصلاحيات' });
    expect(title.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const officers = screen.getByRole('region', { name: 'مدراء شؤون النادي' });
    expect(officers.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it('marks the signed-in officer with a badge', async () => {
    await renderPage(OFFICER);
    const officers = await screen.findByRole('region', { name: 'مدراء شؤون النادي' });
    expect(await within(officers).findByText('أنت', undefined, { timeout: 15_000 })).toBeTruthy();
  });
});
