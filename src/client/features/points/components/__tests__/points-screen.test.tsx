// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { PointsScreen } from '../points-screen';

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
/** A registered member with no role: nothing to see on the points page. */
const MEMBER = 's445001301@st.uqu.edu.sa';

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
    <PointsScreen
      title="النقاط"
      description="أرصدة الأعضاء وسجل الحركات في اللجان ضمن نطاق صلاحياتك."
    />,
  );
  return user;
}

async function openCommitteeList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'اللجنة' }));
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** The balance in a row's badge ("75 نقطة" → 75). */
const balanceIn = (row: HTMLElement) =>
  Number(
    within(row)
      .getAllByRole('cell')
      .at(-2)
      ?.textContent?.replace(/[^\d-]/g, ''),
  );

describe('PointsScreen — scope', { timeout: 20_000 }, () => {
  it('shows a committee lead only the committee they lead, with a note saying so', async () => {
    const user = await renderPage(LEAD);
    expect(await screen.findByText('ترى هنا لجانك التي تقودها فقط.')).toBeTruthy();
    const options = await openCommitteeList(user);
    expect(options.map((option) => option.textContent)).toEqual(['لجنة البرمجة']);
  });

  it('shows a club officer every committee of their club, and no lead note', async () => {
    const user = await renderPage(OFFICER);
    await screen.findByRole('combobox', { name: 'اللجنة' });
    expect(screen.queryByText('ترى هنا لجانك التي تقودها فقط.')).toBeNull();
    const options = await openCommitteeList(user);
    expect(options.map((option) => option.textContent).sort()).toEqual(
      ['لجنة الإعلام', 'لجنة البرمجة', 'لجنة التصميم', 'لجنة الفعاليات'].sort(),
    );
  });

  it('shows a full admin the committees of every club, named with their club', async () => {
    const user = await renderPage(ADMIN);
    const options = await openCommitteeList(user);
    const texts = options.map((option) => option.textContent ?? '');
    expect(texts.some((text) => text.startsWith('نادي الحاسبات · '))).toBe(true);
    expect(texts.some((text) => text.startsWith('نادي طويق · '))).toBe(true);
  });

  it('tells someone with no committees in their scope so', async () => {
    await renderPage(MEMBER);
    expect(await screen.findByText('لا توجد لجان ظاهرة لك')).toBeTruthy();
  });
});

describe('PointsScreen — members and their points', { timeout: 30_000 }, () => {
  it('lists the committee members with their points, role and a way to open their ledger', async () => {
    await renderPage(LEAD);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(within(table).getAllByText('قائد اللجنة').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/نقطة$/).length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: /^عرض سجل / })).toBeTruthy();
    }
  });

  it('shows three numbers about the committee that match its table', async () => {
    await renderPage(LEAD);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect((await screen.findByTestId('kpi-members')).textContent).toBe(String(rows.length));
    const total = rows.reduce((sum, row) => sum + balanceIn(row), 0);
    expect(Number(screen.getByTestId('kpi-total').textContent?.replace(/[^\d-]/g, ''))).toBe(total);
    expect(Number(screen.getByTestId('kpi-top').textContent?.replace(/[^\d-]/g, ''))).toBe(
      Math.max(...rows.map(balanceIn)),
    );
  });

  it('finds a member by name as you type, and says so when nobody matches', async () => {
    const user = await renderPage(LEAD);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const first = rows[0];
    if (!first) throw new Error('no row');
    const name = within(first).getByRole('button', { name: /^سجل / }).textContent ?? '';
    const search = screen.getByRole('searchbox', { name: 'ابحث باسم العضو' });
    await user.type(search, name);
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(1),
    );
    await user.clear(search);
    await user.type(search, 'زززززززز');
    expect(await screen.findByText('لا نتائج مطابقة')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'مسح البحث' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('sorts the lowest balance first when asked', async () => {
    const user = await renderPage(LEAD);
    const balances = () =>
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => balanceIn(row));
    await screen.findByRole('table');
    const highest = balances();
    expect(highest).toEqual([...highest].sort((a, b) => b - a));
    await user.click(screen.getByRole('combobox', { name: 'الترتيب' }));
    await user.click(await screen.findByRole('option', { name: 'الأقل نقاطاً' }));
    await waitFor(() => expect(balances()).toEqual([...highest].sort((a, b) => a - b)));
  });

  it('records points from a row and the balance and the total follow', async () => {
    const user = await renderPage(LEAD);
    const total = async () =>
      Number((await screen.findByTestId('kpi-total')).textContent?.replace(/[^\d-]/g, ''));
    const before = await total();
    const table = await screen.findByRole('table');
    const first = within(table).getAllByRole('row')[1];
    if (!first) throw new Error('no row');
    const name = within(first).getByRole('button', { name: /^سجل / }).textContent ?? '';
    await user.click(within(first).getByRole('button', { name: `رصد نقاط لـ ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    await user.type(within(dialog).getByLabelText(/عدد النقاط/), '9');
    await user.type(within(dialog).getByLabelText(/السبب/), 'مشاركة إضافية');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل الحركة' }));
    await waitFor(async () => expect(await total()).toBe(before + 9), { timeout: 8000 });
  });

  it('opens the member ledger from a row', async () => {
    const user = await renderPage(LEAD);
    const table = await screen.findByRole('table');
    const first = within(table).getAllByRole('row')[1];
    if (!first) throw new Error('no row');
    await user.click(within(first).getByRole('button', { name: /^عرض سجل / }));
    expect(await screen.findByTestId('member-balance', undefined, { timeout: 8000 })).toBeTruthy();
  });
});
