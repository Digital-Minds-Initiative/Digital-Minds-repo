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

import { MemberPointsSheet, type PointsMember } from '../member-points-sheet';

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

/** The members `email` can see, exactly as the members table would list them. */
function membersSeenBy(email: string, status: 'active' | 'removed' = 'active'): Member[] {
  const db = getMockDb();
  const persona = findMockActor(db, email);
  if (!persona) throw new Error(`no persona ${email}`);
  return listMemberFixtures(db, persona, listMembersQuerySchema.parse({ pageSize: 100, status }))
    .items;
}

/** The member as the points page hands them to the ledger. */
function toPointsMember(member: Member): PointsMember {
  return {
    id: member.id,
    fullName: member.user.fullName,
    clubId: member.club.id,
    clubName: member.club.name,
    committees: member.committees.map(({ id, name }) => ({ id, name })),
    removed: member.removedAt !== null,
  };
}

async function openSheet(email: string, member: Member) {
  actor.email = email;
  const user = userEvent.setup();
  renderWithProviders(<MemberPointsSheet member={toPointsMember(member)} onClose={() => {}} />);
  await screen.findByRole('dialog');
  await screen.findByTestId('member-balance');
  return user;
}

const balance = () =>
  Number(screen.getByTestId('member-balance').textContent?.replace(/[^\d-]/g, ''));

describe('MemberPointsSheet — who sees what', { timeout: 20_000 }, () => {
  it('shows a committee lead only the balances and history of the committee they lead', async () => {
    const member = membersSeenBy(LEAD).find(
      (candidate) =>
        candidate.committees.some((c) => c.name === 'لجنة البرمجة') && candidate.points > 0,
    );
    if (!member) throw new Error('demo data has no programming member');
    await openSheet(LEAD, member);

    const split = screen.getByRole('list', { name: 'الرصيد حسب اللجنة' });
    const names = within(split)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(names.every((text) => text?.includes('لجنة البرمجة'))).toBe(true);
    expect(screen.getByText('تظهر هنا حركات لجانك التي تقودها فقط.')).toBeTruthy();
    // Every transaction in the list belongs to that committee.
    for (const row of within(screen.getByRole('list', { name: 'سجل الحركات' })).getAllByRole(
      'listitem',
    )) {
      expect(row.textContent).toContain('لجنة البرمجة');
    }
  });

  it('shows a club officer the whole club: every committee, no scope note', async () => {
    const member = membersSeenBy(OFFICER).find((candidate) => candidate.committees.length >= 2);
    if (!member) throw new Error('demo data has no member in two committees');
    await openSheet(OFFICER, member);
    expect(screen.queryByText('تظهر هنا حركات لجانك التي تقودها فقط.')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'اللجنة' })).toBeTruthy();
  });

  it('keeps a removed member readable but closed to new points', async () => {
    const removed = membersSeenBy(ADMIN, 'removed')[0];
    if (!removed) throw new Error('demo data has no removed member');
    await openSheet(ADMIN, removed);
    expect(screen.getByText(/العضو مُزال من النادي/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إضافة أو خصم' })).toBeNull();
  });
});

