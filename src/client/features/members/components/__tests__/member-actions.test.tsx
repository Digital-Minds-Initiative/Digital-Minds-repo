// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { getMockDb, resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { MembersPage } from '../members-page';

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
// The table keeps its state in the URL; here the URL never changes.
const url = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.search) }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/members',
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const ADMIN = 'demo-staff-01@uqu.edu.sa';
/** Officer of نادي الحاسبات. */
const OFFICER = 's000000001@st.uqu.edu.sa';
/** Leads لجنة البرمجة in نادي الحاسبات. */
const LEAD = 's000000004@st.uqu.edu.sa';

/** A member of لجنة البرمجة, so the officer and the lead both see them. */
const MEMBER_NAME = 'بندر عادل الزهراني';

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

async function renderTable(email: string, search = '') {
  actor.email = email;
  url.search = search;
  const user = userEvent.setup();
  renderWithProviders(<MembersPage title="الأعضاء" description="وصف" />);
  await screen.findByRole('button', { name: `فتح ملف ${MEMBER_NAME}` }, { timeout: 8000 });
  // The table redraws its rows once the club's types arrive (the type badges depend on them); let
  // that settle so a click is not lost to a row replaced between press and release.
  await waitFor(() => expect(screen.getByTestId('member-stat-total')).toBeTruthy(), {
    timeout: 8000,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return user;
}

async function openMember(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: `فتح ملف ${MEMBER_NAME}` }));
  return screen.findByRole('dialog', { name: new RegExp(MEMBER_NAME) }, { timeout: 8000 });
}

describe('member actions — who is offered what', { timeout: 30_000 }, () => {
  it('offers adding members to officers and full admins, not to committee leads', async () => {
    await renderTable(OFFICER);
    expect(screen.getByRole('button', { name: 'إضافة عضو' })).toBeTruthy();
  });

  it('does not offer the add button to a committee lead', async () => {
    await renderTable(LEAD);
    expect(screen.queryByRole('button', { name: 'إضافة عضو' })).toBeNull();
  });

  it('offers the CSV import to officers, and not to a committee lead', async () => {
    await renderTable(OFFICER);
    expect(screen.getByRole('button', { name: 'استيراد من ملف' })).toBeTruthy();
    cleanup();
    await renderTable(LEAD);
    expect(screen.queryByRole('button', { name: 'استيراد من ملف' })).toBeNull();
  });

  it('shows an officer edit and remove on a member, and a lead only edit (the type)', async () => {
    const user = await renderTable(OFFICER);
    let dialog = await openMember(user);
    expect(within(dialog).getByRole('button', { name: 'تعديل البيانات' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'إزالة من النادي' })).toBeTruthy();
    expect(
      await within(dialog).findByRole('button', { name: 'إضافة إلى لجنة' }, { timeout: 8000 }),
    ).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    resetMockDb();
    // A second render for the lead.
    document.body.innerHTML = '';
    const lead = await renderTable(LEAD);
    dialog = await openMember(lead);
    expect(within(dialog).getByRole('button', { name: 'تعديل البيانات' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'إزالة من النادي' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'إضافة إلى لجنة' })).toBeNull();
  });
});

