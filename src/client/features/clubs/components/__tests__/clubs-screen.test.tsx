// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@/client/lib/api-client';
import { getMockDb, resetMockDb } from '@/client/mocks/db';
import { server } from '@/client/mocks/node';
import { renderWithProviders } from '@tests/utils/render';

import { ClubsScreen } from '../clubs-screen';

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
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    'aria-label'?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
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

async function renderScreen(email: string) {
  actor.email = email;
  const user = userEvent.setup();
  renderWithProviders(<ClubsScreen title="الأندية واللجان" description="وصف" />);
  return user;
}

// Each case renders a screen, waits for MSW and clicks through dialogs: allow for a busy machine.
describe('ClubsScreen — what each role is offered', { timeout: 20_000 }, () => {
  it('lets a full admin create clubs and manage committees and types', async () => {
    await renderScreen(ADMIN);
    expect(await screen.findByRole('button', { name: 'إضافة نادٍ' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'إضافة لجنة' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إجراءات النادي' })).toBeTruthy();
    // Both clubs are listed, and the admin's role is named.
    expect(screen.getByRole('button', { name: /نادي الحاسبات/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /نادي طويق/ })).toBeTruthy();
    expect(screen.getByText('مسؤول عام')).toBeTruthy();
  });

  it('gives a club officer membership types only: no clubs, no committees to manage', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    expect(screen.queryByRole('button', { name: 'إضافة نادٍ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'إجراءات النادي' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'إضافة لجنة' })).toBeNull();
    expect(screen.getByText('مسؤول نادي')).toBeTruthy();
    // An officer reads every committee of the club…
    expect(await screen.findByText('لجنة التصميم')).toBeTruthy();
    expect(screen.getByText('لجنة البرمجة')).toBeTruthy();
    // …and runs the club's membership types.
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    expect(await screen.findByRole('button', { name: 'إضافة نوع' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /تقديم عضو فعال/ })).toBeTruthy();
  });

  it('shows a committee lead only their own committee, and membership types read-only', async () => {
    const user = await renderScreen(LEAD);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    expect(screen.getByText('مسؤول لجنة')).toBeTruthy();
    expect(await screen.findByText('لجنة البرمجة')).toBeTruthy();
    expect(screen.queryByText('لجنة التصميم')).toBeNull();
    expect(screen.getByText('تظهر لك اللجان التي تقودها فقط.')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    await screen.findByText('رئيس النادي');
    expect(screen.queryByRole('button', { name: 'إضافة نوع' })).toBeNull();
    expect(screen.queryByRole('button', { name: /تقديم/ })).toBeNull();
    expect(screen.getByText(/يمكنك الاطلاع فقط/)).toBeTruthy();
  });

  it("explains an officer's empty list when their only club is archived, and opens it on request", async () => {
    for (const club of getMockDb().clubs) {
      if (club.name === 'نادي الحاسبات') club.archivedAt = new Date().toISOString();
    }
    const user = await renderScreen(OFFICER);
    expect(await screen.findByText('لا تظهر لك أندية الآن')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'إظهار المؤرشف', hidden: false }));
    expect(await screen.findByRole('heading', { name: /نادي الحاسبات/ })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('مؤرشف');
  });
});

describe('ClubsScreen — changes', { timeout: 20_000 }, () => {
  it('refuses a duplicate committee name on the field and keeps the form open', async () => {
    const user = await renderScreen(ADMIN);
    await user.click(await screen.findByRole('button', { name: 'إضافة لجنة' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/اسم اللجنة/), 'لجنة  البرمجة ');
    await user.click(within(dialog).getByRole('button', { name: 'إضافة اللجنة' }));
    expect(await within(dialog).findByText('الاسم مستخدم بالفعل.')).toBeTruthy();
  });

  it('archives a club: it is marked, and new committees are no longer offered', async () => {
    const user = await renderScreen(ADMIN);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('button', { name: 'إجراءات النادي' }));
    await user.click(await screen.findByRole('menuitem', { name: 'أرشفة النادي' }));
    await user.click(await screen.findByRole('button', { name: 'أرشفة النادي' }));
    // Archived clubs leave the list unless "show archived" is on; the detail follows the next club.
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /نادي الحاسبات/ })).toBeNull(),
      {
        timeout: 5000,
      },
    );
    // While the confirmation dialog is still closing, the page behind it is hidden from queries.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5000 });
    await user.click(screen.getByRole('switch', { name: 'إظهار المؤرشف' }));
    await user.click(
      await screen.findByRole('button', { name: /نادي الحاسبات/ }, { timeout: 5000 }),
    );
    expect(await screen.findByText(/هذا النادي مؤرشف/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(
      (await screen.findByRole('button', { name: 'إضافة لجنة' })).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('adds a membership type at the end, then deletes an unused one', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    await user.click(await screen.findByRole('button', { name: 'إضافة نوع' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/اسم النوع/), 'زائر');
    await user.click(within(dialog).getByRole('button', { name: 'إضافة النوع' }));
    expect(await screen.findByText('زائر')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'قائمة النوع زائر' }));
    await user.click(await screen.findByRole('menuitem', { name: 'حذف' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(/سيُحذف نهائياً/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'حذف النوع' }));
    await waitFor(() => expect(screen.queryByText('زائر')).toBeNull());
  });

  it('asks where to move the members before deleting a type that is in use', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    await user.click(await screen.findByRole('button', { name: 'قائمة النوع عضو فعال' }));
    await user.click(await screen.findByRole('menuitem', { name: 'حذف' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/اختر نوعاً آخر من النادي/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'حذف النوع' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('moves a membership type down and keeps the order', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    await user.click(await screen.findByRole('button', { name: 'تأخير رئيس النادي' }));
    await waitFor(() => {
      const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
      const chief = rows.findIndex((text) => text.includes('رئيس النادي'));
      const deputy = rows.findIndex((text) => text.includes('نائب الرئيس'));
      expect(deputy).toBeLessThan(chief);
    });
  });
});

describe('ClubsScreen — the richer club view', { timeout: 30_000 }, () => {
  it('shows three numbers in the club card that agree with the tabs', async () => {
    await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    // The three numbers come from three independent queries, so they do not land together:
    // waiting for one of them says nothing about the other two.
    await waitFor(
      () => {
        expect(screen.getByTestId('club-stat-committees').textContent).toBe('4');
        expect(screen.getByTestId('club-stat-types').textContent).toBe('5');
        expect(Number(screen.getByTestId('club-stat-members').textContent)).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );
    // The club's code and the person's role sit in the card as badges.
    expect(screen.getByText('computing').tagName).toBe('CODE');
    expect(screen.getByText('مسؤول نادي')).toBeTruthy();
  });

  it('puts the tabs and the archived switch in one bar under the card', async () => {
    await renderScreen(OFFICER);
    const club = await screen.findByRole('article', { name: 'نادي الحاسبات' });
    const bar = within(club)
      .getByRole('switch', { name: 'إظهار المؤرشف' })
      .closest('div[class*="border-t-0"]');
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).getByRole('tab', { name: 'اللجان' })).toBeTruthy();
    expect(within(bar as HTMLElement).getByRole('tab', { name: 'أنواع العضوية' })).toBeTruthy();
  });

  it('tells an officer, beside the title, that committees are managed by the full admin', async () => {
    await renderScreen(OFFICER);
    const note = await screen.findByText('إدارة اللجان للمسؤول العام فقط', undefined, {
      timeout: 8000,
    });
    expect(note.closest('[role="note"]')).not.toBeNull();
  });

  it('gives each committee its member count, its status and a way to see its members', async () => {
    await renderScreen(OFFICER);
    const card = (
      await screen.findByRole('heading', { name: 'لجنة البرمجة' }, { timeout: 8000 })
    ).closest('li');
    if (!card) throw new Error('no committee card');
    await waitFor(() => expect(within(card).getByText(/^\d+ عضو$/)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(within(card).getByText('نشطة')).toBeTruthy();
    const link = within(card).getByRole('link', { name: 'عرض أعضاء لجنة البرمجة' });
    expect(link.getAttribute('href')).toMatch(/^\/dashboard\/members\?committeeId=/);
  });

  it('moves a membership type with the arrow keys on its handle', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    const handle = await screen.findByRole('button', { name: /اسحب لإعادة ترتيب رئيس النادي/ });
    handle.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(
      () => {
        const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
        expect(rows.findIndex((text) => text.includes('نائب الرئيس'))).toBeLessThan(
          rows.findIndex((text) => text.includes('رئيس النادي')),
        );
      },
      { timeout: 8000 },
    );
  });

  it('moves a membership type by dragging its row onto another', async () => {
    const user = await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    const handle = await screen.findByRole('button', { name: /اسحب لإعادة ترتيب رئيس النادي/ });
    const rows = screen.getAllByRole('listitem');
    const first = rows.find((row) => row.textContent?.includes('رئيس النادي'));
    const third = rows.find((row) => row.textContent?.includes('عضو فعال'));
    if (!first || !third) throw new Error('rows missing');
    fireEvent.pointerDown(handle);
    fireEvent.dragStart(first);
    fireEvent.dragOver(third);
    fireEvent.drop(third);
    await waitFor(
      () => {
        const names = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
        expect(names.findIndex((text) => text.includes('عضو فعال'))).toBeLessThan(
          names.findIndex((text) => text.includes('رئيس النادي')),
        );
      },
      { timeout: 8000 },
    );
  });

  it('shows no drag handle or order buttons to a committee lead', async () => {
    const user = await renderScreen(LEAD);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    await user.click(screen.getByRole('tab', { name: 'أنواع العضوية' }));
    await screen.findByText('رئيس النادي');
    expect(screen.queryByRole('button', { name: /اسحب لإعادة ترتيب/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^تقديم / })).toBeNull();
  });
});

describe('ClubsScreen — who may add clubs and committees', { timeout: 30_000 }, () => {
  it('offers adding a club and a committee to a full admin only', async () => {
    await renderScreen(ADMIN);
    expect(await screen.findByRole('button', { name: 'إضافة نادٍ' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'إضافة لجنة' })).toBeTruthy();
  });

  it('refuses a club officer both on the screen and — as the server does — in the mock', async () => {
    await renderScreen(OFFICER);
    await screen.findByRole('heading', { name: 'نادي الحاسبات' });
    expect(screen.queryByRole('button', { name: 'إضافة نادٍ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'إضافة لجنة' })).toBeNull();
    // The same person asking the API directly is told it is for full admins.
    const club = getMockDb().clubs.find((candidate) => candidate.name === 'نادي الحاسبات');
    const response = await fetch(`http://localhost:3000/api/v1/clubs/${club?.id}/committees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `dm-dev-actor=${OFFICER}` },
      body: JSON.stringify({ name: 'لجنة جديدة' }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.reason).toBe('full_admin_required');
  });
});
