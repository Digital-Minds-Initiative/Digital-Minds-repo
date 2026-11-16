// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { listMemberFixtures } from '@/client/features/members/mocks';
import type * as ApiClientModule from '@/client/lib/api-client';
import { findMockActor, getMockDb, resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { listMembersQuerySchema, type Member } from '@/shared/contracts/members';
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

const ADMIN = 'demo-staff-01@uqu.edu.sa';
/** Officer of نادي الحاسبات. */
const OFFICER = 's000000001@st.uqu.edu.sa';
/** Leads لجنة البرمجة in نادي الحاسبات. */
const LEAD = 's000000004@st.uqu.edu.sa';
/** A registered member with no role: nothing to see on the points page. */
const MEMBER = 's000000011@st.uqu.edu.sa';

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
    expect(within(table).getAllByText('مسؤول اللجنة').length).toBeGreaterThan(0);
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
    const search = screen.getByRole('searchbox', {
      name: 'ابحث بالاسم أو البريد الجامعي أو الجوال',
    });
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

/** The members `email` can see in a committee, exactly as the members list would give them. */
function committeeMembersSeenBy(email: string, committeeName: string): Member[] {
  const db = getMockDb();
  const persona = findMockActor(db, email);
  if (!persona) throw new Error(`no persona ${email}`);
  return listMemberFixtures(
    db,
    persona,
    listMembersQuerySchema.parse({ pageSize: 100, status: 'active' }),
  ).items.filter((member) => member.committees.some((c) => c.name === committeeName));
}

const SEARCH = 'ابحث بالاسم أو البريد الجامعي أو الجوال';
const rowsOf = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const kpis = () =>
  ['members', 'total', 'top'].map((key) => screen.getByTestId(`kpi-${key}`).textContent);

describe('PointsScreen — finding a member by email or phone', { timeout: 30_000 }, () => {
  it('shows every member’s university email under their name, and no phone', async () => {
    await renderPage(LEAD);
    await screen.findByRole('table');
    const expected = committeeMembersSeenBy(LEAD, 'لجنة البرمجة');
    expect(rowsOf()).toHaveLength(expected.length);
    for (const member of expected) {
      expect(screen.getByText(member.user.uniEmail)).toBeTruthy();
      if (member.profile.phone) expect(screen.queryByText(member.profile.phone)).toBeNull();
    }
  });

  it('finds a member by their email in any case, leaving the figures as they were', async () => {
    const user = await renderPage(LEAD);
    await screen.findByRole('table');
    const before = kpis();
    const target = committeeMembersSeenBy(LEAD, 'لجنة البرمجة')[0];
    if (!target) throw new Error('no member');
    await user.type(
      screen.getByRole('searchbox', { name: SEARCH }),
      target.user.uniEmail.toUpperCase(),
    );
    await waitFor(() => expect(rowsOf()).toHaveLength(1));
    expect(within(rowsOf().at(0) ?? document.body).getByText(target.user.fullName)).toBeTruthy();
    expect(kpis()).toEqual(before);
  });

  it('finds a member by their phone as typed in Saudi format, and shows the number only then', async () => {
    const user = await renderPage(LEAD);
    await screen.findByRole('table');
    const target = committeeMembersSeenBy(LEAD, 'لجنة البرمجة').find((m) => m.profile.phone);
    const phone = target?.profile.phone;
    if (!phone) throw new Error('no member with a phone');
    const local = `0${phone.replace(/^\+966/, '')}`;
    await user.type(screen.getByRole('searchbox', { name: SEARCH }), local);
    await waitFor(() => expect(rowsOf().length).toBeGreaterThan(0));
    expect(within(rowsOf().at(0) ?? document.body).getByText(phone)).toBeTruthy();
    await user.clear(screen.getByRole('searchbox', { name: SEARCH }));
    await waitFor(() => expect(screen.queryByText(phone)).toBeNull());
  });

  it('finds nobody from outside the lead’s committee, even by their exact email', async () => {
    const user = await renderPage(LEAD);
    await screen.findByRole('table');
    const inScope = new Set(
      committeeMembersSeenBy(LEAD, 'لجنة البرمجة').map((member) => member.user.uniEmail),
    );
    const outsider = committeeMembersSeenBy(ADMIN, 'لجنة التصميم').find(
      (member) => !inScope.has(member.user.uniEmail),
    );
    if (!outsider) throw new Error('no member outside the lead’s committee');
    await user.type(screen.getByRole('searchbox', { name: SEARCH }), outsider.user.uniEmail);
    expect(await screen.findByText('لا نتائج مطابقة')).toBeTruthy();
  });

  it('shows the member’s email in the dialog that records their points', async () => {
    const user = await renderPage(LEAD);
    const first = (await screen.findAllByRole('row'))[1];
    if (!first) throw new Error('no row');
    const name = within(first).getByRole('button', { name: /^سجل / }).textContent ?? '';
    await user.click(within(first).getByRole('button', { name: `رصد نقاط لـ ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    const email = committeeMembersSeenBy(LEAD, 'لجنة البرمجة').find(
      (member) => member.user.fullName === name,
    )?.user.uniEmail;
    if (!email) throw new Error('the row’s member is not in the committee');
    expect(within(dialog).getByText(email)).toBeTruthy();
  });
});