describe('member actions — adding', { timeout: 30_000 }, () => {
  it('adds a person by university email and shows them in the list', async () => {
    const user = await renderTable(OFFICER);
    await user.click(screen.getByRole('button', { name: 'إضافة عضو' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة عضو' });
    await user.type(within(dialog).getByLabelText(/البريد الجامعي/), 'newcomer.test@st.uqu.edu.sa');
    await user.type(within(dialog).getByLabelText(/الاسم الكامل/), 'زائر جديد للاختبار');
    await user.click(within(dialog).getByRole('button', { name: 'إضافة العضو' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 8000 });
    expect(
      getMockDb().users.some((candidate) => candidate.uniEmail === 'newcomer.test@st.uqu.edu.sa'),
    ).toBe(true);
    // The account is not registered yet: the person claims it when they sign up.
    const added = getMockDb().users.find(
      (candidate) => candidate.uniEmail === 'newcomer.test@st.uqu.edu.sa',
    );
    expect(added?.registered).toBe(false);
  });

  it('refuses an address outside the university on the email field', async () => {
    const user = await renderTable(OFFICER);
    await user.click(screen.getByRole('button', { name: 'إضافة عضو' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة عضو' });
    await user.type(within(dialog).getByLabelText(/البريد الجامعي/), 'someone@gmail.com');
    await user.type(within(dialog).getByLabelText(/الاسم الكامل/), 'شخص من الخارج');
    await user.click(within(dialog).getByRole('button', { name: 'إضافة العضو' }));
    expect(
      await within(dialog).findByText(/ينتهي بـ uqu\.edu\.sa/, undefined, { timeout: 8000 }),
    ).toBeTruthy();
    // Nothing was written, and the form stays open.
    expect(getMockDb().users.some((candidate) => candidate.uniEmail === 'someone@gmail.com')).toBe(
      false,
    );
  });

  it('tells you someone is already in the club and opens their file', async () => {
    const user = await renderTable(OFFICER);
    const existing = getMockDb().users.find((candidate) => candidate.fullName === MEMBER_NAME);
    if (!existing) throw new Error('demo member missing');
    await user.click(screen.getByRole('button', { name: 'إضافة عضو' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة عضو' });
    await user.type(within(dialog).getByLabelText(/البريد الجامعي/), existing.uniEmail);
    await user.type(within(dialog).getByLabelText(/الاسم الكامل/), MEMBER_NAME);
    await user.click(within(dialog).getByRole('button', { name: 'إضافة العضو' }));
    expect(
      await within(dialog).findByText('هذا الشخص عضو في النادي بالفعل.', undefined, {
        timeout: 8000,
      }),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'فتح ملفه' }));
    expect(
      await screen.findByRole('dialog', { name: new RegExp(MEMBER_NAME) }, { timeout: 8000 }),
    ).toBeTruthy();
  });
});

describe('member actions — editing, committees and removing', { timeout: 40_000 }, () => {
  it('edits the phone number and the file shows it', async () => {
    const user = await renderTable(OFFICER);
    const file = await openMember(user);
    await user.click(within(file).getByRole('button', { name: 'تعديل البيانات' }));
    const edit = await screen.findByRole('dialog', {
      name: new RegExp(`تعديل بيانات ${MEMBER_NAME}`),
    });
    const phone = within(edit).getByLabelText('الجوال');
    await user.clear(phone);
    await user.type(phone, '0551234567');
    await user.click(within(edit).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /تعديل بيانات/ })).toBeNull(), {
      timeout: 8000,
    });
    const refreshed = await screen.findByRole('dialog', { name: new RegExp(MEMBER_NAME) });
    expect(
      await within(refreshed).findByText('+966551234567', undefined, { timeout: 8000 }),
    ).toBeTruthy();
  });

  it('tells you nothing changed instead of sending an empty edit', async () => {
    const user = await renderTable(OFFICER);
    const file = await openMember(user);
    await user.click(within(file).getByRole('button', { name: 'تعديل البيانات' }));
    const edit = await screen.findByRole('dialog', {
      name: new RegExp(`تعديل بيانات ${MEMBER_NAME}`),
    });
    await user.click(within(edit).getByRole('button', { name: 'حفظ التعديلات' }));
    expect(await within(edit).findByText('لم يتغير شيء.')).toBeTruthy();
  });

  it('gives a committee lead the membership type only', async () => {
    const user = await renderTable(LEAD);
    const file = await openMember(user);
    await user.click(within(file).getByRole('button', { name: 'تعديل البيانات' }));
    const edit = await screen.findByRole('dialog', {
      name: new RegExp(`تعديل بيانات ${MEMBER_NAME}`),
    });
    expect(within(edit).getByLabelText('نوع العضوية')).toBeTruthy();
    expect(within(edit).queryByLabelText('الاسم الكامل')).toBeNull();
    expect(within(edit).queryByLabelText('الجوال')).toBeNull();
  });

  it('adds the member to a committee and takes them out again', async () => {
    const user = await renderTable(OFFICER);
    const file = await openMember(user);
    const before = within(file).getAllByRole('listitem').length;
    await user.click(
      await within(file).findByRole('combobox', { name: 'إضافة إلى لجنة' }, { timeout: 8000 }),
    );
    const option = (await screen.findAllByRole('option'))[0];
    if (!option) throw new Error('no committee to add to');
    const committee = option.textContent ?? '';
    await user.click(option);
    await user.click(within(file).getByRole('button', { name: 'إضافة إلى لجنة' }));
    // The committee's name is also in the picker, so the list itself is what is counted.
    await waitFor(() => expect(within(file).getAllByRole('listitem').length).toBe(before + 1), {
      timeout: 8000,
    });

    await user.click(
      within(file).getByRole('button', { name: `إزالة ${MEMBER_NAME} من ${committee}` }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'إزالة' }));
    await waitFor(() => expect(within(file).getAllByRole('listitem').length).toBe(before), {
      timeout: 8000,
    });
  });

  it('removes the member from the club after a confirmation', async () => {
    const user = await renderTable(OFFICER);
    const file = await openMember(user);
    await user.click(within(file).getByRole('button', { name: 'إزالة من النادي' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'إزالة من النادي' }));
    await waitFor(
      () => expect(screen.queryByRole('button', { name: `فتح ملف ${MEMBER_NAME}` })).toBeNull(),
      { timeout: 8000 },
    );
    // Soft removal: the membership is kept, marked removed, with its roles reset.
    const membership = getMockDb().memberships.find(
      (candidate) => getMockDb().usersById.get(candidate.userId)?.fullName === MEMBER_NAME,
    );
    expect(membership?.removedAt).not.toBeNull();
    expect(membership?.role).toBe('MEMBER');
  });
});

describe('member actions — for a full admin', { timeout: 30_000 }, () => {
  it('offers adding to a club chosen among all of them', async () => {
    actor.email = ADMIN;
    const user = userEvent.setup();
    renderWithProviders(<MembersPage title="الأعضاء" description="وصف" />);
    await user.click(await screen.findByRole('button', { name: 'إضافة عضو' }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة عضو' });
    expect(within(dialog).getByRole('combobox', { name: /النادي/ })).toBeTruthy();
  });
});

describe('members page — numbers and table', { timeout: 30_000 }, () => {
  it('shows the member total and, to an officer, how many hold a role', async () => {
    await renderTable(OFFICER);
    const number = (key: string) => Number(screen.getByTestId(`member-stat-${key}`).textContent);
    await waitFor(() => expect(number('total')).toBeGreaterThan(0), { timeout: 8000 });
    await waitFor(() => expect(number('roles')).toBeGreaterThan(0), { timeout: 8000 });
  });

  it('shows a committee lead only the total: who holds the roles is for officers', async () => {
    await renderTable(LEAD);
    await waitFor(() => expect(screen.getByTestId('member-stat-total')).toBeTruthy(), {
      timeout: 8000,
    });
    expect(screen.queryByTestId('member-stat-roles')).toBeNull();
  });

  it('draws each member with initials and no empty role column', async () => {
    await renderTable(OFFICER);
    const row = screen.getByRole('button', { name: `فتح ملف ${MEMBER_NAME}` }).closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('بع')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'الصلاحية' })).toBeNull();
    // The management role sits beside the type for those who hold it.
    expect(screen.getAllByText('مسؤول نادي').length).toBeGreaterThan(0);
  });

  it('colours the membership type by its place on the ladder', async () => {
    await renderTable(OFFICER);
    const first = screen.getAllByText('رئيس النادي')[0];
    const plain = screen.getAllByText('عضو').find((node) => node.tagName === 'SPAN');
    expect(first?.className).toContain('warning');
    expect(plain?.className).not.toContain('warning');
  });

  it('copies a member’s email from the button beside it', async () => {
    const user = await renderTable(OFFICER);
    await user.click(screen.getByRole('button', { name: `نسخ بريد ${MEMBER_NAME}` }));
    expect(await navigator.clipboard.readText()).toBe('s000000019@st.uqu.edu.sa');
  });
});

describe('members page — period and points order', { timeout: 30_000 }, () => {
  it('labels the points column with the committee and the period, ranked highest first', async () => {
    const committee = getMockDb().committees.find((c) => c.name === 'لجنة البرمجة');
    if (!committee) throw new Error('committee missing');
    await renderTable(OFFICER, `committeeId=${committee.id}&from=2026-01-01&to=2026-06-30`);
    const header = await screen.findByRole('columnheader', { name: /نقاط لجنة البرمجة/ });
    expect(within(header).getByText(/2026/)).toBeTruthy();
    expect(header.getAttribute('aria-sort')).toBe('descending');
    const points = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        Number(within(row).getAllByRole('cell').at(-4)?.textContent?.replace(/\D/g, '')),
      );
    expect(points.length).toBeGreaterThan(1);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
  });
});
