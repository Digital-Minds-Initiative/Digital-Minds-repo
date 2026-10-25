// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { getMockDb, resetMockDb } from '@/client/mocks/db';
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
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

/** Officer of نادي الحاسبات. */
const OFFICER = 's000000001@st.uqu.edu.sa';
/** Leads لجنة البرمجة in نادي الحاسبات. */
const LEAD = 's000000004@st.uqu.edu.sa';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
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

type User = ReturnType<typeof userEvent.setup>;

async function renderPage(email: string) {
  actor.email = email;
  const user = userEvent.setup();
  renderWithProviders(<PointsScreen title="النقاط" description="وصف" />);
  await screen.findByRole('region', { name: /^أرصدة أعضاء / }, { timeout: 8000 });
  return user;
}

const balances = () => screen.getByRole('region', { name: /^أرصدة أعضاء / });

/** The names in the committee's table, in the order shown. */
const memberNames = () =>
  within(balances())
    .getAllByRole('button', { name: /^سجل / })
    .map((button) => button.textContent ?? '');

/** The balance in a member's row ("75 نقطة" → 75). */
function balanceOf(name: string): number {
  const row = within(balances())
    .getByRole('button', { name: `سجل ${name}` })
    .closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return Number(
    within(row)
      .getAllByRole('cell')
      .at(-2)
      ?.textContent?.replace(/[^\d-]/g, ''),
  );
}

const checkboxLabels = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('checkbox')
    .map((box) => box.getAttribute('aria-label') ?? '');

async function fill(user: User, dialog: HTMLElement, amount: string) {
  await user.type(within(dialog).getByLabelText(/عدد النقاط/), amount);
  await user.type(within(dialog).getByLabelText(/السبب/), 'حضور ورشة');
}

async function openCommitteeBatch(user: User) {
  await user.click(screen.getByRole('button', { name: 'رصد جماعي' }));
  return screen.findByRole('dialog', { name: 'رصد جماعي لـ لجنة البرمجة' });
}

async function openClubBatch(user: User) {
  await user.click(screen.getByRole('button', { name: 'رصد على مستوى النادي' }));
  return screen.findByRole('dialog', { name: 'رصد على مستوى نادي الحاسبات' }, { timeout: 8000 });
}

describe('bulk points — who is offered what', { timeout: 30_000 }, () => {
  it('offers a committee lead the committee batch only', async () => {
    await renderPage(LEAD);
    expect(screen.getByRole('button', { name: 'رصد جماعي' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'رصد على مستوى النادي' })).toBeNull();
  });

  it('offers an officer both', async () => {
    await renderPage(OFFICER);
    expect(screen.getByRole('button', { name: 'رصد جماعي' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'رصد على مستوى النادي' })).toBeTruthy();
  });
});