describe('MemberPointsSheet — changing the ledger', { timeout: 20_000 }, () => {
  async function leadAndMember() {
    const member = membersSeenBy(LEAD).find(
      (candidate) =>
        candidate.committees.some((c) => c.name === 'لجنة البرمجة') && candidate.points > 0,
    );
    if (!member) throw new Error('demo data has no programming member');
    return { member, user: await openSheet(LEAD, member) };
  }

  it('adds points, and the balance follows', async () => {
    const { user } = await leadAndMember();
    const before = balance();
    await user.click(screen.getByRole('button', { name: 'إضافة أو خصم' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    await user.type(within(dialog).getByLabelText(/عدد النقاط/), '15');
    await user.type(within(dialog).getByLabelText(/السبب/), 'حضور ورشة');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل الحركة' }));
    await waitFor(() => expect(balance()).toBe(before + 15));
    expect(await screen.findByText('حضور ورشة')).toBeTruthy();
  });

  it('deducts points, and refuses an empty reason and an amount over the limit', async () => {
    const { user } = await leadAndMember();
    const before = balance();
    await user.click(screen.getByRole('button', { name: 'إضافة أو خصم' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة أو خصم نقاط' });
    await user.click(within(dialog).getByRole('button', { name: 'خصم' }));
    await user.type(within(dialog).getByLabelText(/عدد النقاط/), '5000');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل الحركة' }));
    // Nothing is sent: the reason is missing and the amount is above 1000.
    expect((await within(dialog).findAllByText('هذا الحقل مطلوب.')).length).toBeGreaterThan(0);
    expect(
      within(dialog).getByText('النص أطول من الحد الأقصى، أو القيمة أكبر من الحد المسموح.'),
    ).toBeTruthy();
    expect(balance()).toBe(before);

    await user.clear(within(dialog).getByLabelText(/عدد النقاط/));
    await user.type(within(dialog).getByLabelText(/عدد النقاط/), '5');
    await user.type(within(dialog).getByLabelText(/السبب/), 'تأخر عن الموعد');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل الحركة' }));
    await waitFor(() => expect(balance()).toBe(before - 5));
  });

  it('cancels a transaction with a reason: it leaves the balance but stays in the history', async () => {
    const { user } = await leadAndMember();
    const before = balance();
    const list = screen.getByRole('list', { name: 'سجل الحركات' });
    const first = within(list).getAllByRole('listitem')[0];
    if (!first) throw new Error('no transaction');
    const amount = Number(
      within(first)
        .getByLabelText(/نقطة/)
        .textContent?.replace(/[^\d-]/g, ''),
    );
    await user.click(within(first).getByRole('button', { name: /^إلغاء حركة/ }));
    const dialog = await screen.findByRole('dialog', { name: 'إلغاء هذه الحركة؟' });
    // The reason is required.
    await user.click(within(dialog).getByRole('button', { name: 'إلغاء الحركة' }));
    expect((await within(dialog).findAllByText('هذا الحقل مطلوب.')).length).toBeGreaterThan(0);
    await user.type(within(dialog).getByLabelText(/سبب الإلغاء/), 'إدخال مكرر');
    await user.click(within(dialog).getByRole('button', { name: 'إلغاء الحركة' }));
    await waitFor(() => expect(balance()).toBe(before - amount));

    await user.click(screen.getByRole('checkbox', { name: 'إظهار الملغاة' }));
    const cancelled = await screen.findByText('ملغاة');
    expect(cancelled).toBeTruthy();
    expect(screen.getByText(/سبب الإلغاء: إدخال مكرر/)).toBeTruthy();
  });

  it('edits a transaction and shows what it said before', async () => {
    const { user } = await leadAndMember();
    const list = screen.getByRole('list', { name: 'سجل الحركات' });
    const first = within(list).getAllByRole('listitem')[0];
    if (!first) throw new Error('no transaction');
    await user.click(within(first).getByRole('button', { name: /^تعديل حركة/ }));
    const dialog = await screen.findByRole('dialog', { name: 'تعديل حركة' });
    const reason = within(dialog).getByLabelText(/السبب/);
    await user.clear(reason);
    await user.type(reason, 'سبب بعد التصحيح');
    await user.click(within(dialog).getByRole('button', { name: 'حفظ التعديل' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'تعديل حركة' })).toBeNull());
    expect(await screen.findByText('سبب بعد التصحيح')).toBeTruthy();
    // Demo rows may already have been edited, so the count is not asserted, only that it opens.
    const edited = within(screen.getByRole('list', { name: 'سجل الحركات' })).getAllByRole(
      'listitem',
    )[0];
    if (!edited) throw new Error('no transaction');
    await user.click(await within(edited).findByRole('button', { expanded: false }));
    expect((await screen.findAllByText(/قبل التغيير/)).length).toBeGreaterThan(0);
  });
});