describe('bulk points — one committee', { timeout: 30_000 }, () => {
  it('gives each ticked member the points and nobody else', async () => {
    const user = await renderPage(LEAD);
    const [first = '', second = '', third = ''] = memberNames();
    const before = { first: balanceOf(first), second: balanceOf(second), third: balanceOf(third) };

    const dialog = await openCommitteeBatch(user);
    expect(
      within(dialog)
        .getByRole('button', { name: /^تسجيل النقاط/ })
        .hasAttribute('disabled'),
    ).toBe(true);
    await user.click(within(dialog).getByRole('checkbox', { name: first }));
    await user.click(within(dialog).getByRole('checkbox', { name: second }));
    expect(within(dialog).getByText(`2 من ${checkboxLabels(dialog).length} محدد`)).toBeTruthy();
    await fill(user, dialog, '6');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضوين' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(balanceOf(first)).toBe(before.first + 6), { timeout: 8000 });
    expect(balanceOf(second)).toBe(before.second + 6);
    expect(balanceOf(third)).toBe(before.third);
  });

  it('selects the visible members, narrowed by the search, and can clear them', async () => {
    const user = await renderPage(LEAD);
    const dialog = await openCommitteeBatch(user);
    const all = checkboxLabels(dialog);
    await user.type(
      within(dialog).getByRole('searchbox', { name: 'ابحث في الأعضاء' }),
      all[0]?.split(' ')[0] ?? '',
    );
    await user.click(within(dialog).getByRole('button', { name: 'تحديد الظاهرين' }));
    const ticked = within(dialog).getAllByRole('checkbox', { checked: true });
    expect(ticked.length).toBeGreaterThan(0);
    expect(ticked.length).toBeLessThanOrEqual(all.length);
    await user.click(within(dialog).getByRole('button', { name: 'إلغاء التحديد' }));
    expect(within(dialog).queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });

  it('asks for the points and the reason, and refuses a zero, before sending anything', async () => {
    const user = await renderPage(LEAD);
    const dialog = await openCommitteeBatch(user);
    await user.click(within(dialog).getAllByRole('checkbox')[0] as HTMLElement);
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضو واحد' }));
    expect(await within(dialog).findAllByText('هذا الحقل مطلوب.')).not.toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/عدد النقاط/), '0');
    await user.type(within(dialog).getByLabelText(/السبب/), 'سبب');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضو واحد' }));
    // The form's own rule, so nothing is sent for it.
    expect(
      await within(dialog).findByText('النص أقصر من الحد الأدنى، أو القيمة أقل من الحد المسموح.'),
    ).toBeTruthy();
  });

  it('writes nothing when one member can no longer be given points, unticks them, then sends the rest', async () => {
    const user = await renderPage(LEAD);
    const [good = '', stale = ''] = memberNames();
    const before = balanceOf(good);

    const dialog = await openCommitteeBatch(user);
    await user.click(within(dialog).getByRole('checkbox', { name: good }));
    await user.click(within(dialog).getByRole('checkbox', { name: stale }));
    await fill(user, dialog, '4');

    // Meanwhile someone takes `stale` out of the committee.
    const db = getMockDb();
    const person = db.users.find((candidate) => candidate.fullName === stale);
    for (const membership of db.memberships.filter((m) => m.userId === person?.id)) {
      for (const link of membership.committees) link.removed = true;
    }

    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    expect(await within(dialog).findByText(/ولم يُسجَّل شيء/)).toBeTruthy();
    // A lead can no longer see someone who left their committee, so for them it is "not found".
    expect(within(dialog).getByText('غير موجود ضمن نطاقك')).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: stale }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(dialog).getByRole('checkbox', { name: good }).getAttribute('aria-checked')).toBe(
      'true',
    );
    // Not even the member who was fine was written (read from the database: the page behind the
    // dialog is hidden from the accessibility tree).
    const written = () => db.transactions.filter((tx) => tx.reason === 'حضور ورشة');
    expect(written()).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضو واحد' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(balanceOf(good)).toBe(before + 4), { timeout: 8000 });
    expect(written()).toHaveLength(1);
  });
});

describe('bulk points — a whole club', { timeout: 30_000 }, () => {
  it('lists every committee, warns about someone ticked twice, and writes in both', async () => {
    const user = await renderPage(OFFICER);
    const dialog = await openClubBatch(user);
    const groups = within(dialog)
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'))
      .filter((label) => label?.startsWith('لجنة'));
    expect(groups.sort()).toEqual(
      ['لجنة الإعلام', 'لجنة البرمجة', 'لجنة التصميم', 'لجنة الفعاليات'].sort(),
    );

    // Somebody in two committees, ticked in both.
    const byMember = new Map<string, string[]>();
    for (const label of checkboxLabels(dialog).filter((each) => each.includes(' · '))) {
      const member = label.split(' · ')[0] ?? '';
      byMember.set(member, [...(byMember.get(member) ?? []), label]);
    }
    const both = [...byMember.values()].find((labels) => labels.length > 1);
    expect(both, 'a member in two committees in the demo').toBeDefined();
    for (const label of both ?? []) {
      await user.click(within(dialog).getByRole('checkbox', { name: label }));
    }
    expect(within(dialog).getByRole('note').textContent).toContain('عضو واحد محدد في أكثر من لجنة');

    await fill(user, dialog, '3');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل النقاط لعضوين' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 8000 });
  });

  it('a committee checkbox ticks all of its members', async () => {
    const user = await renderPage(OFFICER);
    const dialog = await openClubBatch(user);
    await user.click(within(dialog).getByRole('checkbox', { name: 'تحديد كل أعضاء لجنة التصميم' }));
    const design = within(dialog).getByRole('group', { name: 'لجنة التصميم' });
    const boxes = within(design)
      .getAllByRole('checkbox')
      .filter((box) => box.getAttribute('aria-label')?.includes(' · '));
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.getAttribute('aria-checked')).toBe('true');
  });
});
